import { Product, Shift, Transaction, User } from '../types';

const API_Base = '/api';

/**
 * Token phiên đăng nhập.
 *
 * Server cấp token ở `/auth/login`; mọi lệnh ghi phải gửi kèm
 * `Authorization: Bearer <token>`. Token là chuỗi ký HMAC, KHÔNG chứa PIN —
 * lưu ở localStorage để reload trang không phải đăng nhập lại, và bị xoá khi
 * đăng xuất hoặc khi server trả 401.
 */
const TOKEN_KEY = 'smartpos_token';

let authToken: string | null = null;

const loadToken = (): string | null => {
  if (authToken) return authToken;
  try {
    authToken = localStorage.getItem(TOKEN_KEY);
  } catch {
    authToken = null;
  }
  return authToken;
};

export const setAuthToken = (token: string | null): void => {
  authToken = token;
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* chế độ riêng tư: chỉ giữ trong bộ nhớ */
  }
};

/**
 * Đẩy token THIẾT BỊ xuống service Android chạy nền.
 *
 * Service nền phải sống qua đêm, qua nhiều ca — token web hạn 12 giờ sẽ hết
 * hạn lúc nửa đêm, service nhận 401 rồi im lặng (đúng lỗi "bán xong không
 * thông báo khi app tắt"). Nên nó dùng token riêng hạn 90 ngày mà server cấp
 * ở `/auth/login` (trường `deviceToken`) và tự gia hạn qua `/auth/refresh`.
 *
 * Token này được lưu riêng trong localStorage để sau khi tải lại trang (hoặc
 * app bị hệ điều hành giết rồi mở lại) vẫn đẩy lại được xuống native.
 */
const DEVICE_TOKEN_KEY = 'smartpos_device_token';

export const setNativeDeviceToken = (deviceToken: string | null): void => {
  try {
    if (deviceToken) localStorage.setItem(DEVICE_TOKEN_KEY, deviceToken);
    else localStorage.removeItem(DEVICE_TOKEN_KEY);
  } catch {
    /* chế độ riêng tư */
  }
  try {
    const bridge = (window as unknown as { ZGO?: { saveToken?: (t: string) => void } }).ZGO;
    bridge?.saveToken?.(deviceToken ?? '');
  } catch {
    /* không chạy trong app: không có gì để làm */
  }
};

/** Token thiết bị đang lưu (null nếu chưa đăng nhập lần nào). */
export const getDeviceToken = (): string | null => {
  try {
    return localStorage.getItem(DEVICE_TOKEN_KEY);
  } catch {
    return null;
  }
};

export const getAuthToken = (): string | null => loadToken();

/** Header cho request: luôn kèm token nếu đã đăng nhập. */
const authHeaders = (extra?: Record<string, string>): Record<string, string> => {
  const token = loadToken();
  return {
    ...(extra ?? {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
};

/**
 * Gọi API và ném lỗi có nội dung khi HTTP không phải 2xx.
 * Token hết hạn (401) thì xoá luôn để lần sau buộc đăng nhập lại.
 */
const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const res = await fetch(`${API_Base}${path}`, {
    ...init,
    headers: authHeaders({
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...((init.headers as Record<string, string>) ?? {}),
    }),
  });

  if (res.status === 401) {
    setAuthToken(null);
    throw new Error('Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại');
  }

  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;

  if (!res.ok) {
    const message = (data as { error?: string } | null)?.error ?? `Lỗi máy chủ (${res.status})`;
    throw new Error(message);
  }
  return data as T;
};

export interface SyncStats {
  totalCount: number;
  totalRevenue: number;
  todayRevenue: number;
  todayCount: number;
}

export interface SyncResponse {
  /** Phiên bản dữ liệu sản phẩm — gửi lại lên server ở lần sau để bỏ qua tải. */
  pv: string;
  /** Chỉ có khi phiên bản khác với client đang giữ. */
  products: Product[] | null;
  shifts: Shift[];
  /** Chỉ đơn mới hơn mốc `after`, hoặc 50 đơn gần nhất ở lần đầu. */
  transactions: Transaction[];
  stats: SyncStats;
  /** Giờ server — dùng làm mốc `after` cho lần sau. */
  now: string;
}

export interface SyncParams {
  /** Phiên bản products client đang giữ. */
  pv?: string;
  /** Mốc thời gian giao dịch cuối client đã có. */
  after?: string;
  /** Lấy đủ đơn của một ca (dùng cho màn tổng kết ca). */
  shiftId?: string;
}

/** Tham số lọc dùng chung cho lịch sử / tổng hợp / doanh thu theo ngày. */
export interface TxHistoryParams {
  /**
   * Ngày lịch của cửa hàng, dạng YYYY-MM-DD (giá trị ô lọc ngày).
   *
   * Server tự đổi sang mốc giờ Việt Nam, nên máy đặt sai múi giờ vẫn ra đúng
   * "doanh thu ngày đó". Ưu tiên dùng thay cho from/to.
   */
  fromDay?: string;
  toDay?: string;
  /** Mốc ISO đầy đủ (tương thích cũ). */
  from?: string;
  to?: string;
  shiftId?: string;
  /** Con trỏ keyset: lấy đơn cũ hơn mốc này. */
  before?: string;
  beforeId?: string;
  limit?: number;
}

export interface TxHistoryPage {
  transactions: Transaction[];
  hasMore: boolean;
  nextBefore: string | null;
  nextBeforeId: string | null;
  /** Tổng số đơn của cả khoảng lọc, không phải của riêng trang này. */
  count: number;
  /** Tổng doanh thu của cả khoảng lọc. */
  revenue: number;
}

export interface TxSummary {
  count: number;
  revenue: number;
  cash: number;
  card: number;
  transfer: number;
}

export interface DailyRevenueRow extends TxSummary {
  /** Ngày theo lịch Việt Nam, dạng YYYY-MM-DD. */
  day: string;
}

export interface DailyRevenue {
  days: DailyRevenueRow[];
}

/** Ghép tham số thành query string, bỏ giá trị rỗng. */
const txQuery = (p: TxHistoryParams): string => {
  const q = new URLSearchParams();
  if (p.fromDay) q.set('fromDay', p.fromDay);
  if (p.toDay) q.set('toDay', p.toDay);
  if (p.from) q.set('from', p.from);
  if (p.to) q.set('to', p.to);
  if (p.shiftId) q.set('shiftId', p.shiftId);
  if (p.before) q.set('before', p.before);
  if (p.beforeId) q.set('beforeId', p.beforeId);
  if (p.limit) q.set('limit', String(p.limit));
  return q.toString();
};

/**
 * Đổi hai ngày người dùng chọn thành tham số lọc.
 *
 * Gửi thẳng ngày (YYYY-MM-DD) cho server: server quy đổi theo giờ Việt Nam,
 * nên "doanh thu ngày 20/11" không lệch dù máy đặt múi giờ khác.
 */
export const dayRange = (startDay: string, endDay: string): TxHistoryParams => {
  const out: TxHistoryParams = {};
  if (startDay) out.fromDay = startDay;
  if (endDay) out.toDay = endDay;
  return out;
};

/** Ngày hôm nay theo lịch máy, dạng YYYY-MM-DD (dùng cho ô lọc ngày). */
export const todayKey = (): string => {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
};

export const api = {
  // Users
  getUsers: async (): Promise<User[]> => {
    return request<User[]>('/users');
  },
  /** Đăng nhập: PIN được kiểm ở server, không lưu trong trình duyệt. */
  login: async (id: string, pin: string): Promise<User> => {
    const res = await fetch(`${API_Base}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, pin }),
    });
    const data = (await res.json()) as {
      error?: string;
      id: string;
      name: string;
      role: 'ADMIN' | 'STAFF';
      token?: string;
      deviceToken?: string;
    };
    if (!res.ok) throw new Error(data?.error || 'Mã PIN không đúng');
    if (data.token) setAuthToken(data.token);
    // Token thiết bị hạn 90 ngày cho service nền — xem setNativeDeviceToken.
    if (data.deviceToken) setNativeDeviceToken(data.deviceToken);
    return { id: data.id, name: data.name, role: data.role };
  },
  /**
   * Đăng xuất CHỦ ĐỘNG (người dùng bấm): bỏ cả token web và token thiết bị,
   * service nền dừng.
   */
  logout: (): void => {
    setAuthToken(null);
    setNativeDeviceToken(null);
  },
  createUser: async (user: User): Promise<User> => {
    return request<User>('/users', { method: 'POST', body: JSON.stringify(user) });
  },
  updateUser: async (user: User): Promise<User> => {
    return request<User>(`/users/${user.id}`, { method: 'PUT', body: JSON.stringify(user) });
  },
  deleteUser: async (id: string): Promise<void> => {
    await request<{ success: boolean }>(`/users/${id}`, { method: 'DELETE' });
  },

  /**
   * Đồng bộ gọn: thay cho việc tải toàn bộ products + shifts + transactions.
   * Server bỏ qua products khi phiên bản không đổi, chỉ gửi đơn mới.
   */
  sync: async (params: SyncParams = {}): Promise<SyncResponse> => {
    const q = new URLSearchParams();
    if (params.pv) q.set('pv', params.pv);
    if (params.after) q.set('after', params.after);
    if (params.shiftId) q.set('shiftId', params.shiftId);
    const qs = q.toString();
    return request<SyncResponse>(`/sync${qs ? `?${qs}` : ''}`);
  },

  // Products
  getProducts: async (): Promise<Product[]> => {
    return request<Product[]>('/products');
  },
  createProduct: async (product: Product): Promise<Product> => {
    return request<Product>('/products', { method: 'POST', body: JSON.stringify(product) });
  },
  updateProduct: async (product: Product): Promise<Product> => {
    return request<Product>(`/products/${product.id}`, {
      method: 'PUT',
      body: JSON.stringify(product),
    });
  },
  bulkUpsertProducts: async (products: Product[]): Promise<{ inserted: number; updated: number }> => {
    return request<{ inserted: number; updated: number }>('/products/bulk-upsert', {
      method: 'POST',
      body: JSON.stringify({ products }),
    });
  },
  /**
   * Xoá sản phẩm. Server chặn (409) nếu sản phẩm đã từng bán, trừ khi force.
   * Lỗi 409 ném ra kèm message để UI hỏi lại người dùng.
   */
  deleteProduct: async (
    id: string,
    force = false,
  ): Promise<{ id: string; deleted: boolean; soldCount: number }> => {
    return request<{ id: string; deleted: boolean; soldCount: number }>(
      `/products/${encodeURIComponent(id)}${force ? '?force=1' : ''}`,
      { method: 'DELETE' },
    );
  },

  // Shifts
  getShifts: async (): Promise<Shift[]> => {
    return request<Shift[]>('/shifts');
  },
  createShift: async (shift: Shift): Promise<Shift> => {
    return request<Shift>('/shifts', { method: 'POST', body: JSON.stringify(shift) });
  },
  updateShift: async (shift: Shift): Promise<Shift> => {
    return request<Shift>(`/shifts/${shift.id}`, { method: 'PUT', body: JSON.stringify(shift) });
  },

  // Transactions
  getTransactions: async (): Promise<Transaction[]> => {
    return request<Transaction[]>('/transactions');
  },

  /**
   * Lịch sử giao dịch có phân trang "Tải thêm".
   *
   * Server trả tối đa `limit` đơn cũ dần tính từ con trỏ `before`; `hasMore`
   * cho biết còn trang sau. `count`/`revenue` là tổng của CẢ khoảng lọc, nên
   * hiển thị số liệu đúng dù danh sách mới tải vài chục đơn.
   */
  getTransactionHistory: async (params: TxHistoryParams = {}): Promise<TxHistoryPage> => {
    return request<TxHistoryPage>(`/transactions/history?${txQuery(params)}`);
  },

  /** Tổng hợp tiền theo ca hoặc theo khoảng ngày (SUM trên server). */
  getTransactionSummary: async (params: TxHistoryParams = {}): Promise<TxSummary> => {
    return request<TxSummary>(`/transactions/summary?${txQuery(params)}`);
  },

  /** Doanh thu gom theo từng ngày theo giờ Việt Nam. */
  getDailyRevenue: async (params: TxHistoryParams = {}): Promise<DailyRevenue> => {
    return request<DailyRevenue>(`/transactions/daily?${txQuery(params)}`);
  },

  createTransaction: async (transaction: Transaction): Promise<Transaction> => {
    return request<Transaction>('/transactions', {
      method: 'POST',
      body: JSON.stringify(transaction),
    });
  }
};
