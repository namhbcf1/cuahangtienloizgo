
import React, { useState, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import { Plus, Save, X, Package, Tag, DollarSign, Layers, Search, Filter, ArrowRight, FileSpreadsheet, Barcode, CheckCircle, AlertTriangle, Upload, Trash2, RefreshCw, Pencil } from 'lucide-react';
import { Product } from '../types';
import { matchesKeyword } from '../services/search';

interface InventoryProps {
  products: Product[];
  onAddProduct: (p: Product) => void;
  onUpdateStock: (id: string, qty: number) => void;
  /** Trả Promise để form sửa biết khi nào server đã lưu xong. */
  onUpdateProduct: (p: Product) => void | Promise<void>;
  onReloadProducts: () => Promise<void>;
  /** Xoá sản phẩm. `force` để xoá cả sản phẩm đã từng bán. */
  onDeleteProduct: (id: string, force?: boolean) => Promise<{ id: string; deleted: boolean; soldCount: number }>;
}

/** Một dòng đọc được từ file Excel, kèm trạng thái sẽ xử lý khi import. */
interface ImportRow {
  id: string;
  name: string;
  category: string;
  unit: string;
  price: number;
  costPrice: number;
  stock: number;
  barcodes: string[];
  status: 'new' | 'update' | 'skip';
  reason?: string;
}

/**
 * Đọc sheet đầu tiên của file Excel xuất kho.
 * Cột: A=Mã hàng, B=Tên, C=Nhóm, D=ĐVT, H=Giá bán, J=Giá vốn, K=Tồn kho.
 * Cột A có thể chứa nhiều mã cách nhau bởi dấu phẩy: mã đầu là mã chính,
 * phần còn lại là mã vạch phụ.
 */
const readWorkbook = (file: File): Promise<ImportRow[]> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const bytes = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(bytes, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1 });

        const out: ImportRow[] = [];
        for (let i = 1; i < rows.length; i++) {
          const r = rows[i];
          if (!r || !r[0]) continue;

          const codes = String(r[0]).trim().split(',').map(c => c.trim()).filter(Boolean);
          const id = codes[0];
          const barcodes = codes.slice(1);

          out.push({
            id,
            name: r[1] ? String(r[1]).trim() : '',
            category: r[2] ? String(r[2]).trim() : '',
            unit: r[3] ? String(r[3]).trim() : 'cái',
            price: Number(r[7]) || 0,
            costPrice: Number(r[9]) || 0,
            stock: Number(r[10]) || 0,
            barcodes,
            status: 'new',
          });
        }
        resolve(out);
      } catch (err) {
        reject(new Error('Không đọc được file Excel: ' + (err instanceof Error ? err.message : String(err))));
      }
    };

    reader.onerror = () => reject(new Error('Lỗi đọc file'));
    reader.readAsArrayBuffer(file);
  });

export const Inventory: React.FC<InventoryProps> = ({
  products,
  onAddProduct,
  onUpdateStock,
  onUpdateProduct,
  onReloadProducts,
  onDeleteProduct,
}) => {
  // Modal visibility — mỗi modal một state riêng.
  const [showAddModal, setShowAddModal] = useState(false);
  const [showExcelModal, setShowExcelModal] = useState(false);
  const [stockModalId, setStockModalId] = useState<string | null>(null);
  const [barcodeModalId, setBarcodeModalId] = useState<string | null>(null);
  // Sửa sản phẩm: id đang sửa + bản nháp. Tách khỏi `products` để gõ dở
  // không ghi đè dữ liệu thật cho tới khi bấm Lưu.
  const [editProductId, setEditProductId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<Product>>({});
  const [editError, setEditError] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  // Ô thêm mã vạch ngay trong form sửa (không phải mở modal riêng).
  const [editBarcodeInput, setEditBarcodeInput] = useState('');
  // Xoá sản phẩm: sản phẩm đang chờ xác nhận + trạng thái đang xoá.
  const [deleteProductId, setDeleteProductId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  // Filter & Search State
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');

  // New Product Form State
  const [newProd, setNewProd] = useState<Partial<Product>>({
    name: '', price: 0, category: 'Chung', stock: 0, barcodes: []
  });
  const [newBarcode, setNewBarcode] = useState('');

  // Stock import
  const [importQty, setImportQty] = useState<number>(0);

  // Barcode manager
  const [barcodeInput, setBarcodeInput] = useState('');

  // Excel Import State
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importRows, setImportRows] = useState<ImportRow[] | null>(null);
  const [importFileName, setImportFileName] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [importResult, setImportResult] = useState<{ inserted: number; updated: number } | null>(null);

  // Computed Values
  const categories = useMemo(() => {
    const cats = new Set(products.map(p => p.category));
    return ['All', ...Array.from(cats)];
  }, [products]);

  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      // matchesKeyword bỏ dấu nên "my tron" khớp "Mỳ trộn"
      const matchesSearch =
        matchesKeyword(p.name, searchTerm) ||
        matchesKeyword(p.id, searchTerm) ||
        matchesKeyword(p.category, searchTerm) ||
        (p.barcodes?.some(bc => matchesKeyword(bc, searchTerm)) ?? false);
      const matchesCategory = selectedCategory === 'All' || p.category === selectedCategory;
      return matchesSearch && matchesCategory;
    });
  }, [products, searchTerm, selectedCategory]);

  // --- Add product ---
  const handleCreateProduct = () => {
    if (!newProd.name || !newProd.price) return alert("Vui lòng điền tên và giá");

    const id = newProd.id?.trim() || Math.random().toString(36).substr(2, 9);
    if (products.some(p => p.id === id)) return alert("Mã này đã được sử dụng cho sản phẩm khác");

    const p: Product = {
      id,
      name: newProd.name!,
      price: Number(newProd.price),
      costPrice: Number(newProd.costPrice) || 0,
      category: newProd.category || 'Chung',
      stock: newProd.stock || 0,
      unit: newProd.unit || 'Cái',
      image: `https://picsum.photos/200?random=${Math.random()}`,
      barcodes: newProd.barcodes || [],
    };

    onAddProduct(p);
    setShowAddModal(false);
    setNewProd({ name: '', price: 0, category: 'Chung', stock: 0, barcodes: [] });
    setNewBarcode('');
  };

  const handleAddBarcodeToNew = () => {
    const code = newBarcode.trim();
    if (!code) return;
    if (newProd.barcodes?.includes(code)) return alert("Mã này đã có trong danh sách");
    const used = products.some(p => p.id === code || p.barcodes?.includes(code));
    if (used) return alert("Mã này đã được sử dụng cho sản phẩm khác");
    setNewProd({ ...newProd, barcodes: [...(newProd.barcodes || []), code] });
    setNewBarcode('');
  };

  // --- Import stock ---
  const handleImportStock = () => {
    if (!stockModalId) return;
    const p = products.find(prod => prod.id === stockModalId);
    if (!p || importQty === 0) return;
    onUpdateStock(p.id, Number(importQty));
    setStockModalId(null);
    setImportQty(0);
  };

  // --- Barcode management for an existing product ---
  const handleAddBarcode = () => {
    if (!barcodeModalId) return;
    const code = barcodeInput.trim();
    if (!code) return;

    const product = products.find(p => p.id === barcodeModalId);
    if (!product) return;

    if (product.barcodes?.includes(code)) return alert("Mã này đã có trong danh sách");
    const usedByOther = products.some(
      p => p.id !== barcodeModalId && (p.id === code || p.barcodes?.includes(code))
    );
    if (usedByOther) return alert("Mã này đã được sử dụng cho sản phẩm khác");

    onUpdateProduct({ ...product, barcodes: [...(product.barcodes || []), code] });
    setBarcodeInput('');
  };

  const handleRemoveBarcode = (code: string) => {
    if (!barcodeModalId) return;
    const product = products.find(p => p.id === barcodeModalId);
    if (!product) return;
    onUpdateProduct({ ...product, barcodes: (product.barcodes || []).filter(b => b !== code) });
  };

  // --- Sửa sản phẩm ---

  /** Mở form sửa, nạp sẵn dữ liệu hiện tại của sản phẩm. */
  const openEditProduct = (p: Product) => {
    setEditProductId(p.id);
    setEditDraft({
      id: p.id,
      name: p.name,
      price: p.price,
      costPrice: p.costPrice ?? 0,
      category: p.category ?? '',
      unit: p.unit ?? '',
      stock: p.stock,
      image: p.image,
      barcodes: [...(p.barcodes || [])],
    });
    setEditError('');
  };

  const closeEditProduct = () => {
    setEditProductId(null);
    setEditDraft({});
    setEditError('');
    setEditBarcodeInput('');
  };

  /**
   * Thêm một mã vạch/QR vào bản nháp đang sửa.
   * Chặn trùng trong chính sản phẩm này và chặn trùng với sản phẩm khác —
   * hai sản phẩm cùng một mã vạch sẽ khiến quét mã không biết bán món nào.
   */
  const addEditBarcode = () => {
    const code = editBarcodeInput.trim();
    if (!code) return;

    const current = editDraft.barcodes || [];
    if (current.includes(code)) {
      setEditError('Mã này đã có trong danh sách của sản phẩm');
      return;
    }
    if (editProductId && code === editProductId) {
      setEditError('Mã này trùng mã hàng chính');
      return;
    }
    const clash = products.find(
      p => p.id !== editProductId && (p.id === code || p.barcodes?.includes(code)),
    );
    if (clash) {
      setEditError(`Mã "${code}" đã thuộc sản phẩm "${clash.name}" (${clash.id})`);
      return;
    }

    setEditError('');
    setEditDraft({ ...editDraft, barcodes: [...current, code] });
    setEditBarcodeInput('');
  };

  const removeEditBarcode = (code: string) => {
    setEditDraft({ ...editDraft, barcodes: (editDraft.barcodes || []).filter(b => b !== code) });
  };

  /** Sửa nội dung một mã vạch đã có trong bản nháp. */
  const changeEditBarcode = (oldCode: string, newCode: string) => {
    setEditDraft({
      ...editDraft,
      barcodes: (editDraft.barcodes || []).map(b => (b === oldCode ? newCode : b)),
    });
  };

  // --- Xoá sản phẩm ---

  const openDeleteProduct = (p: Product) => {
    setDeleteProductId(p.id);
    setDeleteError('');
  };

  const closeDeleteProduct = () => {
    setDeleteProductId(null);
    setDeleteError('');
  };

  /**
   * Xoá sản phẩm. Lần đầu gọi không `force`: nếu sản phẩm đã từng bán, server
   * trả 409 kèm số lần bán — hiện cảnh báo để người dùng quyết định, thay vì
   * âm thầm xoá mất lịch sử đối soát.
   */
  const handleConfirmDelete = async (force: boolean) => {
    if (!deleteProductId) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await onDeleteProduct(deleteProductId, force);
      closeDeleteProduct();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Không xoá được sản phẩm');
    } finally {
      setDeleting(false);
    }
  };

  /**
   * Lưu thay đổi.
   *
   * Chỉ gửi những trường người dùng thực sự sửa, nhưng vì API PUT ghi đè cả
   * dòng nên vẫn phải gửi đủ bộ. Mã hàng (id) là khoá chính — không cho đổi,
   * vì đổi id sẽ làm mồ côi lịch sử giao dịch cũ.
   */
  const handleSaveEdit = async () => {
    if (!editProductId) return;

    const name = (editDraft.name ?? '').trim();
    if (!name) {
      setEditError('Tên sản phẩm không được để trống');
      return;
    }

    const price = Math.round(Number(editDraft.price));
    if (!Number.isFinite(price) || price < 0) {
      setEditError('Giá bán không hợp lệ');
      return;
    }

    const costPrice = Math.round(Number(editDraft.costPrice) || 0);
    if (costPrice < 0) {
      setEditError('Giá vốn không hợp lệ');
      return;
    }

    const stock = Math.round(Number(editDraft.stock));
    if (!Number.isFinite(stock)) {
      setEditError('Tồn kho không hợp lệ');
      return;
    }

    setSavingEdit(true);
    setEditError('');
    try {
      await onUpdateProduct({
        id: editProductId,
        name,
        price,
        costPrice,
        category: (editDraft.category ?? '').trim() || 'Chung',
        unit: (editDraft.unit ?? '').trim() || 'Cái',
        stock,
        image: editDraft.image,
        barcodes: editDraft.barcodes ?? [],
      });
      closeEditProduct();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Không lưu được sản phẩm');
    } finally {
      setSavingEdit(false);
    }
  };

  // --- Excel import flow ---
  const handleFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.match(/\.xlsx?$/i)) {
      setImportError('Chỉ chấp nhận file .xlsx hoặc .xls');
      return;
    }

    setImportError('');
    setImporting(true);
    setImportFileName(file.name);
    setImportResult(null);

    try {
      const parsed = await readWorkbook(file);

      const existingIds = new Set(products.map(p => p.id));
      const barcodeToId = new Map<string, string>();
      products.forEach(p => (p.barcodes || []).forEach(bc => barcodeToId.set(bc, p.id)));

      const classified: ImportRow[] = parsed.map(row => {
        if (!row.id) return { ...row, status: 'skip', reason: 'Thiếu mã hàng' };
        if (row.price <= 0) return { ...row, status: 'skip', reason: 'Giá bán không hợp lệ' };
        if (existingIds.has(row.id)) return { ...row, status: 'update' };

        const matched = row.barcodes.find(bc => existingIds.has(bc) || barcodeToId.has(bc));
        return matched
          ? { ...row, status: 'update', reason: `Khớp barcode phụ → ID: ${barcodeToId.get(matched) ?? matched}` }
          : { ...row, status: 'new' };
      });

      setImportRows(classified);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  };

  const handleConfirmImport = async () => {
    if (!importRows) return;

    setImporting(true);
    setImportError('');

    try {
      const payload = importRows.filter(r => r.status !== 'skip');
      const res = await fetch('/api/products/bulk-upsert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ products: payload }),
      });
      const data = await res.json() as { error?: string; inserted: number; updated: number };
      if (!res.ok) throw new Error(data?.error || 'Lỗi server');

      setImportResult({ inserted: data.inserted, updated: data.updated });
      await onReloadProducts();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  };

  const resetExcelModal = () => {
    setImportRows(null);
    setImportFileName('');
    setImportError('');
    setImportResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const updateCount = importRows?.filter(r => r.status === 'update').length ?? 0;
  const newCount = importRows?.filter(r => r.status === 'new').length ?? 0;
  const skipCount = importRows?.filter(r => r.status === 'skip').length ?? 0;

  const stockProduct = stockModalId ? products.find(p => p.id === stockModalId) : null;
  const barcodeProduct = barcodeModalId ? products.find(p => p.id === barcodeModalId) : null;

  return (
    <div className="h-full flex flex-col bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      {/* Header — xếp dọc trên điện thoại, ngang trên máy tính */}
      <div className="p-3 md:p-6 border-b border-slate-100 flex flex-col md:flex-row md:justify-between md:items-center gap-3 bg-white shrink-0">
        <div>
          <h2 className="text-lg md:text-2xl font-bold text-slate-800 tracking-tight">Quản lý Kho hàng</h2>
          <p className="text-slate-500 text-xs md:text-sm mt-0.5 md:mt-1">Quản lý sản phẩm và số lượng tồn kho</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowExcelModal(true)}
            className="flex-1 md:flex-none min-h-[44px] bg-green-600 hover:bg-green-700 text-white px-3 md:px-5 py-2.5 rounded-xl shadow-lg shadow-green-600/20 flex items-center justify-center gap-2 text-xs md:text-sm font-semibold transition-all active:scale-95"
          >
            <FileSpreadsheet className="w-4 h-4 md:w-5 md:h-5" />
            Cập nhật Excel
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex-1 md:flex-none min-h-[44px] bg-primary-600 hover:bg-primary-700 text-white px-3 md:px-5 py-2.5 rounded-xl shadow-lg shadow-primary-600/20 flex items-center justify-center gap-2 text-xs md:text-sm font-semibold transition-all active:scale-95"
          >
            <Plus className="w-4 h-4 md:w-5 md:h-5" />
            Thêm Sản Phẩm
          </button>
        </div>
      </div>

      {/* Toolbar: Search & Filter */}
      <div className="px-3 md:px-6 py-3 md:py-4 bg-white border-b border-slate-100 flex flex-col md:flex-row gap-2 md:gap-4 items-stretch md:items-center shrink-0">
        <div className="relative w-full md:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
          <input
            type="text"
            placeholder="Tìm kiếm sản phẩm... (gõ không dấu cũng được)"
            className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 transition-all text-sm"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="flex-1 w-full overflow-x-auto pb-1 md:pb-0 scrollbar-hide flex items-center gap-2">
          <Filter className="w-4 h-4 text-slate-400 shrink-0" />
          <div className="flex gap-2">
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-2 min-h-[44px] rounded-lg text-sm font-medium whitespace-nowrap transition-all border ${selectedCategory === cat
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

      {/* Danh sách sản phẩm — card trên điện thoại, bảng trên máy tính */}
      <div className="flex-1 overflow-auto bg-slate-50/50">

        {/* ===== ĐIỆN THOẠI: card, đọc được, chạm được ===== */}
        <div className="md:hidden p-2 space-y-2">
          {filteredProducts.length === 0 ? (
            <div className="p-10 text-center text-slate-400 text-sm">
              Không tìm thấy sản phẩm nào phù hợp
            </div>
          ) : (
            filteredProducts.map(p => {
              const stockTone = p.stock <= 0
                ? 'bg-red-100 text-red-600 border-red-200'
                : p.stock < 5
                  ? 'bg-orange-50 text-orange-600 border-orange-100'
                  : 'bg-green-50 text-green-600 border-green-100';
              return (
                <div key={p.id} className="bg-white rounded-xl border border-slate-200 p-3 space-y-2">
                  <div className="flex items-start gap-2.5">
                    <div className="w-11 h-11 rounded-lg bg-slate-100 overflow-hidden border border-slate-200 shrink-0">
                      <img src={p.image} alt="" className="w-full h-full object-cover" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-slate-800 text-sm leading-tight line-clamp-2">{p.name}</p>
                      <p className="font-mono text-[11px] text-slate-400 mt-0.5 truncate">{p.id}</p>
                    </div>
                    <span className={`shrink-0 px-2 py-1 rounded-full text-xs font-bold border ${stockTone}`}>
                      {p.stock}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-bold text-primary-600 text-base">{p.price.toLocaleString()} ₫</p>
                      {p.category && (
                        <p className="text-[11px] text-slate-400 truncate flex items-center gap-1 mt-0.5">
                          <Tag className="w-3 h-3 shrink-0" />{p.category}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => setBarcodeModalId(p.id)}
                      className={`shrink-0 inline-flex items-center gap-1 min-h-[40px] px-2.5 py-2 rounded-lg text-xs font-medium border ${p.barcodes && p.barcodes.length > 0
                        ? 'bg-blue-50 text-blue-600 border-blue-200'
                        : 'bg-slate-50 text-slate-400 border-slate-200'
                        }`}
                    >
                      <Barcode className="w-3.5 h-3.5" />
                      {p.barcodes && p.barcodes.length > 0 ? `${p.barcodes.length} mã` : 'Thêm mã'}
                    </button>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => openEditProduct(p)}
                      className="flex-1 min-h-[44px] rounded-lg bg-slate-100 text-slate-700 border border-slate-200 text-sm font-semibold active:scale-[0.98] transition-all flex items-center justify-center gap-1.5"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      Sửa
                    </button>
                    <button
                      onClick={() => setStockModalId(p.id)}
                      className="flex-1 min-h-[44px] rounded-lg bg-primary-50 text-primary-600 border border-primary-200 text-sm font-semibold active:scale-[0.98] transition-all"
                    >
                      + Nhập hàng
                    </button>
                    <button
                      onClick={() => openDeleteProduct(p)}
                      aria-label={`Xoá ${p.name}`}
                      className="shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg bg-red-50 text-red-600 border border-red-200 active:scale-[0.98] transition-all"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* ===== MÁY TÍNH: bảng đầy đủ ===== */}
        <table className="hidden md:table w-full text-left border-collapse">
          <thead className="bg-white sticky top-0 z-10 text-xs uppercase text-slate-500 font-bold tracking-wider shadow-sm">
            <tr>
              <th className="p-4 border-b border-slate-100">Mã hàng</th>
              <th className="p-4 border-b border-slate-100">Sản phẩm</th>
              <th className="p-4 border-b border-slate-100">Mã phụ</th>
              <th className="p-4 border-b border-slate-100">Danh mục</th>
              <th className="p-4 border-b border-slate-100 text-right">Giá bán</th>
              <th className="p-4 border-b border-slate-100 text-center">Tồn kho</th>
              <th className="p-4 border-b border-slate-100 text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {filteredProducts.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-10 text-center text-slate-400">
                  Không tìm thấy sản phẩm nào phù hợp
                </td>
              </tr>
            ) : (
              filteredProducts.map(p => (
                <tr key={p.id} className="hover:bg-slate-50 transition-colors group">
                  <td className="p-4 font-mono text-xs text-slate-500 font-semibold max-w-[120px]">
                    <div className="truncate" title={p.id}>{p.id}</div>
                  </td>
                  <td className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-slate-100 overflow-hidden border border-slate-200 shrink-0">
                        <img src={p.image} alt="" className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300" />
                      </div>
                      <div className="font-semibold text-slate-800 text-sm line-clamp-1">{p.name}</div>
                    </div>
                  </td>
                  <td className="p-4">
                    <div className="flex items-center gap-1">
                      {p.barcodes && p.barcodes.length > 0 ? (
                        <button
                          onClick={() => setBarcodeModalId(p.id)}
                          className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-600 rounded-md text-xs font-medium border border-blue-200 hover:bg-blue-100 transition-all"
                        >
                          <Barcode className="w-3 h-3" />
                          {p.barcodes.length} mã
                        </button>
                      ) : (
                        <button
                          onClick={() => setBarcodeModalId(p.id)}
                          className="inline-flex items-center gap-1 px-2 py-1 bg-slate-50 text-slate-400 rounded-md text-xs font-medium border border-slate-200 hover:bg-slate-100 hover:text-slate-600 transition-all"
                        >
                          <Plus className="w-3 h-3" />
                          Thêm mã
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="p-4">
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-slate-100 text-xs font-medium text-slate-600 border border-slate-200">
                      <Tag className="w-3 h-3" />
                      {p.category}
                    </span>
                  </td>
                  <td className="p-4 text-right font-medium text-slate-700 text-sm">{p.price.toLocaleString()} ₫</td>
                  <td className="p-4 text-center">
                    <div className="flex flex-col items-center">
                      <span className={`inline-block min-w-[2.5rem] px-2 py-1 rounded-full text-xs font-bold ${p.stock <= 0 ? 'bg-red-100 text-red-600 border border-red-200' : p.stock < 5 ? 'bg-orange-50 text-orange-600 border border-orange-100' : 'bg-green-50 text-green-600 border border-green-100'}`}>
                        {p.stock}
                      </span>
                      <span className="text-[9px] text-slate-400 mt-0.5">{p.unit}</span>
                    </div>
                  </td>
                  <td className="p-4 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => openEditProduct(p)}
                        className="text-slate-600 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-xs font-semibold px-3 py-1.5 rounded-lg transition-all active:scale-95 inline-flex items-center gap-1"
                      >
                        <Pencil className="w-3 h-3" />
                        Sửa
                      </button>
                      <button
                        onClick={() => setStockModalId(p.id)}
                        className="text-primary-600 bg-primary-50 hover:bg-primary-100 border border-primary-200 text-xs font-semibold px-3 py-1.5 rounded-lg transition-all active:scale-95"
                      >
                        + Nhập hàng
                      </button>
                      <button
                        onClick={() => openDeleteProduct(p)}
                        aria-label={`Xoá ${p.name}`}
                        className="text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 text-xs font-semibold px-3 py-1.5 rounded-lg transition-all active:scale-95 inline-flex items-center gap-1"
                      >
                        <Trash2 className="w-3 h-3" />
                        Xoá
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Delete Product Confirm Modal */}
      {deleteProductId && (() => {
        const delProduct = products.find(p => p.id === deleteProductId);
        return (
          <div className="fixed inset-0 bg-slate-900/40 z-50 flex items-center justify-center backdrop-blur-sm p-3 md:p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
              <div className="px-4 md:px-6 py-4 md:py-5 border-b border-slate-100">
                <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-red-600" />
                  Xoá sản phẩm?
                </h3>
                <p className="text-slate-500 text-xs md:text-sm mt-1">
                  Hành động này không thể hoàn tác.
                </p>
              </div>

              <div className="p-4 md:p-6 space-y-3">
                {delProduct && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="font-semibold text-slate-800">{delProduct.name}</p>
                    <p className="text-xs text-slate-500 font-mono mt-0.5">{delProduct.id}</p>
                    <p className="text-xs text-slate-500 mt-1">
                      Tồn kho hiện tại: <span className="font-semibold">{delProduct.stock}</span>
                    </p>
                  </div>
                )}

                {deleteError && (
                  <div className="rounded-xl border border-red-200 bg-red-50 text-red-700 px-3 py-2 text-xs font-semibold flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{deleteError}</span>
                  </div>
                )}

                {deleteError && deleteError.includes('đã bán') && (
                  <p className="text-xs text-slate-500">
                    Nếu vẫn xoá, sản phẩm biến mất khỏi Kho nhưng lịch sử bán vẫn được giữ
                    trong báo cáo cũ.
                  </p>
                )}
              </div>

              <div className="p-4 md:p-6 border-t border-slate-100 bg-slate-50 flex gap-3">
                <button
                  onClick={closeDeleteProduct}
                  className="flex-1 min-h-[48px] py-3 bg-white text-slate-700 border border-slate-200 rounded-xl font-semibold hover:bg-slate-50 transition-all"
                >
                  Huỷ
                </button>
                <button
                  onClick={() => handleConfirmDelete(deleteError.includes('đã bán'))}
                  disabled={deleting}
                  className="flex-1 min-h-[48px] py-3 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {deleting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  {deleteError.includes('đã bán') ? 'Vẫn xoá' : 'Xoá'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Edit Product Modal */}
      {editProductId && (
        <div className="fixed inset-0 bg-slate-900/40 z-50 flex items-center justify-center backdrop-blur-sm p-3 md:p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[92vh]">
            <div className="px-4 md:px-6 py-4 md:py-5 border-b border-slate-100 flex justify-between items-center bg-white shrink-0">
              <div>
                <h3 className="font-bold text-lg md:text-xl text-slate-800">Sửa sản phẩm</h3>
                <p className="text-slate-500 text-xs md:text-sm font-mono">{editProductId}</p>
              </div>
              <button onClick={closeEditProduct} className="p-2 hover:bg-slate-100 rounded-full transition-colors" aria-label="Đóng"><X className="w-5 h-5 text-slate-400 hover:text-red-500" /></button>
            </div>

            <div className="p-4 md:p-6 space-y-4 md:space-y-5 overflow-y-auto">
              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                  <Package className="w-4 h-4 text-slate-400" /> Tên sản phẩm
                </label>
                <input
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-primary-500 outline-none font-medium"
                  value={editDraft.name ?? ''}
                  onChange={e => setEditDraft({ ...editDraft, name: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-3 md:gap-5">
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                    <DollarSign className="w-4 h-4 text-slate-400" /> Giá bán
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      inputMode="numeric"
                      className="w-full pl-4 pr-10 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-primary-500 outline-none font-semibold text-slate-800"
                      value={editDraft.price ?? ''}
                      onChange={e => setEditDraft({ ...editDraft, price: Number(e.target.value) })}
                      onFocus={e => e.target.select()}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-bold">đ</span>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                    <DollarSign className="w-4 h-4 text-slate-400" /> Giá vốn
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      inputMode="numeric"
                      className="w-full pl-4 pr-10 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-primary-500 outline-none font-semibold text-slate-800"
                      value={editDraft.costPrice ?? ''}
                      onChange={e => setEditDraft({ ...editDraft, costPrice: Number(e.target.value) })}
                      onFocus={e => e.target.select()}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-bold">đ</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 md:gap-5">
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                    <Layers className="w-4 h-4 text-slate-400" /> Danh mục
                  </label>
                  <input
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-primary-500 outline-none"
                    value={editDraft.category ?? ''}
                    onChange={e => setEditDraft({ ...editDraft, category: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                    <Tag className="w-4 h-4 text-slate-400" /> Đơn vị
                  </label>
                  <input
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-primary-500 outline-none"
                    value={editDraft.unit ?? ''}
                    onChange={e => setEditDraft({ ...editDraft, unit: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-slate-700">Tồn kho</label>
                <input
                  type="number"
                  inputMode="numeric"
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-primary-500 outline-none font-semibold"
                  value={editDraft.stock ?? 0}
                  onChange={e => setEditDraft({ ...editDraft, stock: Number(e.target.value) })}
                  onFocus={e => e.target.select()}
                />
                <p className="text-[11px] text-slate-400">
                  Sửa trực tiếp tồn kho chỉ nên dùng để đối soát kiểm kê. Nhập hàng thì dùng nút “+ Nhập hàng”.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                  <Barcode className="w-4 h-4 text-slate-400" /> Mã vạch / QR phụ
                </label>

                {(editDraft.barcodes || []).map(bc => (
                  <div key={bc} className="flex items-center gap-2">
                    <input
                      value={bc}
                      onChange={e => changeEditBarcode(bc, e.target.value)}
                      className="flex-1 min-h-[44px] px-3 py-2 rounded-xl border border-slate-200 font-mono text-sm focus:border-blue-500 outline-none"
                    />
                    <button
                      onClick={() => removeEditBarcode(bc)}
                      aria-label={`Xoá mã ${bc}`}
                      className="shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl border border-red-200 text-red-600 hover:bg-red-50"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}

                <div className="flex items-center gap-2">
                  <input
                    value={editBarcodeInput}
                    onChange={e => setEditBarcodeInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addEditBarcode();
                      }
                    }}
                    placeholder="Quét hoặc nhập mã mới rồi Enter..."
                    className="flex-1 min-h-[44px] px-3 py-2 rounded-xl border border-slate-200 font-mono text-sm focus:border-blue-500 outline-none"
                  />
                  <button
                    onClick={addEditBarcode}
                    disabled={!editBarcodeInput.trim()}
                    className="shrink-0 min-h-[44px] px-4 rounded-xl bg-blue-600 text-white font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Thêm
                  </button>
                </div>
                <p className="text-[11px] text-slate-400">
                  Sửa thẳng vào ô để đổi mã. Mã hàng chính ({editProductId}) là khoá — không đổi được.
                </p>
              </div>

              {editError && (
                <div className="rounded-xl border border-red-200 bg-red-50 text-red-700 px-3 py-2 text-xs font-semibold flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{editError}</span>
                </div>
              )}
            </div>

            <div className="p-4 md:p-6 border-t border-slate-100 bg-slate-50 flex gap-3 shrink-0">
              <button
                onClick={closeEditProduct}
                className="flex-1 min-h-[48px] py-3 bg-white text-slate-700 border border-slate-200 rounded-xl font-semibold hover:bg-slate-50 transition-all"
              >
                Hủy bỏ
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={savingEdit}
                className="flex-1 min-h-[48px] py-3 bg-slate-900 text-white rounded-xl font-semibold hover:bg-slate-800 shadow-lg shadow-slate-900/20 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:bg-slate-300"
              >
                {savingEdit ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {savingEdit ? 'Đang lưu...' : 'Lưu thay đổi'}
              </button>
            </div>
          </div>
        </div>
      )}

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

              {/* Barcode phụ */}
              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                  <Barcode className="w-4 h-4 text-slate-400" /> Mã barcode phụ
                  <span className="text-xs text-slate-400 font-normal">(Quét mã nào cũng tìm được SP)</span>
                </label>
                <div className="flex gap-2">
                  <input
                    className="flex-1 px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all outline-none font-mono text-sm"
                    placeholder="Quét hoặc nhập mã..."
                    value={newBarcode}
                    onChange={e => setNewBarcode(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleAddBarcodeToNew()}
                  />
                  <button
                    onClick={handleAddBarcodeToNew}
                    className="px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-sm transition-all"
                  >
                    Thêm
                  </button>
                </div>
                {newProd.barcodes && newProd.barcodes.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {newProd.barcodes.map(bc => (
                      <span key={bc} className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-600 rounded-md text-xs font-mono border border-blue-200">
                        {bc}
                        <button onClick={() => setNewProd({ ...newProd, barcodes: newProd.barcodes!.filter(b => b !== bc) })}>
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-slate-700">Tồn kho ban đầu <span className="text-slate-400 font-normal">(Tùy chọn)</span></label>                <input
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

      {/* Excel Import Modal */}
      {showExcelModal && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
            <div className="px-6 py-5 border-b border-slate-100 flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-green-100 text-green-600 rounded-xl flex items-center justify-center border border-green-200">
                  <FileSpreadsheet className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-lg text-slate-800">Cập nhật giá từ Excel</h3>
                  <p className="text-slate-500 text-xs mt-0.5">Ghi đè giá bán, giá vốn và tem phụ từ file xuất kho</p>
                </div>
              </div>
              <button
                onClick={() => { setShowExcelModal(false); resetExcelModal(); }}
                className="p-2 hover:bg-slate-100 rounded-full transition-colors"
              >
                <X className="w-5 h-5 text-slate-400 hover:text-red-500" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {!importResult && (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-slate-200 rounded-xl p-8 text-center cursor-pointer hover:border-green-400 hover:bg-green-50/50 transition-all group"
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xls"
                    className="hidden"
                    onChange={handleFilePick}
                  />
                  {importing ? (
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-8 h-8 border-4 border-green-200 border-t-green-600 rounded-full animate-spin" />
                      <p className="text-sm text-slate-500">Đang xử lý...</p>
                    </div>
                  ) : (
                    <>
                      <div className="w-14 h-14 bg-green-50 rounded-2xl flex items-center justify-center mx-auto mb-3 group-hover:bg-green-100 transition-colors">
                        <Upload className="w-7 h-7 text-green-600" />
                      </div>
                      <p className="font-semibold text-slate-700">
                        {importFileName || 'Chọn file Excel để import'}
                      </p>
                      <p className="text-xs text-slate-400 mt-1">
                        Cột A=Mã hàng, Cột H=Giá bán, Cột J=Giá vốn, Cột K=Tồn kho
                      </p>
                    </>
                  )}
                </div>
              )}

              {importError && (
                <div className="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  {importError}
                </div>
              )}

              {importResult && (
                <div className="flex flex-col items-center gap-4 py-6 text-center">
                  <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center border-2 border-green-300">
                    <CheckCircle className="w-8 h-8 text-green-600" />
                  </div>
                  <div>
                    <p className="text-xl font-bold text-slate-800">Import thành công!</p>
                    <p className="text-slate-500 text-sm mt-1">
                      Đã cập nhật <span className="font-bold text-blue-600">{importResult.updated}</span> sản phẩm
                      • Thêm mới <span className="font-bold text-green-600">{importResult.inserted}</span> sản phẩm
                    </p>
                  </div>
                  <button
                    onClick={resetExcelModal}
                    className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-sm font-medium transition-all"
                  >
                    <Upload className="w-4 h-4" /> Import file khác
                  </button>
                </div>
              )}

              {importRows && !importResult && (
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="flex items-center gap-2 px-3 py-2.5 bg-blue-50 border border-blue-200 rounded-xl">
                      <FileSpreadsheet className="w-4 h-4 text-blue-500 shrink-0" />
                      <div>
                        <p className="text-xs text-blue-500 font-medium">Cập nhật giá</p>
                        <p className="text-lg font-bold text-blue-700">{updateCount}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 px-3 py-2.5 bg-green-50 border border-green-200 rounded-xl">
                      <Plus className="w-4 h-4 text-green-500 shrink-0" />
                      <div>
                        <p className="text-xs text-green-500 font-medium">Thêm mới</p>
                        <p className="text-lg font-bold text-green-700">{newCount}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl">
                      <X className="w-4 h-4 text-slate-400 shrink-0" />
                      <div>
                        <p className="text-xs text-slate-400 font-medium">Bỏ qua</p>
                        <p className="text-lg font-bold text-slate-500">{skipCount}</p>
                      </div>
                    </div>
                  </div>

                  <div className="border border-slate-200 rounded-xl overflow-hidden max-h-64 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 sticky top-0">
                        <tr>
                          <th className="px-3 py-2 text-left font-semibold text-slate-500 w-28">Mã hàng</th>
                          <th className="px-3 py-2 text-left font-semibold text-slate-500">Tên</th>
                          <th className="px-3 py-2 text-right font-semibold text-slate-500 w-20">Giá bán</th>
                          <th className="px-3 py-2 text-center font-semibold text-slate-500 w-24">Trạng thái</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {importRows.map((row, idx) => (
                          <tr key={`${row.id}-${idx}`} className={row.status === 'skip' ? 'opacity-40' : ''}>
                            <td className="px-3 py-2 font-mono text-slate-500 truncate max-w-[7rem]" title={row.id}>{row.id}</td>
                            <td className="px-3 py-2 text-slate-700 truncate max-w-[200px]" title={row.name}>
                              {row.name}
                              {row.barcodes.length > 0 && (
                                <span className="ml-1 text-blue-400 text-[10px]">+{row.barcodes.length} mã</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right text-slate-600">{row.price.toLocaleString()}</td>
                            <td className="px-3 py-2 text-center">
                              {row.status === 'update' && (
                                <span className="inline-block px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 font-semibold" title={row.reason}>
                                  Cập nhật
                                </span>
                              )}
                              {row.status === 'new' && (
                                <span className="inline-block px-2 py-0.5 rounded-full bg-green-50 text-green-600 font-semibold">Mới</span>
                              )}
                              {row.status === 'skip' && (
                                <span className="inline-block px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 font-semibold" title={row.reason}>Bỏ qua</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            <div className="p-6 border-t border-slate-100 bg-slate-50 flex gap-3">
              <button
                onClick={() => { setShowExcelModal(false); resetExcelModal(); }}
                className="flex-1 py-3 bg-white text-slate-700 border border-slate-200 rounded-xl font-semibold hover:bg-slate-50 transition-all"
              >
                Hủy
              </button>
              <button
                onClick={handleConfirmImport}
                disabled={!importRows || importing || updateCount + newCount === 0}
                className="flex-1 py-3 bg-green-600 hover:bg-green-700 text-white rounded-xl font-semibold shadow-lg shadow-green-600/20 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {importing ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" /> Đang import...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" /> Xác nhận import ({updateCount + newCount} sản phẩm)
                  </>
                )}
              </button>
            </div>

            {importResult && (
              <div className="p-6 border-t border-slate-100 bg-slate-50">
                <button
                  onClick={() => { setShowExcelModal(false); resetExcelModal(); }}
                  className="w-full py-3 bg-slate-900 text-white rounded-xl font-semibold hover:bg-slate-800 transition-all"
                >
                  Đóng
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Barcode Manager Modal */}
      {barcodeProduct && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4 backdrop-blur-md animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl animate-in zoom-in-95 duration-200 overflow-hidden flex flex-col max-h-[80vh]">
            <div className="p-5 border-b border-slate-100 bg-gradient-to-b from-white to-slate-50/50 relative">
              <button
                onClick={() => { setBarcodeModalId(null); setBarcodeInput(''); }}
                className="absolute right-4 top-4 p-2 bg-white rounded-full text-slate-400 hover:text-slate-600 shadow-sm border border-slate-100 transition-all"
              >
                <X className="w-4 h-4" />
              </button>
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center shadow-sm border border-blue-200">
                  <Barcode className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-bold text-lg text-slate-800">Quản lý mã barcode</h3>
                  <p className="text-sm text-slate-500 line-clamp-1">{barcodeProduct.name}</p>
                </div>
              </div>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto flex-1">
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Mã chính</label>
                <div className="flex items-center gap-2 px-4 py-3 bg-slate-100 rounded-xl border border-slate-200">
                  <Tag className="w-4 h-4 text-slate-400" />
                  <span className="font-mono text-sm font-semibold text-slate-700">{barcodeProduct.id}</span>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Thêm mã barcode phụ</label>
                <div className="flex gap-2">
                  <input
                    className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all outline-none font-mono text-sm"
                    placeholder="Quét hoặc nhập mã barcode..."
                    value={barcodeInput}
                    onChange={e => setBarcodeInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddBarcode(); } }}
                    autoFocus
                  />
                  <button
                    onClick={handleAddBarcode}
                    className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium text-sm transition-all active:scale-95"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                  Danh sách mã barcode phụ ({barcodeProduct.barcodes?.length || 0})
                </label>
                <div className="space-y-2 max-h-[200px] overflow-y-auto">
                  {!barcodeProduct.barcodes || barcodeProduct.barcodes.length === 0 ? (
                    <div className="py-6 text-center text-slate-400 text-sm bg-slate-50 rounded-xl border border-dashed border-slate-200">
                      Chưa có mã barcode phụ nào
                    </div>
                  ) : (
                    barcodeProduct.barcodes.map(bc => (
                      <div key={bc} className="flex items-center justify-between px-4 py-2.5 bg-blue-50 rounded-xl border border-blue-200 group">
                        <div className="flex items-center gap-2">
                          <Barcode className="w-4 h-4 text-blue-400" />
                          <span className="font-mono text-sm font-medium text-blue-700">{bc}</span>
                        </div>
                        <button
                          onClick={() => handleRemoveBarcode(bc)}
                          className="p-1.5 text-blue-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="p-5 border-t border-slate-100 bg-slate-50">
              <button
                onClick={() => { setBarcodeModalId(null); setBarcodeInput(''); }}
                className="w-full py-3 bg-slate-900 text-white rounded-xl font-semibold hover:bg-slate-800 transition-all active:scale-[0.98]"
              >
                Xong
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import Stock Modal */}
      {stockProduct && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4 backdrop-blur-md animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl w-full max-w-sm shadow-2xl animate-in zoom-in-95 duration-200 overflow-hidden flex flex-col">
            <div className="p-6 border-b border-slate-100 bg-gradient-to-b from-white to-slate-50/50 text-center relative">
              <button
                onClick={() => { setStockModalId(null); setImportQty(0); }}
                className="absolute right-4 top-4 p-2 bg-white rounded-full text-slate-400 hover:text-slate-600 shadow-sm border border-slate-100 transition-all"
              >
                <X className="w-4 h-4" />
              </button>
              <div className="w-14 h-14 bg-green-100 text-green-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-sm border border-green-200">
                <Plus className="w-7 h-7" />
              </div>
              <h3 className="font-bold text-xl text-slate-800">Nhập Kho Hàng</h3>
              <p className="text-sm text-slate-500 mt-1 max-w-[220px] mx-auto truncate font-medium">
                {stockProduct.name}
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
