export interface Product {
  id: string; // Mã hàng hóa
  name: string; // Tên hàng hóa
  price: number; // Giá bán
  costPrice?: number; // Giá vốn
  category?: string; // Tên nhóm
  stock: number; // Tồn kho
  unit?: string; // ĐVT
  image?: string;
}

export interface CartItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
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
  pin: string;
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
