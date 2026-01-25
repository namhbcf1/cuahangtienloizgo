-- Create Users Table
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    pin TEXT NOT NULL
);

-- Create Products Table
-- Updated to match Excel: Mã hàng hóa, Tên, ĐVT, Giá bán, Giá vốn, Tồn kho, Tên nhóm
CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY, -- Mã hàng hóa
    name TEXT NOT NULL, -- Tên hàng hóa
    price REAL NOT NULL, -- Giá bán
    cost_price REAL DEFAULT 0, -- Giá vốn
    category TEXT, -- Tên nhóm
    stock INTEGER DEFAULT 0, -- Tồn kho
    unit TEXT, -- ĐVT
    image TEXT
);

-- Create Shifts Table
CREATE TABLE IF NOT EXISTS shifts (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    userName TEXT,
    startTime TEXT NOT NULL,
    endTime TEXT,
    startCash REAL DEFAULT 0,
    cashSales REAL DEFAULT 0,
    expectedCash REAL DEFAULT 0,
    endCash REAL DEFAULT 0,
    status TEXT NOT NULL -- 'OPEN' or 'CLOSED'
);

-- Create Transactions Table
CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    total REAL NOT NULL,
    paymentMethod TEXT NOT NULL,
    shiftId TEXT,
    cashierName TEXT
);

-- Create Transaction Items Table
CREATE TABLE IF NOT EXISTS transaction_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transactionId TEXT NOT NULL,
    productId TEXT NOT NULL,
    name TEXT,
    price REAL,
    cost_price REAL, -- Track cost at time of sale for profit calc
    quantity INTEGER,
    FOREIGN KEY(transactionId) REFERENCES transactions(id)
);
