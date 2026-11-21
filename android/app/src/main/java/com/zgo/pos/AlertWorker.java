package com.zgo.pos;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import java.util.concurrent.TimeUnit;

/**
 * Lớp dự phòng khi foreground service bị hệ điều hành giết.
 *
 * Đường chính là KeepAliveService (chạy mỗi 60 giây). Worker này chỉ để
 * "lưới an toàn": nếu service chết, worker vẫn thức dậy định kỳ.
 * Chu kỳ tối thiểu của WorkManager là 15 phút.
 */
public class AlertWorker extends Worker {

    public static final String WORK_NAME = "zgo-alert-check";

    public AlertWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    public static void schedule(Context context) {
        Constraints constraints = new Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build();

        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(
                AlertWorker.class, 15, TimeUnit.MINUTES)
                .setConstraints(constraints)
                .setInitialDelay(15, TimeUnit.MINUTES)
                .build();

        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                WORK_NAME,
                ExistingPeriodicWorkPolicy.UPDATE,
                request);
    }

    /** Huỷ lịch chạy nền (lúc đăng xuất — không còn token thì không có gì để báo). */
    public static void cancel(Context context) {
        WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME);
    }

    @NonNull
    @Override
    public Result doWork() {
        // Chưa đăng nhập: không có token, gọi API chỉ nhận 401. Trả success để
        // không bị WorkManager retry vô hạn với backoff.
        if (AlertChecker.getToken(getApplicationContext()) == null) return Result.success();

        try {
            AlertChecker.runAll(getApplicationContext());
            return Result.success();
        } catch (Exception e) {
            android.util.Log.w("ZGOAlert", "worker that bai: " + e.getMessage());
            return Result.retry();
        }
    }
}
