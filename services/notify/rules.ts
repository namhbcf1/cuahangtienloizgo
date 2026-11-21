import { Product, Shift, Transaction } from '../../types';

/**
 * Các quy tắc sinh thông báo cho cửa hàng.
 *
 * Nguyên tắc thiết kế (theo kết luận của nhóm):
 * - Chỉ báo cái MẤT TIỀN THẬT là ưu tiên P0 (chênh lệch tiền mặt, ca chưa chốt).
 * - Tồn kho gộp thành MỘT thông báo/ngày, vì có tới 395 SKU hết hàng — không thể
 *   bắn 395 thông báo.
 * - Tối đa 3 thông báo/ngày để không bị người dùng tắt.
 * - Hàm thuần, không side-effect, test được.
 */

export type AlertLevel = 'P0' | 'P1' | 'P2' | 'P3';

export interface Alert {
  /** Khoá duy nhất theo quy tắc + đối tượng + ngày, dùng để chống spam. */
  id: string;
  level: AlertLevel;
  title: string;
  body: string;
  /** Màn hình nên mở khi người dùng bấm vào thông báo. */
  target: 'ADMIN_DASHBOARD' | 'INVENTORY' | 'POS';
  /** Dữ liệu kèm theo để màn hình đích xử lý tiếp. */
  payload?: Record<string, unknown>;
}

export interface AlertSnapshot {
  products: Product[];
  shifts: Shift[];
  transactions: Transaction[];
  /** Thời điểm đánh giá, cho phép test với thời gian cố định. */
  now?: Date;
  /** Múi giờ dùng để tính "hôm nay" và chốt ngày. Mặc định Asia/Ho_Chi_Minh. */
  timeZone?: string;
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Ngưỡng lệch tiền mặt được coi là đáng báo (đồng). */
const CASH_DISCREPANCY_THRESHOLD = 50_000;
/** Ca mở quá lâu thì cảnh báo. */
const SHIFT_WARN_HOURS = 12;
const SHIFT_URGENT_HOURS = 24;
/** Số ngày gần nhất để tính "bán chạy". */
const BEST_SELLER_WINDOW_DAYS = 7;
/** Sản phẩm bán chạy cần đạt mức này mới đáng báo khi hết hàng. */
const BEST_SELLER_MIN_QTY = 5;
/** Tồn kho thấp (dương nhưng sắp hết). */
const LOW_STOCK_THRESHOLD = 3;

const money = (n: number) => `${Math.round(n).toLocaleString('vi-VN')}đ`;

/** Lấy ngày dạng YYYY-MM-DD theo múi giờ cửa hàng. */
const dayKey = (d: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);

/** Số giờ lẻ của một ca đang mở. */
const hoursOpen = (startTime: string, now: Date) =>
  (now.getTime() - new Date(startTime).getTime()) / HOUR;

/**
 * Sinh toàn bộ thông báo từ dữ liệu hiện có.
 * Trả về đã sắp xếp theo mức ưu tiên, tối đa `maxAlerts` mục.
 */
export const evaluateAlerts = (snap: AlertSnapshot, maxAlerts = 3): Alert[] => {
  const now = snap.now ?? new Date();
  const timeZone = snap.timeZone ?? 'Asia/Ho_Chi_Minh';
  const today = dayKey(now, timeZone);
  const alerts: Alert[] = [];

  // ---------- P0: ca mở quá lâu ----------
  for (const shift of snap.shifts) {
    if (shift.status !== 'OPEN') continue;

    const open = hoursOpen(shift.startTime, now);
    if (open < SHIFT_WARN_HOURS) continue;

    const days = Math.floor(open / 24);
    const urgent = open >= SHIFT_URGENT_HOURS;
    const expected = shift.startCash + shift.cashSales;

    alerts.push({
      id: `shift-open:${shift.id}:${today}`,
      level: urgent ? 'P0' : 'P1',
      title: urgent ? 'Ca làm việc chưa chốt' : 'Ca làm việc mở lâu',
      body: days >= 1
        ? `Ca của ${shift.userName} mở ${days} ngày chưa đóng. Tiền mặt lý thuyết ${money(expected)}.`
        : `Ca của ${shift.userName} mở ${Math.floor(open)} giờ chưa đóng. Tiền mặt lý thuyết ${money(expected)}.`,
      target: 'ADMIN_DASHBOARD',
      payload: { shiftId: shift.id },
    });
  }

  // ---------- P0: ca đã đóng nhưng lệch tiền mặt ----------
  for (const shift of snap.shifts) {
    if (shift.status !== 'CLOSED') continue;

    const expected = shift.startCash + shift.cashSales;
    const actual = shift.endCash ?? 0;
    const diff = actual - expected;
    if (Math.abs(diff) < CASH_DISCREPANCY_THRESHOLD) continue;

    // Chỉ báo ca đóng trong 2 ngày gần nhất, tránh đào lại lịch sử cũ.
    const closedAt = shift.endTime ? new Date(shift.endTime) : null;
    if (!closedAt || now.getTime() - closedAt.getTime() > 2 * DAY) continue;

    alerts.push({
      id: `cash-diff:${shift.id}:${today}`,
      level: 'P0',
      title: diff > 0 ? 'Ca đóng dư tiền mặt' : 'Ca đóng thiếu tiền mặt',
      body: `Ca của ${shift.userName} lệch ${money(Math.abs(diff))} (${diff > 0 ? 'thừa' : 'thiếu'}). Lý thuyết ${money(expected)}, thực thu ${money(actual)}.`,
      target: 'ADMIN_DASHBOARD',
      payload: { shiftId: shift.id },
    });
  }

  // ---------- P1: hàng bán chạy đã hết ----------
  const since = now.getTime() - BEST_SELLER_WINDOW_DAYS * DAY;
  const soldQty = new Map<string, number>();
  for (const tx of snap.transactions) {
    if (new Date(tx.date).getTime() < since) continue;
    for (const item of tx.items ?? []) {
      soldQty.set(item.productId, (soldQty.get(item.productId) ?? 0) + item.quantity);
    }
  }

  const outOfStockBestSellers = snap.products
    .filter(p => p.stock <= 0 && (soldQty.get(p.id) ?? 0) >= BEST_SELLER_MIN_QTY)
    .sort((a, b) => (soldQty.get(b.id) ?? 0) - (soldQty.get(a.id) ?? 0));

  if (outOfStockBestSellers.length > 0) {
    const top = outOfStockBestSellers[0];
    const more = outOfStockBestSellers.length - 1;
    alerts.push({
      id: `out-of-stock:${today}`,
      level: 'P1',
      title: `${outOfStockBestSellers.length} mặt hàng bán chạy đã hết`,
      body: more > 0
        ? `${top.name} bán ${soldQty.get(top.id)} trong 7 ngày, tồn ${top.stock}. Và ${more} mặt hàng khác cần nhập.`
        : `${top.name} bán ${soldQty.get(top.id)} trong 7 ngày, tồn ${top.stock}. Cần nhập thêm.`,
      target: 'INVENTORY',
      payload: { productIds: outOfStockBestSellers.slice(0, 20).map(p => p.id) },
    });
  }

  // ---------- P2: tồn kho thấp ----------
  const lowStock = snap.products.filter(p => p.stock > 0 && p.stock <= LOW_STOCK_THRESHOLD);
  if (lowStock.length > 0) {
    alerts.push({
      id: `low-stock:${today}`,
      level: 'P2',
      title: `${lowStock.length} mặt hàng sắp hết`,
      body: `Còn ${lowStock.length} mặt hàng tồn từ ${LOW_STOCK_THRESHOLD} trở xuống, ví dụ ${lowStock.slice(0, 3).map(p => p.name).join(', ')}.`,
      target: 'INVENTORY',
      payload: { productIds: lowStock.slice(0, 20).map(p => p.id) },
    });
  }

  // ---------- P2: chốt doanh thu hôm nay (chỉ sau 21h) ----------
  const hourNow = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hour12: false }).format(now)
  );
  if (hourNow >= 21) {
    const todayTx = snap.transactions.filter(t => dayKey(new Date(t.date), timeZone) === today);
    if (todayTx.length > 0) {
      const revenue = todayTx.reduce((s, t) => s + t.total, 0);
      alerts.push({
        id: `daily-revenue:${today}`,
        level: 'P2',
        title: 'Doanh thu hôm nay',
        body: `Hôm nay ${money(revenue)} / ${todayTx.length} đơn.`,
        target: 'ADMIN_DASHBOARD',
      });
    }
  }

  const order: Record<AlertLevel, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
  return alerts.sort((a, b) => order[a.level] - order[b.level]).slice(0, maxAlerts);
};
