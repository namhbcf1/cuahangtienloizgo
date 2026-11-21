
import React, { useState, useMemo, useEffect } from 'react';
import { Search, Plus, Minus, Trash2, ShoppingCart, CheckCircle, TrendingUp, X, AlertTriangle, RefreshCw, Pencil, RotateCcw, Check } from 'lucide-react';
import { Product, CartItem, Transaction } from '../types';
import { ReceiptModal } from './ReceiptModal';
import { matchesKeyword, normalizeForSearch } from '../services/search';
import { showSale, markSelfSale } from '../services/notify/bridge';

/**
 * Thông tin một lần thanh toán. `id` do POS sinh ra và được dùng luôn cho
 * hoá đơn in ra, để mã trên giấy luôn khớp mã trong DB.
 */
export interface CheckoutPayload {
  id: string;
  items: CartItem[];
  total: number;
  paymentMethod: 'CASH' | 'CARD' | 'TRANSFER';
  receivedAmount?: number;
  changeAmount?: number;
}

interface POSProps {
  products: Product[];
  transactions: Transaction[];
  currentUser: { name: string; role: string } | null;
  /** Trả Promise: chỉ resolve khi server đã lưu xong giao dịch. */
  onCheckout: (payload: CheckoutPayload) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Giỏ hàng lưu tạm xuống localStorage
//
// Chỉ là bản nháp của thu ngân đang gõ, KHÔNG phải dữ liệu nghiệp vụ: đơn chỉ
// thành sự thật khi POST /transactions trả 201. Vì vậy đọc hỏng thì bỏ qua
// (trả null) chứ không làm app chết.
// ---------------------------------------------------------------------------
const CART_STORAGE_KEY = 'smartpos_carts';

interface SavedCarts {
  orders: { id: number; items: CartItem[] }[];
  activeOrderId: number;
}

function readSavedCarts(): SavedCarts | null {
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedCarts;
    if (!Array.isArray(parsed?.orders) || parsed.orders.length === 0) return null;
    // Lọc dòng hỏng để một bản ghi lỗi không làm trắng cả giỏ.
    const orders = parsed.orders
      .filter(o => o && typeof o.id === 'number' && Array.isArray(o.items))
      .map(o => ({
        id: o.id,
        items: o.items.filter(
          i => i && typeof i.productId === 'string' && Number.isFinite(Number(i.price)) && Number(i.quantity) > 0,
        ),
      }));
    if (orders.length === 0) return null;
    const activeOrderId = orders.some(o => o.id === parsed.activeOrderId)
      ? parsed.activeOrderId
      : orders[0].id;
    return { orders, activeOrderId };
  } catch {
    return null;
  }
}

function writeSavedCarts(orders: { id: number; items: CartItem[] }[], activeOrderId: number) {
  try {
    // Giỏ trống hoàn toàn thì xoá hẳn khoá, tránh để lại rác vô nghĩa.
    if (orders.every(o => o.items.length === 0) && orders.length === 1) {
      localStorage.removeItem(CART_STORAGE_KEY);
      return;
    }
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify({ orders, activeOrderId }));
  } catch {
    // Hết dung lượng / chế độ riêng tư: bỏ qua, giỏ vẫn chạy trong RAM.
  }
}

export const POS: React.FC<POSProps> = ({ products, transactions, currentUser, onCheckout }) => {
  // --- Multi-Order State ---
  //
  // Giỏ được lưu xuống localStorage: trước đây giỏ chỉ nằm trong RAM nên
  // reload / bị hệ điều hành kill là mất sạch đơn đang gõ dở. Đọc một lần
  // lúc khởi tạo (lazy initializer) để không ghi đè bằng giỏ rỗng.
  const [orders, setOrders] = useState<{ id: number; items: CartItem[] }[]>(() => {
    const saved = readSavedCarts();
    return saved?.orders?.length ? saved.orders : [{ id: 1, items: [] }];
  });
  const [activeOrderId, setActiveOrderId] = useState<number>(() => {
    const saved = readSavedCarts();
    return saved?.activeOrderId ?? 1;
  });

  const activeOrder = orders.find(o => o.id === activeOrderId) || orders[0];
  const cart = activeOrder.items;

  // Ghi lại mỗi khi giỏ đổi. Đây là tiến trình của thu ngân, không phải dữ
  // liệu nghiệp vụ — mất cũng không ảnh hưởng sổ sách, nhưng giữ được thì
  // đỡ gõ lại cả đơn.
  useEffect(() => {
    writeSavedCarts(orders, activeOrderId);
  }, [orders, activeOrderId]);

  // --- Search & Filter State ---
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');

  // Receipt Modal && Payment Flow State
  const [lastTransaction, setLastTransaction] = useState<Transaction | null>(null);
  // Trên điện thoại giỏ hàng là bottom-sheet, mặc định đóng để lưới sản phẩm
  // chiếm trọn màn hình.
  const [cartOpen, setCartOpen] = useState(false);
  // Đang gửi giao dịch lên server: khoá nút để tránh bấm 2 lần tạo 2 đơn.
  const [submitting, setSubmitting] = useState(false);
  // Lỗi thanh toán (thiếu tiền, mất mạng, server từ chối).
  const [payError, setPayError] = useState('');
  const [receivedAmount, setReceivedAmount] = useState<number>(0);
  // Dòng hàng đang sửa giá (productId) + giá đang gõ. Tách khỏi cart để gõ
  // dở không làm tổng tiền nhảy theo từng ký tự.
  const [editingPriceId, setEditingPriceId] = useState<string | null>(null);
  const [priceDraft, setPriceDraft] = useState('');

  // Calculate Sales Volume per Product
  const productSales = useMemo(() => {
    const sales: Record<string, number> = {};
    transactions.forEach(t => {
      t.items.forEach(item => {
        sales[item.productId] = (sales[item.productId] || 0) + item.quantity;
      });
    });
    return sales;
  }, [transactions]);

  // Computed Values
  const categories = useMemo(() => {
    const cats = new Set(products.map(p => p.category));
    return ['All', ...Array.from(cats)];
  }, [products]);

  const filteredProducts = useMemo(() => {
    return products
      .filter(p => {
        // Tìm theo tên, mã hàng, mã vạch phụ, hoặc tên danh mục.
        // matchesKeyword bỏ dấu nên "my tron" khớp "Mỳ trộn".
        const matchesSearch =
          matchesKeyword(p.name, searchTerm) ||
          matchesKeyword(p.id, searchTerm) ||
          matchesKeyword(p.category, searchTerm) ||
          (p.barcodes?.some(bc => matchesKeyword(bc, searchTerm)) ?? false);
        const matchesCategory = selectedCategory === 'All' || p.category === selectedCategory;
        return matchesSearch && matchesCategory;
      })
      .sort((a, b) => {
        const salesA = productSales[a.id] || 0;
        const salesB = productSales[b.id] || 0;
        if (salesB !== salesA) return salesB - salesA;
        return a.name.localeCompare(b.name);
      });
    // Bỏ .slice(0, 18): trước đây khoá cứng 18 ô nên 837 sản phẩm không bao giờ
    // hiển thị hết. Giờ trả toàn bộ kết quả, lưới tự cuộn.
  }, [products, searchTerm, selectedCategory, productSales]);

  const cartTotal = useMemo(() => {
    return cart.reduce((acc, item) => acc + (item.price * item.quantity), 0);
  }, [cart]);

  /** Tổng tiền nếu bán đúng giá niêm yết — để hiện phần chênh lệch khi sửa giá. */
  const cartOriginalTotal = useMemo(() => {
    return cart.reduce((acc, item) => acc + ((item.originalPrice ?? item.price) * item.quantity), 0);
  }, [cart]);

  const hasPriceEdit = cartOriginalTotal !== cartTotal;

  // --- Multi-Order Handlers ---
  const handleAddTab = () => {
    if (orders.length >= 10) return;
    const newId = Math.max(...orders.map(o => o.id)) + 1;
    setOrders(prev => [...prev, { id: newId, items: [] }]);
    setActiveOrderId(newId);
  };

  const handleCloseTab = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    if (orders.length === 1) {
      setOrders([{ id: 1, items: [] }]);
      return;
    }
    const newOrders = orders.filter(o => o.id !== id);
    setOrders(newOrders);
    if (activeOrderId === id) {
      setActiveOrderId(newOrders[newOrders.length - 1].id);
    }
  };

  const updateActiveCart = (newItems: CartItem[]) => {
    setOrders(prev => prev.map(o => o.id === activeOrderId ? { ...o, items: newItems } : o));
  };

  // --- Cart Handlers ---
  const handleAddToCart = (product: Product) => {
    const existing = cart.find(item => item.productId === product.id);

    if (existing) {
      updateActiveCart(cart.map(item => item.productId === product.id
        ? { ...item, quantity: item.quantity + 1 }
        : item
      ));
    } else {
      updateActiveCart([...cart, {
        productId: product.id,
        name: product.name,
        price: product.price,
        originalPrice: product.price,
        quantity: 1
      }]);
    }
  };

  const removeFromCart = (productId: string) => {
    updateActiveCart(cart.filter(item => item.productId !== productId));
    if (editingPriceId === productId) setEditingPriceId(null);
  };

  const updateQuantity = (productId: string, delta: number) => {
    updateActiveCart(cart.map(item => {
      if (item.productId === productId) {
        const newQty = item.quantity + delta;
        if (newQty <= 0) return item;
        return { ...item, quantity: newQty };
      }
      return item;
    }));
  };

  /**
   * Đặt thẳng số lượng (gõ tay), thay vì bấm +/− hàng chục lần.
   * Số ≤ 0 thì bỏ qua — muốn bỏ món thì dùng nút thùng rác.
   */
  const setQuantity = (productId: string, qty: number) => {
    if (!Number.isFinite(qty)) return;
    const n = Math.floor(qty);
    if (n <= 0) return;
    if (n > 9999) return;
    updateActiveCart(cart.map(item => (item.productId === productId ? { ...item, quantity: n } : item)));
  };

  // --- Sửa giá ngay trong giỏ ---

  /** Mở ô sửa giá của một dòng; nạp sẵn giá đang bán. */
  const beginPriceEdit = (item: CartItem) => {
    setEditingPriceId(item.productId);
    setPriceDraft(String(item.price));
    setPayError('');
  };

  /**
   * Áp giá mới cho dòng hàng.
   *
   * `price` là giá bán thực tế của lần này — KHÔNG ghi ngược vào kho. Muốn đổi
   * giá niêm yết thì sửa ở màn Kho. Giá 0 bị chặn vì bán 0đ là mất tiền thật;
   * muốn tặng hàng thì dùng nút "Tặng" (đặt 0đ có chủ đích).
   *
   * Gõ kèm dấu % thì hiểu là phần trăm so với GIÁ GỐC: "30%" = +30%,
   * "-10%" = giảm 10%. Nhờ vậy thu ngân gõ nhanh "30%" thay vì tự tính.
   */
  const applyPrice = (productId: string) => {
    const raw = priceDraft.trim();
    const item = cart.find(c => c.productId === productId);
    if (!item) return;

    const base = item.originalPrice ?? item.price;
    let value: number;

    if (raw.includes('%')) {
      // Bỏ HẾT dấu % (người dùng có thể gõ "30%%" hoặc " 30 % ") và đổi
      // dấu phẩy thập phân kiểu Việt Nam thành dấu chấm.
      const pct = Number(raw.replace(/%/g, '').replace(/\s/g, '').replace(',', '.'));
      if (!Number.isFinite(pct)) {
        setPayError('Phần trăm không hợp lệ');
        return;
      }
      // Làm tròn 100đ cho giá đẹp (25.000 +30% -> 32.500đ).
      value = Math.round((base * (1 + pct / 100)) / 100) * 100;
      if (value < 0) value = 0;
    } else {
      value = Math.round(Number(raw));
    }

    if (!Number.isFinite(value) || value < 0) {
      setPayError('Giá không hợp lệ');
      return;
    }
    if (value === 0 && !window.confirm('Bán món này với giá 0đ (tặng khách)?')) {
      return;
    }

    updateActiveCart(cart.map(c => {
      if (c.productId !== productId) return c;
      return {
        ...c,
        price: value,
        originalPrice: c.originalPrice ?? c.price,
      };
    }));
    // Tổng đã đổi -> số tiền khách đưa nhập trước đó không còn đúng.
    setReceivedAmount(0);
    setEditingPriceId(null);
    setPriceDraft('');
    setPayError('');
  };

  /**
   * Đặt giá theo phần trăm so với giá gốc, tính ngay (không qua ô nhập).
   * Dùng cho các nút nhanh +10% / +20% / +30% / -10%…
   */
  const applyPricePercent = (productId: string, pct: number) => {
    const item = cart.find(c => c.productId === productId);
    if (!item) return;

    const base = item.originalPrice ?? item.price;
    const value = Math.max(0, Math.round((base * (1 + pct / 100)) / 100) * 100);

    updateActiveCart(cart.map(c => {
      if (c.productId !== productId) return c;
      return { ...c, price: value, originalPrice: c.originalPrice ?? c.price };
    }));
    setReceivedAmount(0);
    setEditingPriceId(null);
    setPriceDraft('');
    setPayError('');
  };

  /** Trả dòng hàng về giá niêm yết trong kho. */
  const resetPrice = (productId: string) => {
    updateActiveCart(cart.map(item => {
      if (item.productId !== productId) return item;
      return { ...item, price: item.originalPrice ?? item.price };
    }));
    setReceivedAmount(0);
    if (editingPriceId === productId) setEditingPriceId(null);
  };

  const handleCheckout = async () => {
    if (cart.length === 0 || submitting) return;

    const total = cartTotal;
    // Khách đưa thiếu thì KHÔNG cho thanh toán. Trước đây chỉ đổi màu chữ
    // nhưng vẫn bán, gây thất tiền thật mỗi đơn.
    const finalReceived = receivedAmount > 0 ? receivedAmount : total;
    if (finalReceived < total) {
      setPayError(`Khách còn thiếu ${(total - finalReceived).toLocaleString()}đ`);
      return;
    }

    const finalChange = Math.max(0, finalReceived - total);
    // Sinh ID đúng một lần, dùng cho cả bản ghi DB và hoá đơn in ra.
    const transactionId = Date.now().toString();

    const items = cart.map(c => ({
      productId: c.productId,
      name: c.name,
      price: c.price,
      quantity: c.quantity
    }));

    setPayError('');
    setSubmitting(true);

    // Báo TRƯỚC cho service nền: đơn này do máy này bán, đừng báo "Đơn hàng
    // mới" nữa. Phải đặt trước lệnh POST vì server broadcast qua WebSocket
    // nhanh hơn cả lúc trang web nhận được response.
    markSelfSale(transactionId);

    try {
      // Chỉ hiện hoá đơn và xoá giỏ SAU KHI server xác nhận đã lưu.
      await onCheckout({
        id: transactionId,
        items,
        total,
        paymentMethod: 'CASH',
        receivedAmount: finalReceived,
        changeAmount: finalChange
      });

      setLastTransaction({
        id: transactionId,
        date: new Date().toISOString(),
        total,
        paymentMethod: 'CASH',
        items,
        cashierName: currentUser?.name || 'POS User',
        receivedAmount: finalReceived,
        changeAmount: finalChange
      });

      // Thông báo hệ thống để thu ngân biết đơn đã lưu, kể cả khi đang ở tab khác.
      // Kèm mã giao dịch để service nền không báo thêm "Đơn hàng mới" cho đơn này.
      const itemCount = items.reduce((a, b) => a + b.quantity, 0);
      showSale(
        'Thanh toán thành công',
        `${total.toLocaleString('vi-VN')}đ · ${itemCount} món${finalChange > 0 ? ` · thừa ${finalChange.toLocaleString('vi-VN')}đ` : ''}`,
        transactionId
      );

      updateActiveCart([]);
      setReceivedAmount(0);
      setCartOpen(false);
    } catch (err) {
      // Giữ nguyên giỏ hàng để thu ngân thử lại, không mất đơn.
      setPayError(err instanceof Error ? err.message : 'Không lưu được giao dịch');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDenomClick = (amount: number) => {
    setReceivedAmount(prev => prev + amount);
    setPayError('');
  };

  const handleNewOrder = () => {
    setLastTransaction(null);
  };

  // --- Helper: Generate Color from String ---
  const getProductColor = (name: string) => {
    const colors = [
      'bg-red-100 text-red-600', 'bg-orange-100 text-orange-600', 'bg-amber-100 text-amber-600',
      'bg-green-100 text-green-600', 'bg-emerald-100 text-emerald-600', 'bg-teal-100 text-teal-600',
      'bg-cyan-100 text-cyan-600', 'bg-sky-100 text-sky-600', 'bg-blue-100 text-blue-600',
      'bg-indigo-100 text-indigo-600', 'bg-violet-100 text-violet-600', 'bg-purple-100 text-purple-600',
      'bg-fuchsia-100 text-fuchsia-600', 'bg-pink-100 text-pink-600', 'bg-rose-100 text-rose-600'
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  };

  const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  };

  // --- Search Handler (Scan support) ---
  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;

    const lowerTerm = searchTerm.toLowerCase().trim();
    if (!lowerTerm) return;

    // Ưu tiên mã hàng chính xác
    const exactIdMatch = products.find(p => p.id.toLowerCase() === lowerTerm);
    if (exactIdMatch) {
      handleAddToCart(exactIdMatch);
      setSearchTerm('');
      return;
    }

    // Sau đó tới mã vạch phụ (máy quét trả về barcode)
    const exactBarcodeMatch = products.find(p =>
      p.barcodes?.some(bc => bc.toLowerCase() === lowerTerm)
    );
    if (exactBarcodeMatch) {
      handleAddToCart(exactBarcodeMatch);
      setSearchTerm('');
      return;
    }

    // Cuối cùng là kết quả đầu tiên của tìm kiếm mờ
    if (filteredProducts.length > 0) {
      handleAddToCart(filteredProducts[0]);
      setSearchTerm('');
    }
  };

  return (
    <div className="flex flex-col md:flex-row h-full gap-2 md:gap-3 relative overflow-hidden">
      {/* Left: Product Grid */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden rounded-2xl bg-white shadow-sm border border-slate-200">
        {/* Search & Filter Header */}
        <div className="p-2 md:p-3 border-b border-slate-100 space-y-2 shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
            <input
              type="text"
              placeholder="Tìm tên hoặc mã sản phẩm... (gõ không dấu cũng được, Enter để chọn)"
              className="w-full h-11 pl-9 pr-4 bg-slate-50 border border-slate-200 rounded-xl text-base md:text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 transition-all"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={handleSearchKeyDown}
            />
          </div>
          <div className="flex gap-1.5 overflow-x-auto scrollbar-hide -mx-2 px-2 md:mx-0 md:px-0">
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-2 min-h-[44px] rounded-full text-sm font-medium whitespace-nowrap transition-colors ${selectedCategory === cat
                  ? 'bg-slate-800 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Product Grid: 3 cột trên điện thoại (thẻ ~107-124px, chạm được),
            6 cột trên máy tính. Cuộn dọc thay vì khoá cứng 18 ô. */}
        <div className="flex-1 min-h-0 p-2 md:p-3 grid grid-cols-3 min-[440px]:grid-cols-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 auto-rows-max content-start gap-2 md:gap-2.5 bg-gradient-to-br from-slate-50 to-slate-100/50 overflow-y-auto overscroll-contain">
          {filteredProducts.map(product => {
            const salesCount = productSales[product.id] || 0;
            const isBestSeller = salesCount > 0 && salesCount === Math.max(...(Object.values(productSales) as number[]));
            const stockColor = product.stock <= 0
              ? 'text-red-500 bg-red-50'
              : product.stock < 5
                ? 'text-orange-600 bg-orange-50'
                : 'text-emerald-600 bg-emerald-50';

            return (
              <div
                key={product.id}
                onClick={() => handleAddToCart(product)}
                className="bg-white rounded-xl border border-slate-200/80 shadow-sm md:hover:shadow-lg md:hover:border-primary-300 md:hover:scale-[1.02] active:scale-[0.97] transition-all duration-200 cursor-pointer group flex flex-col overflow-hidden min-h-[152px]"
              >
                <div className="relative w-full h-[72px] md:h-[84px] flex items-center justify-center p-1.5 md:p-2 shrink-0">
                  {isBestSeller && (
                    <div className="absolute top-1 left-1 z-10 bg-gradient-to-r from-orange-500 to-red-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full flex items-center gap-0.5 shadow">
                      <TrendingUp className="w-2.5 h-2.5" /> HOT
                    </div>
                  )}
                  <div className={`w-full h-full rounded-lg flex items-center justify-center overflow-hidden ${product.image ? '' : getProductColor(product.name)}`}>
                    {product.image ? (
                      <img src={product.image} alt={product.name} className="w-full h-full object-contain rounded-lg" />
                    ) : (
                      <span className="text-2xl font-black opacity-90">{getInitials(product.name)}</span>
                    )}
                  </div>
                </div>
                <div className="px-1.5 pb-1.5 md:px-2 md:pb-2 space-y-0.5">
                  <h3 className="font-semibold text-slate-700 text-[13px] md:text-sm leading-tight line-clamp-2 min-h-[2.1em] group-hover:text-primary-600 transition-colors">{product.name}</h3>
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-bold text-primary-600 text-[13px] md:text-sm">{product.price.toLocaleString()}đ</span>
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${stockColor}`}>{product.stock}</span>
                  </div>
                  {salesCount > 0 && (
                    <div className="text-[10px] text-slate-400 font-medium">Đã bán: {salesCount}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Giỏ hàng: bottom-sheet trên điện thoại, cột phải trên máy tính */}
      <div
        className={`bg-white shadow-xl border border-slate-200 flex flex-col overflow-hidden z-20
          ${cartOpen
            ? 'fixed inset-x-0 bottom-[calc(56px+env(safe-area-inset-bottom))] top-[8dvh] rounded-t-2xl md:static md:inset-auto md:bottom-auto md:rounded-2xl md:h-full md:w-[40%] md:shrink-0'
            : 'hidden md:flex md:h-full md:w-[40%] md:shrink-0 md:rounded-2xl'
          }`}
      >
        {/* Tay nắm + nút đóng — chỉ trên điện thoại */}
        <div className="md:hidden shrink-0 flex items-center justify-between px-4 pt-2 pb-1 border-b border-slate-100">
          <span className="text-sm font-bold text-slate-700">
            Giỏ hàng · {cart.reduce((a, b) => a + b.quantity, 0)} món
          </span>
          <button
            onClick={() => setCartOpen(false)}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center -mr-2 text-slate-400 active:text-slate-600"
            aria-label="Đóng giỏ hàng"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Order Tabs */}
        <div className="flex overflow-x-auto bg-slate-100 border-b border-slate-200 scrollbar-hide shrink-0">
          {orders.map((order, index) => (
            <button
              key={order.id}
              onClick={() => setActiveOrderId(order.id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium whitespace-nowrap border-r border-slate-200 min-w-[80px] group transition-colors ${activeOrderId === order.id
                ? 'bg-white text-primary-700 border-b-2 border-b-primary-600'
                : 'bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700'
                }`}
            >
              <span>Đơn {index + 1}</span>
              {order.items.length > 0 && (
                <span className={`text-[9px] px-1 py-0.5 rounded-full ${activeOrderId === order.id ? 'bg-primary-100' : 'bg-slate-300 text-white'}`}>
                  {order.items.reduce((a, b) => a + b.quantity, 0)}
                </span>
              )}
              <div
                onClick={(e) => handleCloseTab(e, order.id)}
                className={`p-0.5 rounded hover:bg-red-100 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity ${orders.length === 1 ? 'hidden' : ''}`}
              >
                <Trash2 className="w-2.5 h-2.5" />
              </div>
            </button>
          ))}
          {orders.length < 10 && (
            <button
              onClick={handleAddTab}
              className="px-2 py-1.5 text-slate-400 hover:text-primary-600 hover:bg-slate-200 transition-colors flex items-center justify-center"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="px-3 py-2 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between shrink-0">
            <h2 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
              <ShoppingCart className="w-4 h-4 text-primary-600" />
              Đơn Hàng
            </h2>
            <span className="bg-primary-100 text-primary-700 text-[10px] px-1.5 py-0.5 rounded-full font-bold">
              {cart.reduce((a, b) => a + b.quantity, 0)} món
            </span>
          </div>

          {/* Cart Items */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
            {cart.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-400 opacity-60 py-4">
                <ShoppingCart className="w-8 h-8 mb-1" />
                <p className="text-xs">Chưa có sản phẩm</p>
              </div>
            ) : (
              cart.map(item => {
                const edited = item.originalPrice !== undefined && item.price !== item.originalPrice;
                const isEditing = editingPriceId === item.productId;

                return (
                  <div key={item.productId} className={`rounded-lg p-2 ${edited ? 'bg-amber-50 border border-amber-200' : 'bg-slate-50'}`}>
                    <div className="flex gap-2 items-center">
                      <div className="flex-1 min-w-0">
                        <h4 className="font-semibold text-slate-800 text-xs line-clamp-1">{item.name}</h4>
                        {isEditing ? (
                          <div className="mt-1 space-y-1.5">
                            <div className="flex items-center gap-1">
                              <input
                                type="text"
                                inputMode="text"
                                autoFocus
                                onFocus={e => e.target.select()}
                                value={priceDraft}
                                onChange={e => setPriceDraft(e.target.value)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') applyPrice(item.productId);
                                  if (e.key === 'Escape') setEditingPriceId(null);
                                }}
                                className="w-24 px-2 py-1 border border-primary-400 rounded-md text-xs font-bold text-slate-800 bg-white outline-none focus:ring-2 focus:ring-primary-300"
                                aria-label={`Giá mới cho ${item.name}`}
                                placeholder="15000 / 30%"
                              />
                              <span className="text-[10px] font-bold text-slate-400">đ</span>
                              <button
                                onClick={() => applyPrice(item.productId)}
                                className="p-1.5 rounded-md bg-primary-600 text-white active:scale-95"
                                aria-label="Lưu giá mới"
                              >
                                <Check className="w-3 h-3" />
                              </button>
                              <button
                                onClick={() => setEditingPriceId(null)}
                                className="p-1.5 rounded-md bg-slate-200 text-slate-600 active:scale-95"
                                aria-label="Huỷ sửa giá"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                            {/* Nút nhanh: cộng/trừ theo % so với giá gốc */}
                            <div className="flex items-center gap-1 flex-wrap">
                              {[10, 20, 30, 50].map(pct => (
                                <button
                                  key={pct}
                                  onClick={() => applyPricePercent(item.productId, pct)}
                                  className="px-1.5 py-0.5 rounded border border-emerald-200 bg-emerald-50 text-emerald-700 text-[10px] font-bold active:scale-95"
                                  aria-label={`Cộng ${pct} phần trăm`}
                                >
                                  +{pct}%
                                </button>
                              ))}
                              {[-10, -20, -30].map(pct => (
                                <button
                                  key={pct}
                                  onClick={() => applyPricePercent(item.productId, pct)}
                                  className="px-1.5 py-0.5 rounded border border-rose-200 bg-rose-50 text-rose-700 text-[10px] font-bold active:scale-95"
                                  aria-label={`Giảm ${Math.abs(pct)} phần trăm`}
                                >
                                  {pct}%
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => beginPriceEdit(item)}
                              className="flex items-center gap-1 text-primary-600 font-bold text-[11px] underline decoration-dotted underline-offset-2 active:scale-95"
                              title="Bấm để sửa giá bán của lần này"
                            >
                              {item.price.toLocaleString()} đ
                              <Pencil className="w-2.5 h-2.5" />
                            </button>
                            {edited && (
                              <>
                                <span className="text-[9px] font-bold text-amber-700 bg-amber-200/70 px-1 rounded">
                                  đã sửa
                                </span>
                                <button
                                  onClick={() => resetPrice(item.productId)}
                                  className="text-[9px] font-semibold text-slate-500 hover:text-slate-700 flex items-center gap-0.5"
                                  title={`Trả về giá gốc ${(item.originalPrice ?? item.price).toLocaleString()}đ`}
                                >
                                  <RotateCcw className="w-2.5 h-2.5" />
                                  {(item.originalPrice ?? item.price).toLocaleString()}
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <div className="flex items-center border border-slate-200 rounded overflow-hidden h-6 bg-white">
                          <button
                            onClick={() => updateQuantity(item.productId, -1)}
                            aria-label="Giảm số lượng"
                            className="px-1.5 hover:bg-slate-100 h-full flex items-center justify-center"
                          >
                            <Minus className="w-2.5 h-2.5" />
                          </button>
                          <input
                            type="number"
                            inputMode="numeric"
                            min={1}
                            value={item.quantity}
                            data-role="cart-quantity"
                            aria-label={`Số lượng ${item.name}`}
                            onFocus={e => e.currentTarget.select()}
                            onChange={e => {
                              const n = parseInt(e.target.value, 10);
                              if (Number.isFinite(n) && n > 0) setQuantity(item.productId, n);
                            }}
                            onBlur={e => {
                              // Gõ 0 / để trống rồi thoát: trả về 1 cho khỏi kẹt.
                              const n = parseInt(e.target.value, 10);
                              if (!Number.isFinite(n) || n <= 0) setQuantity(item.productId, 1);
                            }}
                            className="w-9 text-center text-[10px] font-bold bg-transparent outline-none border-x border-slate-200 focus:bg-blue-50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          />
                          <button
                            onClick={() => updateQuantity(item.productId, 1)}
                            aria-label="Tăng số lượng"
                            className="px-1.5 hover:bg-slate-100 h-full flex items-center justify-center"
                          >
                            <Plus className="w-2.5 h-2.5" />
                          </button>
                        </div>
                        <button onClick={() => removeFromCart(item.productId)} className="p-1 text-slate-300 hover:text-red-500 transition-colors"><Trash2 className="w-3 h-3" /></button>
                      </div>
                    </div>
                    {item.quantity > 1 && (
                      <div className="text-right text-[10px] font-semibold text-slate-400 mt-0.5">
                        = {(item.price * item.quantity).toLocaleString()} đ
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Quick Payment Section */}
          <div className="shrink-0 border-t border-slate-200 bg-slate-50/50 p-3 space-y-2">
            <div className="flex justify-between items-center">
              <label className="text-[9px] font-black text-slate-500 uppercase tracking-wider">Tiền khách đưa</label>
              {receivedAmount > 0 && (
                <div className={`text-xs font-black px-2 py-0.5 rounded border ${receivedAmount >= cartTotal ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-red-100 text-red-700 border-red-200'}`}>
                  {receivedAmount >= cartTotal ? 'Thừa: ' + (receivedAmount - cartTotal).toLocaleString() : 'Thiếu: ' + (cartTotal - receivedAmount).toLocaleString()} đ
                </div>
              )}
            </div>
            <div className="relative">
              <input
                type="number"
                data-role="received-amount"
                aria-label="Tiền khách đưa"
                className="w-full pl-3 pr-8 py-2 bg-white border border-slate-200 rounded-lg text-sm font-bold text-slate-800 focus:border-primary-500 outline-none transition-all"
                placeholder="Nhập số tiền..."
                value={receivedAmount || ''}
                onChange={(e) => setReceivedAmount(Number(e.target.value))}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">đ</span>
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              {[1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000].map(d => (
                <button
                  key={d}
                  onClick={() => handleDenomClick(d)}
                  className="py-1.5 bg-white border border-slate-200 rounded-lg text-[10px] font-bold text-slate-700 hover:bg-slate-50 hover:border-slate-400 active:scale-95 transition-all"
                >
                  +{d >= 1000 ? (d / 1000) + 'k' : d}
                </button>
              ))}
            </div>
            <button
              onClick={() => setReceivedAmount(cartTotal)}
              className="w-full py-1.5 bg-primary-600 text-white rounded-lg text-[10px] font-bold hover:bg-primary-700 transition-all"
            >
              Khách đưa đủ: {cartTotal.toLocaleString()} đ
            </button>
          </div>
        </div>

        <div className="shrink-0 p-3 bg-white border-t border-slate-200 space-y-2 pb-[calc(12px+env(safe-area-inset-bottom))] md:pb-3">
          <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            <span>Tạm tính</span>
            <span className={hasPriceEdit ? 'line-through' : ''}>{cartOriginalTotal.toLocaleString()} đ</span>
          </div>
          {hasPriceEdit && (
            <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider">
              <span className="text-amber-600">Đã sửa giá</span>
              <span className={cartTotal >= cartOriginalTotal ? 'text-emerald-600' : 'text-red-600'}>
                {cartTotal >= cartOriginalTotal ? '+' : '−'}
                {Math.abs(cartTotal - cartOriginalTotal).toLocaleString()} đ
              </span>
            </div>
          )}
          <div className="flex justify-between items-center text-slate-900">
            <span className="text-sm font-black italic">TỔNG CỘNG</span>
            <span className="text-2xl font-black text-primary-600 tracking-tight">{cartTotal.toLocaleString()} đ</span>
          </div>

          {/* Lỗi thanh toán: thiếu tiền / mất mạng / server từ chối */}
          {payError && (
            <div className="rounded-xl border border-red-200 bg-red-50 text-red-700 px-3 py-2 text-xs font-semibold flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{payError}</span>
            </div>
          )}

          <button
            onClick={handleCheckout}
            disabled={cart.length === 0 || submitting || (receivedAmount > 0 && receivedAmount < cartTotal)}
            className="w-full min-h-[52px] py-3 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold text-base md:text-sm shadow-lg transition-all flex items-center justify-center gap-2 active:scale-[0.98] disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
          >
            {submitting ? (
              <>
                <RefreshCw className="w-5 h-5 animate-spin" />
                ĐANG LƯU...
              </>
            ) : (
              <>
                <CheckCircle className="w-5 h-5" />
                XÁC NHẬN THANH TOÁN
              </>
            )}
          </button>
        </div>
      </div>

      {/* Thanh giỏ dính đáy — nằm TRÊN thanh tab điều hướng (z-30 < z-40) */}
      {!cartOpen && (
        <div className="md:hidden fixed inset-x-0 bottom-[calc(56px+env(safe-area-inset-bottom))] z-30 bg-white border-t border-slate-200 shadow-[0_-4px_16px_rgba(0,0,0,0.08)]">
          <button
            onClick={() => setCartOpen(true)}
            disabled={cart.length === 0}
            className="w-full min-h-[60px] px-4 flex items-center justify-between gap-3 active:bg-slate-50 disabled:opacity-60"
          >
            <div className="flex items-center gap-2.5">
              <div className="relative">
                <ShoppingCart className="w-6 h-6 text-primary-600" />
                {cart.length > 0 && (
                  <span className="absolute -top-1.5 -right-2 bg-primary-600 text-white text-[10px] font-bold min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center">
                    {cart.reduce((a, b) => a + b.quantity, 0)}
                  </span>
                )}
              </div>
              <div className="text-left leading-tight">
                <p className="text-[11px] text-slate-500 font-medium">
                  {cart.length === 0 ? 'Chưa có sản phẩm' : `${cart.length} mặt hàng`}
                </p>
                <p className="text-lg font-black text-slate-900">{cartTotal.toLocaleString()} đ</p>
              </div>
            </div>
            <span className={`px-5 py-3 rounded-xl font-bold text-sm ${cart.length === 0 ? 'bg-slate-200 text-slate-400' : 'bg-primary-600 text-white'
              }`}>
              {cart.length === 0 ? 'Giỏ trống' : 'Xem giỏ'}
            </span>
          </button>
        </div>
      )}

      {/* Receipt Modal */}
      {lastTransaction && (
        <ReceiptModal transaction={lastTransaction} onClose={handleNewOrder} />
      )}
    </div>
  );
};
