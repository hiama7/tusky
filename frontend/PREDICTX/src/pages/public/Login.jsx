// User login (real authentication against the API).
import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import AuthLayout from '../../components/layout/AuthLayout';
import { Field, Modal } from '../../components/ui';
import PasswordInput from '../../components/ui/PasswordInput';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { forgotPassword } from '../../services/auth';
import { isEmail, validateLogin } from '../../utils/validation';
import { cx } from '../../utils/format';

export default function Login() {
  const { user, ready, login } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: location.state?.email || '', password: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetBusy, setResetBusy] = useState(false);

  if (ready && user && !busy) return <Navigate to="/user/dashboard" replace />;

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    const errs = validateLogin(form);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      await login(form);
      toast.success('Welcome back!', 'Logged in');
      navigate(location.state?.from || '/user/dashboard', { replace: true });
    } catch (err) {
      setErrors({ form: err.message, ...err.fields });
      setBusy(false);
    }
  }

  async function sendReset() {
    if (!isEmail(resetEmail)) return toast.error('Enter a valid email address.');
    setResetBusy(true);
    try {
      await forgotPassword(resetEmail);
      toast.info('If an account exists for that email, a reset link is on its way.', 'Check your inbox');
      setForgotOpen(false);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setResetBusy(false);
    }
  }

  return (
    <AuthLayout title="Welcome back" subtitle="Log in to view your predictions and purchases.">
      <form onSubmit={submit} noValidate className="space-y-4">
        {errors.form && <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red" role="alert">{errors.form}</p>}
        <Field label="Email" error={errors.email}>
          <input className={cx('input', errors.email && 'input-error')} type="email" autoComplete="email" value={form.email} onChange={set('email')} placeholder="you@example.com" />
        </Field>
        <Field label="Password" error={errors.password}>
          <PasswordInput error={errors.password} autoComplete="current-password" value={form.password} onChange={set('password')} placeholder="••••••••" />
        </Field>
        <div className="flex items-center justify-end text-sm">
          <button type="button" className="text-brand hover:underline" onClick={() => { setResetEmail(form.email); setForgotOpen(true); }}>Forgot password?</button>
        </div>
        <button className="btn-primary btn-lg w-full" disabled={busy}>{busy ? <><span className="spinner" /> Signing in…</> : 'Login'}</button>
        <p className="text-center text-[11px] text-muted">You stay signed in on this device for up to 7 days. Log out on shared computers.</p>
      </form>
      <p className="mt-6 text-center text-sm text-muted">New to TUSKY? <Link to="/register" className="font-medium text-brand hover:underline">Create Account</Link></p>
      <p className="mt-2 text-center text-xs text-muted">Administrator? <Link to="/admin/login" className="hover:text-white">Admin login</Link></p>

      <Modal open={forgotOpen} onClose={() => setForgotOpen(false)} title="Reset password" size="sm"
        footer={<><button className="btn-ghost" onClick={() => setForgotOpen(false)}>Cancel</button><button className="btn-primary" onClick={sendReset} disabled={resetBusy}>{resetBusy ? <span className="spinner" /> : 'Send reset link'}</button></>}>
        <p className="mb-4 text-sm text-muted">Enter your account email and we’ll send a link to choose a new password. The link is valid for 30 minutes.</p>
        <input className="input" type="email" value={resetEmail} onChange={(e) => setResetEmail(e.target.value)} placeholder="you@example.com" aria-label="Email for password reset" />
      </Modal>
    </AuthLayout>
  );
}
