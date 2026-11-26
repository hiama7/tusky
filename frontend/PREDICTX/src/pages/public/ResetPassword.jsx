// Password reset page, reached from the emailed link: #/reset-password?token=…
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import AuthLayout from '../../components/layout/AuthLayout';
import { Field } from '../../components/ui';
import PasswordInput from '../../components/ui/PasswordInput';
import { useToast } from '../../context/ToastContext';
import { resetPassword } from '../../services/auth';
import { passwordIssue } from '../../utils/validation';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const toast = useToast();
  const navigate = useNavigate();
  const [pw, setPw] = useState({ password: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    const errs = {};
    const issue = passwordIssue(pw.password);
    if (issue) errs.password = issue;
    if (pw.password !== pw.confirm) errs.confirm = 'Passwords do not match.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      await resetPassword(token, pw.password, pw.confirm);
      toast.success('Password updated. Please log in.', 'All set');
      navigate('/login', { replace: true });
    } catch (err) {
      setErrors({ form: err.message, password: err.fields.password });
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <AuthLayout title="Reset link missing" subtitle="Open the link from your email, or request a new one.">
        <Link to="/login" className="btn-primary w-full">Back to login</Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Choose a new password" subtitle="Your other devices will be signed out.">
      <form onSubmit={submit} noValidate className="space-y-4">
        {errors.form && <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red" role="alert">{errors.form}</p>}
        <Field label="New password" error={errors.password}>
          <PasswordInput error={errors.password} autoComplete="new-password" value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} />
        </Field>
        <Field label="Confirm new password" error={errors.confirm}>
          <PasswordInput error={errors.confirm} autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
        </Field>
        <button className="btn-primary btn-lg w-full" disabled={busy}>{busy ? <span className="spinner" /> : 'Update password'}</button>
      </form>
      <p className="mt-6 text-center text-sm text-muted"><Link to="/login" className="text-blue hover:underline">Back to login</Link></p>
    </AuthLayout>
  );
}
