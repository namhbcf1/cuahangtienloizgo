package com.zgo.pos;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Nhận báo thức của {@link ServiceWatchdog} và bật lại service nếu nó đã chết.
 *
 * Không `exported` và không có intent-filter: chỉ báo thức nội bộ của app gọi
 * tới, app khác không chạm được.
 */
public class WatchdogReceiver extends BroadcastReceiver {

    public static final String ACTION = "com.zgo.pos.WATCHDOG";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !ACTION.equals(intent.getAction())) return;
        ServiceWatchdog.onAlarm(context);
    }
}