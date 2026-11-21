import { useCallback, useEffect, useRef, useState } from 'react';
import { api, getAuthToken, SyncStats } from '../services/api';
import { Product, Shift, Transaction } from '../types';

/**
 * Đồng bộ dữ liệu tự động giữa nhiều máy.
 *
 * Trước đây mỗi lần làm mới tải TOÀN BỘ: 164 KB sản phẩm + 884 KB giao dịch
 * = 1.049 KB mỗi 5 giây (738 MB/giờ). Giờ dùng /api/sync:
 *
 *  - Sản phẩm chỉ tải khi server báo phiên bản đổi (`pv` khác). Lần thứ hai
 *    trở đi gần như không tốn gì cho phần này.
 *  - Giao dịch chỉ tải đơn MỚI hơn mốc `after`, không kéo lại 1.800 đơn cũ.
 *  - Tổng doanh thu do server tính sẵn trong `stats`.
 *
 * Kết quả: một lần đồng bộ bình thường chỉ còn vài KB.
 *
 * Thêm WebSocket: nếu server đẩy tín hiệu "có thay đổi" thì đồng bộ ngay,
 * không đợi hết chu kỳ.
 */

/** Chu kỳ dự phòng khi không có WebSocket. Có WebSocket thì đây chỉ là lưới an toàn. */
const POLL_INTERVAL_MS = 5_000;

/** Giữ tối đa bao nhiêu đơn trong bộ nhớ để hiện lịch sử. */
const MAX_KEPT_TRANSACTIONS = 300;

export interface LiveData {
  products: Product[];
  shifts: Shift[];
  transactions: Transaction[];
  stats: SyncStats;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  lastSync: Date | null;
  /** Nguồn cập nhật gần nhất — để biết WebSocket có đang hoạt động. */
  lastSource: 'init' | 'poll' | 'push' | 'manual' | null;
  /** WebSocket đang kết nối? */
  live: boolean;
  refresh: (source?: LiveData['lastSource']) => Promise<void>;
}

const EMPTY_STATS: SyncStats = { totalCount: 0, totalRevenue: 0, todayRevenue: 0, todayCount: 0 };

/** Ghép đơn mới vào danh sách cũ, bỏ trùng theo id, giữ tối đa N đơn. */
const mergeTransactions = (old: Transaction[], fresh: Transaction[]): Transaction[] => {
  if (fresh.length === 0) return old;
  const byId = new Map<string, Transaction>();
  for (const t of old) byId.set(t.id, t);
  for (const t of fresh) byId.set(t.id, t);
  const merged = [...byId.values()].sort((a, b) => a.date.localeCompare(b.date));
  return merged.length > MAX_KEPT_TRANSACTIONS
    ? merged.slice(merged.length - MAX_KEPT_TRANSACTIONS)
    : merged;
};

export const useLiveData = (enabled: boolean): LiveData => {
  const [products, setProducts] = useState<Product[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [stats, setStats] = useState<SyncStats>(EMPTY_STATS);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [lastSource, setLastSource] = useState<LiveData['lastSource']>(null);
  const [live, setLive] = useState(false);

  // Con trỏ đồng bộ — dùng ref để không phụ thuộc state, tránh tạo lại vòng lặp
  const pvRef = useRef<string>('');
  const afterRef = useRef<string>('');
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const refreshRef = useRef<(source?: LiveData['lastSource']) => Promise<void>>(async () => {});

  const refresh = useCallback(async (source: LiveData['lastSource'] = 'manual') => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);

    try {
      const res = await api.sync({
        pv: pvRef.current || undefined,
        after: afterRef.current || undefined,
      });

      if (!mounted.current) return;

      // Sản phẩm: null nghĩa là server xác nhận chưa đổi -> giữ nguyên bản cũ
      if (Array.isArray(res.products)) setProducts(res.products);
      if (Array.isArray(res.shifts)) setShifts(res.shifts);
      if (Array.isArray(res.transactions)) {
        setTransactions((prev) => mergeTransactions(prev, res.transactions));
      }
      if (res.stats) setStats(res.stats);

      pvRef.current = res.pv ?? '';
      afterRef.current = res.now ?? new Date().toISOString();

      setError(null);
      setLastSync(new Date());
      setLastSource(source);
    } catch (e) {
      if (mounted.current) {
        setError(e instanceof Error ? e.message : 'Không kết nối được máy chủ');
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) {
        setRefreshing(false);
        setLoading(false);
      }
    }
  }, []);

  refreshRef.current = refresh;

  // Đồng bộ lần đầu + chu kỳ dự phòng + khi quay lại app
  useEffect(() => {
    mounted.current = true;
    if (!enabled) return;

    void refresh('init');

    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      void refresh('poll');
    }, POLL_INTERVAL_MS);

    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh('poll');
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      mounted.current = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, refresh]);

  // WebSocket: server đẩy tín hiệu thì đồng bộ ngay, khỏi đợi 5 giây.
  // Nếu kết nối hỏng, chu kỳ 5 giây phía trên vẫn chạy nên không mất dữ liệu.
  useEffect(() => {
    if (!enabled) return;

    let ws: WebSocket | null = null;
    let retry = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const connect = () => {
      if (closed) return;

      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      // WebSocket không set được header, nên token đi qua query string.
      const token = getAuthToken();
      const url = `${proto}//${location.host}/api/live${token ? `?token=${encodeURIComponent(token)}` : ''}`;

      try {
        ws = new WebSocket(url);
      } catch {
        scheduleRetry();
        return;
      }

      ws.onopen = () => {
        retry = 0;
        setLive(true);
        // Đồng bộ ngay sau khi nối lại để bắt kịp thay đổi lúc mất kết nối
        void refreshRef.current('push');
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data));
          if (msg?.type === 'changed') void refreshRef.current('push');
        } catch {
          /* tin nhắn không phải JSON: bỏ qua */
        }
      };

      ws.onclose = () => {
        setLive(false);
        ws = null;
        scheduleRetry();
      };

      ws.onerror = () => {
        try { ws?.close(); } catch { /* bỏ qua */ }
      };
    };

    const scheduleRetry = () => {
      if (closed) return;
      retry = Math.min(retry + 1, 6);
      const delay = Math.min(1000 * 2 ** (retry - 1), 30_000);
      retryTimer = setTimeout(connect, delay);
    };

    connect();

    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      setLive(false);
      try { ws?.close(); } catch { /* bỏ qua */ }
    };
  }, [enabled]);

  return {
    products, shifts, transactions, stats,
    loading, refreshing, error, lastSync, lastSource, live,
    refresh,
  };
};