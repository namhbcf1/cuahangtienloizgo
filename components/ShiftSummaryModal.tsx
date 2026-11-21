
import React, { useEffect, useRef, useState } from 'react';
import { X, CheckCircle, AlertTriangle, Clock, Calendar, User, TrendingUp, DollarSign, FileText, RefreshCw } from 'lucide-react';
import { Shift, Transaction } from '../types';
import { api, TxSummary } from '../services/api';

interface ShiftSummaryModalProps {
  shift: Shift;
  /**
   * Đơn đang có trong bộ nhớ — chỉ dùng để hiện danh sách nhanh.
   *
   * SỐ TIỀN KHÔNG lấy từ đây: bộ nhớ client chỉ giữ vài trăm đơn gần nhất, ca
   * nào đông khách sẽ bị cộng thiếu. Toàn bộ con số tiền lấy từ server
   * (`/transactions/summary?shiftId=`), còn danh sách tải đủ qua phân trang.
   */
  transactions: Transaction[];
  onClose: () => void;
}

const PAGE_SIZE = 50;

const money = (n: number) => `${n.toLocaleString('vi-VN')} ₫`;

/**
 * Tổng kết một ca làm việc: dòng tiền, doanh thu theo phương thức,
 * và danh sách giao dịch phát sinh trong ca.
 */
export const ShiftSummaryModal: React.FC<ShiftSummaryModalProps> = ({ shift, transactions, onClose }) => {
  // Số tiền chính thức của cả ca do server cộng.
  const [totals, setTotals] = useState<TxSummary | null>(null);
  const [totalsError, setTotalsError] = useState<string | null>(null);

  // Danh sách đơn của ca, tải theo trang.
  const [items, setItems] = useState<Transaction[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<{ date: string; id: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);

  // Dự phòng khi server lỗi: cộng tạm từ danh sách đang có, nhưng nói rõ là
  // số tạm tính để người dùng không nhầm với số chính thức.
  const fallback = transactions.filter(t => t.shiftId === shift.id);
  const fallbackTotals: TxSummary = {
    count: fallback.length,
    revenue: fallback.reduce((s, t) => s + t.total, 0),
    cash: fallback.filter(t => t.paymentMethod === 'CASH').reduce((s, t) => s + t.total, 0),
    card: fallback.filter(t => t.paymentMethod === 'CARD').reduce((s, t) => s + t.total, 0),
    transfer: fallback.filter(t => t.paymentMethod === 'TRANSFER').reduce((s, t) => s + t.total, 0),
  };

  const view = totals ?? fallbackTotals;

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const [summary, page] = await Promise.all([
          api.getTransactionSummary({ shiftId: shift.id }),
          api.getTransactionHistory({ shiftId: shift.id, limit: PAGE_SIZE }),
        ]);
        if (cancelled) return;
        setTotals(summary);
        setItems(page.transactions);
        setHasMore(page.hasMore);
        setCursor(
          page.hasMore && page.nextBefore && page.nextBeforeId
            ? { date: page.nextBefore, id: page.nextBeforeId }
            : null,
        );
      } catch (e) {
        if (cancelled) return;
        setTotalsError(e instanceof Error ? e.message : 'Không tải được số liệu ca');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [shift.id]);

  const loadMore = async () => {
    if (!cursor || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const page = await api.getTransactionHistory({
        shiftId: shift.id,
        limit: PAGE_SIZE,
        before: cursor.date,
        beforeId: cursor.id,
      });
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
      setTotalsError(e instanceof Error ? e.message : 'Không tải thêm được');
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  };

  // Danh sách hiển thị: đơn của ca tải từ server; nếu chưa tải xong thì dùng
  // tạm đơn có trong bộ nhớ để modal không trống.
  const list = items.length > 0 ? items : loading ? fallback : items;

  const expectedCash = shift.startCash + shift.cashSales;
  const actualCash = shift.endCash || 0;
  const difference = actualCash - expectedCash;
  const isClosed = shift.status === 'CLOSED';

  const durationMinutes = shift.endTime
    ? Math.round((new Date(shift.endTime).getTime() - new Date(shift.startTime).getTime()) / (1000 * 60))
    : null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col">

        {/* Header */}
        <div className="p-6 border-b border-slate-200 bg-gradient-to-r from-blue-50 to-indigo-50">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2 mb-2">
                <FileText className="w-6 h-6 text-blue-600" />
                Tổng Kết Ca Làm Việc
              </h2>
              <div className="flex items-center gap-4 mt-2 text-sm text-slate-600 flex-wrap">
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4" />
                  <span className="font-semibold">{shift.userName}</span>
                  <span className="text-slate-400 font-mono">#{shift.userId}</span>
                </div>
                {isClosed && (
                  <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${difference === 0
                    ? 'bg-green-100 text-green-700 border border-green-200'
                    : difference > 0
                      ? 'bg-blue-100 text-blue-700 border border-blue-200'
                      : 'bg-red-100 text-red-700 border border-red-200'
                    }`}>
                    {difference === 0 ? (
                      <><CheckCircle className="w-3 h-3" /> Khớp tiền</>
                    ) : (
                      <><AlertTriangle className="w-3 h-3" /> {difference > 0 ? 'Dư tiền' : 'Thiếu tiền'}</>
                    )}
                  </div>
                )}
              </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-white/80 rounded-lg transition-colors">
              <X className="w-5 h-5 text-slate-600" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">

          {totalsError && (
            <div className="flex items-center gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{totalsError} — số dưới đây là tạm tính từ đơn đang có trong máy.</span>
            </div>
          )}

          {/* Ngày & thời gian */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
              <div className="flex items-center gap-2 text-slate-500 text-sm mb-2">
                <Calendar className="w-4 h-4" />
                Ngày làm việc
              </div>
              <div className="font-bold text-slate-800">
                {new Date(shift.startTime).toLocaleDateString('vi-VN', {
                  weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
                })}
              </div>
            </div>

            <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
              <div className="flex items-center gap-2 text-slate-500 text-sm mb-2">
                <Clock className="w-4 h-4" />
                Thời gian ca làm
              </div>
              <div className="font-bold text-slate-800">
                {new Date(shift.startTime).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                {shift.endTime && (
                  <> → {new Date(shift.endTime).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</>
                )}
              </div>
              {durationMinutes !== null && (
                <div className="text-xs text-slate-500 mt-1">Tổng thời gian: {durationMinutes} phút</div>
              )}
            </div>
          </div>

          {/* Dòng tiền */}
          <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl p-5 border border-green-200">
            <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-green-600" />
              Dòng Tiền Mặt
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <div className="text-xs text-slate-500 mb-1">Tiền đầu ca</div>
                <div className="font-bold text-lg text-slate-800">{shift.startCash.toLocaleString('vi-VN')} ₫</div>
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Doanh thu tiền mặt</div>
                <div className="font-bold text-lg text-green-600">+{shift.cashSales.toLocaleString('vi-VN')} ₫</div>
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Lý thuyết</div>
                <div className="font-bold text-lg text-slate-800">{expectedCash.toLocaleString('vi-VN')} ₫</div>
              </div>
              {isClosed && (
                <div>
                  <div className="text-xs text-slate-500 mb-1">Thực tế thu</div>
                  <div className={`font-bold text-lg ${difference === 0 ? 'text-slate-800' : difference > 0 ? 'text-blue-600' : 'text-red-600'}`}>
                    {actualCash.toLocaleString('vi-VN')} ₫
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Doanh thu — số của server, tính trên toàn bộ đơn của ca */}
          <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-5 border border-blue-200">
            <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-blue-600" />
              Tổng Doanh Thu
              {loading && <RefreshCw className="w-4 h-4 animate-spin text-blue-400" />}
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <div className="text-xs text-slate-500 mb-1">Tổng doanh thu</div>
                <div className="font-bold text-xl text-slate-800">{money(view.revenue)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Tiền mặt</div>
                <div className="font-bold text-lg text-green-600">{money(view.cash)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Thẻ</div>
                <div className="font-bold text-lg text-blue-600">{money(view.card)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Chuyển khoản</div>
                <div className="font-bold text-lg text-purple-600">{money(view.transfer)}</div>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-blue-200">
              <div className="text-xs text-slate-500">
                Tổng số giao dịch: <span className="font-bold text-slate-800">{view.count.toLocaleString('vi-VN')} đơn</span>
              </div>
            </div>
          </div>

          {/* Chi tiết giao dịch */}
          {list.length > 0 && (
            <div>
              <h3 className="font-bold text-slate-800 mb-3 flex items-center gap-2">
                <FileText className="w-5 h-5 text-slate-600" />
                Chi Tiết Giao Dịch ({view.count.toLocaleString('vi-VN')})
              </h3>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {list.map(t => (
                  <div key={t.id} className="bg-white border border-slate-200 rounded-lg p-3 flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-mono text-xs text-slate-400">#{t.id.slice(-6)}</span>
                        <span className="text-slate-500">
                          {new Date(t.date).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <span className={`px-2 py-0.5 rounded text-xs font-semibold ${t.paymentMethod === 'CASH' ? 'bg-green-100 text-green-700' : t.paymentMethod === 'CARD' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                          {t.paymentMethod === 'CASH' ? 'Tiền mặt' : t.paymentMethod === 'CARD' ? 'Thẻ' : 'Chuyển khoản'}
                        </span>
                      </div>
                      <div className="text-xs text-slate-400 mt-1">{t.items.length} sản phẩm</div>
                    </div>
                    <div className="font-bold text-slate-800">{t.total.toLocaleString('vi-VN')} ₫</div>
                  </div>
                ))}
              </div>
              {hasMore && (
                <div className="flex justify-center mt-3">
                  <button
                    onClick={() => void loadMore()}
                    disabled={loadingMore}
                    className="px-4 py-2 rounded-lg border border-slate-200 bg-white text-slate-600 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50"
                  >
                    {loadingMore ? 'Đang tải...' : `Tải thêm ${PAGE_SIZE} đơn`}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-slate-100 bg-slate-50">
          <button
            onClick={onClose}
            className="w-full py-3 bg-slate-800 text-white rounded-xl font-bold hover:bg-slate-900 transition-all"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
};
