// Profile details + settings (change password, notification preferences, sign out).
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserRound, Settings, KeyRound, Bell, LogOut } from 'lucide-react';
import { Chips, Field, PageHeader } from '../../components/ui';
import PasswordInput from '../../components/ui/PasswordInput';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { changePassword, updateProfile } from '../../services/auth';
import { readPref, writePref } from '../../services/storage';
import { isEmail, isPhone, passwordIssue } from '../../utils/validation';
import { cx, fmtDate } from '../../utils/format';

function ProfileForm({ user, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: user.name, email: user.email, phone: user.phone || '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  async function save(e) {
    e.preventDefault();
    const errs = {};
    if (form.name.trim().length < 3) errs.name = 'Please enter your full name.';
    if (!isEmail(form.email)) errs.email = 'Enter a valid email.';
    if (!isPhone(form.phone)) errs.phone = 'Enter a valid 10-digit mobile number.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const updated = await updateProfile({ fullName: form.name.trim(), email: form.email.trim().toLowerCase(), phone: form.phone.trim() });
      onSaved(updated);
      toast.success('Profile updated.');
    } catch (err) {
      setErrors({ name: err.fields.fullName, email: err.fields.email, phone: err.fields.phone });
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  const initials = user.name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="card text-center">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-blue to-purple font-display text-2xl font-bold">{initials}</div>
        <p className="mt-4 text-lg font-semibold">{user.name}</p>
        <p className="text-sm text-muted">{user.email}</p>
        <p className="mt-3 text-xs text-muted">Member since {fmtDate(user.registeredAt)}</p>
        <p className="mt-1 text-xs text-muted">User ID: <span className="font-mono">{user.id}</span></p>
      </div>
      <form onSubmit={save} noValidate className="card space-y-4 lg:col-span-2">
        <h2 className="font-semibold">Personal details</h2>
        <Field label="Full name" error={errors.name}><input className={cx('input', errors.name && 'input-error')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Email" error={errors.email}><input className={cx('input', errors.email && 'input-error')} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="Phone" error={errors.phone}><input className={cx('input', errors.phone && 'input-error')} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
        </div>
        <div className="flex justify-end"><button className="btn-primary" disabled={busy}>{busy ? <span className="spinner" /> : 'Save changes'}</button></div>
      </form>
    </div>
  );
}

function SettingsPanel({ user }) {
  const toast = useToast();
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwErr, setPwErr] = useState({});
  const [busy, setBusy] = useState(false);
  // Display preferences only (harmless to keep in the browser).
  const [prefs, setPrefs] = useState(() => readPref(`notify_${user.id}`) || { matchReminders: true, newsDigest: false, showSampleContent: true });

  async function savePassword(e) {
    e.preventDefault();
    const errs = {};
    if (!pw.current) errs.current = 'Enter your current password.';
    const issue = passwordIssue(pw.next);
    if (issue) errs.next = issue;
    if (pw.next !== pw.confirm) errs.confirm = 'Passwords do not match.';
    setPwErr(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      await changePassword(pw.current, pw.next, pw.confirm);
      toast.success('Password changed. Other devices have been signed out.');
      setPw({ current: '', next: '', confirm: '' });
    } catch (err) {
      setPwErr({ current: err.fields.currentPassword || err.message, next: err.fields.newPassword });
    } finally {
      setBusy(false);
    }
  }

  function togglePref(k) {
    const next = { ...prefs, [k]: !prefs[k] };
    setPrefs(next);
    writePref(`notify_${user.id}`, next);
    toast.info('Preference saved on this device.');
  }

  async function signOut() {
    await logout();
    navigate('/login');
  }

  const PREFS = [['matchReminders', 'Show match start reminders'], ['newsDigest', 'Highlight news for my favourite sports'], ['showSampleContent', 'Show “Sample” labels on demo content']];

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <form onSubmit={savePassword} noValidate className="card space-y-4">
        <h2 className="flex items-center gap-2 font-semibold"><KeyRound className="h-4 w-4 text-blue" /> Change password</h2>
        <Field label="Current password" error={pwErr.current}><PasswordInput error={pwErr.current} autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
        <Field label="New password" error={pwErr.next}><PasswordInput error={pwErr.next} autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
        <Field label="Confirm new password" error={pwErr.confirm}><PasswordInput error={pwErr.confirm} autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></Field>
        <div className="flex justify-end"><button className="btn-primary" disabled={busy}>{busy ? <span className="spinner" /> : 'Update password'}</button></div>
      </form>
      <div className="space-y-5">
        <section className="card">
          <h2 className="mb-4 flex items-center gap-2 font-semibold"><Bell className="h-4 w-4 text-orange" /> Display preferences</h2>
          <ul className="space-y-3">
            {PREFS.map(([k, label]) => (
              <li key={k} className="flex items-center justify-between gap-4 text-sm">
                {label}
                <button type="button" role="switch" aria-checked={prefs[k]} onClick={() => togglePref(k)} className={cx('relative h-6 w-11 shrink-0 rounded-full transition-colors', prefs[k] ? 'bg-blue' : 'bg-white/10')}>
                  <span className={cx('absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all', prefs[k] ? 'left-[22px]' : 'left-0.5')} />
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] text-muted">Stored on this device only.</p>
        </section>
        <section className="card">
          <h2 className="flex items-center gap-2 font-semibold"><LogOut className="h-4 w-4 text-red" /> Sign out</h2>
          <p className="mt-2 text-sm text-muted">Ends your session on this device. Changing your password signs out every other device.</p>
          <button className="btn-ghost mt-4" onClick={signOut}>Log out</button>
        </section>
      </div>
    </div>
  );
}

export default function Profile({ tab = 'profile' }) {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  return (
    <>
      <PageHeader title={tab === 'settings' ? 'Settings' : 'Profile'} subtitle="Manage your account details and preferences." />
      <div className="mb-6"><Chips options={[{ value: 'profile', label: <span className="flex items-center gap-1.5"><UserRound className="h-3.5 w-3.5" />Profile</span> }, { value: 'settings', label: <span className="flex items-center gap-1.5"><Settings className="h-3.5 w-3.5" />Settings</span> }]} value={tab} onChange={(v) => navigate(v === 'settings' ? '/user/settings' : '/user/profile')} /></div>
      {tab === 'settings' ? <SettingsPanel user={user} /> : <ProfileForm user={user} onSaved={setUser} />}
    </>
  );
}
