// Demo registration with full client-side validation.
import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import AuthLayout from '../../components/layout/AuthLayout';
import { Field } from '../../components/ui';
import PasswordInput from '../../components/ui/PasswordInput';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { passwordStrength, validateRegister } from '../../utils/validation';
import { cx } from '../../utils/format';

const STRENGTH = [
  { label: 'Too weak', color: 'bg-red' },
  { label: 'Weak', color: 'bg-red' },
  { label: 'Fair', color: 'bg-orange' },
  { label: 'Good', color: 'bg-brand' },
  { label: 'Strong', color: 'bg-green' },
];

export default function Register() {
  const { user, register } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', confirm: '', terms: false });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/user/dashboard" replace />;

  const set = (k) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [k]: value }));
    if (errors[k]) setErrors((er) => ({ ...er, [k]: undefined }));
  };

  async function submit(e) {
    e.preventDefault();
    const errs = validateRegister(form);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      await register(form);
      toast.success('Account created. Please log in to continue.', 'Registration complete');
      navigate('/login', { state: { email: form.email } });
    } catch (err) {
      // Map server field names back to this form's fields.
      const f = err.fields || {};
      setErrors({ form: err.message, name: f.fullName, email: f.email, phone: f.phone, password: f.password, confirm: f.confirmPassword });
      setBusy(false);
    }
  }

  const strength = passwordStrength(form.password);

  return (
    <AuthLayout title="Create your account" subtitle="Join TUSKY and get your first prediction free.">
      <form onSubmit={submit} noValidate className="space-y-4">
        {errors.form && <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red" role="alert">{errors.form}</p>}
        <Field label="Full Name" error={errors.name}>
          <input className={cx('input', errors.name && 'input-error')} autoComplete="name" value={form.name} onChange={set('name')} placeholder="Your full name" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Email" error={errors.email}>
            <input className={cx('input', errors.email && 'input-error')} type="email" autoComplete="email" value={form.email} onChange={set('email')} placeholder="you@example.com" />
          </Field>
          <Field label="Phone Number" error={errors.phone}>
            <input className={cx('input', errors.phone && 'input-error')} type="tel" autoComplete="tel" value={form.phone} onChange={set('phone')} placeholder="98765 43210" />
          </Field>
        </div>
        <Field label="Password" error={errors.password}>
          <PasswordInput error={errors.password} autoComplete="new-password" value={form.password} onChange={set('password')} placeholder="At least 8 characters" />
          {form.password && (
            <div className="mt-2 flex items-center gap-2">
              <div className="flex flex-1 gap-1">{[0, 1, 2, 3].map((i) => <span key={i} className={cx('h-1 flex-1 rounded-full transition-colors', i < strength ? STRENGTH[strength].color : 'bg-white/10')} />)}</div>
              <span className="text-[11px] text-muted">{STRENGTH[strength].label}</span>
            </div>
          )}
        </Field>
        <Field label="Confirm Password" error={errors.confirm}>
          <PasswordInput error={errors.confirm} autoComplete="new-password" value={form.confirm} onChange={set('confirm')} placeholder="Repeat password" />
        </Field>
        <Field error={errors.terms}>
          <label className="flex items-start gap-2 text-sm text-muted"><input type="checkbox" checked={form.terms} onChange={set('terms')} className="mt-1 accent-brand" /> <span>I am 18 or older, I agree to the <a href="#/terms" target="_blank" rel="noopener" className="text-brand underline">Terms of Use</a> and <a href="#/privacy" target="_blank" rel="noopener" className="text-brand underline">Privacy Policy</a>, and I understand predictions are estimates, not guarantees.</span></label>
        </Field>
        <button className="btn-primary btn-lg w-full" disabled={busy}>{busy ? <><span className="spinner" /> Creating account…</> : 'Register'}</button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">Already have an account? <Link to="/login" className="font-medium text-brand hover:underline">Login</Link></p>
    </AuthLayout>
  );
}
