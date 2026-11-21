import { Alert } from './rules';

/**
 * Cầu nối thông báo. Ưu tiên theo thứ tự:
 *
 *  1. `window.ZGO` — cầu nối native của app Android (xem MainActivity.java).
 *     Đây là đường DUY NHẤT hoạt động thật trong WebView, vì WebView không
 *     hỗ trợ Web Notification API.
 *  2. `window.Capacitor.Plugins.LocalNotifications` — nếu sau này chuyển sang Capacitor.
 *  3. Web Notification API — chỉ dùng khi mở bằng trình duyệt (Chrome/Safari).
 *
 * Giới hạn thật của Android:
 * - Android 13+ bắt buộc quyền runtime POST_NOTIFICATIONS.
 * - Thông báo cục bộ chỉ kêu khi app còn sống. Muốn kêu khi app đã bị kill
 *   phải có server push (FCM) — hiện chưa có.
 */

/** Cầu nối native do MainActivity.java đăng ký qua addJavascriptInterface. */
type NativeBridge = {
  available?: () => boolean;
  sale?: (title: string, body: string, txId?: string) => boolean;
  alert?: (title: string, body: string) => boolean;
  vibrate?: (ms: number) => void;
  permission?: () => string;
  /** Lưu token phiên để service nền gọi API (xem AlertChecker.saveToken). */
  saveToken?: (token: string) => void;
  token?: () => string;
  /** Báo trước "máy này sắp bán đơn id này" để service nền không báo trùng. */
  markSelfSale?: (txId: string) => void;
};

/**
 * Báo trước cho service nền: đơn này do máy này bán.
 *
 * Gọi TRƯỚC khi POST /transactions. Server broadcast qua WebSocket nhanh hơn
 * cả lúc trang web nhận response, nên nếu đợi bán xong mới báo thì service đã
 * kịp bắn "Đơn hàng mới" chồng lên "Thanh toán thành công".
 */
export const markSelfSale = (txId: string): void => {
  const native = getNative();
  if (!native?.markSelfSale) return;
  try {
    native.markSelfSale(txId);
  } catch {
    /* bản APK cũ chưa có hàm này: bỏ qua */
  }
};

type CapacitorLike = {
  isNativePlatform?: () => boolean;
  Plugins?: {
    LocalNotifications?: {
      requestPermissions: () => Promise<{ display: string }>;
      schedule: (opts: unknown) => Promise<unknown>;
      createChannel?: (opts: unknown) => Promise<unknown>;
    };
  };
};

const getNative = (): NativeBridge | null => {
  const b = (window as unknown as { ZGO?: NativeBridge }).ZGO;
  return b && typeof b.available === 'function' ? b : null;
};

const getCapacitor = (): CapacitorLike | null => {
  const c = (window as unknown as { Capacitor?: CapacitorLike }).Capacitor;
  return c && typeof c.isNativePlatform === 'function' && c.isNativePlatform() ? c : null;
};

/** Đang chạy trong app Android (có cầu nối native)? */
export const isNative = (): boolean => getNative() !== null;

/** Đang chạy trong app nhưng không có cầu nối (bản APK cũ)? */
export const isWebViewWithoutBridge = (): boolean => {
  const ua = navigator.userAgent || '';
  return ua.includes('ZGOPOS') && !isNative();
};

/** Trạng thái quyền hiện tại, không kích hoạt hộp thoại xin quyền. */
export const permissionState = (): 'granted' | 'denied' | 'default' | 'unsupported' => {
  const native = getNative();
  if (native?.permission) {
    try {
      const p = native.permission();
      return p === 'granted' ? 'granted' : 'denied';
    } catch {
      return 'default';
    }
  }
  if (getCapacitor()) return 'default';
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission as 'granted' | 'denied' | 'default';
};

/**
 * Xin quyền. Trong app Android, quyền được xin lúc mở app (MainActivity),
 * nên ở đây chỉ cần đọc lại trạng thái.
 * Trên trình duyệt BẮT BUỘC gọi từ trong sự kiện click.
 */
export const requestPermission = async (): Promise<boolean> => {
  const native = getNative();
  if (native?.permission) {
    return permissionState() === 'granted';
  }

  const cap = getCapacitor();
  if (cap?.Plugins?.LocalNotifications) {
    try {
      const res = await cap.Plugins.LocalNotifications.requestPermissions();
      return res.display === 'granted';
    } catch {
      return false;
    }
  }

  if (typeof Notification === 'undefined') return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;

  try {
    const res = await Notification.requestPermission();
    return res === 'granted';
  } catch {
    return false;
  }
};

/**
 * Hiện thông báo bán hàng (ưu tiên cao, rung). Trả về true nếu đã hiện.
 *
 * `txId` là mã giao dịch vừa lưu: chuyển xuống native để service nền ghi nhớ
 * "đơn này đã báo rồi" — nhờ vậy đơn của máy khác vẫn được báo, còn đơn của
 * chính máy này thì không báo hai lần.
 */
export const showSale = (title: string, body: string, txId?: string): boolean => {
  const native = getNative();
  if (native?.sale) {
    try {
      return native.sale(title, body, txId);
    } catch {
      return false;
    }
  }
  return showWeb(title, body);
};

/** Hiện cảnh báo nghiệp vụ. */
export const showAlert = async (alert: Alert): Promise<boolean> => {
  const native = getNative();
  if (native?.alert) {
    try {
      return native.alert(alert.title, alert.body);
    } catch {
      /* rơi xuống các nhánh dưới */
    }
  }

  const cap = getCapacitor();
  if (cap?.Plugins?.LocalNotifications) {
    try {
      if (cap.Plugins.LocalNotifications.createChannel) {
        await cap.Plugins.LocalNotifications.createChannel({
          id: 'zgo-alerts',
          name: 'Cảnh báo cửa hàng',
          description: 'Ca làm việc và tồn kho',
          importance: 4,
          visibility: 1,
        });
      }
      await cap.Plugins.LocalNotifications.schedule({
        notifications: [
          {
            id: Math.floor(Date.now() / 1000) % 2147483647,
            title: alert.title,
            body: alert.body,
            channelId: 'zgo-alerts',
          },
        ],
      });
      return true;
    } catch {
      return false;
    }
  }

  return showWeb(alert.title, alert.body, alert.id);
};

/** Rung máy (nếu có cầu nối native). */
export const vibrate = (ms = 80): void => {
  const native = getNative();
  if (native?.vibrate) {
    try { native.vibrate(ms); return; } catch { /* bỏ qua */ }
  }
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try { navigator.vibrate(ms); } catch { /* bỏ qua */ }
  }
};

/**
 * Đẩy token phiên xuống service Android ở nền.
 *
 * Server bắt buộc `Authorization: Bearer` cho /api/check và /api/live, nên
 * không có bước này thì service nền không báo được đơn mới khi app đóng.
 * Gọi với chuỗi rỗng khi đăng xuất.
 */
export const syncTokenToNative = (token: string | null): void => {
  const native = getNative();
  if (!native?.saveToken) return;
  try {
    native.saveToken(token ?? '');
  } catch {
    /* bản APK cũ không có hàm này: bỏ qua */
  }
};

const showWeb = (title: string, body: string, tag?: string): boolean => {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
    return false;
  }
  try {
    new Notification(title, { body, tag });
    return true;
  } catch {
    return false;
  }
};
