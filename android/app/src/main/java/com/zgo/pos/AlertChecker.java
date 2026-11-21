package com.zgo.pos;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.NumberFormat;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * Logic kiểm tra nghiệp vụ, dùng chung cho foreground service và WorkManager.
 *
 * Tối ưu hạn mức D1 Free: tất cả quy tắc dùng CHUNG một lần gọi /api/check.
 *
 * Trước đây mỗi vòng lặp 30 giây gọi:
 *    /api/transactions  -> quét 1.817 row
 *    /api/products      -> quét 837 row
 *    /api/shifts        -> 10 row
 *   = 2.664 row mỗi 30 giây = 7,7 triệu row/ngày cho MỘT máy.
 *   Gói Free chỉ cho 5 triệu row/ngày -> vượt hạn mức chỉ với một máy.
 *
 * Nay /api/check trả đúng những gì cần, dùng index và cache:
 *   ~20 row mỗi lần gọi -> giảm hơn 100 lần.
 */
public final class AlertChecker {

    public static final String CHANNEL_SALES = "zgo-sales";
    public static final String CHANNEL_ALERTS = "zgo-alerts";
    public static final String CHANNEL_SERVICE = "zgo-service";

    /** Gốc id thông báo; phần còn lại tính từ (kênh, khoá) để mỗi đơn một id. */
    private static final int NOTIF_ID_BASE = 1000;

    /**
     * Số thông báo giữ tối đa cho một kênh.
     *
     * Android giữ khoảng 50 thông báo cho một ứng dụng rồi tự bỏ dòng cũ nhất.
     * Giữ 30 để chủ động bỏ, và để khay không dài quá mức đọc được.
     */
    private static final int MAX_STACKED_PER_CHANNEL = 30;

    private static final String PREFS = "zgo_prefs";
    private static final String KEY_TOKEN = "auth_token";
    /** Danh sách id giao dịch do chính máy này bán (xem markSelfSale). */
    private static final String KEY_SELF_SALES = "self_sale_ids";
    /** Danh sách id thông báo đã đăng, mỗi kênh một khoá. */
    private static final String KEY_ID_LIST_PREFIX = "notif_ids_";
    private static final String API_BASE = "https://cuahangtienloizgo-efi.pages.dev/api";

    private AlertChecker() {
    }

    // ============================================================
    // Token phiên đăng nhập
    // ============================================================

    /**
     * Lưu token do trang web gửi qua cầu nối `ZGO.saveToken()`.
     *
     * Server đã bắt buộc token cho /check và /live, nên không có token thì
     * service không lấy được dữ liệu và không báo đơn mới. Truyền chuỗi rỗng
     * để xoá (lúc đăng xuất).
     */
    public static void saveToken(Context ctx, String token) {
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (token == null || token.isEmpty()) {
            prefs.edit().remove(KEY_TOKEN).apply();
        } else {
            prefs.edit().putString(KEY_TOKEN, token).apply();
        }
    }

    /** Token hiện tại, hoặc null nếu chưa đăng nhập. */
    public static String getToken(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_TOKEN, null);
    }

    /**
     * Trang web báo trước: "máy này sắp tạo giao dịch có id này".
     *
     * Gọi NGAY TRƯỚC khi POST /transactions. Nhờ vậy vòng kiểm tra nền biết
     * đơn ấy do chính máy này bán và bỏ qua — không bắn "Đơn hàng mới" chồng
     * lên "Thanh toán thành công" mà thu ngân vừa thấy.
     *
     * Server broadcast qua WebSocket rất nhanh (có khi trước cả khi trang web
     * nhận được response), nên không thể dựa vào việc gọi markNotified sau khi
     * bán xong — phải báo trước.
     */
    public static void markSelfSale(Context ctx, String txId) {
        if (txId == null || txId.isEmpty()) return;
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String cur = prefs.getString(KEY_SELF_SALES, "");
        // Giữ tối đa 20 id gần nhất; đủ cho mọi trường hợp thực tế và không
        // để prefs phình ra.
        String next = cur.isEmpty() ? txId : (cur + "," + txId);
        String[] parts = next.split(",");
        if (parts.length > 20) {
            StringBuilder sb = new StringBuilder();
            for (int i = parts.length - 20; i < parts.length; i++) {
                if (sb.length() > 0) sb.append(',');
                sb.append(parts[i]);
            }
            next = sb.toString();
        }
        prefs.edit().putString(KEY_SELF_SALES, next).apply();
    }

    /** Đơn này có phải do chính máy này vừa bán? */
    private static boolean isSelfSale(Context ctx, String txId) {
        if (txId == null || txId.isEmpty()) return false;
        String cur = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getString(KEY_SELF_SALES, "");
        if (cur.isEmpty()) return false;
        for (String s : cur.split(",")) {
            if (txId.equals(s)) return true;
        }
        return false;
    }

    /** Chạy toàn bộ quy tắc với MỘT lần gọi API. */
    public static void runAll(Context ctx) {
        JSONObject snap;
        try {
            snap = getObject(ctx, "/check");
        } catch (Exception e) {
            android.util.Log.w("ZGOAlert", "khong lay duoc du lieu: " + e.getMessage());
            return;
        }

        try {
            checkNewSales(ctx, snap);
        } catch (Exception e) {
            android.util.Log.w("ZGOAlert", "checkNewSales: " + e.getMessage());
        }
        try {
            checkShift(ctx, snap);
        } catch (Exception e) {
            android.util.Log.w("ZGOAlert", "checkShift: " + e.getMessage());
        }
        try {
            checkStock(ctx, snap);
        } catch (Exception e) {
            android.util.Log.w("ZGOAlert", "checkStock: " + e.getMessage());
        }
        try {
            checkDailyRevenue(ctx, snap);
        } catch (Exception e) {
            android.util.Log.w("ZGOAlert", "checkDailyRevenue: " + e.getMessage());
        }
    }

    // ============================================================
    // Quy tắc 0: ĐƠN HÀNG MỚI — báo ngay mỗi đơn, kể cả khi app đóng.
    // ============================================================
    private static void checkNewSales(Context ctx, JSONObject snap) {
        JSONArray recent = snap.optJSONArray("recent");
        if (recent == null || recent.length() == 0) return;

        String latestId = snap.optString("latestId", "");
        if (latestId.isEmpty()) return;

        SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String lastId = prefs.getString("last_tx_id", null);

        // Lần chạy đầu: chỉ ghi nhớ mốc, KHÔNG bắn hàng loạt thông báo cũ.
        if (lastId == null) {
            prefs.edit().putString("last_tx_id", latestId).apply();
            return;
        }
        if (lastId.equals(latestId)) return;

        // recent sắp mới nhất trước. Lấy những đơn mới hơn mốc, tối đa 5.
        java.util.List<JSONObject> fresh = new java.util.ArrayList<>();
        for (int i = 0; i < recent.length(); i++) {
            JSONObject t = recent.optJSONObject(i);
            if (t == null) continue;
            String id = t.optString("id", "");
            if (id.isEmpty() || id.equals(lastId)) break;
            // Đơn do chính máy này vừa bán: thu ngân đã thấy "Thanh toán thành
            // công" do trang web hiện, không báo thêm "Đơn hàng mới".
            if (isSelfSale(ctx, id)) continue;
            fresh.add(t);
        }

        // Không có đơn nào của máy khác trong 5 dòng gần nhất: vẫn phải kiểm tra
        // xem có đơn nào NẰM NGOÀI 5 dòng đó không (máy kia bán > 5 đơn trong
        // lúc service ngủ/mất mạng) rồi mới kết luận là không có gì để báo.
        if (fresh.isEmpty()) {
            int hidden = countNewer(ctx, latestId, lastId);
            if (hidden > 0) {
                // Không có dòng chi tiết nào: /count trả về CHÍNH LÀ số đơn chưa
                // báo (5 dòng gần nhất đều là đơn của máy này, phần dư nằm ngoài
                // cửa sổ). Vì không có dòng nào ở trên, không được nói "ngoài 5
                // dòng trên" — người đọc sẽ đi tìm mấy dòng không tồn tại.
                notifySale(ctx, "Đơn hàng mới",
                        hidden + " đơn mới đã bán (mạng trễ, không kèm chi tiết). Mốc #"
                                + latestId + ".",
                        "batch|" + latestId);
            }
            prefs.edit().putString("last_tx_id", latestId).apply();
            return;
        }

        // MỖI ĐƠN MỘT DÒNG, xếp chồng trong khay. Không gộp, không ghi đè:
        // gộp lại thì đọc không biết đơn nào, còn ghi đè thì mất đơn cũ.
        java.util.Collections.reverse(fresh); // cũ trước, mới sau
        for (JSONObject t : fresh) {
            double total = t.optDouble("total", 0);
            int qty = t.optInt("quantity", 0);
            String cashier = t.optString("cashierName", "");
            String body = money(total) + " · " + qty + " món"
                    + (cashier.isEmpty() ? "" : " · " + cashier);
            // Khoá = mã đơn: mỗi đơn một dòng riêng, đơn sau không đè đơn trước.
            notifySale(ctx, "Đơn hàng mới", body, t.optString("id", ""));
        }

        // Còn đơn mới nằm ngoài cửa sổ 5 dòng vừa báo: gộp thành MỘT dòng tổng
        // hợp, hiện sau chuỗi dòng chi tiết (mới nhất của đợt nằm trên cùng).
        // Không bỏ, không để mốc nuốt mất — chỉ nén phần dư lại để khay không
        // phình 100–1000 dòng một lúc.
        // Khoá theo mã đơn mới nhất đã báo: cùng đợt -> cùng dòng (cập nhật),
        // đợt sau -> dòng mới.
        int hidden = countNewer(ctx, latestId, lastId);
        if (hidden > 0) {
            // Đếm cả đơn của chính máy này (đã có "Thanh toán thành công" riêng)
            // nên phải trừ đi, tránh báo chồng lên chính mình.
            int owned = countSelfSales(ctx, recent, lastId);
            int others = Math.max(0, hidden - owned);
            if (others > 0) {
                notifySale(ctx, "Đơn hàng mới",
                        others + " đơn nữa đã bán (ngoài 5 dòng trên, mạng trễ). Mốc #"
                                + latestId + ".",
                        "batch|" + latestId);
            }
        }

        prefs.edit().putString("last_tx_id", latestId).apply();
    }

    /**
     * Đếm số đơn mới hơn mốc `lastId`, TÍNH CẢ đơn nằm ngoài 5 dòng gần nhất.
     *
     * Lý do: /check chỉ trả 5 đơn gần nhất. Nếu máy kia bán 40 đơn trong lúc
     * service ngủ hoặc mất mạng, vòng kiểm tra sau chỉ thấy 5 dòng trong khay,
     * còn 35 đơn kia bị mốc `last_tx_id` nuốt mất — thông báo sót, doanh thu
     * không ai thấy.
     *
     * Trả về -1 khi không gọi được /count (mất mạng, APK cũ chưa có endpoint
     * này): khi đó bên gọi coi như "không biết", KHÔNG dựng dòng tổng hợp để
     * tránh báo khống mỗi 30 giây.
     */
    private static int countNewer(Context ctx, String latestId, String lastId) {
        try {
            String path = "/count?after=" + android.net.Uri.encode(lastId)
                    + "&before=" + android.net.Uri.encode(latestId);
            JSONObject res = getObject(ctx, path);
            return Math.max(0, res.optInt("count", 0));
        } catch (Exception e) {
            android.util.Log.w("ZGOAlert", "khong dem duoc don moi: " + e.getMessage());
            return -1;
        }
    }

    /**
     * Trong 5 dòng vừa lấy, bao nhiêu dòng là đơn của CHÍNH máy này?
     *
     * Đơn tự bán đã có "Thanh toán thành công" hiện ngay trên màn hình thu ngân
     * (POS.handleCheckout -> ZGO.sale) nên khi trừ bớt phần đếm từ /count phải
     * bỏ chúng ra, tránh báo chồng hai lần cho cùng một đơn.
     */
    private static int countSelfSales(Context ctx, JSONArray recent, String lastId) {
        int n = 0;
        for (int i = 0; i < recent.length(); i++) {
            JSONObject t = recent.optJSONObject(i);
            if (t == null) continue;
            String id = t.optString("id", "");
            if (id.isEmpty() || id.equals(lastId)) break;
            if (isSelfSale(ctx, id)) n++;
        }
        return n;
    }

    // ============================================================
    // Quy tắc 1: ca làm việc mở quá lâu (mất tiền thật)
    // ============================================================
    private static void checkShift(Context ctx, JSONObject snap) {
        JSONArray openShifts = snap.optJSONArray("openShifts");
        if (openShifts == null) return;

        for (int i = 0; i < openShifts.length(); i++) {
            JSONObject s = openShifts.optJSONObject(i);
            if (s == null) continue;

            long start = parseIso(s.optString("startTime"));
            if (start <= 0) continue;

            long hours = (System.currentTimeMillis() - start) / 3600000L;
            if (hours < 12) continue;

            long days = hours / 24;
            String expected = money(s.optDouble("startCash", 0) + s.optDouble("cashSales", 0));
            String who = s.optString("userName", "Nhân viên");

            String body = days >= 1
                    ? "Ca của " + who + " mở " + days + " ngày chưa đóng. Tiền mặt lý thuyết " + expected + "."
                    : "Ca của " + who + " mở " + hours + " giờ chưa đóng. Tiền mặt lý thuyết " + expected + ".";

            String key = "shift_" + s.optString("id") + "_" + today();
            if (alreadySent(ctx, key)) continue;

            notify(ctx, CHANNEL_ALERTS, "Ca làm việc chưa chốt", body);
            markSent(ctx, key);
        }
    }

    // ============================================================
    // Quy tắc 2: hàng bán chạy đã hết
    // ============================================================
    private static void checkStock(Context ctx, JSONObject snap) {
        JSONObject stock = snap.optJSONObject("stockAlert");
        if (stock == null) return;

        int outOfStock = stock.optInt("outOfStock", 0);
        if (outOfStock < 20) return;

        String key = "stock_" + today();
        if (alreadySent(ctx, key)) return;

        String worstName = stock.optString("worstName", "");
        int worstStock = stock.optInt("worstStock", 0);

        String body = !worstName.isEmpty()
                ? outOfStock + " mặt hàng đã hết, nặng nhất: " + worstName + " (tồn " + worstStock + "). Cần nhập thêm."
                : outOfStock + " mặt hàng đã hết. Cần nhập thêm.";

        notify(ctx, CHANNEL_ALERTS, outOfStock + " mặt hàng đã hết", body);
        markSent(ctx, key);
    }

    // ============================================================
    // Quy tắc 3: chốt doanh thu cuối ngày
    // ============================================================
    private static void checkDailyRevenue(Context ctx, JSONObject snap) {
        java.util.Calendar now = java.util.Calendar.getInstance();
        int hour = now.get(java.util.Calendar.HOUR_OF_DAY);
        if (hour < 21 || hour > 23) return;

        JSONObject stats = snap.optJSONObject("stats");
        if (stats == null) return;

        int todayCount = stats.optInt("todayCount", 0);
        if (todayCount == 0) return;

        String key = "revenue_" + today();
        if (alreadySent(ctx, key)) return;

        double todayRevenue = stats.optDouble("todayRevenue", 0);
        notify(ctx, CHANNEL_ALERTS, "Doanh thu hôm nay",
                "Hôm nay " + money(todayRevenue) + " / " + todayCount + " đơn.");
        markSent(ctx, key);
    }

    // ============================================================
    // Tiện ích dùng chung
    // ============================================================

    /** Tạo đủ 3 kênh thông báo. Gọi ở cả Activity và Service. */
    public static void ensureChannels(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null) return;

        if (nm.getNotificationChannel(CHANNEL_SALES) == null) {
            NotificationChannel ch = new NotificationChannel(
                    CHANNEL_SALES, "Thông báo bán hàng", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("Xác nhận khi thanh toán thành công");
            ch.enableVibration(true);
            ch.enableLights(true);
            ch.setLightColor(0xFF22C55E);
            ch.setVibrationPattern(new long[]{0, 120});
            ch.setShowBadge(true);
            nm.createNotificationChannel(ch);
        }

        if (nm.getNotificationChannel(CHANNEL_ALERTS) == null) {
            NotificationChannel ch = new NotificationChannel(
                    CHANNEL_ALERTS, "Cảnh báo cửa hàng", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("Ca làm việc và tồn kho");
            ch.enableVibration(true);
            ch.setVibrationPattern(new long[]{0, 200, 100, 200});
            ch.setShowBadge(true);
            nm.createNotificationChannel(ch);
        }

        if (nm.getNotificationChannel(CHANNEL_SERVICE) == null) {
            NotificationChannel ch = new NotificationChannel(
                    CHANNEL_SERVICE, "ZGO POS đang chạy nền", NotificationManager.IMPORTANCE_MIN);
            ch.setDescription("Duy trì kiểm tra đơn hàng và cảnh báo");
            ch.setShowBadge(false);
            ch.setSound(null, null);
            ch.enableVibration(false);
            nm.createNotificationChannel(ch);
        }
    }

    /**
     * Hiện thông báo — MỖI ĐƠN MỘT DÒNG, xếp chồng, mới nhất lên trên.
     *
     * `key` quyết định danh tính của thông báo:
     *   - Cùng key  -> cập nhật dòng cũ (không nhân đôi).
     *   - Khác key  -> thêm dòng mới, dòng cũ VẪN CÒN.
     *
     * Trước đây id tính cố định theo kênh nên mọi đơn dùng chung một id: bán 10
     * đơn thì chỉ còn 1 dòng cuối cùng trong khay, 9 đơn trước bị ghi đè và mất.
     * Đúng lỗi "hiện mỗi 1 thông báo 1 lần xong không đè lên thì lại thành sót".
     */
    public static void notify(Context ctx, String channel, String title, String body) {
        // Cùng nội dung thì coi là cùng một thông báo (cập nhật, không nhân đôi).
        notifyKeyed(ctx, channel, title, body, title + "|" + body);
    }

    /**
     * Thông báo cho một đơn hàng cụ thể.
     *
     * `txId` là danh tính: đơn nào ra dòng nấy, không bao giờ ghi đè nhau.
     */
    public static void notifySale(Context ctx, String title, String body, String txId) {
        String key = (txId == null || txId.isEmpty())
                // Không có mã đơn (bản APK cũ): dùng mốc thời gian để mỗi lần là
                // một dòng riêng, vẫn không đè lên nhau.
                ? ("sale|" + title + "|" + body + "|" + System.currentTimeMillis())
                : txId;
        notifyKeyed(ctx, CHANNEL_SALES, title, body, key);
    }

    private static void notifyKeyed(Context ctx, String channel, String title, String body, String key) {
        ensureChannels(ctx);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && ContextCompat.checkSelfPermission(ctx, android.Manifest.permission.POST_NOTIFICATIONS)
                != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            android.util.Log.w("ZGOAlert", "chua co quyen thong bao");
            return;
        }

        // Id ổn định theo (kênh, key): same key -> cùng id -> cập nhật;
        // khác key -> khác id -> xếp chồng. `& 0x7fffffff` để không âm.
        int id = NOTIF_ID_BASE
                + ((channel.hashCode() & 0x7f) * 1_000_000)
                + (Math.abs(key.hashCode()) & 0x7fffff);

        rememberId(ctx, channel, id);

        Intent open = new Intent(ctx, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(ctx, id, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, channel)
                .setSmallIcon(R.drawable.ic_stat_zgo)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setDefaults(NotificationCompat.DEFAULT_ALL)
                .setAutoCancel(true)
                .setContentIntent(pi)
                .setColor(0xFF2563EB)
                // when = bây giờ: Android xếp dòng mới lên trên dòng cũ.
                .setWhen(System.currentTimeMillis())
                .setShowWhen(true)
                // Đơn mới phải kêu, kể cả khi đang có thông báo khác cùng kênh.
                .setOnlyAlertOnce(false);

        try {
            NotificationManagerCompat.from(ctx).notify(id, b.build());
            android.util.Log.d("ZGOAlert", "da hien thong bao: " + title
                    + " (id=" + id + ", " + countIds(ctx, channel) + " dong trong khay)");
        } catch (SecurityException e) {
            android.util.Log.w("ZGOAlert", "khong hien duoc: " + e.getMessage());
        }
    }

    /**
     * Ghi nhớ id đã đăng và bỏ dòng cũ nhất khi vượt giới hạn.
     *
     * Android chỉ giữ được ~50 thông báo cho một ứng dụng; quá mức đó hệ thống
     * tự bỏ dòng cũ mà không báo gì. Giữ 30 dòng là mức đọc được, và chủ động
     * bỏ dòng cũ nhất để biết chắc dòng mới luôn còn.
     */
    private static void rememberId(Context ctx, String channel, int id) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String prefKey = KEY_ID_LIST_PREFIX + channel;
        String raw = p.getString(prefKey, "");

        java.util.List<String> ids = new java.util.ArrayList<>();
        if (!raw.isEmpty()) java.util.Collections.addAll(ids, raw.split(","));

        String s = String.valueOf(id);
        if (ids.contains(s)) return; // đã có: lần này chỉ cập nhật nội dung

        ids.add(s);
        while (ids.size() > MAX_STACKED_PER_CHANNEL) {
            String oldest = ids.remove(0);
            try {
                NotificationManagerCompat.from(ctx).cancel(Integer.parseInt(oldest));
            } catch (Exception ignored) {
                /* id hỏng: bỏ qua */
            }
        }
        p.edit().putString(prefKey, android.text.TextUtils.join(",", ids)).apply();
    }

    /** Số dòng đang giữ trong khay cho một kênh (dùng cho log). */
    private static int countIds(Context ctx, String channel) {
        String raw = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getString(KEY_ID_LIST_PREFIX + channel, "");
        return raw.isEmpty() ? 0 : raw.split(",").length;
    }

    /** Gọi một endpoint trả về JSON object. */
    private static JSONObject getObject(Context ctx, String path) throws Exception {
        String text = getRaw(ctx, path);
        return new JSONObject(text);
    }

    private static String getRaw(Context ctx, String path) throws Exception {
        String token = getToken(ctx);
        if (token == null || token.isEmpty()) {
            // Chưa đăng nhập: không gọi. Tránh 401 mỗi 30 giây và đốt pin.
            throw new IllegalStateException("chua dang nhap");
        }

        HttpURLConnection conn = null;
        try {
            URL url = new URL(API_BASE + path);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(20000);
            conn.setRequestProperty("Accept", "application/json");
            conn.setRequestProperty("Authorization", "Bearer " + token);

            int code = conn.getResponseCode();
            if (code == 401) {
                // Token hết hạn hoặc bị thu hồi: xoá để lần đăng nhập sau ghi lại.
                saveToken(ctx, "");
                throw new Exception("HTTP 401 — token het han");
            }
            if (code != 200) throw new Exception("HTTP " + code);

            StringBuilder sb = new StringBuilder();
            try (BufferedReader r = new BufferedReader(new InputStreamReader(conn.getInputStream()))) {
                String line;
                while ((line = r.readLine()) != null) sb.append(line);
            }
            return sb.toString();
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static long parseIso(String iso) {
        if (iso == null || iso.isEmpty()) return 0;
        String[] patterns = {
                "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
                "yyyy-MM-dd'T'HH:mm:ss'Z'"
        };
        for (String p : patterns) {
            try {
                SimpleDateFormat f = new SimpleDateFormat(p, Locale.US);
                f.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
                Date d = f.parse(iso);
                if (d != null) return d.getTime();
            } catch (Exception ignored) {
            }
        }
        return 0;
    }

    private static String money(double v) {
        NumberFormat nf = NumberFormat.getInstance(new Locale("vi", "VN"));
        nf.setMaximumFractionDigits(0);
        return nf.format(v) + "đ";
    }

    private static String today() {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
    }

    private static boolean alreadySent(Context ctx, String key) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(key, false);
    }

    private static void markSent(Context ctx, String key) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit().putBoolean(key, true).apply();
    }
}