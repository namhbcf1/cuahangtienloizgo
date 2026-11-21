package com.zgo.pos;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Tự khởi động lại service sau khi điện thoại khởi động lại.
 * Không có receiver này, người dùng tắt máy rồi mở lại thì không còn thông báo.
 */
public class BootReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent == null ? "" : intent.getAction();
        if (action == null) return;

        boolean shouldStart =
                Intent.ACTION_BOOT_COMPLETED.equals(action)
                        || "android.intent.action.QUICKBOOT_POWERON".equals(action)
                        || "com.htc.intent.action.QUICKBOOT_POWERON".equals(action)
                        || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action);

        if (!shouldStart) return;

        // Chưa đăng nhập lần nào thì không có token -> service cũng không lấy
        // được dữ liệu (server trả 401). Không khởi động, tránh treo thông báo
        // "đang chạy nền" vô nghĩa với người vừa cài app.
        if (AlertChecker.getToken(context) == null) return;

        try {
            KeepAliveService.start(context);
            // Đặt lại báo thức watchdog: sau reboot, alarm cũ đã bị xoá.
            ServiceWatchdog.schedule(context);
            android.util.Log.d("ZGOAlert", "khoi dong lai service sau " + action);
        } catch (Exception e) {
            android.util.Log.w("ZGOAlert", "khong khoi dong duoc: " + e.getMessage());
        }
    }
}
