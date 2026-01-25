
import React, { useState } from 'react';
import { User } from '../types';
import { Users, Plus, Trash2, Key, Shield, User as UserIcon, Save, X, Pencil } from 'lucide-react';

interface EmployeeManagementProps {
  users: User[];
  onAddUser: (user: User) => void;
  onUpdateUser: (user: User) => void;
  onDeleteUser: (id: string) => void;
}

export const EmployeeManagement: React.FC<EmployeeManagementProps> = ({ users, onAddUser, onUpdateUser, onDeleteUser }) => {
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  
  const [formData, setFormData] = useState<Partial<User>>({
    name: '',
    pin: '',
    role: 'STAFF'
  });

  const openAddModal = () => {
    setEditingId(null);
    setFormData({ name: '', pin: '', role: 'STAFF' });
    setShowModal(true);
  };

  const openEditModal = (user: User) => {
    setEditingId(user.id);
    setFormData({
        name: user.name,
        pin: user.pin,
        role: user.role
    });
    setShowModal(true);
  };

  const handleSave = () => {
    if (!formData.name || !formData.pin || formData.pin.length !== 4) {
      alert("Vui lòng nhập tên và mã PIN 4 số");
      return;
    }

    if (editingId) {
        // Update existing
        onUpdateUser({
            id: editingId,
            name: formData.name,
            role: formData.role as 'ADMIN' | 'STAFF',
            pin: formData.pin
        });
    } else {
        // Create new
        const user: User = {
            id: Math.random().toString(36).substr(2, 9),
            name: formData.name,
            role: formData.role as 'ADMIN' | 'STAFF',
            pin: formData.pin
        };
        onAddUser(user);
    }

    setShowModal(false);
    setFormData({ name: '', pin: '', role: 'STAFF' });
    setEditingId(null);
  };

  return (
    <div className="h-full flex flex-col bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      {/* Header */}
      <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-white">
        <div>
           <h2 className="text-2xl font-bold text-slate-800 tracking-tight">Quản lý Nhân sự</h2>
           <p className="text-slate-500 text-sm mt-1">Thêm, sửa, xóa nhân viên và mã PIN</p>
        </div>
        <button 
          onClick={openAddModal}
          className="bg-slate-900 hover:bg-slate-800 text-white px-5 py-2.5 rounded-xl shadow-lg shadow-slate-900/20 flex items-center gap-2 text-sm font-semibold transition-all active:scale-95"
        >
          <Plus className="w-5 h-5" />
          Thêm Nhân viên
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-auto bg-slate-50/50 p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {users.map(user => (
            <div key={user.id} className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-all group relative">
              
              <div className="flex justify-between items-start mb-4">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center ${user.role === 'ADMIN' ? 'bg-purple-100 text-purple-600' : 'bg-blue-100 text-blue-600'}`}>
                  {user.role === 'ADMIN' ? <Shield className="w-6 h-6" /> : <UserIcon className="w-6 h-6" />}
                </div>
                
                <div className="flex gap-1">
                    <button 
                        onClick={() => openEditModal(user)}
                        className="text-slate-400 hover:text-primary-600 p-2 hover:bg-primary-50 rounded-lg transition-colors"
                        title="Chỉnh sửa"
                    >
                        <Pencil className="w-4 h-4" />
                    </button>
                    {user.role !== 'ADMIN' && (
                    <button 
                        onClick={() => {
                            if(confirm('Bạn có chắc muốn xóa nhân viên này?')) onDeleteUser(user.id);
                        }}
                        className="text-slate-400 hover:text-red-500 p-2 hover:bg-red-50 rounded-lg transition-colors"
                        title="Xóa"
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>
                    )}
                </div>
              </div>
              
              <h3 className="font-bold text-slate-800 text-lg">{user.name}</h3>
              <p className="text-sm text-slate-500 font-medium mb-4">{user.role}</p>
              
              <div className="bg-slate-50 rounded-lg p-3 flex items-center justify-between border border-slate-100">
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <Key className="w-4 h-4 text-slate-400" />
                  <span>Mã PIN</span>
                </div>
                <span className="font-mono font-bold text-slate-800 tracking-widest">{user.pin}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-slate-900/40 z-50 flex items-center justify-center backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl animate-in zoom-in-95 duration-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center">
              <h3 className="font-bold text-lg text-slate-800">{editingId ? 'Chỉnh sửa thông tin' : 'Thêm nhân viên mới'}</h3>
              <button onClick={() => setShowModal(false)}><X className="w-5 h-5 text-slate-400 hover:text-red-500" /></button>
            </div>
            
            <div className="p-6 space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-slate-700">Họ và tên</label>
                <input 
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-primary-500 outline-none"
                  placeholder="Ví dụ: Nguyễn Văn A"
                  value={formData.name}
                  onChange={e => setFormData({...formData, name: e.target.value})}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-slate-700">Vai trò</label>
                <div className="grid grid-cols-2 gap-3">
                  <button 
                    onClick={() => setFormData({...formData, role: 'STAFF'})}
                    className={`py-3 rounded-xl border font-semibold text-sm flex items-center justify-center gap-2 ${formData.role === 'STAFF' ? 'bg-blue-50 border-blue-200 text-blue-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                  >
                    <UserIcon className="w-4 h-4" /> Nhân viên
                  </button>
                  <button 
                    onClick={() => setFormData({...formData, role: 'ADMIN'})}
                    className={`py-3 rounded-xl border font-semibold text-sm flex items-center justify-center gap-2 ${formData.role === 'ADMIN' ? 'bg-purple-50 border-purple-200 text-purple-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                  >
                    <Shield className="w-4 h-4" /> Quản lý
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-slate-700">Mã PIN (4 số)</label>
                <input 
                  type="text"
                  maxLength={4}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-primary-500 outline-none font-mono tracking-widest text-lg"
                  placeholder="0000"
                  value={formData.pin}
                  onChange={e => setFormData({...formData, pin: e.target.value.replace(/[^0-9]/g, '')})}
                />
              </div>

              <button 
                onClick={handleSave}
                className="w-full mt-4 py-3 bg-slate-900 text-white rounded-xl font-bold shadow-lg shadow-slate-900/20 hover:bg-slate-800 active:scale-95 transition-all flex items-center justify-center gap-2"
              >
                <Save className="w-4 h-4" /> {editingId ? 'Cập nhật' : 'Lưu Nhân Viên'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
