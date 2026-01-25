import React, { useState, useEffect } from 'react';
import { Layout } from './components/Layout';
import { POS } from './components/POS';
import { Inventory } from './components/Inventory';
import { Transactions } from './components/Transactions';
import { Login } from './components/Login';
import { ShiftModal } from './components/ShiftModal';
import { AdminDashboard } from './components/AdminDashboard';
import { EmployeeManagement } from './components/EmployeeManagement';
import { Product, Transaction, ViewState, CartItem, User, Shift } from './types';
import { api } from './services/api';

function App() {
    // Global State
    const [users, setUsers] = useState<User[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [shifts, setShifts] = useState<Shift[]>([]);

    // Session State
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [currentShift, setCurrentShift] = useState<Shift | null>(null);
    const [view, setView] = useState<ViewState>('POS');

    // Modal State
    const [showShiftModal, setShowShiftModal] = useState<'OPEN' | 'CLOSE' | null>(null);

    // Initial Data Load & Session Restore
    useEffect(() => {
        const loadData = async () => {
            try {
                // Restore session first to avoid flicker
                const savedUser = localStorage.getItem('smartpos_user');
                const savedShift = localStorage.getItem('smartpos_shift');

                if (savedUser) setCurrentUser(JSON.parse(savedUser));
                if (savedShift) setCurrentShift(JSON.parse(savedShift));

                const [u, p, s, t] = await Promise.all([
                    api.getUsers(),
                    api.getProducts(),
                    api.getShifts(),
                    api.getTransactions()
                ]);
                setUsers(u);
                setProducts(p);
                setShifts(s);
                setTransactions(t);

                // FORCE SYNC: Always try to find the active open shift for the current user from the fresh server data.
                // This fixes issues where localStorage might be stale or missing, or if the user logged in on another device.
                if (savedUser) {
                    const userObj = JSON.parse(savedUser);
                    const freshOpenShift = s.find((shift: Shift) => shift.userId === userObj.id && shift.status === 'OPEN');

                    if (freshOpenShift) {
                        // Found an open shift on server -> Use it as source of truth
                        setCurrentShift(freshOpenShift);
                        localStorage.setItem('smartpos_shift', JSON.stringify(freshOpenShift));
                    } else {
                        // No open shift on server -> Clear local state if it was mistakenly set
                        if (savedShift && JSON.parse(savedShift).status === 'OPEN') {
                            setCurrentShift(null);
                            localStorage.removeItem('smartpos_shift');
                        }
                    }
                }
            } catch (error) {
                console.error("Failed to load data", error);
            }
        };
        loadData();
    }, []);

    // --- Auth Logic ---
    const handleLogin = (user: User) => {
        setCurrentUser(user);
        localStorage.setItem('smartpos_user', JSON.stringify(user));

        // ADMIN BYPASS: Admins don't need to open shifts
        if (user.role === 'ADMIN') {
            setView('ADMIN_DASHBOARD');
            return;
        }

        // STAFF LOGIC
        const openShift = shifts.find(s => s.userId === user.id && s.status === 'OPEN');
        if (openShift) {
            setCurrentShift(openShift);
            localStorage.setItem('smartpos_shift', JSON.stringify(openShift));
            setView('POS');
        } else {
            setShowShiftModal('OPEN');
        }
    };

    const handleLogoutRequest = () => {
        // If admin, just logout. If staff, must close shift.
        if (currentUser?.role === 'ADMIN') {
            setCurrentUser(null);
            localStorage.removeItem('smartpos_user');
            localStorage.removeItem('smartpos_shift');
            setView('POS'); // Reset view for next user
        } else {
            setShowShiftModal('CLOSE');
        }
    };

    // --- User Management Logic ---
    const handleAddUser = async (newUser: User) => {
        try {
            const created = await api.createUser(newUser);
            setUsers(prev => [...prev, created]);
        } catch (error) {
            console.error("Failed to add user", error);
        }
    };

    const handleUpdateUser = async (updatedUser: User) => {
        try {
            const updated = await api.updateUser(updatedUser);
            setUsers(prev => prev.map(u => u.id === updated.id ? updated : u));
            // Update currentUser session if they are editing themselves
            if (currentUser && currentUser.id === updated.id) {
                setCurrentUser(updated);
            }
        } catch (error) {
            console.error("Failed to update user", error);
        }
    };

    const handleDeleteUser = async (userId: string) => {
        try {
            await api.deleteUser(userId);
            setUsers(prev => prev.filter(u => u.id !== userId));
        } catch (error) {
            console.error("Failed to delete user", error);
        }
    };

    // --- Shift Logic ---
    const handleOpenShift = async (startCash: number) => {
        if (!currentUser) return;
        const newShift: Shift = {
            id: Date.now().toString(),
            userId: currentUser.id,
            userName: currentUser.name,
            startTime: new Date().toISOString(),
            startCash: startCash,
            cashSales: 0,
            expectedCash: startCash, // Initially just the start cash
            status: 'OPEN'
        };
        try {
            const created = await api.createShift(newShift);
            setShifts(prev => [...prev, created]);
            setCurrentShift(created);
            localStorage.setItem('smartpos_shift', JSON.stringify(created)); // PERSIST!
            setShowShiftModal(null);
            setView('POS');
        } catch (error) {
            console.error("Failed to open shift", error);
        }
    };

    const handleCloseShift = async (endCash: number) => {
        if (!currentShift) return;

        const expected = currentShift.startCash + currentShift.cashSales; // Simplified local recalc
        const updatedShift: Shift = {
            ...currentShift,
            endTime: new Date().toISOString(),
            endCash: endCash,
            expectedCash: expected,
            status: 'CLOSED'
        };

        try {
            const saved = await api.updateShift(updatedShift);
            setShifts(prev => prev.map(s => s.id === currentShift.id ? saved : s));

            // Cleanup Session
            setCurrentShift(null);
            setCurrentUser(null);
            localStorage.removeItem('smartpos_user');
            localStorage.removeItem('smartpos_shift');
            setShowShiftModal(null);
            setView('POS');
        } catch (error) {
            console.error("Failed to close shift", error);
        }
    };

    // --- Core Business Logic ---
    const handleCheckout = async (cartItems: CartItem[], total: number, paymentMethod: 'CASH' | 'CARD' | 'TRANSFER', receivedAmount?: number, changeAmount?: number) => {
        // For Staff: Ensure they have an active shift before allowing checkout
        if (currentUser.role === 'STAFF' && !currentShift?.id) {
            console.error("Staff must have an active shift to checkout");
            alert("Lỗi: Bạn phải mở ca làm việc trước khi bán hàng!");
            return;
        }

        const newTx: Transaction = {
            id: Date.now().toString(),
            date: new Date().toISOString(),
            total,
            paymentMethod,
            items: cartItems.map(c => ({
                productId: c.productId,
                name: c.name,
                price: c.price,
                quantity: c.quantity
            })),
            shiftId: currentShift?.id || null,
            cashierName: currentUser?.name,
            receivedAmount,
            changeAmount
        };

        try {
            await api.createTransaction(newTx);
            setTransactions(prev => [...prev, newTx]);

            // Refresh products to get updated stock
            const freshProducts = await api.getProducts();
            setProducts(freshProducts);

            if (currentShift && paymentMethod === 'CASH') {
                // Optimistic update for shift cash
                const updatedShift = {
                    ...currentShift,
                    cashSales: currentShift.cashSales + total,
                    expectedCash: currentShift.expectedCash + total
                };
                setCurrentShift(updatedShift);
                localStorage.setItem('smartpos_shift', JSON.stringify(updatedShift));
                // Also update in list
                setShifts(prev => prev.map(s => s.id === currentShift.id ? updatedShift : s));

                // Update backend shift as well
                try {
                    await api.updateShift(updatedShift);
                } catch (err) {
                    console.error("Failed to update shift cash on backend", err);
                }
            }
        } catch (error) {
            console.error("Checkout failed", error);
        }
    };

    const handleAddProduct = async (newProduct: Product) => {
        try {
            const created = await api.createProduct(newProduct);
            setProducts(prev => [...prev, created]);
        } catch (error) {
            console.error("Failed to add product", error);
        }
    };

    const handleUpdateStock = async (productId: string, qtyToAdd: number) => {
        const product = products.find(p => p.id === productId);
        if (!product) return;
        const updated = { ...product, stock: product.stock + qtyToAdd };
        try {
            const saved = await api.updateProduct(updated);
            setProducts(prev => prev.map(p => p.id === productId ? saved : p));
        } catch (error) {
            console.error("Failed to update stock", error);
        }
    };

    // --- Render ---

    if (!currentUser) {
        return <Login users={users} onLogin={handleLogin} />;
    }

    return (
        <>
            <Layout
                currentView={view}
                onChangeView={setView}
                currentUser={currentUser}
                onLogout={handleLogoutRequest}
            >
                {view === 'POS' && (
                    <POS
                        products={products}
                        transactions={transactions}
                        currentUser={currentUser}
                        onCheckout={handleCheckout}
                    />
                )}
                {view === 'INVENTORY' && (
                    <Inventory
                        products={products}
                        onAddProduct={handleAddProduct}
                        onUpdateStock={handleUpdateStock}
                    />
                )}
                {view === 'TRANSACTIONS' && (
                    <Transactions
                        transactions={
                            currentUser.role === 'ADMIN'
                                ? transactions
                                : transactions.filter(t => t.shiftId === currentShift?.id)
                        }
                    />
                )}
                {view === 'ADMIN_DASHBOARD' && currentUser.role === 'ADMIN' && (
                    <AdminDashboard shifts={shifts} transactions={transactions} />
                )}
                {view === 'EMPLOYEE_MANAGEMENT' && currentUser.role === 'ADMIN' && (
                    <EmployeeManagement
                        users={users}
                        onAddUser={handleAddUser}
                        onUpdateUser={handleUpdateUser}
                        onDeleteUser={handleDeleteUser}
                    />
                )}
            </Layout>

            {showShiftModal && (
                <ShiftModal
                    mode={showShiftModal}
                    user={currentUser}
                    currentShift={currentShift}
                    onConfirm={showShiftModal === 'OPEN' ? handleOpenShift : handleCloseShift}
                    onCancel={() => showShiftModal === 'CLOSE' ? setShowShiftModal(null) : null}
                />
            )}
        </>
    );
}

export default App;
