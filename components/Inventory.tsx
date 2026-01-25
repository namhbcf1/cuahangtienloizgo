
import React, { useState, useMemo } from 'react';
import { Product } from '../types';
import { Plus, Save, X, Package, Tag, DollarSign, Layers, Search, Filter, ArrowRight } from 'lucide-react';

interface InventoryProps {
  products: Product[];
  onAddProduct: (p: Product) => void;
  onUpdateStock: (id: string, qty: number) => void;
}

export const Inventory: React.FC<InventoryProps> = ({ products, onAddProduct, onUpdateStock }) => {
  const [showAddModal, setShowAddModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState<string | null>(null);

  // Filter & Search State
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');

  // New Product Form State
  const [newProd, setNewProd] = useState<Partial<Product>>({
    name: '', price: 0, category: 'Chung', stock: 0
  });

  // Import Stock State
  const [importQty, setImportQty] = useState<number>(0);

  // Computed Values
  const categories = useMemo(() => {
    const cats = new Set(products.map(p => p.category));
    return ['All', ...Array.from(cats)];
  }, [products]);

  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      const matchesSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesCategory = selectedCategory === 'All' || p.category === selectedCategory;
      return matchesSearch && matchesCategory;
    });
  }, [products, searchTerm, selectedCategory]);

  const handleCreateProduct = async () => {
    if (!newProd.name || !newProd.price) return alert("Vui lòng điền tên và giá");

    const p: Product = {
      id: newProd.id || Math.random().toString(36).substr(2, 9),
      name: newProd.name!,
      price: Number(newProd.price),
      costPrice: Number(newProd.costPrice) || 0,
      category: newProd.category || 'Chung',
      stock: newProd.stock || 0,
      unit: newProd.unit || 'Cái',
      image: `https://picsum.photos/200?random=${Math.random()}`
    };

    onAddProduct(p);
    setShowAddModal(false);
    setNewProd({ name: '', price: 0, category: 'Chung', stock: 0 });
  };

  const handleImportStock = () => {
    if (!showImportModal) return;
    const p = products.find(prod => prod.id === showImportModal);
    if (!p) return;

    if (importQty === 0) return; // Prevent 0 import

    onUpdateStock(p.id, Number(importQty));
    setShowImportModal(null);
    setImportQty(0);
  };

  return (
    <div className="h-full flex flex-col bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      {/* Header */}
      <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-white">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 tracking-tight">Quản lý Kho hàng</h2>
          <p className="text-slate-500 text-sm mt-1">Quản lý sản phẩm và số lượng tồn kho</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="bg-primary-600 hover:bg-primary-700 text-white px-5 py-2.5 rounded-xl shadow-lg shadow-primary-600/20 flex items-center gap-2 text-sm font-semibold transition-all active:scale-95"
        >
          <Plus className="w-5 h-5" />
          Thêm Sản Phẩm
        </button>
      </div>

      {/* Toolbar: Search & Filter */}
      <div className="px-6 py-4 bg-white border-b border-slate-100 flex flex-col md:flex-row gap-4 items-center">
        {/* Search Input */}
        <div className="relative w-full md:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
          <input
            type="text"
            placeholder="Tìm kiếm sản phẩm..."
            className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 transition-all text-sm"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        {/* Category Filter */}
        <div className="flex-1 w-full overflow-x-auto pb-1 md:pb-0 scrollbar-hide flex items-center gap-2">
          <Filter className="w-4 h-4 text-slate-400 shrink-0" />
          <div className="flex gap-2">
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all border ${selectedCategory === cat
                  ? 'bg-slate-800 text-white border-slate-800 shadow-md shadow-slate-800/20'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  }`}
              >
                {cat === 'All' ? 'Tất cả' : cat}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto bg-slate-50/50">
        <table className="w-full text-left border-collapse">
          <thead className="bg-white sticky top-0 z-10 text-xs uppercase text-slate-500 font-bold tracking-wider shadow-sm">
            <tr>
              <th className="p-5 border-b border-slate-100">Mã hàng</th>
              <th className="p-5 border-b border-slate-100">Sản phẩm</th>
              <th className="p-5 border-b border-slate-100">Danh mục</th>
              <th className="p-5 border-b border-slate-100 text-right">Giá vốn</th>
              <th className="p-5 border-b border-slate-100 text-right">Giá bán</th>
              <th className="p-5 border-b border-slate-100 text-center">Tồn kho</th>
              <th className="p-5 border-b border-slate-100 text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {filteredProducts.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-10 text-center text-slate-400">
                  Không tìm thấy sản phẩm nào phù hợp
                </td>
              </tr>
            ) : (
              filteredProducts.map(p => {
                return (
                  <tr key={p.id} className="hover:bg-slate-50 transition-colors group">
                    <td className="p-5 font-mono text-sm text-slate-500 font-semibold">
                      {p.id}
                    </td>
                    <td className="p-5">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-lg bg-slate-100 overflow-hidden border border-slate-200">
                          <img src={p.image} alt="" className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300" />
                        </div>
                        <div>
                          <div className="font-semibold text-slate-800 text-sm">{p.name}</div>
                        </div>
                      </div>
                    </td>
                    <td className="p-5">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-100 text-xs font-medium text-slate-600 border border-slate-200">
                        <Tag className="w-3 h-3" />
                        {p.category}
                      </span>
                    </td>
                    <td className="p-5 text-right text-slate-500">{p.costPrice?.toLocaleString()} ₫</td>
                    <td className="p-5 text-right font-medium text-slate-700">{p.price.toLocaleString()} ₫</td>
                    <td className="p-5 text-center">
                      <div className="flex flex-col items-center">
                        <span className={`inline-block min-w-[3rem] px-2 py-1 rounded-full text-xs font-bold ${p.stock <= 0 ? 'bg-red-100 text-red-600 border border-red-200' : p.stock < 5 ? 'bg-orange-50 text-orange-600 border border-orange-100' : 'bg-green-50 text-green-600 border border-green-100'}`}>
                          {p.stock}
                        </span>
                        <span className="text-[10px] text-slate-400 mt-1">{p.unit}</span>
                      </div>
                    </td>
                    <td className="p-5 text-right">
                      <button
                        onClick={() => setShowImportModal(p.id)}
                        className="text-primary-600 bg-primary-50 hover:bg-primary-100 border border-primary-200 text-xs font-semibold px-4 py-2 rounded-lg transition-all active:scale-95"
                      >
                        + Nhập hàng
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Add Product Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-900/40 z-50 flex items-center justify-center backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
            <div className="px-6 py-5 border-b border-slate-100 flex justify-between items-center bg-white">
              <div>
                <h3 className="font-bold text-xl text-slate-800">Thêm sản phẩm mới</h3>
                <p className="text-slate-500 text-sm">Nhập thông tin sản phẩm vào kho</p>
              </div>
              <button onClick={() => setShowAddModal(false)} className="p-2 hover:bg-slate-100 rounded-full transition-colors"><X className="w-5 h-5 text-slate-400 hover:text-red-500" /></button>
            </div>

            <div className="p-6 space-y-5 overflow-y-auto">
              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                  <Tag className="w-4 h-4 text-slate-400" /> Mã hàng hóa
                </label>
                <input
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all outline-none placeholder:text-slate-400 font-mono"
                  placeholder="Ví dụ: IP15PM..."
                  value={newProd.id || ''}
                  onChange={e => setNewProd({ ...newProd, id: e.target.value })}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                  <Package className="w-4 h-4 text-slate-400" /> Tên sản phẩm
                </label>
                <input
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all outline-none placeholder:text-slate-400 font-medium"
                  placeholder="Ví dụ: iPhone 15 Pro..."
                  value={newProd.name}
                  onChange={e => setNewProd({ ...newProd, name: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-5">
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                    <Layers className="w-4 h-4 text-slate-400" /> Danh mục
                  </label>
                  <input
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all outline-none placeholder:text-slate-400"
                    placeholder="Điện thoại..."
                    value={newProd.category}
                    onChange={e => setNewProd({ ...newProd, category: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                    <DollarSign className="w-4 h-4 text-slate-400" /> Giá bán
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      className="w-full pl-4 pr-12 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all outline-none font-semibold text-slate-800"
                      placeholder="0"
                      value={newProd.price || ''}
                      onChange={e => setNewProd({ ...newProd, price: Number(e.target.value) })}
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-bold">đ</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-5">
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                    <DollarSign className="w-4 h-4 text-slate-400" /> Giá vốn
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      className="w-full pl-4 pr-12 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all outline-none font-semibold text-slate-800"
                      placeholder="0"
                      value={newProd.costPrice || ''}
                      onChange={e => setNewProd({ ...newProd, costPrice: Number(e.target.value) })}
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-bold">đ</span>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                    <Tag className="w-4 h-4 text-slate-400" /> Đơn vị tính
                  </label>
                  <input
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all outline-none"
                    placeholder="Cái, Hộp, Kg..."
                    value={newProd.unit || ''}
                    onChange={e => setNewProd({ ...newProd, unit: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-slate-700">Tồn kho ban đầu <span className="text-slate-400 font-normal">(Tùy chọn)</span></label>
                <input
                  type="number"
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all outline-none"
                  placeholder="0"
                  value={newProd.stock || ''}
                  onChange={e => setNewProd({ ...newProd, stock: Number(e.target.value) })}
                />
              </div>
            </div>

            <div className="p-6 border-t border-slate-100 bg-slate-50 flex gap-3">
              <button
                onClick={() => setShowAddModal(false)}
                className="flex-1 py-3 bg-white text-slate-700 border border-slate-200 rounded-xl font-semibold hover:bg-slate-50 hover:border-slate-300 transition-all"
              >
                Hủy bỏ
              </button>
              <button
                onClick={handleCreateProduct}
                className="flex-1 py-3 bg-slate-900 text-white rounded-xl font-semibold hover:bg-slate-800 shadow-lg shadow-slate-900/20 active:scale-95 transition-all flex items-center justify-center gap-2"
              >
                <Save className="w-4 h-4" /> Lưu Sản Phẩm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import Stock Modal (Redesigned) */}
      {showImportModal && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4 backdrop-blur-md animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl w-full max-w-sm shadow-2xl animate-in zoom-in-95 duration-200 overflow-hidden flex flex-col">
            <div className="p-6 border-b border-slate-100 bg-gradient-to-b from-white to-slate-50/50 text-center relative">
              <button
                onClick={() => setShowImportModal(null)}
                className="absolute right-4 top-4 p-2 bg-white rounded-full text-slate-400 hover:text-slate-600 shadow-sm border border-slate-100 transition-all"
              >
                <X className="w-4 h-4" />
              </button>
              <div className="w-14 h-14 bg-green-100 text-green-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-sm border border-green-200">
                <Plus className="w-7 h-7" />
              </div>
              <h3 className="font-bold text-xl text-slate-800">Nhập Kho Hàng</h3>
              <p className="text-sm text-slate-500 mt-1 max-w-[220px] mx-auto truncate font-medium">
                {products.find(p => p.id === showImportModal)?.name}
              </p>
            </div>

            <div className="p-8 space-y-6">
              <div className="flex flex-col items-center">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Số lượng thêm</label>

                <div className="flex items-center gap-4 w-full">
                  <button
                    onClick={() => setImportQty(Math.max(0, importQty - 1))}
                    className="w-14 h-14 rounded-2xl border-2 border-slate-100 text-slate-400 hover:border-slate-300 hover:text-slate-600 hover:bg-slate-50 transition-all flex items-center justify-center active:scale-95"
                  >
                    <X className="w-6 h-6 rotate-45" />
                  </button>

                  <div className="flex-1 h-20 bg-slate-50 rounded-2xl border-2 border-slate-100 flex items-center justify-center relative overflow-hidden group focus-within:border-primary-500 focus-within:ring-4 focus-within:ring-primary-500/10 transition-all">
                    <input
                      type="number"
                      className="w-full h-full bg-transparent text-center text-4xl font-bold text-slate-800 outline-none z-10"
                      value={importQty}
                      onChange={e => setImportQty(Number(e.target.value))}
                      placeholder="0"
                      autoFocus
                    />
                  </div>

                  <button
                    onClick={() => setImportQty(importQty + 1)}
                    className="w-14 h-14 rounded-2xl bg-slate-900 text-white shadow-lg shadow-slate-900/20 hover:bg-slate-800 transition-all flex items-center justify-center active:scale-95"
                  >
                    <Plus className="w-6 h-6" />
                  </button>
                </div>
              </div>

              {/* Quick Add Buttons */}
              <div className="grid grid-cols-3 gap-3">
                {[5, 10, 50].map(val => (
                  <button
                    key={val}
                    onClick={() => setImportQty(importQty + val)}
                    className="py-2 rounded-xl border border-slate-200 text-slate-600 font-semibold text-sm hover:bg-slate-50 hover:border-slate-300 transition-all active:scale-95"
                  >
                    +{val}
                  </button>
                ))}
              </div>
            </div>

            <div className="p-6 border-t border-slate-100 bg-slate-50">
              <button
                onClick={handleImportStock}
                disabled={importQty <= 0}
                className="w-full py-4 bg-green-600 text-white rounded-xl font-bold shadow-xl shadow-green-600/20 hover:bg-green-700 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-lg"
              >
                <span>Xác nhận nhập</span>
                <ArrowRight className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
