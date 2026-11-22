import React, { useState, useEffect } from 'react';
import { Layout } from './components/Layout';
import { POS, CheckoutPayload } from './components/POS';
import { Inventory } from './components/Inventory';
import { Transactions } from './components/Transactions';
import { Login } from './components/Login';
import { ShiftModal } from './components/ShiftModal';
import { ShiftSummaryModal } from './components/ShiftSummaryModal';
import { AdminDashboard } from './components/AdminDashboard';
import { EmployeeManagement } from './components/EmployeeManagement';
import { Product, Transaction, ViewState, User, Shift } from './types';
import { api, getAuthToken, getDeviceToken, setNativeDeviceToken } from './services/api';
import { useLiveData } from './hooks/useLiveData';
import { ToastProvider, useToast } from './components/Toast';

function App() {
    // Global State
    const [users, setUsers] = useState<User[]>([]);

    // Session State
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [currentShift, setCurrentShift] = useState<Shift | null>(null);
    const [view, setView] = useState<ViewState>('POS');

    // Dữ liệu sống: tự tải lại mỗi 10 giây + khi quay lại app,
    // để nhiều máy thấy thay đổi của nhau mà không phải tắt mở lại.
    const {
        products, shifts, transactions, stats,
        loading, refreshing, error: syncError, lastSync, live, refresh,
    } = useLiveData(!!currentUser);

    // Modal State
    const [showShiftModal, setShowShiftModal] = useState<'OPEN' | 'CLOSE' | null>(null);
    const [summaryShift, setSummaryShift] = useState<Shift | null>(null);

    // Khôi phục phiên đăng nhập + tải danh sách nhân viên.
    // Sản phẩm/ca/giao dịch do useLiveData lo.
    useEffect(() => {
        const bootstrap = async () => {
            try {
                const savedUser = localStorage.getItem('smartpos_user');
                const savedShift = localStorage.getItem('smartpos_shift');
                // Chỉ khôi phục phiên khi còn token: token hết hạn hoặc đã bị
                // xoá thì phải đăng nhập lại, không vào app bằng dữ liệu cũ.
                if (savedUser && getAuthToken()) setCurrentUser(JSON.parse(savedUser));
                if (savedShift && getAuthToken()) setCurrentShift(JSON.parse(savedShift));

                // App vừa mở lại (kể cả sau khi bị hệ điều hành giết): đẩy token
                // THIẾT BỊ xuống native để service nền tiếp tục báo đơn.
                // Dùng token thiết bị (90 ngày), không dùng token web (12 giờ) —
                // nếu đẩy token web thì qua đêm service sẽ 401 và im lặng.
                const deviceToken = getDeviceToken();
                if (deviceToken) setNativeDeviceToken(deviceToken);

                const u = await api.getUsers();
                if (Array.isArray(u)) setUsers(u);
            } catch (error) {
                console.error("Failed to load users", error);
            }
        };
        void bootstrap();
    }, []);

    // Server trả 401 (token hết hạn / bị thu hồi) -> đá về màn đăng nhập ngay,
    // không để nhân viên tiếp tục bán hàng trong trạng thái mất quyền.
    useEffect(() => {
        if (!syncError) return;
        if (!/hết hạn|Cần đăng nhập|Không đủ quyền/.test(syncError)) return;
        api.logout();
        setCurrentUser(null);
        setCurrentShift(null);
        localStorage.removeItem('smartpos_user');
        localStorage.removeItem('smartpos_shift');
    }, [syncError]);

    // Đồng bộ ca đang mở theo dữ liệu mới nhất từ server.
    // Chạy mỗi khi `shifts` đổi (tức là sau mỗi lần polling).
    useEffect(() => {
        if (!currentUser || shifts.length === 0) return;

        const fresh = shifts.find(s => s.userId === currentUser.id && s.status === 'OPEN');

        if (fresh) {
            // Có ca mở trên server -> luôn dùng số liệu server (đã cộng dồn từ mọi máy)
            setCurrentShift(prev => {
                if (prev && prev.id === fresh.id
                    && prev.cashSales === fresh.cashSales
                    && prev.expectedCash === fresh.expectedCash) {
                    return prev; // không đổi thì giữ nguyên, tránh render lại
                }
                localStorage.setItem('smartpos_shift', JSON.stringify(fresh));
                return fresh;
            });
        } else {
            setCurrentShift(prev => {
                if (prev && prev.status === 'OPEN') {
                    localStorage.removeItem('smartpos_shift');
                    return null;
                }
                return prev;
            });
        }
    }, [shifts, currentUser]);

    // --- Auth Logic ---
    const handleLogin = async (user: User) => {
        // Không ghi PIN xuống localStorage: trước đây bất kỳ ai mở DevTools
        // cũng đọc được PIN của nhân viên đang đăng nhập.
        const { pin: _pin, ...safeUser } = user;
        setCurrentUser(safeUser as User);
        localStorage.setItem('smartpos_user', JSON.stringify(safeUser));

        // Phải lấy ca MỚI NHẤT từ server trước khi quyết định mở ca hay không.
        // Trước đây đọc từ state `shifts` — nhưng state này giờ do polling nạp
        // nên lúc đăng nhập có thể còn rỗng, khiến admin bị hỏi mở ca dù
        // đã có ca đang mở.
        let latestShifts: Shift[] = shifts;
        try {
            const fresh = await api.getShifts();
            if (Array.isArray(fresh)) latestShifts = fresh;
        } catch {
            /* mất mạng: dùng tạm dữ liệu đang có */
        }

        const openShift = latestShifts.find(s => s.userId === user.id && s.status === 'OPEN');

        if (openShift) {
            setCurrentShift(openShift);
            localStorage.setItem('smartpos_shift', JSON.stringify(openShift));
            setView(user.role === 'ADMIN' ? 'ADMIN_DASHBOARD' : 'POS');
            void refresh();
            return;
        }

        // Chưa có ca mở
        if (user.role === 'ADMIN') {
            // Admin không bắt buộc phải mở ca: hỏi trước.
            const wantsShift = window.confirm(
                'Bạn có muốn mở ca làm việc không? (Nhấn OK để mở ca, Cancel để vào dashboard)'
            );
            if (wantsShift) setShowShiftModal('OPEN');
            else setView('ADMIN_DASHBOARD');
        } else {
            setShowShiftModal('OPEN');
        }
    };

    const handleLogoutRequest = () => {
        // Đang có ca mở thì phải kết ca trước; ngược lại chỉ cần đăng xuất.
        if (currentShift && currentShift.status === 'OPEN') {
            setShowShiftModal('CLOSE');
        } else {
            api.logout();
            setCurrentUser(null);
            localStorage.removeItem('smartpos_user');
            localStorage.removeItem('smartpos_shift');
            setView('POS');
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
            expectedCash: startCash,
            status: 'OPEN'
        };
        try {
            const created = await api.createShift(newShift);
            setCurrentShift(created);
            localStorage.setItem('smartpos_shift', JSON.stringify(created));
            setShowShiftModal(null);
            setView('POS');
            void refresh(); // đồng bộ danh sách ca cho máy khác thấy
        } catch (error) {
            console.error("Failed to open shift", error);
        }
    };

    const handleCloseShift = async (endCash: number) => {
        if (!currentShift) return;

        const expected = currentShift.startCash + currentShift.cashSales;
        const updatedShift: Shift = {
            ...currentShift,
            endTime: new Date().toISOString(),
            endCash: endCash,
            expectedCash: expected,
            status: 'CLOSED'
        };

        try {
            await api.updateShift(updatedShift);

            // Cleanup Session
            api.logout();
            setCurrentShift(null);
            setCurrentUser(null);
            localStorage.removeItem('smartpos_user');
            localStorage.removeItem('smartpos_shift');
            setShowShiftModal(null);
            setView('POS');
            void refresh();
        } catch (error) {
            console.error("Failed to close shift", error);
        }
    };

    // --- Core Business Logic ---
    const handleCheckout = async (payload: CheckoutPayload) => {
        // Staff phải có ca đang mở mới được bán
        if (!currentShift?.id) {
            throw new Error('Bạn phải mở ca làm việc trước khi bán hàng');
        }

        const newTx: Transaction = {
            id: payload.id,
            date: new Date().toISOString(),
            total: payload.total,
            paymentMethod: payload.paymentMethod,
            items: payload.items,
            shiftId: currentShift.id,
            cashierName: currentUser?.name,
            receivedAmount: payload.receivedAmount,
            changeAmount: payload.changeAmount
        };

        // Không bọc try/catch: để lỗi nổi lên POS, POS giữ nguyên giỏ hàng
        // và hiện thông báo. Trước đây lỗi bị nuốt nên app vẫn in hoá đơn
        // "thành công" dù DB không có giao dịch nào.
        const res = await api.createTransaction(newTx);
        if (res && typeof res === 'object' && 'error' in res) {
            throw new Error(String((res as { error: unknown }).error));
        }

        // Server đã trừ kho và cộng cashSales trong một batch.
        // Chỉ cần tải lại để lấy số thật — không tự đoán, không ghi đè.
        await refresh();

        if (currentShift && payload.paymentMethod === 'CASH') {
            // Hiện ngay con số ước tính cho mượt, lần polling sau sẽ sửa lại
            // bằng số chính xác từ server.
            const optimistic = {
                ...currentShift,
                cashSales: currentShift.cashSales + payload.total,
                expectedCash: currentShift.expectedCash + payload.total
            };
            setCurrentShift(optimistic);
            localStorage.setItem('smartpos_shift', JSON.stringify(optimistic));
        }
    };

    const handleAddProduct = async (newProduct: Product) => {
        try {
            await api.createProduct(newProduct);
            await refresh();
        } catch (error) {
            console.error("Failed to add product", error);
        }
    };

    const handleUpdateStock = async (productId: string, qtyToAdd: number) => {
        const product = products.find(p => p.id === productId);
        if (!product) return;
        const updated = { ...product, stock: product.stock + qtyToAdd };
        try {
            await api.updateProduct(updated);
            await refresh();
        } catch (error) {
            console.error("Failed to update stock", error);
        }
    };

    const handleUpdateProduct = async (updated: Product) => {
        // Không nuốt lỗi: form sửa sản phẩm cần biết khi server từ chối
        // (mất mạng, 401, 403) để hiện thông báo thay vì đóng form như đã lưu.
        await api.updateProduct(updated);
        await refresh();
    };

    /**
     * Xoá sản phẩm. Server chặn 409 nếu sản phẩm đã từng bán (giữ lịch sử
     * đối soát); khi đó ném lỗi lên UI để người dùng quyết định xoá cưỡng bức.
     */
    const handleDeleteProduct = async (id: string, force = false) => {
        const res = await api.deleteProduct(id, force);
        await refresh();
        return res;
    };

    const reloadProducts = async () => {
        await refresh();
    };

    // --- Render ---

    const { toast } = useToast();

    // Theo dõi trạng thái kết nối internet — hiện toast rõ ràng khi mất/mạng hồi phục.
    useEffect(() => {
      const handleOnline = () => {
        toast({
          type: 'success',
          title: 'Đã khôi phục kết nối',
          description: 'Dữ liệu sẽ tự đồng bộ lại trong giây lát.',
          duration: 4000,
        });
      };
      const handleOffline = () => {
        toast({
          type: 'error',
          title: 'Mất kết nối internet',
          description: 'Bạn vẫn có thể bán hàng, dữ liệu sẽ được đồng bộ khi mạng trở lại.',
          duration: 0,
          action: { label: 'Đóng', onClick: () => {} },
        });
      };

      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);

      // Kiểm tra ngay khi mount
      if (!navigator.onLine) {
        handleOffline();
      }

      return () => {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
      };
    }, [toast]);

    if (!currentUser) {
        return <Login users={users} onLogin={handleLogin} />;
    }

    return (
        <ToastProvider>
            <Layout
                currentView={view}
                onChangeView={setView}
                currentUser={currentUser}
                onLogout={handleLogoutRequest}
                syncing={refreshing}
                syncError={syncError}
                lastSync={lastSync}
                live={live}
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
                        onUpdateProduct={handleUpdateProduct}
                        onReloadProducts={reloadProducts}
                        onDeleteProduct={handleDeleteProduct}
                    />
                )}
                {view === 'TRANSACTIONS' && (
                    <Transactions
                        scope={currentUser.role === 'ADMIN' ? 'store' : 'shift'}
                        shiftId={currentUser.role === 'ADMIN' ? undefined : currentShift?.id}
                    />
                )}
                {view === 'ADMIN_DASHBOARD' && currentUser.role === 'ADMIN' && (
                    <AdminDashboard
                        shifts={shifts}
                        transactions={transactions}
                        stats={stats}
                        currentShift={currentShift}
                        onShiftClick={(shift) => setSummaryShift(shift)}
                    />
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

            {summaryShift && (
                <ShiftSummaryModal
                    shift={summaryShift}
                    transactions={transactions}
                    onClose={() => setSummaryShift(null)}
                />
            )}
        </ToastProvider>
    );
}

export default App;
