
import React, { useState, useMemo } from 'react';
import { Transaction } from '../types';
import { FileText, Calendar, DollarSign, User, Filter, X } from 'lucide-react';

interface TransactionsProps {
  transactions: Transaction[];
}

export const Transactions: React.FC<TransactionsProps> = ({ transactions }) => {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Filter transactions based on date range
  const filteredTransactions = useMemo(() => {
    return transactions.filter(t => {
      const txDate = new Date(t.date);
      
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        if (txDate < start) return false;
      }
      
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        if (txDate > end) return false;
      }
      
      return true;
    });
  }, [transactions, startDate, endDate]);

  // Calculate summary for the filtered view
  const summary = useMemo(() => {
    return filteredTransactions.reduce((acc, t) => ({
      total: acc.total + t.total,
      count: acc.count + 1
    }), { total: 0, count: 0 });
  }, [filteredTransactions]);

  const handleClearFilter = () => {
    setStartDate('');
    setEndDate('');
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 h-full flex flex-col">
      {/* Header & Filters */}
      <div className="p-5 border-b border-slate-100 bg-slate-50/50 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <FileText className="w-5 h-5 text-slate-500" />
            Lịch sử giao dịch
          </h2>
          
          <div className="flex items-center gap-2 bg-white p-1 rounded-xl border border-slate-200 shadow-sm">
             <div className="flex items-center gap-2 px-2 border-r border-slate-100">
               <Filter className="w-4 h-4 text-slate-400" />
               <span className="text-xs font-bold text-slate-500 uppercase">Lọc</span>
             </div>
             <input 
               type="date" 
               className="text-sm bg-transparent border-none focus:ring-0 text-slate-600 font-medium"
               value={startDate}
               onChange={(e) => setStartDate(e.target.value)}
             />
             <span className="text-slate-300">-</span>
             <input 
               type="date" 
               className="text-sm bg-transparent border-none focus:ring-0 text-slate-600 font-medium"
               value={endDate}
               onChange={(e) => setEndDate(e.target.value)}
             />
             {(startDate || endDate) && (
               <button 
                 onClick={handleClearFilter}
                 className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-red-500 transition-colors"
                 title="Xóa bộ lọc"
               >
                 <X className="w-4 h-4" />
               </button>
             )}
          </div>
        </div>

        {/* Filter Summary Stats */}
        {(startDate || endDate) && (
           <div className="flex gap-4 text-sm">
              <div className="bg-blue-50 text-blue-700 px-3 py-1.5 rounded-lg border border-blue-100 font-medium flex items-center gap-2">
                 <span>Đơn hàng: <b>{summary.count}</b></span>
              </div>
              <div className="bg-green-50 text-green-700 px-3 py-1.5 rounded-lg border border-green-100 font-medium flex items-center gap-2">
                 <span>Doanh thu: <b>{summary.total.toLocaleString()} đ</b></span>
              </div>
           </div>
        )}
      </div>

      {/* List */}
      <div className="flex-1 overflow-auto p-4 space-y-4 bg-slate-50/30">
        {filteredTransactions.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-slate-400">
                <FileText className="w-12 h-12 mb-3 opacity-50" />
                <p>Không tìm thấy giao dịch nào</p>
                {(startDate || endDate) && (
                  <button onClick={handleClearFilter} className="mt-2 text-primary-600 text-sm hover:underline">
                    Xóa bộ lọc ngày
                  </button>
                )}
            </div>
        ) : (
            filteredTransactions.slice().reverse().map(t => (
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
                                        <Calendar className="w-3 h-3" /> {new Date(t.date).toLocaleString()}
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
                            +{t.total.toLocaleString()} đ
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
                                    <span className="font-medium">{(item.price * item.quantity).toLocaleString()}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
            ))
        )}
      </div>
    </div>
  );
};
