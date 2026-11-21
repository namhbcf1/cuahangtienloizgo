# ZGO POS — Cửa hàng tiện lợi

Web POS + app Android cho cửa hàng tiện lợi. Bán hàng, quản lý kho, ca làm việc, báo cáo.

- **Web**: https://cuahangtienloizgo-efi.pages.dev
- **App**: `android/app/build/outputs/apk/release/app-release.apk` (1.3.0, ~3.0 MB)

## Kiến trúc

| Thành phần | Công nghệ |
|---|---|
| Giao diện | React 19 + TypeScript + Vite |
| CSS | Tailwind v4, build tĩnh vào `dist/assets/*.css` |
| API | Cloudflare Pages Functions (Hono) |
| Database | Cloudflare D1 (SQLite) |
| App Android | WebView shell bọc bundle web, gọi API qua shim |

## Lệnh thường dùng

```bash
npm install          # cài dependencies

npm run dev          # web dev server (cần dev:api chạy song song)
npm run dev:api      # API local ở cổng 8788

npm run typecheck    # kiểm tra TypeScript
npm run verify       # chạy 107 test tự động (API + giao diện + responsive)
npm test             # typecheck + verify

npm run build        # build web vào dist/
npm run deploy       # build + deploy lên Cloudflare Pages
npm run apk          # build APK + AAB (tự chạy test trước)
```

### Chạy test tự động

Cần server đang chạy trước:

```bash
npm run build
npm run dev:api                    # cửa sổ 1
npm run verify                     # cửa sổ 2
```

Test bao gồm:

- **API**: chặn truy cập ẩn danh (401), token giả bị từ chối, PIN sai bị từ chối,
  STAFF không quản trị được nhân sự (403), không lộ PIN, chặn bán vượt tồn, chống trùng giao dịch,
  sửa sản phẩm qua `PUT /products/:id`, đơn lưu đúng **giá đã sửa tay** chứ không lấy lại giá kho
- **Giao diện**: đăng nhập, điều hướng 5 tab, tìm không dấu, chặn thu thiếu tiền,
  sửa giá trong giỏ + hoàn tác, mở/huỷ form sửa sản phẩm
- **Responsive**: 360/390/412px + máy tính, không tràn, không cắt chữ, nút ≥40px

Chạy riêng từng phần: `--api`, `--ui`, `--responsive`.

Kiểm chứng 4 tính năng mới (giỏ giữ qua reload, gõ số lượng, sửa mã vạch, xoá
sản phẩm) — cần server đang chạy:

```bash
npm run verify:features    # 15 check, chạy trên Chrome thật
```

### Sửa giá khi thanh toán

Giá niêm yết nằm trong Kho; giá **thực bán** của từng lần bán nằm trong giỏ hàng.
Muốn bán khác giá niêm yết:

1. Vào **Bán hàng** → thêm món vào giỏ → bấm vào giá của dòng hàng (có icon bút chì).
2. Gõ giá mới → bấm ✔. Dòng hàng hiện nhãn **"đã sửa"**; khu tổng kết hiện dòng
   **"ĐÃ SỬA GIÁ"** kèm chênh lệch (+/−) so với giá niêm yết.
3. Bấm ⟲ để trả về giá gốc bất cứ lúc nào trước khi thanh toán.

**Tăng/giảm theo phần trăm** — hai cách, kết quả như nhau:

- Bấm nút nhanh trong ô sửa giá: `+10% +20% +30% +50%` (xanh) và `-10% -20% -30%` (đỏ).
- Hoặc gõ thẳng vào ô giá: `30%` = cộng 30%, `-10%` = giảm 10%. Gõ dư ký tự
  (`30%%`) hoặc có khoảng trắng vẫn hiểu đúng.

Phần trăm tính trên **giá gốc trong kho**, làm tròn 100đ (25.000đ +30% → 32.500đ).
Ví dụ 6.000đ +30% = **7.800đ**.

Đơn lưu vào DB đúng giá đã bán; **giá trong kho không bị đổi** — muốn đổi giá niêm
yết thì dùng màn Kho. Giá 0đ bị hỏi lại (bán 0đ = mất tiền thật).

### Sửa sản phẩm

Vào **Kho** → nút **Sửa** trên từng sản phẩm. Sửa được: tên, giá bán, giá vốn,
danh mục, đơn vị, tồn kho, mã vạch phụ. Không đổi được mã hàng (khoá chính — đổi
sẽ làm mồ côi lịch sử giao dịch). Nhập hàng định kỳ thì dùng nút **+ Nhập hàng**
để cộng tồn, không sửa tay ô tồn.

**Mã vạch / QR**: ngay trong form Sửa, sửa thẳng vào ô mã để đổi, bấm 🗑 để bỏ,
hoặc nhập mã mới rồi Enter (hoặc bấm **Thêm**). Mã trùng với sản phẩm khác bị
chặn — hai sản phẩm cùng một mã thì quét mã không biết bán món nào.

### Xoá sản phẩm

Vào **Kho** → nút 🗑 trên từng dòng (hoặc nút **Xoá** ở bảng máy tính) → xác nhận.

Sản phẩm **đã từng bán sẽ bị chặn** (server trả 409 kèm số lần bán) để không làm
mồ côi lịch sử đối soát. Nếu vẫn muốn bỏ, bấm **Vẫn xoá**: sản phẩm biến mất khỏi
Kho nhưng các đơn cũ vẫn giữ nguyên tên và giá đã bán trong báo cáo.

### Số lượng trong giỏ

Bấm thẳng vào ô số lượng giữa hai nút **−** và **+** để gõ số (nhập 50 gói thì
gõ `50`, không phải bấm 50 lần). Gõ `0` hoặc để trống rồi thoát sẽ tự về `1`;
muốn bỏ món thì dùng nút thùng rác.

### Giỏ hàng không mất khi tải lại

Giỏ được lưu tạm vào `localStorage` (khoá `smartpos_carts`), nên tải lại trang /
bị hệ điều hành kill app giữa lúc đang gõ đơn thì **giỏ vẫn còn**, kể cả số
lượng và giá đã sửa tay. Đây chỉ là bản nháp của thu ngân: đơn chỉ thành sự thật
khi server trả 201, và giỏ tự xoá sau khi thanh toán xong.

### Build APK

```bash
npm run apk            # release APK + AAB
npm run apk -- --debug # chỉ APK debug
```

Script tự kiểm tra JDK 17 + Android SDK, build web, **chạy test**, **đối chiếu SHA256
asset trong `android/app/src/main/assets/www/` với `dist/`**, rồi mới đóng gói.
Test fail hoặc asset lệch → **không** build APK.

Yêu cầu môi trường (đã cài trên máy này):

- JDK 17: `C:\AndroidBuild\jdk-17.0.20.1+1`
- Android SDK: `C:\AndroidBuild\sdk` (platform 35, build-tools 34)

Đặt biến môi trường nếu cài ở chỗ khác: `JAVA_HOME`, `ANDROID_HOME`.

## Cấu hình

| File | Nội dung |
|---|---|
| `wrangler.toml` | Tên project Pages + binding D1 |
| `android/keystore.properties` | Thông tin ký APK (**không commit**) |
| `C:\AndroidBuild\keys\zgo-release.jks` | Keystore gốc — **mất là không update được app** |

## Xác thực

- `POST /api/auth/login` kiểm PIN ở server và trả **token ký HMAC-SHA256, KHÔNG hết hạn**.
- Mọi endpoint dữ liệu (`/products`, `/shifts`, `/transactions`, `/sync`, `/check`, `/live`)
  bắt buộc `Authorization: Bearer <token>`; WebSocket dùng `?token=`.
- Chỉ `GET /api/users` (danh sách cho màn đăng nhập, không có PIN) là mở.
- Ghi bảng `users` chỉ ADMIN.
- Token lưu ở `localStorage` (khoá `smartpos_token`) và được đẩy xuống service
  Android qua cầu nối `ZGO.saveToken()` để thông báo nền vẫn chạy khi app đóng.
- Khoá ký: đặt `wrangler secret put AUTH_SECRET` khi triển khai; nếu không, server
  tự sinh một lần và lưu trong bảng `sync_meta`.

### Token không hết hạn — vẫn thu hồi được

Token chỉ chứa `uid` + `role`, không có `exp`. Đăng nhập một lần là dùng mãi, không
còn cảnh service nền nhận 401 lúc nửa đêm rồi im lặng.

Vẫn kiểm soát được, không phải cấp phát vĩnh viễn không cửa đóng:

| Muốn gì | Cách làm | Hiệu lực |
|---|---|---|
| Cắt quyền một nhân viên | Xoá user ở màn Nhân sự | Ngay lập tức (401) |
| Hạ quyền ADMIN → STAFF | Sửa vai trò ở màn Nhân sự | Ngay lập tức |
| Vô hiệu **toàn bộ** token | Đổi `AUTH_SECRET` rồi deploy | Ngay lập tức, mọi máy phải đăng nhập lại |
| Chống token tự chế | Chữ ký HMAC-SHA256 | Mọi lúc |

Mỗi request vẫn tra `role` từ DB (cache 30 giây, xoá cache khi sửa/xoá user), nên
token cũ không sống sót qua việc xoá tài khoản.

## Thông báo nền trên Android

Ba lớp chồng nhau, vì mỗi lớp đều có trường hợp hệ điều hành cắt:

| Lớp | Nhiệm vụ | Nhịp |
|---|---|---|
| `KeepAliveService` (foreground) | Giữ WebSocket → báo trong ~1 giây | liên tục |
| `AlertWorker` (WorkManager) | Gọi `/api/check` khi service chết | 15 phút |
| `ServiceWatchdog` (AlarmManager) | Bật lại service nếu nó đã chết | 15 phút |

Thêm hai đường hồi phục: `onTaskRemoved` (bật lại 1 giây sau khi app bị vuốt khỏi
danh sách gần đây) và `BootReceiver` (sau khi khởi động lại máy).

Đơn hàng do **chính máy này** bán không báo "Đơn hàng mới" — web gọi
`ZGO.markSelfSale(txId)` **trước** khi POST, vì server broadcast qua WebSocket
nhanh hơn cả lúc trang web nhận được response. Đơn của máy khác luôn được báo.

## Database

```bash
# Xem dữ liệu local
npx wrangler d1 execute cuahangtienloizgo-db --local --command "SELECT count(*) FROM products"

# Nạp schema mới
npx wrangler d1 execute cuahangtienloizgo-db --local --file migrations/0001_initial.sql
```

Bảng: `users`, `products` (có cột `barcodes` JSON), `shifts`, `transactions`,
`transaction_items`, `sync_meta` (phiên bản sản phẩm, cache thống kê, secret ký token).

## Import sản phẩm từ Excel

```bash
node import_products.js          # đọc "Products (4).xlsx" → seed_products.sql
```

Cột: A=Mã hàng, B=Tên, C=Nhóm, D=ĐVT, H=Giá bán, J=Giá vốn, K=Tồn kho.

## Bảo mật

- PIN xác thực ở server, **không** trả về qua `GET /api/users`, **không** lưu trong `localStorage`
- Mọi lệnh ghi cần token; token giả/hết hạn bị 401 và app tự đá về màn đăng nhập
- Server chặn bán vượt tồn (409) và chống trùng giao dịch (idempotency)
- TLS mặc định của hệ thống (không có trust-all), `usesCleartextTraffic=false`
- `allowBackup=false` — không đẩy phiên đăng nhập lên cloud backup
- WebView chỉ ở lại trong origin `appassets.androidplatform.net`; mọi host khác mở
  ra trình duyệt ngoài nên không chạm được cầu nối `ZGO`

## Giới hạn đã biết

- Chưa có quét barcode bằng camera (quyền đã khai báo, UI chưa có). Dùng máy quét Bluetooth hoặc gõ mã.
- Thông báo nền: ba lớp (foreground service + WorkManager + AlarmManager watchdog).
  Chưa dùng FCM nên khi máy bị Doze rất sâu, thông báo có thể trễ tới 15 phút
  (lớp watchdog), không phải tức thì trong ~1 giây.
- APK chưa lên Google Play: cần tài khoản Play Console. targetSdk đã lên 35 (mức Play yêu cầu).
- **Bản 1.0.0 / 1.1.0 / 1.2.0 đã cài trên máy phải nâng lên 1.3.0 (versionCode 4)** —
  các bản cũ dùng token hạn 12 giờ, qua đêm là mất thông báo.
- Sửa giá ở màn Bán hàng chỉ áp cho lần bán đó. Muốn đổi giá niêm yết phải vào Kho.
- Chưa có phân quyền riêng cho việc sửa giá: mọi nhân viên đã đăng nhập đều sửa
  được giá của đơn mình đang bán. Chênh lệch giá được ghi lại trong DB
  (`transaction_items.price` khác `products.price`) nên vẫn đối soát được.
- Xoá sản phẩm chỉ ADMIN. Sản phẩm đã từng bán phải xác nhận thêm một lần nữa.
- Giỏ hàng lưu trong `localStorage` của máy đang bán — đổi máy hoặc xoá dữ liệu
  trình duyệt là mất bản nháp giỏ.

