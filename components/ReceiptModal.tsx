import React from 'react';
import { Transaction } from '../types';
import { CheckCircle, Printer, Eye, X } from 'lucide-react';

interface ReceiptModalProps {
    transaction: Transaction;
    onClose: () => void;
}

export const ReceiptModal: React.FC<ReceiptModalProps> = ({ transaction, onClose }) => {
    const handlePrint = () => {
        window.print();
    };

    const handlePreview = () => {
        // Open print preview
        window.print();
    };

    return (
        <>
            {/* Modal Overlay */}
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-3 md:p-4 animate-in fade-in duration-200">
                {/* max-h + flex-col: hoá đơn dài sẽ cuộn bên trong, không đẩy
                    nút bấm ra ngoài màn hình như trước. */}
                <div className="relative bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[92dvh]">

                    {/* Close Button */}
                    <button
                        onClick={onClose}
                        className="absolute top-3 right-3 z-20 p-2 bg-white/80 backdrop-blur rounded-full shadow-sm hover:bg-slate-100 transition-colors"
                        aria-label="Đóng"
                    >
                        <X className="w-5 h-5 text-slate-400 hover:text-slate-600" />
                    </button>

                    {/* Success Header */}
                    <div className="shrink-0 px-4 py-4 md:p-6 bg-gradient-to-br from-green-50 to-emerald-50 border-b border-green-100 text-center">
                        <div className="w-12 h-12 md:w-16 md:h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-2 md:mb-3">
                            <CheckCircle className="w-7 h-7 md:w-10 md:h-10 text-green-600" />
                        </div>
                        <h2 className="text-lg md:text-2xl font-bold text-slate-800">Thanh toán thành công!</h2>
                        <p className="text-slate-600 text-xs md:text-sm mt-0.5 md:mt-1">Giao dịch đã được lưu vào lịch sử</p>
                    </div>

                    {/* Receipt Details — cuộn được */}
                    <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-3 md:p-6 space-y-3 md:space-y-4" id="receipt-content">
                        {/* Store Header (visible only when printing) */}
                        <div className="hidden print:block text-center border-b-2 border-slate-800 pb-4 mb-4">
                            <h1 className="text-2xl font-bold text-slate-900">CỬA HÀNG TIỆN LỢI ZGO</h1>
                            <p className="text-sm text-slate-600 mt-1">Hóa đơn bán hàng</p>
                        </div>

                        <div className="flex justify-between items-center text-lg">
                            <span className="text-slate-600">Tổng tiền</span>
                            <span className="font-bold text-primary-600 text-2xl">{transaction.total.toLocaleString()} đ</span>
                        </div>

                        <div className="flex justify-between items-center">
                            <span className="text-slate-600">Số lượng món</span>
                            <span className="font-semibold text-slate-800">{transaction.items.reduce((sum, item) => sum + item.quantity, 0)}</span>
                        </div>

                        <div className="flex justify-between items-center">
                            <span className="text-slate-600">Phương thức</span>
                            <span className="font-semibold text-slate-800">
                                {transaction.paymentMethod === 'CASH' ? 'Tiền mặt' : transaction.paymentMethod === 'CARD' ? 'Thẻ' : 'Chuyển khoản'}
                            </span>
                        </div>

                        <div className="flex justify-between items-center text-sm">
                            <span className="text-slate-500">Mã giao dịch</span>
                            <span className="font-mono text-slate-600">#{transaction.id}</span>
                        </div>

                        {transaction.receivedAmount !== undefined && transaction.paymentMethod === 'CASH' && (
                            <>
                                <div className="flex justify-between items-center text-sm">
                                    <span className="text-slate-500">Khách đưa</span>
                                    <span className="text-slate-600 font-bold">{transaction.receivedAmount.toLocaleString()} đ</span>
                                </div>
                                <div className="flex justify-between items-center text-sm">
                                    <span className="text-slate-500">Tiền thừa</span>
                                    <span className="text-slate-600 font-bold">{(transaction.changeAmount || 0).toLocaleString()} đ</span>
                                </div>
                            </>
                        )}

                        <div className="flex justify-between items-center text-sm">
                            <span className="text-slate-500">Thời gian</span>
                            <span className="text-slate-600">{new Date(transaction.date).toLocaleString('vi-VN')}</span>
                        </div>

                        {transaction.cashierName && (
                            <div className="flex justify-between items-center text-sm">
                                <span className="text-slate-500">Thu ngân</span>
                                <span className="text-slate-600">{transaction.cashierName}</span>
                            </div>
                        )}

                        {/* Items List */}
                        <div className="border-t border-slate-200 pt-4 mt-4">
                            <h3 className="font-semibold text-slate-700 mb-3">Chi tiết đơn hàng</h3>
                            <div className="space-y-2">
                                {transaction.items.map((item, idx) => (
                                    <div key={idx} className="flex justify-between text-sm">
                                        <span className="text-slate-600">
                                            {item.quantity}x {item.name}
                                        </span>
                                        <span className="font-semibold text-slate-800">{(item.price * item.quantity).toLocaleString()} đ</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Print Footer */}
                        <div className="hidden print:block text-center text-sm text-slate-500 mt-6 pt-4 border-t border-slate-200">
                            <p>Cảm ơn quý khách!</p>
                            <p className="text-xs mt-1">Hẹn gặp lại</p>
                        </div>
                    </div>

                    {/* Action Buttons — cố định đáy, không bị đẩy ra ngoài */}
                    <div className="shrink-0 px-4 py-3 md:p-6 bg-slate-50 border-t border-slate-100 flex gap-2 md:gap-3">
                        <button
                            onClick={handlePreview}
                            className="flex-1 min-h-[48px] py-3 px-2 md:px-4 rounded-xl border-2 border-slate-300 text-slate-700 font-semibold hover:bg-white transition-all flex items-center justify-center gap-1.5 md:gap-2 text-sm md:text-base whitespace-nowrap"
                        >
                            <Eye className="w-4 h-4 shrink-0" />
                            Xem trước
                        </button>
                        <button
                            onClick={handlePrint}
                            className="flex-1 min-h-[48px] py-3 px-2 md:px-4 rounded-xl bg-primary-600 text-white font-semibold hover:bg-primary-700 transition-all flex items-center justify-center gap-1.5 md:gap-2 shadow-lg shadow-primary-600/20 text-sm md:text-base whitespace-nowrap"
                        >
                            <Printer className="w-4 h-4 shrink-0" />
                            In hóa đơn
                        </button>
                    </div>

                    <div className="shrink-0 px-4 py-3 md:p-4 border-t border-slate-100 pb-[calc(12px+env(safe-area-inset-bottom))] md:pb-4">
                        <button
                            onClick={onClose}
                            className="w-full min-h-[48px] py-3 rounded-xl bg-slate-800 text-white font-bold hover:bg-slate-900 transition-all flex items-center justify-center gap-2"
                        >
                            Đơn hàng mới
                        </button>
                    </div>
                </div>
            </div>

            {/* Print Styles */}
            <style>{`
        @media print {
          @page {
            margin: 0;
            size: 80mm 210mm;
          }
          
          /* Hide everything except receipt */
          body * {
            visibility: hidden;
          }
          
          #receipt-content, #receipt-content * {
            visibility: visible;
          }
          
          #receipt-content {
            position: absolute;
            left: 0;
            top: 0;
            width: 72.1mm;
            padding: 2mm;
            margin: 0;
            background-color: #fff !important;
          }
          
          /* Enhanced print quality */
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          
          /* ULTRA BOLD AND PURE BLACK FOR EVERYTHING */
          #receipt-content,
          #receipt-content *,
          #receipt-content span,
          #receipt-content p,
          #receipt-content div,
          #receipt-content h1,
          #receipt-content h2,
          #receipt-content h3,
          #receipt-content strong {
            color: #000 !important;
            font-weight: 900 !important;
            -webkit-text-stroke: 0.2px #000; /* Slightly thicker for Times serif */
            font-family: "Times New Roman", Times, serif !important;
          }
          
          #receipt-content {
            font-size: 10pt !important;
            line-height: 1.1 !important;
          }
          
          #receipt-content h1 {
            font-size: 14pt !important;
            margin-bottom: 2mm !important;
            text-transform: uppercase;
          }
          
          #receipt-content .text-2xl, 
          #receipt-content .text-primary-600 {
            font-size: 15pt !important;
            color: #000 !important;
          }
          
          #receipt-content .text-slate-600,
          #receipt-content .text-slate-500,
          #receipt-content .text-slate-400 {
            color: #000 !important; /* Force all grey to black */
          }
          
          #receipt-content .space-y-4 > * + * {
            margin-top: 2mm !important;
          }
          
          #receipt-content .pt-4,
          #receipt-content .mt-4,
          #receipt-content .mt-6 {
            margin-top: 3mm !important;
            padding-top: 2mm !important;
          }

          /* Thick black lines */
          #receipt-content .border-b-2,
          #receipt-content .border-t,
          #receipt-content .border-slate-200 {
            border-color: #000 !important;
            border-bottom-width: 2px !important;
            border-top-width: 2px !important;
            border-style: solid !important;
          }

          /* Remove all backgrounds */
          #receipt-content * {
            background: transparent !important;
          }
          
          button {
            display: none !important;
          }
        }
      `}</style>
        </>
    );
};
