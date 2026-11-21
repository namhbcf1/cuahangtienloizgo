-- Tối ưu D1 cho gói Free: giảm mạnh rows_read mỗi lần đồng bộ.
--
-- Vấn đề: /api/sync quét toàn bảng mỗi lần gọi.
--   products (837) + transactions (1.817) + transaction_items (4.056) + stats (1.817)
--   ≈ 8.537 rows/lần. Gói Free cho 5.000.000 rows/ngày
--   -> một máy polling 5 giây sẽ hết hạn mức trong chưa đầy 1 giờ.
--
-- Cách sửa:
--   1. Thêm index cho các cột hay lọc -> LIMIT và WHERE không còn quét cả bảng.
--   2. Bảng sync_meta giữ phiên bản sản phẩm và cache thống kê -> đọc 1-2 row
--      thay vì quét 837 + 1.817 row.

-- ---------- 1. Index ----------
-- Lấy 50 đơn gần nhất: trước đây quét 1.817 row, sau còn 50.
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);

-- Lấy đơn theo ca (màn tổng kết ca): trước quét 1.817, sau vài chục.
CREATE INDEX IF NOT EXISTS idx_transactions_shift ON transactions(shiftId);

-- Ghép items cho các đơn vừa lấy: trước quét 4.056 row mỗi lần, sau chỉ đọc
-- đúng số item của 50 đơn đó.
CREATE INDEX IF NOT EXISTS idx_items_transaction ON transaction_items(transactionId);

-- Tra sản phẩm theo mã khi bán (kiểm tra tồn kho).
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);

-- ---------- 2. Bảng siêu dữ liệu ----------
CREATE TABLE IF NOT EXISTS sync_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Phiên bản dữ liệu sản phẩm: tăng mỗi khi có thay đổi sản phẩm.
-- Client gửi lại giá trị này; trùng thì server không gửi 837 sản phẩm.
INSERT OR IGNORE INTO sync_meta (key, value) VALUES ('products_version', '1');

-- Cache thống kê doanh thu (JSON). Chỉ tính lại khi hết hạn hoặc sau khi bán.
INSERT OR IGNORE INTO sync_meta (key, value) VALUES ('stats_cache', '');

-- Cache tình trạng tồn kho. Đếm hàng hết phải quét bảng products nên cache 5 phút.
INSERT OR IGNORE INTO sync_meta (key, value) VALUES ('stock_cache', '');
