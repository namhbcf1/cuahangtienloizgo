package com.zgo.pos;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.SystemClock;

/**
 * Giữ service nền sống.
 *
 * Vì sao cần: khi app bị đẩy khỏi danh sách ứng dụng gần đây, hoặc bị hệ điều
 * hành giết vì thiếu RAM, service nền có thể chết và KHÔNG tự sống lại. Từ lúc
 * đó máy không còn báo đơn hàng nào — đúng triệu chứng "bán xong mà không thấy
 * thông báo khi app đóng".
 *
 * Cách chống: một báo thức lặp (AlarmManager) đánh thức app mỗi 15 phút để
 * kiểm tra. Nếu service không chạy thì bật lại. Báo thức lặp không chính xác
 * (`setInexactRepeating`) KHÔNG cần quyền SCHEDULE_EXACT_ALARM — chỉ cần đánh
 * thức trong khoảng ±vài phút là đủ cho việc này.
 *
 * Đây là lớp thứ ba, xếp sau:
 *   1. Foreground service (đường chính, giữ WebSocket).
 *   2. WorkManager 15 phút (đã có sẵn, chạy khi service chết).
 *   3. Báo thức này (bật lại service, để WebSocket — vốn nhanh hơn — hoạt động).
 */
public final class ServiceWatchdog {

    private static final int REQUEST_CODE = 4711;
    private static final long INTERVAL_MS = 15 * 60 * 1000L;

    private ServiceWatchdog() {
    }

    /** Đăng ký báo thức lặp. Gọi ở MainActivity và BootReceiver. */
    public static void schedule(Context ctx) {
        AlarmManager am = ctx.getSystemService(AlarmManager.class);
        if (am == null) return;

        try {
            am.setInexactRepeating(
                    AlarmManager.ELAPSED_REALTIME_WAKEUP,
                    SystemClock.elapsedRealtime() + INTERVAL_MS,
                    INTERVAL_MS,
                    pendingIntent(ctx));
        } catch (Exception e) {
            android.util.Log.w("ZGOAlert", "khong dat duoc bao thuc: " + e.getMessage());
        }
    }

    public static void cancel(Context ctx) {
        AlarmManager am = ctx.getSystemService(AlarmManager.class);
        if (am == null) return;
        try {
            am.cancel(pendingIntent(ctx));
        } catch (Exception ignored) {
            /* chưa đặt thì thôi */
        }
    }

    /**
     * Báo thức kêu: nếu chưa đăng nhập thì thôi, nếu service đang chạy thì thôi,
     * còn lại thì bật lại.
     */
    static void onAlarm(Context ctx) {
        if (AlertChecker.getToken(ctx) == null) return;
        if (KeepAliveService.isRunning()) return;

        android.util.Log.d("ZGOAlert", "watchdog: service khong chay, bat lai");
        try {
            KeepAliveService.start(ctx);
        } catch (Exception e) {
            android.util.Log.w("ZGOAlert", "watchdog khong bat duoc: " + e.getMessage());
        }
    }

    private static PendingIntent pendingIntent(Context ctx) {
        Intent i = new Intent(ctx, WatchdogReceiver.class);
        i.setAction(WatchdogReceiver.ACTION);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getBroadcast(ctx, REQUEST_CODE, i, flags);
    }
}