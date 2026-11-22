import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: string;
  type: ToastType;
  title: string;
  description?: string;
  /** Thời gian tự biến tách (ms). 0 = hiển thị vĩnh viễn cho đến khi người dùng bấm đóng. */
  duration?: number;
  action?: { label: string; onClick: () => void };
}

interface ToastContextType {
  toast: (item: Omit<ToastItem, 'id'>) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

const ICONS: Record<ToastType, React.ComponentType<{ className?: string }>> = {
  success: () => <svg className="w-5 h-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>,
  error: () => <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>,
  warning: () => <svg className="w-5 h-5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
  info: () => <svg className="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
};

function ToastItemView({ toast: item, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  const bgByType: Record<ToastType, string> = {
    success: 'bg-green-50 border-green-200 text-green-900',
    error: 'bg-red-50 border-red-200 text-red-900',
    warning: 'bg-amber-50 border-amber-200 text-amber-900',
    info: 'bg-blue-50 border-blue-200 text-blue-900',
  };

  const Icon = ICONS[item.type];

  return (
    <div
      className={`flex items-start gap-3 px-3 py-2 rounded-lg border text-sm font-medium shadow-lg shadow-slate-900/10 ${bgByType[item.type]} animate-in slide-in-from-right duration-200`}
    >
      <Icon className="shrink-0 mt-0.5" />
      <div className="flex-1 leading-tight">
        <div className="font-semibold">{item.title}</div>
        {item.description && <div className="text-[11px] opacity-80 mt-0.5">{item.description}</div>}
      </div>
      {item.action && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            item.action.onClick();
            onDismiss();
          }}
          className="ml-2 shrink-0 text-[11px] font-bold underline decoration-dotted underline-offset-2 hover:opacity-80 transition-opacity"
        >
          {item.action.label}
        </button>
      )}
      <button
        onClick={onDismiss}
        className="ml-2 shrink-0 p-1 text-slate-400 hover:text-slate-600 rounded hover:bg-slate-100 transition-colors"
        aria-label="Đóng thông báo"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const toast = useCallback(
    (item: Omit<ToastItem, 'id'>) => {
      const id = Math.random().toString(36).slice(2, 9);
      setToasts((prev) => [...prev, { id, ...item }]);
      if (item.duration !== 0) {
        const ms = item.duration ?? 5000;
        setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t.id !== id));
        }, ms);
      }
    },
    []
  );

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const value = useMemo<ToastContextType>(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div key={t.id}>
            <ToastItemView toast={t} onDismiss={() => dismiss(t.id)} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function useToast(): ToastContextType {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}

export { useToast };
