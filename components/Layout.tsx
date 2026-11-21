
import React from 'react';
import {
  LayoutDashboard, ShoppingCart, Package, History, LogOut,
  User as UserIcon, ShieldCheck, Users
} from 'lucide-react';
import { ViewState, User } from '../types';
import { SyncStatus } from './SyncStatus';

interface LayoutProps {
  currentView: ViewState;
  currentUser: User | null;
  onChangeView: (view: ViewState) => void;
  onLogout: () => void;
  /** Trạng thái đồng bộ dữ liệu, hiện ở header điện thoại. */
  syncing?: boolean;
  syncError?: string | null;
  lastSync?: Date | null;
  /** WebSocket đang kết nối. */
  live?: boolean;
  children: React.ReactNode;
}

const NavItem = ({
  active,
  icon: Icon,
  label,
  onClick
}: {
  active: boolean;
  icon: React.ElementType;
  label: string;
  onClick: () => void;
}) => (
  <button
    onClick={onClick}
    className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-all duration-200 ${active
      ? 'bg-primary-600 text-white shadow-md'
      : 'text-slate-500 hover:bg-slate-100 hover:text-primary-600'
      }`}
  >
    <Icon className="w-5 h-5" />
    <span className="font-medium">{label}</span>
  </button>
);

/** Một tab ở thanh điều hướng đáy (chỉ hiện trên điện thoại). */
const TabItem = ({
  active,
  icon: Icon,
  label,
  onClick
}: {
  active: boolean;
  icon: React.ElementType;
  label: string;
  onClick: () => void;
}) => (
  <button
    onClick={onClick}
    aria-current={active ? 'page' : undefined}
    className={`flex-1 min-h-[56px] flex flex-col items-center justify-center gap-0.5 px-1 transition-colors ${active ? 'text-primary-600' : 'text-slate-500 active:text-slate-700'
      }`}
  >
    <Icon className={`w-5 h-5 ${active ? 'stroke-[2.4]' : ''}`} />
    <span className={`text-[11px] leading-tight text-center ${active ? 'font-bold' : 'font-medium'}`}>
      {label}
    </span>
  </button>
);

export const Layout: React.FC<LayoutProps> = ({
  currentView, currentUser, onChangeView, onLogout,
  syncing = false, syncError = null, lastSync = null, live = false, children,
}) => {
  const isAdmin = currentUser?.role === 'ADMIN';

  return (
    // 100dvh thay cho h-screen: thanh địa chỉ của trình duyệt di động co giãn
    // làm h-screen bị cắt mất phần đáy.
    <div className="flex h-[100dvh] bg-slate-50 overflow-hidden">

      {/* Sidebar — chỉ hiện từ màn hình md trở lên.
          Trước đây w-64 (256px) luôn hiện, trên máy 360px chỉ còn 104px cho nội dung. */}
      <aside className="hidden md:flex w-64 bg-white border-r border-slate-200 flex-col shadow-lg z-10 shrink-0">
        <div className="p-6 border-b border-slate-100 flex items-center space-x-2">
          <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center">
            <LayoutDashboard className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-xl font-bold text-slate-800 tracking-tight">ZGO POS</h1>
        </div>

        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
          <NavItem
            active={currentView === 'POS'}
            icon={ShoppingCart}
            label="Bán Hàng (POS)"
            onClick={() => onChangeView('POS')}
          />

          {isAdmin && (
            <>
              <div className="pt-4 pb-2 px-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Quản Trị</div>
              <NavItem
                active={currentView === 'ADMIN_DASHBOARD'}
                icon={ShieldCheck}
                label="Báo cáo & Ca làm"
                onClick={() => onChangeView('ADMIN_DASHBOARD')}
              />
              <NavItem
                active={currentView === 'EMPLOYEE_MANAGEMENT'}
                icon={Users}
                label="Quản lý Nhân sự"
                onClick={() => onChangeView('EMPLOYEE_MANAGEMENT')}
              />
              <NavItem
                active={currentView === 'INVENTORY'}
                icon={Package}
                label="Quản lý Kho"
                onClick={() => onChangeView('INVENTORY')}
              />
              <NavItem
                active={currentView === 'TRANSACTIONS'}
                icon={History}
                label="Tất cả Giao Dịch"
                onClick={() => onChangeView('TRANSACTIONS')}
              />
            </>
          )}

          {!isAdmin && (
            <NavItem
              active={currentView === 'TRANSACTIONS'}
              icon={History}
              label="Lịch sử Ca này"
              onClick={() => onChangeView('TRANSACTIONS')}
            />
          )}
        </nav>

        {/* User Profile & Logout */}
        <div className="p-4 border-t border-slate-100 bg-slate-50">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center border-2 border-white shadow-sm">
              <UserIcon className="w-5 h-5 text-slate-500" />
            </div>
            <div className="overflow-hidden">
              <p className="text-sm font-bold text-slate-800 truncate">{currentUser?.name}</p>
              <div className="flex items-center gap-1">
                <span className={`w-2 h-2 rounded-full ${isAdmin ? 'bg-purple-500' : 'bg-blue-500'}`}></span>
                <p className="text-xs text-slate-500 truncate font-medium">{currentUser?.role}</p>
              </div>
            </div>
          </div>

          <button
            onClick={onLogout}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-red-100 bg-red-50 text-red-600 hover:bg-red-100 hover:border-red-200 text-sm font-semibold transition-all"
          >
            <LogOut className="w-4 h-4" /> {isAdmin ? 'Đăng Xuất' : 'Kết Thúc Ca'}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden relative">
        {/* Thanh trên cùng — chỉ hiện trên điện thoại, thay cho sidebar */}
        <header className="md:hidden shrink-0 bg-white border-b border-slate-200 px-3 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-primary-600 rounded-lg flex items-center justify-center">
              <LayoutDashboard className="w-4 h-4 text-white" />
            </div>
            <div className="leading-tight">
              <p className="text-sm font-bold text-slate-800">{currentUser?.name}</p>
              <p className="text-[10px] text-slate-500 font-medium">{isAdmin ? 'Quản trị' : 'Nhân viên'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <SyncStatus refreshing={syncing} error={syncError} lastSync={lastSync} live={live} />
            <button
              onClick={onLogout}
              className="flex items-center gap-1.5 min-h-[44px] px-3 py-2 rounded-lg border border-red-100 bg-red-50 text-red-600 text-xs font-semibold active:scale-95 transition-all"
            >
              <LogOut className="w-3.5 h-3.5" /> {isAdmin ? 'Đăng xuất' : 'Kết ca'}
            </button>
          </div>
        </header>

        {/* Vùng nội dung: chừa chỗ cho thanh tab đáy cố định */}
        <div className="flex-1 min-h-0 overflow-auto p-2 pb-[calc(64px+env(safe-area-inset-bottom))] md:p-6 md:pb-6">
          {children}
        </div>

        {/* Thanh điều hướng đáy — cố định, z-40 để luôn nằm trên thanh giỏ (z-30) */}
        <nav className="md:hidden fixed inset-x-0 bottom-0 z-40 bg-white border-t border-slate-200 shadow-[0_-2px_10px_rgba(0,0,0,0.06)] pb-[env(safe-area-inset-bottom)]">
          <div className="flex items-stretch">
            <TabItem
              active={currentView === 'POS'}
              icon={ShoppingCart}
              label="Bán hàng"
              onClick={() => onChangeView('POS')}
            />
            {isAdmin && (
              <TabItem
                active={currentView === 'INVENTORY'}
                icon={Package}
                label="Kho"
                onClick={() => onChangeView('INVENTORY')}
              />
            )}
            <TabItem
              active={currentView === 'TRANSACTIONS'}
              icon={History}
              label={isAdmin ? 'Giao dịch' : 'Ca này'}
              onClick={() => onChangeView('TRANSACTIONS')}
            />
            {isAdmin && (
              <TabItem
                active={currentView === 'ADMIN_DASHBOARD'}
                icon={ShieldCheck}
                label="Báo cáo"
                onClick={() => onChangeView('ADMIN_DASHBOARD')}
              />
            )}
            {isAdmin && (
              <TabItem
                active={currentView === 'EMPLOYEE_MANAGEMENT'}
                icon={Users}
                label="Nhân sự"
                onClick={() => onChangeView('EMPLOYEE_MANAGEMENT')}
              />
            )}
          </div>
        </nav>
      </main>
    </div>
  );
};
