import { Alert } from './rules';

/**
 * Ghi nhớ thông báo đã hiện, để mỗi quy tắc chỉ báo một lần mỗi ngày.
 * Dùng localStorage vì dữ liệu rất nhỏ (chỉ vài khoá).
 */

const ACK_KEY = 'zgo_notify_ack';
const SNOOZE_KEY = 'zgo_notify_snooze_until';

type AckMap = Record<string, number>;

const readAck = (): AckMap => {
  try {
    const raw = localStorage.getItem(ACK_KEY);
    return raw ? (JSON.parse(raw) as AckMap) : {};
  } catch {
    return {};
  }
};

const writeAck = (map: AckMap) => {
  try {
    // Dọn khoá cũ hơn 30 ngày để không phình localStorage
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const pruned: AckMap = {};
    for (const [k, ts] of Object.entries(map)) {
      if (ts >= cutoff) pruned[k] = ts;
    }
    localStorage.setItem(ACK_KEY, JSON.stringify(pruned));
  } catch {
    /* localStorage đầy hoặc bị chặn: bỏ qua, không làm hỏng app */
  }
};

/** Đã hiện thông báo này chưa (trong 24h gần nhất)? */
export const isAcknowledged = (alertId: string): boolean => {
  const ts = readAck()[alertId];
  if (!ts) return false;
  return Date.now() - ts < 24 * 60 * 60 * 1000;
};

export const acknowledge = (alertId: string) => {
  const map = readAck();
  map[alertId] = Date.now();
  writeAck(map);
};

/** Người dùng bấm "Nhắc lại sau": tạm ẩn mọi thông báo tới thời điểm này. */
export const snoozeAll = (hours: number) => {
  try {
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + hours * 60 * 60 * 1000));
  } catch {
    /* bỏ qua */
  }
};

export const isSnoozed = (): boolean => {
  try {
    const raw = localStorage.getItem(SNOOZE_KEY);
    if (!raw) return false;
    return Date.now() < Number(raw);
  } catch {
    return false;
  }
};

export const clearSnooze = () => {
  try {
    localStorage.removeItem(SNOOZE_KEY);
  } catch {
    /* bỏ qua */
  }
};

/** Lọc bỏ những thông báo đã hiện hôm nay hoặc đang trong thời gian tạm ẩn. */
export const filterFresh = (alerts: Alert[]): Alert[] => {
  if (isSnoozed()) return [];
  return alerts.filter(a => !isAcknowledged(a.id));
};
