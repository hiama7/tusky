// Separate admin login (demo credentials shown on screen).
import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import AuthLayout from '../../components/layout/AuthLayout';
import { DemoBanner, Field } from '../../components/ui';
import PasswordInput from '../../components/ui/PasswordInput';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { DEMO_ADMIN_LOGIN } from '../../data/demo/users';
import { validateLogin } from '../../utils/validation';
import { cx } from '../../utils/format';

export default function AdminLogin() {
  const { admin, adminLogin } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  if (admin && !busy) return <Navigate to="/admin/dashboard" replace />;

  async function submit(e) {
    e.preventDefault();
    const errs = validateLogin(form);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      await adminLogin(form);
      toast.success('Admin session started (demo).');
      navigate('/admin/dashboard', { replace: true });
    } catch (err) {
      setErrors({ form: err.message });
      setBusy(false);
    }
  }

  return (
    <AuthLayout admin title="Admin Console" subtitle="Restricted area for TUSKY administrators." points={['Manage matches, predictions & news', 'Track users, subscriptions & transactions', 'Revenue analytics with date filters']}>
      <DemoBanner className="mb-6">
        <b>Demo admin login — not secure.</b> Use <button type="button" className="underline" onClick={() => setForm(DEMO_ADMIN_LOGIN)}>{DEMO_ADMIN_LOGIN.email} / {DEMO_ADMIN_LOGIN.password}</button>. Real admin authentication (separate table, PHP session, rate limiting) comes in Stage 2.
      </DemoBanner>
      <form onSubmit={submit} noValidate className="space-y-4">
        {errors.form && <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red" role="alert">{errors.form}</p>}
        <Field label="Admin email" error={errors.email}>
          <input className={cx('input', errors.email && 'input-error')} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="admin@tusky.app" autoComplete="username" />
        </Field>
        <Field label="Password" error={errors.password}>
          <PasswordInput error={errors.password} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="current-password" />
        </Field>
        <button className="btn-primary btn-lg w-full" disabled={busy}>{busy ? <><span className="spinner" /> Verifying…</> : <><ShieldCheck className="h-4 w-4" /> Sign in to Admin</>}</button>
      </form>
    </AuthLayout>
  );
}
