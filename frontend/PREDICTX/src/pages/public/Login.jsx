// Demo login. NOT secure — credentials are checked against data in this browser.
import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import AuthLayout from '../../components/layout/AuthLayout';
import { DemoBanner, Field, Modal } from '../../components/ui';
import PasswordInput from '../../components/ui/PasswordInput';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { forgotPassword } from '../../services/auth';
import { DEMO_USER_LOGIN } from '../../data/demo/users';
import { isEmail, validateLogin } from '../../utils/validation';
import { cx } from '../../utils/format';

export default function Login() {
  const { user, login } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: location.state?.email || '', password: '', remember: true });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState('');

  if (user && !busy) return <Navigate to="/user/dashboard" replace />;

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  async function submit(e) {
    e.preventDefault();
    const errs = validateLogin(form);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      await login(form);
      toast.success('Welcome back! (demo session)', 'Logged in');
      navigate(location.state?.from || '/user/dashboard', { replace: true });
    } catch (err) {
      setErrors({ form: err.message });
      setBusy(false);
    }
  }

  async function sendReset() {
    if (!isEmail(resetEmail)) return toast.error('Enter a valid email address.');
    const res = await forgotPassword(resetEmail);
    toast.info(res.message, 'Password reset');
    setForgotOpen(false);
  }

  return (
    <AuthLayout title="Welcome back" subtitle="Log in to view your predictions and purchases.">
      <DemoBanner className="mb-6">
        <b>Demo login only — not secure.</b> Use <button type="button" className="underline" onClick={() => setForm((f) => ({ ...f, ...DEMO_USER_LOGIN }))}>the demo account</button> ({DEMO_USER_LOGIN.email} / {DEMO_USER_LOGIN.password}) or one you registered in this browser.
      </DemoBanner>
      <form onSubmit={submit} noValidate className="space-y-4">
        {errors.form && <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red" role="alert">{errors.form}</p>}
        <Field label="Email" error={errors.email}>
          <input className={cx('input', errors.email && 'input-error')} type="email" autoComplete="email" value={form.email} onChange={set('email')} placeholder="you@example.com" />
        </Field>
        <Field label="Password" error={errors.password}>
          <PasswordInput error={errors.password} autoComplete="current-password" value={form.password} onChange={set('password')} placeholder="••••••••" />
        </Field>
        <div className="flex items-center justify-between text-sm">
          <label className="flex items-center gap-2 text-muted"><input type="checkbox" checked={form.remember} onChange={set('remember')} className="accent-blue" /> Remember me</label>
          <button type="button" className="text-blue hover:underline" onClick={() => { setResetEmail(form.email); setForgotOpen(true); }}>Forgot password?</button>
        </div>
        <button className="btn-primary btn-lg w-full" disabled={busy}>{busy ? <><span className="spinner" /> Signing in…</> : 'Login'}</button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">New to TUSKY? <Link to="/register" className="font-medium text-blue hover:underline">Create Account</Link></p>
      <p className="mt-2 text-center text-xs text-muted">Administrator? <Link to="/admin/login" className="hover:text-white">Admin login</Link></p>

      <Modal open={forgotOpen} onClose={() => setForgotOpen(false)} title="Reset password" size="sm"
        footer={<><button className="btn-ghost" onClick={() => setForgotOpen(false)}>Cancel</button><button className="btn-primary" onClick={sendReset}>Send reset link</button></>}>
        <p className="mb-4 text-sm text-muted">Enter your email and we’ll send a reset link. (Demo: no email is sent in Stage 1.)</p>
        <input className="input" type="email" value={resetEmail} onChange={(e) => setResetEmail(e.target.value)} placeholder="you@example.com" aria-label="Email for password reset" />
      </Modal>
    </AuthLayout>
  );
}
