
import React from 'react';
import { LayoutDashboard, ShoppingCart, Package, History, LogOut, User as UserIcon, ShieldCheck, Users } from 'lucide-react';
import { ViewState, User } from '../types';

interface LayoutProps {
  currentView: ViewState;
  currentUser: User | null;
  onChangeView: (view: ViewState) => void;
  onLogout: () => void;
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
    className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-all duration-200 ${
      active 
        ? 'bg-primary-600 text-white shadow-md' 
        : 'text-slate-500 hover:bg-slate-100 hover:text-primary-600'
    }`}
  >
    <Icon className="w-5 h-5" />
    <span className="font-medium">{label}</span>
  </button>
);

export const Layout: React.FC<LayoutProps> = ({ currentView, currentUser, onChangeView, onLogout, children }) => {
  const isAdmin = currentUser?.role === 'ADMIN';

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-slate-200 flex flex-col shadow-lg z-10">
        <div className="p-6 border-b border-slate-100 flex items-center space-x-2">
          <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center">
            <LayoutDashboard className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-xl font-bold text-slate-800 tracking-tight">POS Simple</h1>
        </div>

        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
          {/* Common Menu */}
          <NavItem 
            active={currentView === 'POS'} 
            icon={ShoppingCart} 
            label="Bán Hàng (POS)" 
            onClick={() => onChangeView('POS')} 
          />
          
          {/* Admin Only Menu */}
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

          {/* Staff specific items if needed */}
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
      <main className="flex-1 overflow-auto relative flex flex-col">
         {/* Mobile Header Placeholder (hidden on desktop) */}
        <header className="md:hidden h-14 bg-white border-b flex items-center px-4">
           <span className="font-bold">POS Simple</span>
        </header>
        <div className="flex-1 p-6">
          {children}
        </div>
      </main>
    </div>
  );
};
