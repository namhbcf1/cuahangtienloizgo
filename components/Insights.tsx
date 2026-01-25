import React, { useEffect, useState } from 'react';
import { Transaction, Product } from '../types';
import { generateBusinessInsights } from '../services/geminiService';
import { Sparkles, RefreshCw } from 'lucide-react';

interface InsightsProps {
  transactions: Transaction[];
  products: Product[];
}

export const Insights: React.FC<InsightsProps> = ({ transactions, products }) => {
  const [insight, setInsight] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchInsights = async () => {
    setLoading(true);
    const result = await generateBusinessInsights(transactions, products);
    setInsight(result);
    setLastUpdated(new Date());
    setLoading(false);
  };

  useEffect(() => {
    // Fetch initial insights if we have data
    if (transactions.length > 0 && !insight) {
        fetchInsights();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="h-full flex flex-col gap-6">
        <div className="bg-gradient-to-r from-indigo-600 to-purple-600 rounded-2xl p-6 text-white shadow-lg">
            <div className="flex justify-between items-start">
                <div>
                    <h2 className="text-2xl font-bold flex items-center gap-2 mb-2">
                        <Sparkles className="w-6 h-6 text-yellow-300" />
                        AI Business Assistant
                    </h2>
                    <p className="text-indigo-100 max-w-xl">
                        Sử dụng Google Gemini để phân tích dữ liệu bán hàng và tồn kho của bạn, đưa ra các gợi ý kinh doanh thông minh.
                    </p>
                </div>
                <button 
                    onClick={fetchInsights} 
                    disabled={loading}
                    className="bg-white/20 hover:bg-white/30 backdrop-blur-sm p-3 rounded-xl transition-all disabled:opacity-50"
                >
                    <RefreshCw className={`w-6 h-6 ${loading ? 'animate-spin' : ''}`} />
                </button>
            </div>
        </div>

        <div className="flex-1 bg-white rounded-2xl shadow-sm border border-slate-200 p-8 overflow-y-auto">
            {loading ? (
                <div className="h-full flex flex-col items-center justify-center space-y-4">
                    <div className="w-12 h-12 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
                    <p className="text-slate-500 font-medium animate-pulse">Đang phân tích dữ liệu...</p>
                </div>
            ) : !insight ? (
                <div className="text-center text-slate-400 mt-20">
                    <p>Chưa có dữ liệu phân tích. Hãy thực hiện vài giao dịch để AI có thể làm việc.</p>
                </div>
            ) : (
                <div className="prose prose-indigo max-w-none">
                    <div className="flex items-center justify-between border-b pb-4 mb-6">
                         <h3 className="text-xl font-bold text-slate-800 m-0">Báo cáo chi tiết</h3>
                         <span className="text-xs text-slate-500">Cập nhật: {lastUpdated?.toLocaleTimeString()}</span>
                    </div>
                    <div dangerouslySetInnerHTML={{ __html: insight }} />
                </div>
            )}
        </div>
    </div>
  );
};
