// Separate admin login. Only accounts with role ADMIN can start an admin session.
import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import AuthLayout from '../../components/layout/AuthLayout';
import { Field } from '../../components/ui';
import PasswordInput from '../../components/ui/PasswordInput';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { validateLogin } from '../../utils/validation';
import { cx } from '../../utils/format';

export default function AdminLogin() {
  const { admin, ready, adminLogin } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [needsCode, setNeedsCode] = useState(false);
  const [code, setCode] = useState('');

  if (ready && admin && !busy) return <Navigate to="/admin/dashboard" replace />;

  async function submit(e) {
    e.preventDefault();
    const errs = validateLogin(form);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      await adminLogin({ ...form, code: code.trim() });
      toast.success('Admin session started.');
      navigate('/admin/dashboard', { replace: true });
    } catch (err) {
      // the server asks for a code only once the password is right
      if (err.fields.code) {
        setErrors(needsCode ? { code: err.fields.code } : {});
        setNeedsCode(true);
        setCode('');
      } else setErrors({ form: err.message });
      setBusy(false);
    }
  }

  return (
    <AuthLayout admin title="Admin Console" subtitle="Restricted area for TUSKY administrators." points={['Manage matches, predictions & news', 'Track users, subscriptions & transactions', 'Revenue analytics with date filters']}>
      <form onSubmit={submit} noValidate className="space-y-4">
        {errors.form && <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red" role="alert">{errors.form}</p>}
        <Field label="Admin email" error={errors.email}>
          <input className={cx('input', errors.email && 'input-error')} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="admin@yourdomain.com" autoComplete="username" />
        </Field>
        <Field label="Password" error={errors.password}>
          <PasswordInput error={errors.password} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="current-password" />
        </Field>
        {needsCode && (
          <Field label="Authentication code" error={errors.code} hint="6 digits from your authenticator app, or a recovery code.">
            <input className={cx('input', errors.code && 'input-error')} value={code} onChange={(e) => setCode(e.target.value)} inputMode="text" autoComplete="one-time-code" autoFocus maxLength={20} />
          </Field>
        )}
        <button className="btn-primary btn-lg w-full" disabled={busy}>{busy ? <><span className="spinner" /> Verifying…</> : <><ShieldCheck className="h-4 w-4" /> Sign in to Admin</>}</button>
      </form>
    </AuthLayout>
  );
}
