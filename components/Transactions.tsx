
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Transaction } from '../types';
import {
  api, dayRange, todayKey,
  DailyRevenueRow,
} from '../services/api';
import { formatDateTime, formatDayKey } from '../utils/date';
import { DateField } from './DateField';
import {
  FileText, Calendar, DollarSign, User, Filter, X, RefreshCw, ChevronDown, AlertTriangle,
} from 'lucide-react';

interface TransactionsProps {
  /**
   * Chỉ lấy đơn của một ca (nhân viên). Bỏ trống = toàn bộ lịch sử (quản trị).
   *
   * Danh sách KHÔNG lấy từ bộ nhớ đồng bộ nữa: bộ nhớ đó chỉ giữ vài trăm đơn
   * gần nhất, nên lịch sử và tiền theo ngày phải hỏi thẳng server.
   */
  shiftId?: string;
  /**
   * `store` = xem toàn cửa hàng (quản trị).
   * `shift` = chỉ xem ca của mình; chưa mở ca thì không hiện gì, tránh lộ
   *           toàn bộ lịch sử cửa hàng cho nhân viên.
   */
  scope?: 'store' | 'shift';
}

/** Số đơn mỗi lần tải. */
const PAGE_SIZE = 50;

/** Tự làm mới trang đầu khi đang mở màn — không đụng tới phần đã tải thêm. */
const AUTO_REFRESH_MS = 60_000;

/** Khi không lọc ngày: bảng "theo ngày" chỉ tính 90 ngày gần nhất cho nhẹ. */
const DEFAULT_DAILY_DAYS = 90;

const money = (n: number) => `${n.toLocaleString('vi-VN')} đ`;

/** Mốc YYYY-MM-DD của N ngày trước (theo lịch máy). */
const daysAgoKey = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
};

export const Transactions: React.FC<TransactionsProps> = ({ shiftId, scope = 'store' }) => {
  /**
   * Nhân viên chưa mở ca: không có ca để xem, và tuyệt đối không được rơi về
   * "xem toàn cửa hàng" — /transactions chỉ bắt token, không phân biệt quyền.
   */
  const blocked = scope === 'shift' && !shiftId;

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Danh sách đã tải (mới nhất trước) + con trỏ cho lần "Tải thêm".
  const [items, setItems] = useState<Transaction[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<{ date: string; id: string } | null>(null);

  /**
   * Tổng số đơn + doanh thu của CẢ khoảng lọc, do server đếm.
   *
   * Lấy từ chính truy vấn lịch sử (`count`/`revenue`) nên luôn khớp bộ lọc —
   * không phải cộng trang đang xem, và không phải gọi thêm endpoint nào.
   */
  const [totals, setTotals] = useState<{ count: number; revenue: number } | null>(null);
  const [days, setDays] = useState<DailyRevenueRow[]>([]);

  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Chống race: chỉ kết quả của lần gọi mới nhất được ghi vào state.
  const requestSeq = useRef(0);
  const loadingMoreRef = useRef(false);
  /**
   * Đã bấm "Tải thêm" lần nào chưa.
   *
   * Có rồi thì KHÔNG tự làm mới trang đầu nữa: làm mới sẽ thay cả danh sách
   * bằng 50 đơn mới nhất, khiến người dùng đang xem lịch sử cũ bị nhảy về đầu.
   */
  const loadedMoreRef = useRef(false);

  // Lọc ngày theo giờ máy -> mốc ISO đầy đủ. Server không phải đoán múi giờ.
  const range = useMemo(() => dayRange(startDate, endDate), [startDate, endDate]);

  /**
   * Phạm vi cho bảng "doanh thu theo ngày".
   *
   * Chưa lọc ngày thì chỉ tính 90 ngày gần nhất: bảng này gom nhóm cả bảng
   * transactions, chạy nó trên toàn bộ lịch sử mỗi phút sẽ tốn hạn mức D1 vô ích.
   */
  const dailyRange = useMemo(() => {
    if (startDate || endDate) return range;
    return dayRange(daysAgoKey(DEFAULT_DAILY_DAYS), todayKey());
  }, [range, startDate, endDate]);

  const fetchFirstPage = useCallback(async () => {
    if (blocked) {
      setItems([]);
      setTotals(null);
      setDays([]);
      setHasMore(false);
      setCursor(null);
      setLoading(false);
      return;
    }
    // Đổi bộ lọc / bấm làm mới: bắt đầu lại từ trang đầu.
    loadedMoreRef.current = false;
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      // Hai truy vấn song song: một trang đơn + bảng gom theo ngày.
      const [page, daily] = await Promise.all([
        api.getTransactionHistory({ ...range, shiftId, limit: PAGE_SIZE }),
        api.getDailyRevenue({ ...dailyRange, shiftId }),
      ]);
      if (seq !== requestSeq.current) return;

      setItems(page.transactions);
      setHasMore(page.hasMore);
      setCursor(
        page.hasMore && page.nextBefore && page.nextBeforeId
          ? { date: page.nextBefore, id: page.nextBeforeId }
          : null,
      );
      setTotals({ count: page.count, revenue: page.revenue });
      setDays(daily.days);
    } catch (e) {
      if (seq !== requestSeq.current) return;
      setError(e instanceof Error ? e.message : 'Không tải được lịch sử giao dịch');
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [range, dailyRange, shiftId, blocked]);

  /**
   * Làm mới nền: CHỈ khi người dùng chưa bấm "Tải thêm". Đã tải thêm thì danh
   * sách đang dài hơn 50 đơn, thay bằng trang đầu sẽ làm họ mất chỗ đang xem.
   */
  const refreshFirstPage = useCallback(async () => {
    if (blocked || loadingMoreRef.current || loadedMoreRef.current) return;
    try {
      const page = await api.getTransactionHistory({ ...range, shiftId, limit: PAGE_SIZE });
      setItems(page.transactions);
      setHasMore(page.hasMore);
      setCursor(
        page.hasMore && page.nextBefore && page.nextBeforeId
          ? { date: page.nextBefore, id: page.nextBeforeId }
          : null,
      );
      setTotals({ count: page.count, revenue: page.revenue });
    } catch {
      /* lần làm mới nền lỗi thì giữ nguyên dữ liệu đang xem */
    }
  }, [range, shiftId, blocked]);

  const loadMore = async () => {
    if (!cursor || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    loadedMoreRef.current = true;
    setLoadingMore(true);
    try {
      const page = await api.getTransactionHistory({
        ...range,
        shiftId,
        limit: PAGE_SIZE,
        before: cursor.date,
        beforeId: cursor.id,
      });
      // Ghép theo id để không bao giờ hiện trùng dù có đơn mới chen vào.
      setItems(prev => {
        const seen = new Set(prev.map(t => t.id));
        return [...prev, ...page.transactions.filter(t => !seen.has(t.id))];
      });
      setHasMore(page.hasMore);
      setCursor(
        page.hasMore && page.nextBefore && page.nextBeforeId
          ? { date: page.nextBefore, id: page.nextBeforeId }
          : null,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải thêm được');
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  };

  // Đổi bộ lọc -> tải lại từ trang đầu.
  useEffect(() => {
    void fetchFirstPage();
  }, [fetchFirstPage]);

  // Tự làm mới khi chưa bấm "Tải thêm": luôn quay về trang đầu nên không mất
  // vị trí người dùng đang xem sâu trong lịch sử.
  useEffect(() => {
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (!cursor && !blocked) {
        void refreshFirstPage();
        void api.getDailyRevenue({ ...dailyRange, shiftId })
          .then(d => setDays(d.days))
          .catch(() => undefined);
      }
    }, AUTO_REFRESH_MS);
    return () => clearInterval(timer);
  }, [cursor, dailyRange, shiftId, refreshFirstPage, blocked]);

  const handleClearFilter = () => {
    setStartDate('');
    setEndDate('');
  };

  const handleToday = () => {
    const t = todayKey();
    setStartDate(t);
    setEndDate(t);
  };

  const isFiltered = Boolean(startDate || endDate);

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 h-full flex flex-col">
      {/* Header & Filters */}
      <div className="p-5 border-b border-slate-100 bg-slate-50/50 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <FileText className="w-5 h-5 text-slate-500" />
            Lịch sử giao dịch
          </h2>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleToday}
              className="px-3 py-2 text-xs font-bold rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              title="Chỉ xem hôm nay"
            >
              Hôm nay
            </button>
            <div className="flex items-center gap-1 bg-white p-1 rounded-xl border border-slate-200 shadow-sm">
              <div className="flex items-center gap-2 px-2 border-r border-slate-100">
                <Filter className="w-4 h-4 text-slate-400" />
                <span className="text-xs font-bold text-slate-500 uppercase">Lọc</span>
              </div>
              <DateField
                value={startDate}
                onChange={setStartDate}
                title="Từ ngày"
                ariaLabel="Từ ngày"
              />
              <span className="text-slate-300">-</span>
              <DateField
                value={endDate}
                onChange={setEndDate}
                title="Đến ngày"
                ariaLabel="Đến ngày"
              />
              {isFiltered && (
                <button
                  onClick={handleClearFilter}
                  className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-red-500 transition-colors"
                  title="Xóa bộ lọc"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            <button
              onClick={() => void fetchFirstPage()}
              disabled={loading}
              className="p-2 rounded-xl border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 disabled:opacity-50"
              title="Làm mới"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Số liệu của CẢ khoảng lọc — server đếm, không phải cộng trang đang xem */}
        {totals && (
          <div className="flex gap-3 flex-wrap text-sm">
            <div className="bg-blue-50 text-blue-700 px-3 py-1.5 rounded-lg border border-blue-100 font-medium">
              Đơn hàng: <b>{totals.count.toLocaleString('vi-VN')}</b>
            </div>
            <div className="bg-green-50 text-green-700 px-3 py-1.5 rounded-lg border border-green-100 font-medium">
              Doanh thu: <b>{money(totals.revenue)}</b>
            </div>
            {days.length > 0 && (
              <div className="bg-slate-50 text-slate-600 px-3 py-1.5 rounded-lg border border-slate-200 font-medium">
                {isFiltered ? 'Theo khoảng ngày đã chọn' : `${DEFAULT_DAILY_DAYS} ngày gần nhất`}
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        {/* Tiền từng ngày — nhóm theo ngày lịch Việt Nam ở phía server */}
        {days.length > 0 && (
          <div className="p-4 pb-0">
            <h3 className="text-sm font-bold text-slate-700 mb-2 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-slate-400" />
              Doanh thu theo ngày
            </h3>
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <div className="max-h-60 overflow-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-slate-50 sticky top-0 text-xs uppercase text-slate-500 font-bold">
                    <tr>
                      <th className="px-3 py-2">Ngày</th>
                      <th className="px-3 py-2 text-right">Số đơn</th>
                      <th className="px-3 py-2 text-right">Doanh thu</th>
                      <th className="px-3 py-2 text-right hidden md:table-cell">Tiền mặt</th>
                      <th className="px-3 py-2 text-right hidden md:table-cell">Thẻ</th>
                      <th className="px-3 py-2 text-right hidden md:table-cell">CK</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {days.map(d => (
                      <tr key={d.day} className="hover:bg-slate-50/60">
                        <td className="px-3 py-2 font-medium text-slate-700">{formatDayKey(d.day)}</td>
                        <td className="px-3 py-2 text-right text-slate-600">{d.count}</td>
                        <td className="px-3 py-2 text-right font-bold text-green-700">{money(d.revenue)}</td>
                        <td className="px-3 py-2 text-right text-slate-600 hidden md:table-cell">{money(d.cash)}</td>
                        <td className="px-3 py-2 text-right text-slate-600 hidden md:table-cell">{money(d.card)}</td>
                        <td className="px-3 py-2 text-right text-slate-600 hidden md:table-cell">{money(d.transfer)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Danh sách đơn */}
        <div className="p-4 space-y-4 bg-slate-50/30">
          {blocked ? (
            <div className="flex flex-col items-center justify-center h-64 text-slate-400">
              <FileText className="w-12 h-12 mb-3 opacity-50" />
              <p>Bạn chưa mở ca làm việc nên chưa có lịch sử để xem</p>
            </div>
          ) : loading && items.length === 0 ? (
            <div className="flex items-center justify-center h-64 text-slate-400">
              <div className="flex flex-col items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-slate-200 animate-pulse" />
                <p className="text-xs font-medium text-slate-600">Đang tải lịch sử...</p>
              </div>
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-slate-400">
              <FileText className="w-12 h-12 mb-3 opacity-50" />
              <p>Không tìm thấy giao dịch nào</p>
              {isFiltered && (
                <button onClick={handleClearFilter} className="mt-2 text-primary-600 text-sm hover:underline">
                  Xóa bộ lọc ngày
                </button>
              )}
            </div>
          ) : (
            items.map(t => (
              <div key={t.id} className="bg-white border border-slate-200 rounded-xl p-4 hover:shadow-md transition-shadow">
                <div className="flex justify-between items-start mb-3">
                  <div className="flex items-center gap-2">
                    <div className="bg-primary-50 p-2 rounded-lg text-primary-600">
                      <DollarSign className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-bold text-slate-800">#{t.id}</h3>
                      <div className="flex items-center gap-2 text-xs text-slate-500 mt-1">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" /> {formatDateTime(t.date)}
                        </span>
                        {t.cashierName && (
                          <span className="flex items-center gap-1 font-medium text-slate-700 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200">
                            <User className="w-3 h-3" /> {t.cashierName}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <span className="text-lg font-bold text-green-600">
                    +{t.total.toLocaleString('vi-VN')} đ
                  </span>
                </div>
                <div className="bg-slate-50 rounded-lg p-3 text-sm border border-slate-100">
                  <p className="font-semibold text-slate-600 mb-2">Chi tiết đơn hàng:</p>
                  <ul className="space-y-1">
                    {t.items.map((item, idx) => (
                      <li key={idx} className="flex justify-between text-slate-700">
                        <span>
                          {item.name} <span className="text-slate-400">x{item.quantity}</span>
                        </span>
                        <span className="font-medium">{(item.price * item.quantity).toLocaleString('vi-VN')}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))
          )}

          {/* "Tải thêm" — keyset nên không lặp/sót đơn khi có đơn mới */}
          {hasMore && (
            <div className="flex justify-center pt-2">
              <button
                onClick={() => void loadMore()}
                disabled={loadingMore}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-700 font-semibold hover:bg-slate-50 disabled:opacity-50"
              >
                {loadingMore ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
                {loadingMore ? 'Đang tải...' : `Tải thêm ${PAGE_SIZE} đơn`}
              </button>
            </div>
          )}

          {!hasMore && items.length > 0 && (
            <p className="text-center text-xs text-slate-400 py-2">
              Đã hiển thị toàn bộ {items.length.toLocaleString('vi-VN')} đơn
              {isFiltered ? ' trong khoảng ngày đã chọn' : ''}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
