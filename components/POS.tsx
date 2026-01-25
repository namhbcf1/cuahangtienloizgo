
import React, { useState, useMemo } from 'react';
import { Search, Plus, Minus, Trash2, CreditCard, Box, ShoppingCart, CheckCircle, RefreshCw, TrendingUp } from 'lucide-react';
import { Product, CartItem, Transaction } from '../types';
import { ReceiptModal } from './ReceiptModal';

interface POSProps {
  products: Product[];
  transactions: Transaction[];
  currentUser: { name: string; role: string } | null;
  onCheckout: (items: CartItem[], total: number, paymentMethod: 'CASH' | 'CARD' | 'TRANSFER', receivedAmount?: number, changeAmount?: number) => void;
}

export const POS: React.FC<POSProps> = ({ products, transactions, currentUser, onCheckout }) => {
  // --- Multi-Order State ---
  const [orders, setOrders] = useState<{ id: number; items: CartItem[] }[]>([{ id: 1, items: [] }]);
  const [activeOrderId, setActiveOrderId] = useState(1);

  const activeOrder = orders.find(o => o.id === activeOrderId) || orders[0];
  const cart = activeOrder.items;

  // --- Search & Filter State ---
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');

  // Receipt Modal && Payment Flow State
  const [lastTransaction, setLastTransaction] = useState<Transaction | null>(null);
  const [receivedAmount, setReceivedAmount] = useState<number>(0);
  const [customReceived, setCustomReceived] = useState<string>('');

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
    // 1. Filter by Search & Category
    const filtered = products.filter(p => {
      const lowerTerm = searchTerm.toLowerCase();
      // Search by Name OR Product Code (ID)
      const matchesSearch = p.name.toLowerCase().includes(lowerTerm) || p.id.toLowerCase().includes(lowerTerm);
      const matchesCategory = selectedCategory === 'All' || p.category === selectedCategory;
      return matchesSearch && matchesCategory;
    });

    // 2. Sort by Sales (Bestsellers first)
    // If sales are equal, sort by Name as tiebreaker
    return filtered.sort((a, b) => {
      const salesA = productSales[a.id] || 0;
      const salesB = productSales[b.id] || 0;

      if (salesB !== salesA) {
        return salesB - salesA; // Descending
      }
      return a.name.localeCompare(b.name);
    }).slice(0, 8);
  }, [products, searchTerm, selectedCategory, productSales]);

  const cartTotal = useMemo(() => {
    return cart.reduce((acc, item) => acc + (item.price * item.quantity), 0);
  }, [cart]);

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
      // Don't close the last tab, just clear it
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
      const newItems = cart.map(item => item.productId === product.id
        ? { ...item, quantity: item.quantity + 1 }
        : item
      );
      updateActiveCart(newItems);
    } else {
      const newItems = [...cart, {
        productId: product.id,
        name: product.name,
        price: product.price,
        quantity: 1
      }];
      updateActiveCart(newItems);
    }
  };

  const removeFromCart = (productId: string) => {
    updateActiveCart(cart.filter(item => item.productId !== productId));
  };

  const updateQuantity = (productId: string, delta: number) => {
    const newItems = cart.map(item => {
      if (item.productId === productId) {
        const newQty = item.quantity + delta;
        if (newQty <= 0) return item;
        return { ...item, quantity: newQty };
      }
      return item;
    });
    updateActiveCart(newItems);
  };

  const handleCheckout = () => {
    if (cart.length === 0) return;

    // 1. Calculate stats for the receipt view
    const total = cartTotal;
    const itemsCount = cart.reduce((a, b) => a + b.quantity, 0);

    // 2. Create transaction object for receipt
    const newTransaction: Transaction = {
      id: Date.now().toString(),
      date: new Date().toISOString(),
      total,
      paymentMethod: 'CASH',
      items: cart.map(c => ({
        productId: c.productId,
        name: c.name,
        price: c.price,
        quantity: c.quantity
      })),
      cashierName: currentUser?.name || 'POS User'
    };

    // 4. Finalize
    const finalReceived = receivedAmount > 0 ? receivedAmount : total;
    const finalChange = Math.max(0, finalReceived - total);

    onCheckout(cart, total, 'CASH', finalReceived, finalChange);

    // 5. Update UI State & Clear Current Tab
    setLastTransaction({
      ...newTransaction,
      paymentMethod: 'CASH',
      receivedAmount: finalReceived,
      changeAmount: finalChange
    });
    updateActiveCart([]); // Clear items in current order
    setReceivedAmount(0);
    setCustomReceived('');
  };

  const denoms = [1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000];

  const handleDenomClick = (amount: number) => {
    setReceivedAmount(prev => prev + amount);
  };

  const handleCustomReceivedChange = (val: string) => {
    setCustomReceived(val);
    if (val === '') {
      // If cleared, maybe we don't want to reset receivedAmount if it came from buttons?
      // But typically entering custom overrides. Let's make it additive or override.
      // Re-thinking: let's keep manual buttons and input separate or combined?
      // Combined is better.
    }
    const num = parseInt(val) || 0;
    setReceivedAmount(num);
  };

  const handleQuickPay = (amount: number) => {
    setReceivedAmount(amount);
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
    if (e.key === 'Enter') {
      const lowerTerm = searchTerm.toLowerCase().trim();
      if (!lowerTerm) return;

      // Prioritize exact ID match
      const exactIdMatch = products.find(p => p.id.toLowerCase() === lowerTerm);
      if (exactIdMatch) {
        handleAddToCart(exactIdMatch);
        setSearchTerm('');
        return;
      }

      // Fallback to first filtered result if available
      if (filteredProducts.length > 0) {
        handleAddToCart(filteredProducts[0]);
        setSearchTerm('');
      }
    }
  };

  return (
    <div className="flex h-full gap-6 relative">
      {/* Left: Product Grid */}
      <div className="flex-1 flex flex-col h-full overflow-hidden rounded-2xl bg-white shadow-sm border border-slate-200">
        {/* Search & Filter Header */}
        <div className="p-4 border-b border-slate-100 space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
            <input
              type="text"
              placeholder="Tìm tên hoặc mã sản phẩm... (Enter để chọn)"
              className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 transition-all"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={handleSearchKeyDown}
            />
          </div>
          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${selectedCategory === cat
                  ? 'bg-slate-800 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Product Grid */}
        <div className="flex-1 overflow-y-auto p-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 bg-slate-50/50">
          {filteredProducts.map(product => {
            const salesCount = productSales[product.id] || 0;
            const isBestSeller = salesCount > 0 && salesCount === Math.max(...(Object.values(productSales) as number[]));
            const stockColor = product.stock <= 0 ? 'text-red-600' : product.stock < 5 ? 'text-orange-500' : 'text-slate-500';

            return (
              <div
                key={product.id}
                onClick={() => handleAddToCart(product)}
                className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-all cursor-pointer group flex flex-col relative"
              >
                {isBestSeller && (
                  <div className="absolute top-2 left-2 z-10 bg-orange-500 text-white text-[10px] font-bold px-2 py-1 rounded-full flex items-center gap-1 shadow-sm">
                    <TrendingUp className="w-3 h-3" /> HOT
                  </div>
                )}
                <div className="absolute top-2 right-2 z-10 bg-slate-100 text-slate-500 text-[10px] font-mono px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                  #{product.id}
                </div>

                <div className="aspect-square bg-slate-100 rounded-lg mb-3 flex items-center justify-center overflow-hidden relative">
                  {product.image ? (
                    <img src={product.image} alt={product.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className={`w-full h-full flex flex-col items-center justify-center ${getProductColor(product.name)}`}>
                      <span className="text-2xl font-black opacity-80">{getInitials(product.name)}</span>
                    </div>
                  )}
                </div>
                <h3 className="font-medium text-slate-800 line-clamp-2 mb-1 group-hover:text-primary-600 transition-colors">{product.name}</h3>
                <div className="mt-auto">
                  <div className="flex items-center justify-between mt-2">
                    <span className="font-bold text-primary-700">{product.price.toLocaleString()} đ</span>
                    <div className="flex flex-col items-end">
                      <span className={`text-xs font-bold ${stockColor}`}>
                        Kho: {product.stock}
                      </span>
                      {salesCount > 0 && (
                        <span className="text-[10px] text-slate-400">Đã bán: {salesCount}</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Right: Cart & Quick Payment */}
      <div className="w-[480px] bg-white rounded-2xl shadow-xl border border-slate-200 flex flex-col h-full overflow-hidden z-20">

        {/* Order Tabs */}
        <div className="flex overflow-x-auto bg-slate-100 border-b border-slate-200 scrollbar-hide">
          {orders.map((order, index) => (
            <button
              key={order.id}
              onClick={() => setActiveOrderId(order.id)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap border-r border-slate-200 min-w-[100px] group transition-colors ${activeOrderId === order.id
                ? 'bg-white text-primary-700 border-b-2 border-b-primary-600 pb-[10px]'
                : 'bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700'
                }`}
            >
              <span>Đơn {index + 1}</span>
              {order.items.length > 0 && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${activeOrderId === order.id ? 'bg-primary-100' : 'bg-slate-300 text-white'}`}>
                  {order.items.reduce((a, b) => a + b.quantity, 0)}
                </span>
              )}
              <div
                onClick={(e) => handleCloseTab(e, order.id)}
                className={`p-0.5 rounded hover:bg-red-100 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity ${orders.length === 1 ? 'hidden' : ''}`}
              >
                <Trash2 className="w-3 h-3" />
              </div>
            </button>
          ))}
          {orders.length < 10 && (
            <button
              onClick={handleAddTab}
              className="px-3 py-2 text-slate-400 hover:text-primary-600 hover:bg-slate-200 transition-colors flex items-center justify-center"
            >
              <Plus className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-primary-600" />
            Đơn Hàng <span className="text-slate-400 font-normal text-sm">#{activeOrderId}</span>
          </h2>
          <span className="bg-primary-100 text-primary-700 text-xs px-2 py-0.5 rounded-full font-bold">{cart.reduce((a, b) => a + b.quantity, 0)} món</span>
        </div>

        <div className="flex-1 overflow-y-auto flex flex-col">
          {/* Cart Items */}
          <div className="p-4 space-y-3 min-h-[150px] max-h-[40%] overflow-y-auto border-b border-slate-50">
            {cart.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-400 opacity-60">
                <ShoppingCart className="w-12 h-12 mb-2" />
                <p className="text-sm">Chưa có sản phẩm</p>
              </div>
            ) : (
              cart.map(item => (
                <div key={item.productId} className="flex gap-3 items-center">
                  <div className="flex-1">
                    <h4 className="font-bold text-slate-800 text-sm line-clamp-1">{item.name}</h4>
                    <p className="text-primary-600 font-black text-xs">{item.price.toLocaleString()} đ</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden h-7">
                      <button onClick={() => updateQuantity(item.productId, -1)} className="px-2 hover:bg-slate-100 h-full flex items-center justify-center"><Minus className="w-3 h-3" /></button>
                      <span className="w-7 text-center text-xs font-bold">{item.quantity}</span>
                      <button onClick={() => updateQuantity(item.productId, 1)} className="px-2 hover:bg-slate-100 h-full flex items-center justify-center"><Plus className="w-3 h-3" /></button>
                    </div>
                    <button onClick={() => removeFromCart(item.productId)} className="p-1.5 text-slate-300 hover:text-red-500 transition-colors"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Quick Payment Section */}
          <div className="flex-1 p-5 bg-slate-50/50 space-y-5">
            <div className="space-y-3">
              <div className="flex justify-between items-end">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Tiền khách đưa</label>
                {receivedAmount > 0 && (
                  <div className={`text-lg font-black px-3 py-1 rounded-lg border shadow-sm ${receivedAmount >= cartTotal ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-red-100 text-red-700 border-red-200'}`}>
                    {receivedAmount >= cartTotal ? 'Thừa: ' + (receivedAmount - cartTotal).toLocaleString() : 'Thiếu: ' + (cartTotal - receivedAmount).toLocaleString()} đ
                  </div>
                )}
              </div>
              <div className="relative">
                <input
                  type="number"
                  className="w-full pl-4 pr-12 py-3 bg-white border-2 border-slate-200 rounded-xl text-xl font-black text-slate-800 focus:border-primary-500 outline-none transition-all shadow-sm"
                  placeholder="Nhập số tiền..."
                  value={receivedAmount || ''}
                  onChange={(e) => setReceivedAmount(Number(e.target.value))}
                />
                <span className="absolute right-5 top-1/2 -translate-y-1/2 font-bold text-slate-400">đ</span>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {[1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000].map(d => (
                <button
                  key={d}
                  onClick={() => handleDenomClick(d)}
                  className="py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-black text-slate-700 hover:bg-slate-50 hover:border-slate-400 active:scale-95 transition-all shadow-sm"
                >
                  +{d >= 1000 ? (d / 1000) + 'k' : d}
                </button>
              ))}
              <button
                onClick={() => setReceivedAmount(cartTotal)}
                className="col-span-3 py-2.5 bg-primary-600 text-white rounded-xl text-xs font-black hover:bg-primary-700 transition-all shadow-md shadow-primary-600/10"
              >
                Khách đưa đủ: {cartTotal.toLocaleString()} đ
              </button>
            </div>
          </div>
        </div>

        <div className="p-6 bg-white border-t border-slate-200 space-y-5 pb-10">
          <div className="space-y-2">
            <div className="flex justify-between text-xs font-bold text-slate-400 uppercase tracking-widest">
              <span>Tạm tính</span>
              <span>{cartTotal.toLocaleString()} đ</span>
            </div>
            <div className="flex justify-between items-center text-slate-900">
              <span className="text-lg font-black italic">TỔNG CỘNG</span>
              <span className="text-3xl font-black text-primary-600 tracking-tight">{cartTotal.toLocaleString()} đ</span>
            </div>
          </div>

          <button
            onClick={handleCheckout}
            disabled={cart.length === 0}
            className="w-full py-5 bg-slate-900 hover:bg-slate-800 text-white rounded-2xl font-black text-xl shadow-xl shadow-slate-900/10 transition-all flex items-center justify-center gap-3 active:scale-[0.98] disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
          >
            <CheckCircle className="w-7 h-7" />
            XÁC NHẬN & IN HÓA ĐƠN
          </button>
        </div>
      </div>

      {/* Receipt Modal */}
      {lastTransaction && (
        <ReceiptModal transaction={lastTransaction} onClose={handleNewOrder} />
      )}
    </div>
  );
};
