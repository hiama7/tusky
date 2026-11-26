// Notification popups (toasts). Usage: const toast = useToast(); toast.success('Saved');
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { CheckCircle2, Info, AlertTriangle, XCircle, X } from 'lucide-react';

const ToastContext = createContext(null);

const STYLES = {
  success: { icon: CheckCircle2, color: 'text-green', bar: 'bg-green' },
  info: { icon: Info, color: 'text-brand', bar: 'bg-brand' },
  warning: { icon: AlertTriangle, color: 'text-orange', bar: 'bg-orange' },
  error: { icon: XCircle, color: 'text-red', bar: 'bg-red' },
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const push = useCallback((type, message, title) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t.slice(-3), { id, type, message, title }]);
    setTimeout(() => dismiss(id), 4200);
  }, [dismiss]);

  const api = useMemo(() => ({
    success: (m, t) => push('success', m, t),
    info: (m, t) => push('info', m, t),
    warning: (m, t) => push('warning', m, t),
    error: (m, t) => push('error', m, t),
  }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2" aria-live="polite">
        {toasts.map((t) => {
          const s = STYLES[t.type];
          const Icon = s.icon;
          return (
            <div key={t.id} className="glass relative flex items-start gap-3 overflow-hidden p-4 shadow-2xl" style={{ animation: 'toast-in .3s ease both' }} role="status">
              <span className={`absolute left-0 top-0 h-full w-1 ${s.bar}`} />
              <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${s.color}`} />
              <div className="min-w-0 flex-1">
                {t.title && <p className="text-sm font-semibold">{t.title}</p>}
                <p className="text-sm text-muted">{t.message}</p>
              </div>
              <button onClick={() => dismiss(t.id)} className="text-muted hover:text-white" aria-label="Dismiss notification"><X className="h-4 w-4" /></button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
