# Giữ bridge JS (nếu bật minify sau này)
-keepclassmembers class com.zgo.pos.** {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class com.zgo.pos.** { *; }
