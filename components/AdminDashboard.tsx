
import React, { useMemo } from 'react';
import { Shift, Transaction } from '../types';
import { Shield, AlertTriangle, CheckCircle, Clock, DollarSign, TrendingUp, Calendar, User, ArrowRight } from 'lucide-react';

interface AdminDashboardProps {
  shifts: Shift[];
  transactions: Transaction[];
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ shifts, transactions }) => {
  // Stats
  const totalRevenue = useMemo(() => transactions.reduce((sum, t) => sum + t.total, 0), [transactions]);
  const closedShifts = useMemo(() => shifts.filter(s => s.status === 'CLOSED'), [shifts]);
  const totalDiscrepancy = useMemo(() => {
    return closedShifts.reduce((sum, s) => {
        const diff = (s.endCash || 0) - (s.expectedCash || 0);
        return sum + diff;
    }, 0);
  }, [closedShifts]);

  return (
    <div className="flex flex-col h-full gap-6">
      {/* Top Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex items-center gap-4">
           <div className="w-12 h-12 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center shadow-sm">
             <TrendingUp className="w-6 h-6" />
           </div>
           <div>
             <p className="text-slate-500 text-sm font-medium">Tổng Doanh Thu</p>
             <h3 className="text-2xl font-bold text-slate-800">{totalRevenue.toLocaleString()} đ</h3>
           </div>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex items-center gap-4">
           <div className="w-12 h-12 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center shadow-sm">
             <Clock className="w-6 h-6" />
           </div>
           <div>
             <p className="text-slate-500 text-sm font-medium">Số ca đã đóng</p>
             <h3 className="text-2xl font-bold text-slate-800">{closedShifts.length} ca</h3>
           </div>
        </div>

        <div className={`bg-white p-6 rounded-2xl shadow-sm border flex items-center gap-4 ${totalDiscrepancy < 0 ? 'border-red-200 bg-red-50/50' : 'border-slate-200'}`}>
           <div className={`w-12 h-12 rounded-full flex items-center justify-center shadow-sm ${totalDiscrepancy < 0 ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}>
             <DollarSign className="w-6 h-6" />
           </div>
           <div>
             <p className="text-slate-500 text-sm font-medium">Tổng chênh lệch tiền mặt</p>
             <h3 className={`text-2xl font-bold ${totalDiscrepancy < 0 ? 'text-red-600' : 'text-green-600'}`}>
                {totalDiscrepancy > 0 ? '+' : ''}{totalDiscrepancy.toLocaleString()} đ
             </h3>
           </div>
        </div>
      </div>

      {/* Shift History Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 flex-1 overflow-hidden flex flex-col">
         <div className="p-6 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-50/50">
            <div className="flex items-center gap-3">
                <div className="bg-white p-2 rounded-lg border border-slate-200 shadow-sm text-slate-600">
                    <Shield className="w-5 h-5" />
                </div>
                <div>
                    <h3 className="font-bold text-slate-800 text-lg">Báo cáo Ca làm việc & Bàn giao</h3>
                    <p className="text-slate-500 text-sm">Theo dõi chi tiết dòng tiền và ca làm việc của nhân viên</p>
                </div>
            </div>
         </div>
         
         <div className="overflow-auto flex-1 bg-slate-50/30">
            <table className="w-full text-left border-collapse">
               <thead className="bg-white sticky top-0 z-10 text-xs uppercase text-slate-500 font-bold tracking-wider shadow-sm">
                  <tr>
                     <th className="p-5 border-b border-slate-100 pl-6">Nhân viên</th>
                     <th className="p-5 border-b border-slate-100">Thời gian</th>
                     <th className="p-5 border-b border-slate-100 text-right">Đầu ca</th>
                     <th className="p-5 border-b border-slate-100 text-right">Doanh thu (TM)</th>
                     <th className="p-5 border-b border-slate-100 text-right bg-slate-50/50">Lý thuyết</th>
                     <th className="p-5 border-b border-slate-100 text-right bg-slate-50/50">Thực tế thu</th>
                     <th className="p-5 border-b border-slate-100 text-center pr-6">Trạng thái</th>
                  </tr>
               </thead>
               <tbody className="divide-y divide-slate-100">
                  {shifts.slice().reverse().map(shift => {
                      const expected = shift.expectedCash || 0;
                      const actual = shift.endCash || 0;
                      const diff = actual - expected;
                      const isClosed = shift.status === 'CLOSED';

                      return (
                          <tr key={shift.id} className="hover:bg-white transition-colors bg-slate-50/30">
                              <td className="p-5 pl-6">
                                  <div className="flex items-center gap-3">
                                      <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center text-slate-500 font-bold border-2 border-white shadow-sm">
                                          {shift.userName.charAt(0)}
                                      </div>
                                      <div>
                                        <div className="font-bold text-slate-800">{shift.userName}</div>
                                        <div className="text-xs text-slate-400 font-mono">#{shift.userId}</div>
                                      </div>
                                  </div>
                              </td>
                              <td className="p-5">
                                  <div className="flex flex-col gap-1 text-sm">
                                      <div className="flex items-center gap-2 text-slate-600">
                                          <Calendar className="w-3 h-3" /> {new Date(shift.startTime).toLocaleDateString()}
                                      </div>
                                      <div className="flex items-center gap-2 text-slate-500 text-xs">
                                          <Clock className="w-3 h-3" /> 
                                          {new Date(shift.startTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} 
                                          <ArrowRight className="w-3 h-3 mx-0.5" /> 
                                          {shift.endTime ? new Date(shift.endTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '...'}
                                      </div>
                                  </div>
                              </td>
                              <td className="p-5 text-right font-mono text-slate-600 font-medium">{shift.startCash.toLocaleString()}</td>
                              <td className="p-5 text-right font-mono text-green-600 font-medium">+{shift.cashSales.toLocaleString()}</td>
                              
                              <td className="p-5 text-right font-mono font-bold text-slate-700 bg-slate-50/50 border-l border-slate-100">
                                  {isClosed ? expected.toLocaleString() : <span className="text-slate-300">---</span>}
                              </td>
                              <td className="p-5 text-right font-mono font-bold text-slate-900 bg-slate-50/50">
                                  {isClosed ? actual.toLocaleString() : <span className="text-slate-300">---</span>}
                              </td>
                              
                              <td className="p-5 text-center pr-6">
                                  {!isClosed ? (
                                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold text-blue-600 bg-blue-50 border border-blue-100">
                                          <Clock className="w-3 h-3" /> Đang hoạt động
                                      </span>
                                  ) : diff === 0 ? (
                                      <div className="flex flex-col items-center">
                                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold text-green-600 bg-green-50 border border-green-100">
                                              <CheckCircle className="w-3 h-3" /> Khớp tiền
                                          </span>
                                      </div>
                                  ) : (
                                      <div className="flex flex-col items-end gap-1">
                                          <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${diff > 0 ? 'text-blue-600 bg-blue-50 border-blue-100' : 'text-red-600 bg-red-50 border-red-100'}`}>
                                              <AlertTriangle className="w-3 h-3" /> 
                                              {diff > 0 ? 'Dư tiền' : 'Thiếu tiền'}
                                          </span>
                                          <span className={`text-xs font-bold ${diff > 0 ? 'text-blue-600' : 'text-red-600'}`}>
                                              {diff > 0 ? '+' : ''}{diff.toLocaleString()}
                                          </span>
                                      </div>
                                  )}
                              </td>
                          </tr>
                      );
                  })}
                  {shifts.length === 0 && (
                      <tr>
                          <td colSpan={7} className="p-16 text-center">
                              <div className="flex flex-col items-center justify-center text-slate-400">
                                  <Shield className="w-12 h-12 mb-3 opacity-20" />
                                  <p className="font-medium">Chưa có dữ liệu ca làm việc</p>
                                  <p className="text-sm mt-1">Các ca làm việc của nhân viên sẽ hiển thị tại đây</p>
                              </div>
                          </td>
                      </tr>
                  )}
               </tbody>
            </table>
         </div>
      </div>
    </div>
  );
};
