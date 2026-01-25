
import React, { useState, useEffect } from 'react';
import { Shift, User } from '../types';
import { Save, AlertTriangle, LogOut, DollarSign, Calculator } from 'lucide-react';

interface ShiftModalProps {
  mode: 'OPEN' | 'CLOSE';
  user: User;
  currentShift?: Shift | null;
  onConfirm: (amount: number) => void;
  onCancel: () => void;
}

export const ShiftModal: React.FC<ShiftModalProps> = ({ mode, user, currentShift, onConfirm, onCancel }) => {
  const [amount, setAmount] = useState<string>('');
  
  // For Close Mode
  const expectedCash = currentShift ? currentShift.startCash + currentShift.cashSales : 0;
  const difference = amount ? Number(amount) - expectedCash : 0 - expectedCash;

  useEffect(() => {
      // Focus input on mount
      const timer = setTimeout(() => document.getElementById('cash-input')?.focus(), 100);
      return () => clearTimeout(timer);
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className={`p-6 border-b ${mode === 'OPEN' ? 'bg-primary-50 border-primary-100' : 'bg-slate-50 border-slate-100'}`}>
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            {mode === 'OPEN' ? <DollarSign className="text-primary-600" /> : <LogOut className="text-slate-600" />}
            {mode === 'OPEN' ? 'Mở Ca Làm Việc' : 'Kết Thúc Ca & Bàn Giao'}
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            Nhân viên: <span className="font-bold text-slate-700">{user.name}</span>
          </p>
        </div>

        {/* Body */}
        <div className="p-6 space-y-6">
          {mode === 'CLOSE' && currentShift && (
            <div className="bg-slate-50 rounded-xl p-4 space-y-3 border border-slate-100">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Tiền đầu ca:</span>
                <span className="font-mono font-medium">{currentShift.startCash.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Doanh thu tiền mặt:</span>
                <span className="font-mono font-medium text-green-600">+{currentShift.cashSales.toLocaleString()}</span>
              </div>
              <div className="border-t border-slate-200 pt-2 flex justify-between font-bold text-slate-800">
                <span>Tổng tiền hệ thống (Lý thuyết):</span>
                <span>{expectedCash.toLocaleString()}</span>
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">
              {mode === 'OPEN' ? 'Nhập số tiền đầu ca (Tiền lẻ trong két):' : 'Nhập tổng tiền thực tế kiểm đếm:'}
            </label>
            <div className="relative">
              <input
                id="cash-input"
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full pl-10 pr-4 py-3 bg-white border-2 border-slate-200 rounded-xl focus:border-primary-500 focus:ring-0 outline-none text-lg font-bold text-slate-800 transition-all placeholder:font-normal"
                placeholder="0"
              />
              <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                <Calculator className="w-5 h-5" />
              </div>
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400">VND</span>
            </div>
          </div>

          {mode === 'CLOSE' && amount !== '' && (
            <div className={`p-3 rounded-lg flex items-start gap-3 text-sm ${difference === 0 ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <div>
                <p className="font-bold">{difference === 0 ? 'Khớp số liệu' : difference > 0 ? 'Thừa tiền (Dư)' : 'Thiếu tiền (Lệch)'}</p>
                <p>Chênh lệch: <span className="font-mono font-bold text-lg">{Math.abs(difference).toLocaleString()}</span></p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 bg-slate-50 border-t border-slate-100 flex gap-3">
            {mode === 'CLOSE' && (
                <button 
                onClick={onCancel}
                className="px-5 py-3 rounded-xl border border-slate-200 text-slate-600 font-semibold hover:bg-white transition-all"
                >
                Hủy
                </button>
            )}
            <button
                disabled={!amount}
                onClick={() => onConfirm(Number(amount))}
                className="flex-1 py-3 bg-slate-900 text-white rounded-xl font-bold shadow-lg shadow-slate-900/20 hover:bg-slate-800 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
                <Save className="w-4 h-4" />
                {mode === 'OPEN' ? 'Bắt đầu Ca làm việc' : 'Xác nhận Kết ca'}
            </button>
        </div>

      </div>
    </div>
  );
};
