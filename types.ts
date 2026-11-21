export interface Product {
  id: string; // Mã hàng hóa
  name: string; // Tên hàng hóa
  price: number; // Giá bán
  costPrice?: number; // Giá vốn
  category?: string; // Tên nhóm
  stock: number; // Tồn kho
  unit?: string; // ĐVT
  image?: string;
  barcodes?: string[]; // Mã vạch phụ (quét mã nào cũng tìm được SP)
}

export interface CartItem {
  productId: string;
  name: string;
  /** Giá bán thực tế của dòng hàng — có thể đã sửa tay lúc thanh toán. */
  price: number;
  quantity: number;
  /**
   * Giá gốc trong kho tại lúc thêm vào giỏ.
   *
   * Dùng để biết dòng hàng đã bị sửa giá hay chưa (hiện nhãn "đã sửa" và cho
   * phép hoàn tác). Không gửi lên server — server chỉ cần `price` thật đã bán.
   */
  originalPrice?: number;
}

export interface Transaction {
  id: string;
  date: string;
  total: number;
  paymentMethod: 'CASH' | 'CARD' | 'TRANSFER';
  items: {
    productId: string;
    name: string;
    price: number;
    costPrice?: number;
    quantity: number;
  }[];
  shiftId?: string;
  cashierName?: string;
  receivedAmount?: number;
  changeAmount?: number;
}

export interface User {
  id: string;
  name: string;
  role: 'ADMIN' | 'STAFF';
  /** Không còn được server trả về; chỉ dùng khi tạo/sửa nhân viên. */
  pin?: string;
}

export interface Shift {
  id: string;
  userId: string;
  userName: string;
  startTime: string;
  endTime?: string;
  startCash: number;
  cashSales: number;
  expectedCash: number;
  endCash?: number;
  status: 'OPEN' | 'CLOSED';
}

export type ViewState = 'POS' | 'TRANSACTIONS' | 'INVENTORY' | 'ADMIN_DASHBOARD' | 'EMPLOYEE_MANAGEMENT';
