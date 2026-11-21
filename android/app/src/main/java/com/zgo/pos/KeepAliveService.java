package com.zgo.pos;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.os.SystemClock;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;

import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;

/**
 * Foreground service giữ app "thức" để nhận thông báo tức thì.
 *
 * Hai đường nhận tín hiệu:
 *  1. WebSocket tới Durable Object hub — có đơn mới là báo trong ~1 giây.
 *  2. Vòng lặp 30 giây — dự phòng khi WebSocket đứt.
 *
 * Đây là cách Zalo và các app nhắn tin làm: một service chạy foreground với
 * thông báo thường trực. Android không được phép giết service này.
 *
 * WebSocket viết tay bằng Socket thuần (không thêm thư viện) để APK gọn:
 * giao thức WebSocket khung nhỏ, chỉ cần đọc text frame.
 */
public class KeepAliveService extends Service {

    public static final int NOTIFICATION_ID = 1;

    /** Vòng lặp dự phòng khi WebSocket chết. */
    private static final long FALLBACK_INTERVAL_MS = 30_000L;

    /** Hub realtime (Durable Object) — cùng host với API. */
    private static final String WS_HOST = "cuahangtienloizgo-efi.pages.dev";
    private static final String WS_PATH = "/api/live";

    private Thread loopThread;
    private Thread wsThread;
    private Thread pingThread;
    private static volatile boolean running = false;
    private volatile long lastWsMessageAt = 0L;
    /** OutputStream của WebSocket đang mở — để thread ping gửi khung ping. */
    private volatile OutputStream wsOut = null;

    /**
     * Service đang chạy?
     *
     * Cờ này là `static` (không phải thuộc instance) vì watchdog chạy trong cùng
     * tiến trình và cần biết service có sống hay không. Nếu tiến trình bị giết
     * thì cờ tự về false cùng lúc — đúng ý nghĩa "service không chạy".
     */
    public static boolean isRunning() {
        return running;
    }

    public static void start(Context ctx) {
        Intent i = new Intent(ctx, KeepAliveService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ctx.startForegroundService(i);
        } else {
            ctx.startService(i);
        }
    }

    public static void stop(Context ctx) {
        ctx.stopService(new Intent(ctx, KeepAliveService.class));
    }

    @Override
    public void onCreate() {
        super.onCreate();
        AlertChecker.ensureChannels(this);
        startForeground(NOTIFICATION_ID, buildServiceNotification("Đang theo dõi đơn hàng"));
    }

    @Override
    public int onStartCommand(@Nullable Intent intent, int flags, int startId) {
        if (!running) {
            running = true;

            // Đường chính: WebSocket, nhận tín hiệu trong ~1 giây
            startWebSocketLoop();
            startPingLoop();

            // Đường dự phòng: kiểm tra định kỳ nếu WebSocket không có tin nhắn
            loopThread = new Thread(() -> {
                // Kiểm tra ngay lần đầu
                try {
                    AlertChecker.runAll(KeepAliveService.this);
                } catch (Exception e) {
                    android.util.Log.w("ZGOAlert", "lan dau: " + e.getMessage());
                }

                while (running) {
                    for (int i = 0; i < FALLBACK_INTERVAL_MS / 1000 && running; i++) {
                        SystemClock.sleep(1000);
                    }
                    if (!running) break;

                    // WebSocket vừa có tin nhắn -> nó đã xử lý, khỏi kiểm tra lại
                    boolean wsFresh = System.currentTimeMillis() - lastWsMessageAt < FALLBACK_INTERVAL_MS;
                    if (wsFresh) continue;

                    try {
                        AlertChecker.runAll(KeepAliveService.this);
                    } catch (Exception e) {
                        android.util.Log.w("ZGOAlert", "vong lap: " + e.getMessage());
                    }
                }
            }, "zgo-fallback-loop");
            loopThread.setDaemon(true);
            loopThread.start();

            android.util.Log.d("ZGOAlert", "foreground service da khoi dong");
        }

        return START_STICKY;
    }

    // ============================================================
    // WebSocket
    // ============================================================

    private void startWebSocketLoop() {
        wsThread = new Thread(() -> {
            int backoff = 1;
            while (running) {
                try {
                    connectAndListen();
                    backoff = 1;
                } catch (Exception e) {
                    android.util.Log.w("ZGOAlert", "ws loi: " + e.getMessage());
                }
                if (!running) break;

                // Nối lại với backoff tăng dần, tối đa 30 giây
                for (int i = 0; i < backoff && running; i++) SystemClock.sleep(1000);
                backoff = Math.min(backoff * 2, 30);
            }
        }, "zgo-ws");
        wsThread.setDaemon(true);
        wsThread.start();
    }

    /**
     * Gửi khung ping mỗi 50 giây.
     *
     * Durable Object có Hibernation nên không tự gửi gì khi im lặng. Nếu client
     * cũng không gửi, kết nối TCP bị timeout sau 2 phút và phải nối lại liên tục.
     * Ping giữ kết nối sống, tránh churn.
     */
    private void startPingLoop() {
        pingThread = new Thread(() -> {
            while (running) {
                for (int i = 0; i < 50 && running; i++) SystemClock.sleep(1000);
                if (!running) break;
                sendPing();
            }
        }, "zgo-ws-ping");
        pingThread.setDaemon(true);
        pingThread.start();
    }

    /** Khung ping phía client BẮT BUỘC phải có mask. */
    private void sendPing() {
        OutputStream out = wsOut;
        if (out == null) return;
        try {
            // FIN + opcode 0x9 (ping), MASK + độ dài 0
            byte[] frame = new byte[]{(byte) 0x89, (byte) 0x80};
            byte[] mask = new byte[4];
            new SecureRandom().nextBytes(mask);
            synchronized (this) {
                out.write(frame);
                out.write(mask);
                out.flush();
            }
        } catch (Exception e) {
            android.util.Log.d("ZGOAlert", "ping loi: " + e.getMessage());
        }
    }

    /** Mở kết nối WebSocket, đọc khung tin nhắn cho tới khi đứt. */
    private void connectAndListen() throws Exception {
        // Dùng TLS mặc định của hệ thống.
        //
        // Bản trước tự dựng SSLContext với X509TrustManager rỗng (chấp nhận mọi
        // chứng chỉ) để "cho chắc". Hệ quả: bất kỳ ai chèn được vào đường mạng
        // đều giả được hub và bơm frame {"type":"changed"} — hoặc tệ hơn, mạo
        // danh máy chủ. Android đã có CA store đúng, không cần tự làm.
        SSLSocketFactory factory = (SSLSocketFactory) SSLSocketFactory.getDefault();
        try (SSLSocket socket = (SSLSocket) factory.createSocket(WS_HOST, 443)) {
            socket.setSoTimeout(120_000);
            socket.startHandshake();

            String key = randomKey();
            String req = "GET " + WS_PATH + tokenQuery() + " HTTP/1.1\r\n"
                    + "Host: " + WS_HOST + "\r\n"
                    + "Upgrade: websocket\r\n"
                    + "Connection: Upgrade\r\n"
                    + "Sec-WebSocket-Key: " + key + "\r\n"
                    + "Sec-WebSocket-Version: 13\r\n"
                    + "User-Agent: ZGOPOS-Android\r\n"
                    + "\r\n";

            OutputStream out = socket.getOutputStream();
            out.write(req.getBytes(StandardCharsets.ISO_8859_1));
            out.flush();
            wsOut = out; // cho thread ping dùng

            InputStream in = socket.getInputStream();

            // Đọc header phản hồi tới hết \r\n\r\n
            if (!readHeaders(in)) {
                throw new IOException("không nâng cấp được WebSocket");
            }
            android.util.Log.d("ZGOAlert", "ws da ket noi");

            // Đọc từng khung
            while (running) {
                String msg = readTextFrame(in);
                if (msg == null) break; // kết nối đóng
                if (msg.isEmpty()) continue;

                lastWsMessageAt = System.currentTimeMillis();

                // Hub chỉ gửi {"type":"changed"} -> kiểm tra ngay
                if (msg.contains("changed")) {
                    AlertChecker.runAll(this);
                }
            }
        }
        wsOut = null;
        android.util.Log.d("ZGOAlert", "ws da dong");
    }

    /** Đọc phần header HTTP, trả về true nếu thấy 101 Switching Protocols. */
    private boolean readHeaders(InputStream in) throws IOException {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        int state = 0;
        while (state < 4) {
            int b = in.read();
            if (b < 0) return false;
            buf.write(b);
            if ((state == 0 || state == 2) && b == '\r') state++;
            else if ((state == 1 || state == 3) && b == '\n') state++;
            else state = (b == '\r') ? 1 : 0;
        }
        String headers = buf.toString("ISO-8859-1");
        return headers.startsWith("HTTP/1.1 101") || headers.contains(" 101 ");
    }

    /** Đọc một khung WebSocket dạng text. Trả về null khi kết nối đóng. */
    private String readTextFrame(InputStream in) throws IOException {
        int b0 = in.read();
        int b1 = in.read();
        if (b0 < 0 || b1 < 0) return null;

        int opcode = b0 & 0x0F;
        boolean masked = (b1 & 0x80) != 0;
        long len = b1 & 0x7F;

        if (len == 126) {
            len = ((in.read() & 0xFF) << 8) | (in.read() & 0xFF);
        } else if (len == 127) {
            len = 0;
            for (int i = 0; i < 8; i++) len = (len << 8) | (in.read() & 0xFF);
        }

        byte[] mask = null;
        if (masked) {
            mask = new byte[4];
            for (int i = 0; i < 4; i++) mask[i] = (byte) in.read();
        }

        // Khung đóng
        if (opcode == 0x8) return null;

        // Bỏ qua khung ping/pong, trả chuỗi rỗng để vòng lặp đọc tiếp
        if (opcode == 0x9 || opcode == 0xA) {
            skipFully(in, len);
            return "";
        }

        if (len > 1_000_000) { // khung quá lớn: bỏ
            skipFully(in, len);
            return "";
        }

        byte[] payload = new byte[(int) len];
        int read = 0;
        while (read < len) {
            int r = in.read(payload, read, (int) len - read);
            if (r < 0) return null;
            read += r;
        }

        if (mask != null) {
            for (int i = 0; i < payload.length; i++) {
                payload[i] ^= mask[i % 4];
            }
        }

        return new String(payload, StandardCharsets.UTF_8);
    }

    private void skipFully(InputStream in, long n) throws IOException {
        long left = n;
        while (left > 0) {
            long skipped = in.skip(left);
            if (skipped <= 0) break;
            left -= skipped;
        }
    }

    /**
     * Khoá ngẫu nhiên 16 byte, base64 theo chuẩn RFC 6455.
     *
     * Dùng android.util.Base64 (API 1) thay vì java.util.Base64 (API 26): minSdk
     * của app là 24, nên bản cũ sẽ ném NoClassDefFoundError trên Android 7.x và
     * WebSocket không bao giờ nối được ở những máy đó.
     */
    private String randomKey() {
        byte[] b = new byte[16];
        new SecureRandom().nextBytes(b);
        return android.util.Base64.encodeToString(b, android.util.Base64.NO_WRAP);
    }

    /** `?token=...` cho URL WebSocket, hoặc chuỗi rỗng khi chưa đăng nhập. */
    private String tokenQuery() {
        String token = AlertChecker.getToken(this);
        if (token == null || token.isEmpty()) return "";
        try {
            return "?token=" + java.net.URLEncoder.encode(token, "UTF-8");
        } catch (Exception e) {
            return "";
        }
    }

    // ============================================================
    // Vòng đời
    // ============================================================

    @Override
    public void onDestroy() {
        running = false;
        wsOut = null;
        if (loopThread != null) { loopThread.interrupt(); loopThread = null; }
        if (wsThread != null) { wsThread.interrupt(); wsThread = null; }
        if (pingThread != null) { pingThread.interrupt(); pingThread = null; }
        super.onDestroy();
        android.util.Log.d("ZGOAlert", "foreground service da dung");

        // Bị hệ điều hành giết (không phải người dùng đăng xuất): hẹn bật lại.
        // stopForeground(true) + START_STICKY không đủ trên nhiều máy Android
        // 12+, nhất là khi app vừa bị đẩy khỏi danh sách gần đây.
        if (AlertChecker.getToken(this) != null) {
            ServiceWatchdog.schedule(this);
        }
    }

    /** Người dùng đẩy app khỏi danh sách gần đây: bật lại ngay, không chờ 15 phút. */
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        super.onTaskRemoved(rootIntent);
        android.util.Log.d("ZGOAlert", "app bi day khoi recents: bat lai service");

        if (AlertChecker.getToken(this) == null) return;
        try {
            Intent restart = new Intent(getApplicationContext(), KeepAliveService.class);
            int flags = android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O
                    ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                    : PendingIntent.FLAG_UPDATE_CURRENT;
            PendingIntent pi = PendingIntent.getService(getApplicationContext(), 1, restart, flags);
            AlarmManager am = getSystemService(AlarmManager.class);
            if (am != null) {
                // 1 giây nữa bật lại — đủ để hệ thống hoàn tất việc gỡ task.
                am.set(AlarmManager.ELAPSED_REALTIME_WAKEUP,
                        SystemClock.elapsedRealtime() + 1000, pi);
            }
        } catch (Exception e) {
            android.util.Log.w("ZGOAlert", "khong hen bat lai duoc: " + e.getMessage());
        }
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private android.app.Notification buildServiceNotification(String text) {
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        return new NotificationCompat.Builder(this, AlertChecker.CHANNEL_SERVICE)
                .setSmallIcon(R.drawable.ic_stat_zgo)
                .setContentTitle("ZGO POS")
                .setContentText(text)
                .setPriority(NotificationCompat.PRIORITY_MIN)
                .setOngoing(true)
                .setSilent(true)
                .setShowWhen(false)
                .setContentIntent(pi)
                .setColor(0xFF2563EB)
                .build();
    }
}
