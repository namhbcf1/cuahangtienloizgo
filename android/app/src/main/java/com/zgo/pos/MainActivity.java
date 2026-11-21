package com.zgo.pos;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.view.KeyEvent;
import android.webkit.ConsoleMessage;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.webkit.WebViewAssetLoader;

/**
 * ZGO POS - WebView shell (bundle offline + API tu xa).
 *
 * Vi sao dung WebViewAssetLoader thay vi file:// :
 *  - Bundle Vite la ES module (<script type="module">). WebView CHAN module nap tu
 *    file:// (origin "null"). WebViewAssetLoader phuc vu asset qua
 *    https://appassets.androidplatform.net/... nen origin la https hop le, module chay,
 *    localStorage/IndexedDB hoat dong, va fetch sang API https khong bi mixed-content.
 *  - API: assets/www/zgo-shim.js rewrite moi fetch('/api/...') thanh
 *    https://cuahangtienloizgo-efi.pages.dev/api/...
 *
 * Cau noi thong bao: trang web goi window.ZGO.sale(title, body) de hien thong bao
 * he thong that. Khong co cau noi nay thi Web Notification API khong hoat dong
 * trong WebView, nen truoc day ban hang xong khong thay thong bao nao.
 *
 * Cau noi token: sau khi dang nhap, web goi window.ZGO.saveToken(token) de
 * service nen dung cung phien. Xem AlertChecker.getToken().
 */
public class MainActivity extends AppCompatActivity {

    private static final String ASSET_HOST = "appassets.androidplatform.net";
    private static final String LOCAL_ENTRY =
            "https://" + ASSET_HOST + "/assets/www/index.html";

    private static final int REQ_CAMERA = 1001;
    private static final int REQ_NOTIF = 1002;

    /** Tên kênh thông báo — dùng chung với AlertChecker để không tạo trùng. */
    private static final String CHANNEL_SALES = AlertChecker.CHANNEL_SALES;
    private static final String CHANNEL_ALERTS = AlertChecker.CHANNEL_ALERTS;

    private WebView webView;
    private PermissionRequest pendingPermissionRequest;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        // Phải gọi trước super.onCreate()/setContentView để splash được thay
        // đúng lúc, không nháy trắng.
        androidx.core.splashscreen.SplashScreen.installSplashScreen(this);
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        createNotificationChannels();

        final WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .setDomain(ASSET_HOST)
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        webView = findViewById(R.id.webview);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        // Release: chặn mọi nội dung hỗn hợp. Debug: cho phép http tới API dev
        // (10.0.2.2 / localhost) để test được luồng đăng nhập + token trên
        // emulator mà không phải dựng chứng chỉ. COMPATIBILITY_MODE vẫn chặn
        // fetch/XHR nên phải dùng ALWAYS_ALLOW — và chỉ ở bản debug.
        s.setMixedContentMode(BuildConfig.ALLOW_MIXED_CONTENT
                ? WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
                : WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        // Lấy version từ resource sinh bởi Gradle, không hard-code: bản 1.0.0
        // trước đây gắn UA "ZGOPOS/1.1.0" trong khi versionName là 1.0.0, nên
        // log server không phân biệt được hai bản.
        s.setUserAgentString(s.getUserAgentString() + " ZGOPOS/" + BuildConfig.VERSION_NAME);

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);

        // Cau noi de web goi duoc thong bao he thong cua Android.
        webView.addJavascriptInterface(new ZgoBridge(), "ZGO");

        webView.setWebViewClient(new WebViewClient() {
            @Nullable
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleUrl(request.getUrl());
            }

            @SuppressWarnings("deprecation")
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleUrl(Uri.parse(url));
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> {
                    boolean wantsCamera = false;
                    for (String r : request.getResources()) {
                        if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) {
                            wantsCamera = true;
                            break;
                        }
                    }
                    if (!wantsCamera) {
                        request.deny();
                        return;
                    }
                    if (ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.CAMERA)
                            == PackageManager.PERMISSION_GRANTED) {
                        request.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
                    } else {
                        pendingPermissionRequest = request;
                        ActivityCompat.requestPermissions(MainActivity.this,
                                new String[]{Manifest.permission.CAMERA}, REQ_CAMERA);
                    }
                });
            }

            @Override
            public void onGeolocationPermissionsShowPrompt(String origin,
                                                           GeolocationPermissions.Callback callback) {
                callback.invoke(origin, false, false);
            }

            @Override
            public boolean onConsoleMessage(ConsoleMessage cm) {
                android.util.Log.d("ZGOWeb", cm.message() + " @" + cm.sourceId() + ":" + cm.lineNumber());
                return true;
            }
        });

        webView.loadUrl(LOCAL_ENTRY);
        askNotificationPermission();
        startBackgroundService();
    }

    /**
     * Bật service chạy nền liên tục + xin bỏ qua tối ưu pin.
     * Không có hai bước này, Android sẽ giết app sau vài phút và thông báo
     * không bao giờ nổi khi app đóng.
     *
     * Chỉ chạy khi đã có token: server bắt buộc xác thực nên chưa đăng nhập
     * thì service cũng không lấy được gì, chỉ tốn pin và hiện thông báo thừa.
     * Token được lưu qua cầu nối ZGO.saveToken() -> khi đó mới start.
     */
    private void startBackgroundService() {
        if (AlertChecker.getToken(this) == null) {
            android.util.Log.d("ZGOAlert", "chua dang nhap: chua bat service nen");
            return;
        }

        try {
            KeepAliveService.start(this);
        } catch (Exception e) {
            android.util.Log.w("ZGOAlert", "khong start duoc service: " + e.getMessage());
        }

        // WorkManager là lớp dự phòng: nếu service bị hệ điều hành giết,
        // worker vẫn thức dậy định kỳ để báo.
        try {
            AlertWorker.schedule(this);
        } catch (Exception e) {
            android.util.Log.w("ZGOAlert", "khong dang ky duoc worker: " + e.getMessage());
        }

        // Lớp thứ ba: báo thức 15 phút bật lại service nếu nó đã chết (bị đẩy
        // khỏi recents, hết RAM...). Không có lớp này thì máy im lặng cho tới
        // khi người dùng tự mở app.
        ServiceWatchdog.schedule(this);

        requestIgnoreBatteryOptimizations();
    }

    /** Xin người dùng cho app chạy nền không bị tối ưu pin. */
    private void requestIgnoreBatteryOptimizations() {
        android.os.PowerManager pm = getSystemService(android.os.PowerManager.class);
        if (pm == null) return;
        if (pm.isIgnoringBatteryOptimizations(getPackageName())) return;

        try {
            Intent i = new Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            i.setData(Uri.parse("package:" + getPackageName()));
            startActivity(i);
        } catch (Exception e) {
            // Một số máy không hỗ trợ intent này, bỏ qua
            android.util.Log.w("ZGOAlert", "khong xin duoc quyen pin: " + e.getMessage());
        }
    }

    // ============================================================
    // Thong bao
    // ============================================================

    /**
     * Tao kenh thong bao.
     *
     * Nội dung kênh do AlertChecker quyết định — chỉ một nơi tạo, tránh trường
     * hợp Activity và Service mỗi bên tạo một kênh cùng id nhưng khác mức ưu
     * tiên (Android bỏ qua lần tạo sau, nên hành vi phụ thuộc thứ tự khởi động).
     */
    private void createNotificationChannels() {
        AlertChecker.ensureChannels(this);
    }

    /**
     * Doi tuong lo sang JavaScript qua ten "ZGO".
     * Moi phuong thuc chay tren thread rieng nen phai day ve UI thread.
     */
    private class ZgoBridge {

        @JavascriptInterface
        public boolean available() {
            return true;
        }

        /**
         * Trang web báo trước khi tạo giao dịch: "máy này sắp bán đơn có id này".
         *
         * Phải gọi TRƯỚC khi POST /transactions — server broadcast qua WebSocket
         * nhanh hơn cả việc trang web nhận response, nên nếu đợi bán xong mới
         * báo thì vòng kiểm tra nền đã kịp bắn "Đơn hàng mới" chồng lên.
         */
        @JavascriptInterface
        public void markSelfSale(String txId) {
            final String id = txId;
            runOnUiThread(() -> AlertChecker.markSelfSale(MainActivity.this, id));
        }

        /** Thông báo bán hàng (ưu tiên cao, rung nhẹ) — hiện ngay khi lưu xong. */
        @JavascriptInterface
        public boolean sale(String title, String body, String txId) {
            final String t = title;
            final String bd = body;
            final String id = txId;
            runOnUiThread(() -> {
                AlertChecker.markSelfSale(MainActivity.this, id);
                // notifySale: mỗi đơn một dòng riêng, không đè lên đơn trước.
                AlertChecker.notifySale(MainActivity.this, t, bd, id);
            });
            vibrateNow(120);
            return true;
        }

        /** Bản cũ không truyền txId — giữ để tương thích. */
        @JavascriptInterface
        public boolean sale(String title, String body) {
            return sale(title, body, null);
        }

        /** Canh bao nghiep vu (ca chua chot, lech tien, het hang). */
        @JavascriptInterface
        public boolean alert(String title, String body) {
            final String t = title;
            final String bd = body;
            runOnUiThread(() -> AlertChecker.notify(MainActivity.this, CHANNEL_ALERTS, t, bd));
            vibrateNow(200);
            return true;
        }

        /**
         * Lưu token phiên đăng nhập để service nền gọi được /api/check và
         * /api/live. Trang web gọi hàm này ngay sau khi đăng nhập thành công,
         * và gọi với chuỗi rỗng khi đăng xuất.
         */
        @JavascriptInterface
        public void saveToken(String token) {
            final String t = token == null ? "" : token;
            runOnUiThread(() -> {
                AlertChecker.saveToken(MainActivity.this, t);
                if (t.isEmpty()) {
                    // Đăng xuất: tắt service để không còn thông báo của phiên cũ
                    // và không gọi API bằng token đã chết.
                    KeepAliveService.stop(MainActivity.this);
                    AlertWorker.cancel(MainActivity.this);
                    ServiceWatchdog.cancel(MainActivity.this);
                } else {
                    // Vừa đăng nhập: giờ mới có token nên mới bật service.
                    startBackgroundService();
                }
            });
        }

        /** Token đang lưu (rỗng nếu chưa đăng nhập). */
        @JavascriptInterface
        public String token() {
            String t = AlertChecker.getToken(MainActivity.this);
            return t == null ? "" : t;
        }

        /** Chi rung, khong hien thong bao. */
        @JavascriptInterface
        public void vibrate(int ms) {
            vibrateNow(ms);
        }

        /** Trang thai quyen thong bao, de web biet co hien duoc hay khong. */
        @JavascriptInterface
        public String permission() {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return "granted";
            boolean ok = ContextCompat.checkSelfPermission(MainActivity.this,
                    Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
            return ok ? "granted" : "denied";
        }
    }

    private void vibrateNow(int ms) {
        runOnUiThread(() -> {
            Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (v == null || !v.hasVibrator()) return;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                v.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE));
            } else {
                v.vibrate(ms);
            }
        });
    }

    // ============================================================
    // Dieu huong & vong doi
    // ============================================================

    private boolean handleUrl(Uri uri) {
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(java.util.Locale.ROOT);
        String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(java.util.Locale.ROOT);

        // Chỉ origin của bundle nội bộ được ở lại trong WebView. Trước đây
        // host API cũng được trả `false`, nghĩa là WebView có thể điều hướng
        // sang site thật — và trang đó thừa hưởng luôn cầu nối `ZGO` (đọc/ghi
        // token, bắn thông báo, rung máy). Giờ mọi host khác đều mở ra trình
        // duyệt ngoài, nơi không có cầu nối.
        if (ASSET_HOST.equals(host)) return false;
        if ("file".equals(scheme) || "about".equals(scheme)
                || "data".equals(scheme) || "blob".equals(scheme) || "javascript".equals(scheme)) {
            return false;
        }
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (Exception e) {
            Toast.makeText(this, "Khong co ung dung xu ly lien ket nay", Toast.LENGTH_SHORT).show();
        }
        return true;
    }

    private void askNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this,
                    new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIF);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions,
                                           @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);

        if (requestCode == REQ_CAMERA && pendingPermissionRequest != null) {
            boolean granted = grantResults.length > 0
                    && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            if (granted) {
                pendingPermissionRequest.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
            } else {
                pendingPermissionRequest.deny();
                Toast.makeText(this, R.string.no_camera_permission, Toast.LENGTH_LONG).show();
            }
            pendingPermissionRequest = null;
        }

        if (requestCode == REQ_NOTIF) {
            boolean granted = grantResults.length > 0
                    && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            if (!granted) {
                Toast.makeText(this,
                        "Chua bat quyen thong bao - vao Cai dat > Ung dung > ZGO POS de bat",
                        Toast.LENGTH_LONG).show();
            }
        }
    }

    /**
     * Nut Back Android:
     *  1. WebView con lich su -> goBack().
     *  2. Het lich su (SPA chi co 1 trang) -> nhan Back 2 lan trong 2 giay moi thoat,
     *     tranh nhan vien bam nham lam mat ca ban hang.
     */
    private long lastBackPressed = 0L;

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        long now = System.currentTimeMillis();
        if (now - lastBackPressed < 2000L) {
            super.onBackPressed();
            return;
        }
        lastBackPressed = now;
        Toast.makeText(this, "Nhan Back lan nua de thoat", Toast.LENGTH_SHORT).show();
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            onBackPressed();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onPause() {
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.loadUrl("about:blank");
            webView.removeAllViews();
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
