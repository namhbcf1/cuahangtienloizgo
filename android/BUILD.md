# ZGO POS — Build Android APK/AAB

Quy trình đóng gói app web POS (`cuahangtienloizgo-master`) thành app Android native shell (WebView).

> **v4 — BẢN GIAO CUỐI (FREEZE).** Bundle chốt, đã verify SHA256 trong APK khớp `dist/`.
> Đã bỏ hoàn toàn `tailwind-cdn.js`; có `AlertBanner` + `services/notify/*`; auth qua `/api/auth/login`.
>
> ⚠️ **APK này đi kèm API mới.** `GET /api/users` không còn trả `pin`, có `POST /api/auth/login`.
> Cài APK mà chưa deploy API mới → login fail. API đã được Lead deploy (đã verify: `/users` chỉ trả
> `id,name,role`; `/auth/login` → 200 với PIN đúng, 401 với PIN sai).

---

## 0. Thông số app

| Hạng mục | Giá trị |
|---|---|
| Tên hiển thị | **ZGO POS** |
| Application ID (release) | `com.zgo.pos` |
| Application ID (debug) | `com.zgo.pos.debug` (cài song song được) |
| versionCode / versionName | `1` / `1.0.0` |
| minSdk | **24** (Android 7.0) |
| targetSdk / compileSdk | **34** (Android 14) |
| Kiến trúc | Java + AndroidX WebView (không cần Node runtime trên máy) |
| Quyền | INTERNET, ACCESS_NETWORK_STATE, CAMERA, POST_NOTIFICATIONS, VIBRATE |
| Hướng màn hình | Khoá **portrait** (manifest `screenOrientation="portrait"`) |

---

## 1. Kiến trúc tích hợp web

```
android/app/src/main/assets/www/     <- bundle Vite (dist/) copy vào đây
  index.html                         (đã vá: path tương đối + chèn shim)
  assets/index-*.js                  (~657 KB, bundle React + AlertBanner + notify)
  assets/index-*.css                 (~74 KB, Tailwind v4 build tĩnh)
  zgo-shim.js                        (rewrite /api -> API_BASE)
```

**Không còn** `tailwind-cdn.js` (407 KB). Web build CSS thật từ `src/index.css`
(`@import "tailwindcss"` + `@theme`), nên giao diện hiển thị đúng cả khi không có mạng.

**Vì sao dùng `WebViewAssetLoader` (origin `https://appassets.androidplatform.net`) thay vì `file://`:**
Bundle Vite là ES module (`<script type="module">`). WebView/Chrome **chặn** module nạp từ `file://` (origin `null`) → app trắng. `WebViewAssetLoader` phục vụ asset qua origin `https://` hợp lệ nên module chạy, `localStorage` hoạt động, và `fetch` sang API https không bị mixed-content.

**Vì sao cần `zgo-shim.js`:**
`services/api.ts` gọi đường dẫn tương đối `/api/...`. Trong app, origin là `appassets.androidplatform.net` nên `/api` sẽ trỏ sai. Shim rewrite:
`/api/products` → `https://cuahangtienloizgo.pages.dev/api/products`
Server Cloudflare trả `Access-Control-Allow-Origin: *` (đã kiểm chứng: GET 200 + preflight `OPTIONS 204`) nên CORS qua.

---

## 2. Lệnh build cuối cùng

```powershell
$env:JAVA_HOME="C:\AndroidBuild\jdk-17.0.20.1+1"
$env:ANDROID_HOME="C:\AndroidBuild\sdk"
$env:ANDROID_SDK_ROOT="C:\AndroidBuild\sdk"
$env:PATH="$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\build-tools\34.0.0;$env:PATH"

cd C:\Users\ADMIN\Desktop\cuahangtienloizgo-master\android
node scripts\sync-web.mjs                              # copy dist -> assets/www + vá + tự kiểm tra
.\gradlew.bat --no-daemon clean assembleRelease bundleRelease
```

Hoặc script gộp:

```powershell
cd C:\Users\ADMIN\Desktop\cuahangtienloizgo-master\android
.\build-apk.cmd all        # debug + release + aab
```

### Nơi file nằm (số liệu thật, `Get-Item` 18/10/2026 11:33)

| Loại | Đường dẫn | Dung lượng thật | SHA256 |
|---|---|---|---|
| **Release APK (đã ký)** | `android\app\build\outputs\apk\release\app-release.apk` | **2,845,578 B = 2.71 MB** | `435152AF1C396C1A42AF5798789B6EBE507D03F5F9262D2072C7E64FF055B8FC` |
| **Release AAB (CH Play)** | `android\app\build\outputs\bundle\release\app-release.aab` | **2,686,447 B = 2.56 MB** | `27A86BCF7A876741DF81C880E259129575A1DDDFE0B93CE76FF572E94BECAC4A` |
| Debug APK | `android\app\build\outputs\apk\debug\app-debug.apk` | ~3.7 MB (build lại khi cần) | — |

Bundle nhúng trong APK — SHA256 đã verify **bên trong file .apk/.aab** (giải nén ra kiểm), khớp 100% `dist/`:

| File trong `assets/www/assets/` | Bytes | SHA256 (khớp `dist/`) |
|---|---|---|
| `index-C7Xq4wwT.js` | 658,452 | `C25F39DE73BECB8288CD2EB79A4689D9845B1326C0852FD38E3EC78D609B433F` |
| `index-OGFkG92T.css` | 73,939 | `4AC793B487D9A7960A196FDA3CF9B523601095827560A23A90919D18897284BE` |

`index.html`: `dist` = `9043C11F2B0BF9282918B4EBD816D91D2A4E95B7D134E767FAF665333E6BE3DE` (866 B).
Trong APK là 908 B vì `sync-web.mjs` **cố ý** sửa 2 path `/assets/` → `./assets/` và chèn 1 dòng
`<script src="./zgo-shim.js">`. Diff đã kiểm: chỉ 3 dòng đó, không mất nội dung gốc.

---

## 3. Ký số (QUAN TRỌNG)

| Trường | Giá trị |
|---|---|
| File | `C:\AndroidBuild\keys\zgo-release.jks` (bản sao: `android\keys\zgo-release.jks`) |
| Store password | `ZgoPos@2026!Release` |
| Key alias | `zgo` |
| Key password | `ZgoPos@2026!Release` |
| Thuật toán | RSA 4096-bit, PKCS12, hiệu lực 10.000 ngày (đến 2054) |
| SHA-256 cert | `56:8C:60:95:DC:76:B9:2A:6E:5E:87:80:86:59:A6:D3:36:14:99:C5:51:C6:B0:97:CA:B9:5C:9B:D5:07:17:9E` |
| SHA-1 cert | `26:AB:F2:1A:A1:15:80:74:86:42:3E:CC:4F:96:E5:1F:A1:E0:AA:2F` |

Cấu hình đọc từ `android\keystore.properties` (đã tạo, đã thêm vào `.gitignore`).

### MẤT KEYSTORE = MẤT APP
Google Play nhận diện app bằng **package name + chữ ký**. Mất `.jks` hoặc mật khẩu thì **không thể** phát hành bản cập nhật cho app đã lên store.
→ Backup `.jks` + mật khẩu ra **2 nơi tách biệt**. Không đưa lên git.

### Kiểm tra chữ ký

```powershell
C:\AndroidBuild\sdk\build-tools\34.0.0\apksigner.bat verify --verbose --print-certs `
  app\build\outputs\apk\release\app-release.apk
```
Kết quả: `Verifies` / `v2 scheme: true` / `CN=ZGO POS, OU=Store, O=ZGO, L=Hanoi, ST=Hanoi, C=VN`

---

## 4. Cài lên máy thật

```powershell
adb install -r android\app\build\outputs\apk\release\app-release.apk
```

---

## 5. Khi web thay đổi

```powershell
cd C:\Users\ADMIN\Desktop\cuahangtienloizgo-master
npm run build
cd android
node scripts\sync-web.mjs
.\gradlew.bat --no-daemon assembleRelease bundleRelease
```

Bundle nhúng trong APK, nên app đã cài vẫn chạy code cũ cho tới khi phát hành APK mới (quyết định có chủ đích — xem mục 7).

**Kiểm tra nhanh đã đúng bản mới chưa:**
```powershell
# So hash dist/ với assets trong APK
(Get-FileHash dist\assets\*.js -Algorithm SHA256).Hash
(Get-FileHash android\app\src\main\assets\www\assets\*.js -Algorithm SHA256).Hash
```

---

## 6. Rủi ro đã biết

| Rủi ro | Chi tiết | Xử lý |
|---|---|---|
| **Debug vs Release** | Debug APK có `applicationIdSuffix=".debug"`, `debuggable=true`, ký debug key → không upload CH Play được | Dùng `app-release.apk` / `app-release.aab` |
| **Chưa ký = không cài được** | Thiếu `keystore.properties` → ra `app-release-unsigned.apk`, Android từ chối (`INSTALL_PARSE_FAILED_NO_CERTIFICATES`) | Luôn giữ `keystore.properties` + `.jks` |
| **targetSdk 34** | CH Play bắt buộc ≥ 34 hiện tại, ≥ 35 từ kỳ hạn 31/8/2025 | Nâng `targetSdk 35` + `compileSdk 35` khi tải `platforms;android-35` |
| **Dung lượng APK** | 2.71 MB (WebView shell + JS 657 KB + CSS 74 KB) | Chấp nhận được |
| **Phụ thuộc mạng** | Giao diện hiện offline, nhưng tải sản phẩm/giao dịch cần Internet | Cần offline queue (IndexedDB) nếu muốn bán offline hoàn toàn |
| **CORS phụ thuộc server** | Siết CORS trên Cloudflare (bỏ `*`) → app chết API | Giữ `cors()` mở hoặc whitelist `appassets.androidplatform.net` |
| **Camera quét barcode** | `getUserMedia` cần `onPermissionRequest` (đã xử lý). Bundle **chưa có** code quét → quyền sẵn nhưng UI quét chưa tồn tại | Lead đã ghi nhận, giao riêng |
| **Không obfuscation** | `minifyEnabled false` → JS bundle đọc được | Bật R8 + obfuscate JS nếu cần |

---

## 7. Quyết định: GIỮ LOCAL BUNDLE (Lead chốt)

Không nạp remote URL `https://cuahangtienloizgo.pages.dev` làm entry.
Lý do: shop mất mạng vẫn phải mở được app để bán; remote URL sẽ làm app trắng khi mất wifi.
Đánh đổi: mỗi lần đổi UI/nghiệp vụ phải phát hành APK mới.

---

## 8. Môi trường build (đã kiểm chứng)

```
JDK      : C:\AndroidBuild\jdk-17.0.20.1+1  (javac 17.0.20.1)
SDK      : C:\AndroidBuild\sdk               (platforms/android-34, build-tools/34.0.0, platform-tools)
Gradle   : C:\AndroidBuild\gradle-8.7 + wrapper trong android/gradle/wrapper
AGP      : 8.4.2
Node     : v24.19.0 / npm 11.14.1
Emulator : AVD zgo_test (system-images;android-34;google_apis;x86_64)
```

Lỗi đã gặp và cách sửa:
- `Duplicate class kotlin.collections.jdk8.CollectionsJDK8Kt` → thêm `implementation platform('org.jetbrains.kotlin:kotlin-bom:1.8.22')`.
- `android.defaults.buildfeatures.buildconfig` deprecated → bỏ khỏi `gradle.properties`.
- `gradlew` không tồn tại → `gradle wrapper --gradle-version 8.7`.
- **App crash ngay khi mở**: `XmlPullParserException: <bitmap> requires a valid 'src' attribute` → `launch_background.xml` trỏ `<bitmap>` vào adaptive-icon XML. Sửa sang `@drawable/zgo_logo` (PNG thật trong `drawable-nodpi`).
- **Thanh giỏ đè lên tab đáy** (bản bundle 11:21): đã hết từ bundle `CSFgRtyq` — thanh giỏ `bottom-[calc(56px+env(safe-area-inset-bottom))] z-30`, tab đáy `z-40`.

---

## 9. Bằng chứng chạy thật (emulator API 34, BẢN GIAO CUỐI v4)

Cài đặt:
```
adb uninstall com.zgo.pos        -> Success
adb install -r app-release.apk   -> Performing Streamed Install / Success
```

logcat:
```
D ZGOWeb: [ZGO] shim active, apiBase=https://cuahangtienloizgo.pages.dev
        @https://appassets.androidplatform.net/assets/www/zgo-shim.js:41
```
Không có `FATAL EXCEPTION`. Không còn warning `cdn.tailwindcss.com should not be used in production`.

Ảnh chụp thật (1080x2340):
| File | Nội dung |
|---|---|
| `proof-login.png` | Màn hình chọn nhân viên (ADMIN + NAM từ D1, `GET /users` mới không trả pin) |
| `proof-dashboard.png` | **Đăng nhập THÀNH CÔNG qua `/api/auth/login`** → Báo cáo: banner đỏ "Ca làm việc chưa chốt — 259 ngày chưa đóng", "1/3 cảnh báo", doanh thu 61,721,000đ, 1,639 đơn |
| `proof-pos-grid.png` | POS: banner đỏ, lưới 3 cột, thanh giỏ + tab đáy không chồng nhau |
| `proof-cash-validation.png` | **Fix chặn thu thiếu tiền**: nhập 1000đ cho đơn 25,000đ → hiện `Thiếu: 24,000 đ` đỏ, nút XÁC NHẬN bị **disable** (xám) |
| `proof-back-button.png` | Toast "Nhấn Back lần nữa để thoát" |

API mới đã verify bằng `Invoke-WebRequest` trực tiếp:
- `GET /api/users` → 200, fields = `id, name, role` (**không còn `pin`**)
- `POST /api/auth/login` `{id:"admin",pin:"1234"}` → **200** `{"id":"admin","name":"Quản trị viên","role":"ADMIN"}`
- `POST /api/auth/login` `{id:"admin",pin:"9999"}` → **401** (đúng)

Đã xác minh:
- Đăng nhập trong app đi qua `/api/auth/login` (không còn so PIN client-side).
- Banner `AlertBanner` render đúng trên cả POS và Báo cáo, nội dung khớp dữ liệu thật (259 ngày).
- Fix thu thiếu tiền hoạt động: nút disable + hiện số thiếu.
- Layout responsive: sidebar `hidden md:flex` ẩn, tab đáy 5 mục hiện đúng, `h-[100dvh]`.
- Không còn `tailwind-cdn.js` trong APK (liệt kê `assets/www` bằng `jar tf` → 0 kết quả `tailwind`).
- Bundle trong APK khớp SHA256 với `dist/` — verify **bên trong .apk và .aab** (giải nén kiểm), js + css đều khớp.
- Khoá portrait: `requestedOrientation=SCREEN_ORIENTATION_PORTRAIT`.
- Back: toast lần 1, 2 lần trong 2s → về launcher.
