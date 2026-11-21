/**
 * Định dạng ngày giờ dùng chung — LUÔN là kiểu Việt Nam: DD/MM/YYYY.
 *
 * Không dùng `toLocaleDateString()` trơn (hay `toLocaleString()`): kết quả phụ
 * thuộc ngôn ngữ của trình duyệt/máy. Máy cài en-US sẽ hiện `11/21/2026`, còn
 * máy cài vi-VN mới ra `21/11/2026`. Cửa hàng cần một kiểu duy nhất, nên tự
 * ghép chuỗi từ các thành phần ngày.
 */

const pad2 = (n: number): string => String(n).padStart(2, '0');

const toDate = (value: string | number | Date): Date | null => {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** `2026-11-21T...` -> `21/11/2026`. Chuỗi hỏng trả về rỗng. */
export const formatDate = (value: string | number | Date): string => {
  const d = toDate(value);
  if (!d) return '';
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
};

/** Giờ 24 tiếng, `14:05`. */
export const formatTime = (value: string | number | Date): string => {
  const d = toDate(value);
  if (!d) return '';
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

/** `21/11/2026 14:05` — dùng cho lịch sử giao dịch, hoá đơn. */
export const formatDateTime = (value: string | number | Date): string => {
  const d = toDate(value);
  if (!d) return '';
  return `${formatDate(d)} ${formatTime(d)}`;
};

/**
 * Ngày dạng khoá `YYYY-MM-DD` (giá trị ô chọn ngày, kết quả `/transactions/daily`)
 * -> `DD/MM/YYYY` để hiển thị.
 */
export const formatDayKey = (day: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return day;
  return `${m[3]}/${m[2]}/${m[1]}`;
};
