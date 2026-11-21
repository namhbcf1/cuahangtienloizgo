import React from 'react';
import { RefreshCw, WifiOff, CheckCircle } from 'lucide-react';

interface SyncStatusProps {
  refreshing: boolean;
  error: string | null;
  lastSync: Date | null;
  /** WebSocket đang kết nối — cập nhật tức thì. */
  live?: boolean;
}

/**
 * Thanh trạng thái đồng bộ nhỏ, hiện trong header.
 *
 * Cho người dùng biết app đang tự cập nhật, tránh cảm giác "phải tắt mở lại".
 */
export const SyncStatus: React.FC<SyncStatusProps> = ({ refreshing, error, lastSync, live = false }) => {
  if (error) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-red-50 border border-red-200">
        <WifiOff className="w-3.5 h-3.5 text-red-500 shrink-0" />
        <span className="text-[11px] font-semibold text-red-600 whitespace-nowrap">Mất kết nối</span>
      </div>
    );
  }

  if (refreshing) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-blue-50 border border-blue-200">
        <RefreshCw className="w-3.5 h-3.5 text-blue-500 animate-spin shrink-0" />
        <span className="text-[11px] font-semibold text-blue-600 whitespace-nowrap">Đang cập nhật</span>
      </div>
    );
  }

  const time = lastSync
    ? lastSync.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
    : '--:--';

  // Chấm xanh nhấp nháy khi WebSocket đang nối = cập nhật tức thì
  return (
    <div className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border ${live
      ? 'bg-emerald-50 border-emerald-300'
      : 'bg-slate-50 border-slate-200'
      }`}>
      {live ? (
        <span className="relative flex w-2.5 h-2.5 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full w-2.5 h-2.5 bg-emerald-500" />
        </span>
      ) : (
        <CheckCircle className="w-3.5 h-3.5 text-slate-400 shrink-0" />
      )}
      <span className={`text-[11px] font-semibold whitespace-nowrap ${live ? 'text-emerald-700' : 'text-slate-600'
        }`}>{time}</span>
    </div>
  );
};
