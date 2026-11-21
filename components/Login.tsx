
import React, { useState } from 'react';
import { User } from '../types';
import { Lock, User as UserIcon, ChevronRight } from 'lucide-react';
import { api } from '../services/api';

interface LoginProps {
  users: User[];
  onLogin: (user: User) => void;
}

export const Login: React.FC<LoginProps> = ({ users, onLogin }) => {
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);

  const handleNumClick = (num: string) => {
    if (pin.length < 4) setPin(prev => prev + num);
    setError('');
  };

  const handleBackspace = () => {
    setPin(prev => prev.slice(0, -1));
  };

  // Keyboard Support
  React.useEffect(() => {
    if (!selectedUser) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Numbers 0-9
      if (/^[0-9]$/.test(e.key)) {
        if (pin.length < 4) {
          setPin(prev => prev.length < 4 ? prev + e.key : prev);
          setError('');
        }
      }
      // Backspace
      else if (e.key === 'Backspace') {
        setPin(prev => prev.slice(0, -1));
        setError('');
      }
      // Enter
      else if (e.key === 'Enter') {
        handleSubmit();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedUser, pin]);

  const handleSubmit = async () => {
    if (!selectedUser || checking) return;
    setChecking(true);
    setError('');
    try {
      // Xác thực ở server: PIN không còn được gửi xuống trình duyệt.
      const verified = await api.login(selectedUser.id, pin);
      onLogin(verified);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Mã PIN không đúng');
      setPin('');
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl flex overflow-hidden min-h-[500px]">

        {/* Left: User List */}
        <div className="w-1/2 border-r border-slate-100 bg-slate-50 p-8 flex flex-col">
          <h2 className="text-2xl font-bold text-slate-800 mb-6">Chọn nhân viên</h2>
          <div className="space-y-3 flex-1 overflow-y-auto">
            {users.map(user => (
              <button
                key={user.id}
                onClick={() => {
                  setSelectedUser(user);
                  setPin('');
                  setError('');
                }}
                className={`w-full p-4 rounded-xl flex items-center justify-between transition-all ${selectedUser?.id === user.id
                    ? 'bg-primary-600 text-white shadow-lg shadow-primary-600/20'
                    : 'bg-white text-slate-600 hover:bg-white hover:shadow-md border border-transparent hover:border-slate-200'
                  }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${selectedUser?.id === user.id ? 'bg-white/20' : 'bg-slate-100'}`}>
                    <UserIcon className="w-5 h-5" />
                  </div>
                  <div className="text-left">
                    <p className="font-bold">{user.name}</p>
                    <p className={`text-xs ${selectedUser?.id === user.id ? 'text-primary-100' : 'text-slate-400'}`}>{user.role}</p>
                  </div>
                </div>
                {selectedUser?.id === user.id && <ChevronRight className="w-5 h-5" />}
              </button>
            ))}
          </div>
        </div>

        {/* Right: PIN Entry */}
        <div className="w-1/2 p-8 flex flex-col items-center justify-center bg-white relative">
          {!selectedUser ? (
            <div className="text-center text-slate-400">
              <Lock className="w-16 h-16 mx-auto mb-4 opacity-20" />
              <p>Vui lòng chọn nhân viên bên trái</p>
            </div>
          ) : (
            <div className="w-full max-w-xs">
              <div className="text-center mb-8">
                <h3 className="text-xl font-bold text-slate-800">Xin chào, {selectedUser.name}</h3>
                <p className="text-slate-500 text-sm">Nhập mã PIN để bắt đầu ca làm việc</p>
              </div>

              <div className="flex justify-center gap-4 mb-8">
                {[...Array(4)].map((_, i) => (
                  <div
                    key={i}
                    className={`w-4 h-4 rounded-full transition-all ${i < pin.length ? 'bg-primary-600 scale-110' : 'bg-slate-200'
                      }`}
                  />
                ))}
              </div>

              {error && <p className="text-red-500 text-center text-sm mb-4 font-medium animate-pulse">{error}</p>}

              <div className="grid grid-cols-3 gap-4">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
                  <button
                    key={num}
                    onClick={() => handleNumClick(num.toString())}
                    className="h-14 rounded-xl bg-slate-50 hover:bg-slate-100 text-xl font-bold text-slate-700 transition-colors"
                  >
                    {num}
                  </button>
                ))}
                <button onClick={() => setPin('')} className="h-14 rounded-xl text-slate-400 hover:text-slate-600 font-medium">Clear</button>
                <button onClick={() => handleNumClick('0')} className="h-14 rounded-xl bg-slate-50 hover:bg-slate-100 text-xl font-bold text-slate-700">0</button>
                <button onClick={handleBackspace} className="h-14 rounded-xl text-slate-400 hover:text-slate-600 font-medium">⌫</button>
              </div>

              <button
                onClick={handleSubmit}
                disabled={pin.length !== 4}
                className="w-full mt-8 py-3 bg-primary-600 hover:bg-primary-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white rounded-xl font-bold shadow-lg shadow-primary-600/20 transition-all active:scale-95"
              >
                Đăng Nhập
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
