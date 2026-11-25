// Profile details + settings (password, preferences, reset demo data).
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserRound, Settings, KeyRound, Trash2, Bell } from 'lucide-react';
import { Chips, DemoBanner, Field, Modal, PageHeader } from '../../components/ui';
import PasswordInput from '../../components/ui/PasswordInput';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { changePassword, updateProfile } from '../../services/auth';
import { read, resetDemo, write } from '../../services/storage';
import { isEmail, isPhone, passwordIssue } from '../../utils/validation';
import { cx, fmtDate } from '../../utils/format';

function ProfileForm({ user }) {
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
    await updateProfile(user.id, { name: form.name.trim(), email: form.email.trim().toLowerCase(), phone: form.phone.trim() });
    setBusy(false);
    toast.success('Profile updated.');
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
  const [prefs, setPrefs] = useState(() => read(`prefs_${user.id}`) || { email: true, push: true, matchReminders: true, newsletter: false });
  const [resetOpen, setResetOpen] = useState(false);

  async function savePassword(e) {
    e.preventDefault();
    const errs = {};
    if (!pw.current) errs.current = 'Enter your current password.';
    const issue = passwordIssue(pw.next);
    if (issue) errs.next = issue;
    if (pw.next !== pw.confirm) errs.confirm = 'Passwords do not match.';
    setPwErr(errs);
    if (Object.keys(errs).length) return;
    try {
      await changePassword(user.id, pw.current, pw.next);
      toast.success('Password changed (demo).');
      setPw({ current: '', next: '', confirm: '' });
    } catch (err) {
      setPwErr({ current: err.message });
    }
  }

  function togglePref(k) {
    const next = { ...prefs, [k]: !prefs[k] };
    setPrefs(next);
    write(`prefs_${user.id}`, next);
    toast.info('Preference saved.');
  }

  async function doReset() {
    await logout();
    resetDemo();
    toast.success('All demo data in this browser has been reset.');
    navigate('/');
  }

  const PREFS = [['email', 'Email notifications'], ['push', 'In-app notifications'], ['matchReminders', 'Match start reminders'], ['newsletter', 'Weekly newsletter']];

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <form onSubmit={savePassword} noValidate className="card space-y-4">
        <h2 className="flex items-center gap-2 font-semibold"><KeyRound className="h-4 w-4 text-blue" /> Change password</h2>
        <Field label="Current password" error={pwErr.current}><PasswordInput error={pwErr.current} value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
        <Field label="New password" error={pwErr.next}><PasswordInput error={pwErr.next} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
        <Field label="Confirm new password" error={pwErr.confirm}><PasswordInput error={pwErr.confirm} value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></Field>
        <div className="flex justify-end"><button className="btn-primary">Update password</button></div>
      </form>
      <div className="space-y-5">
        <section className="card">
          <h2 className="mb-4 flex items-center gap-2 font-semibold"><Bell className="h-4 w-4 text-orange" /> Notification preferences</h2>
          <ul className="space-y-3">
            {PREFS.map(([k, label]) => (
              <li key={k} className="flex items-center justify-between text-sm">
                {label}
                <button type="button" role="switch" aria-checked={prefs[k]} onClick={() => togglePref(k)} className={cx('relative h-6 w-11 rounded-full transition-colors', prefs[k] ? 'bg-blue' : 'bg-white/10')}>
                  <span className={cx('absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all', prefs[k] ? 'left-[22px]' : 'left-0.5')} />
                </button>
              </li>
            ))}
          </ul>
        </section>
        <section className="card border-red/20">
          <h2 className="flex items-center gap-2 font-semibold text-red"><Trash2 className="h-4 w-4" /> Reset demo data</h2>
          <p className="mt-2 text-sm text-muted">Clears every TUSKY demo record in this browser — accounts, purchases, trial status, wallet and admin edits — and restores the sample data.</p>
          <button className="btn-danger mt-4" onClick={() => setResetOpen(true)}>Reset demo data</button>
        </section>
      </div>
      <Modal open={resetOpen} onClose={() => setResetOpen(false)} title="Reset all demo data?" size="sm"
        footer={<><button className="btn-ghost" onClick={() => setResetOpen(false)}>Cancel</button><button className="btn-danger" onClick={doReset}>Reset everything</button></>}>
        <p className="text-sm text-muted">This removes all demo data stored by TUSKY in this browser and logs you out. It can’t be undone.</p>
      </Modal>
    </div>
  );
}

export default function Profile({ tab: initial = 'profile' }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const tab = initial;
  return (
    <>
      <PageHeader title={tab === 'settings' ? 'Settings' : 'Profile'} subtitle="Manage your account details and preferences." />
      <div className="mb-6"><Chips options={[{ value: 'profile', label: <span className="flex items-center gap-1.5"><UserRound className="h-3.5 w-3.5" />Profile</span> }, { value: 'settings', label: <span className="flex items-center gap-1.5"><Settings className="h-3.5 w-3.5" />Settings</span> }]} value={tab} onChange={(v) => navigate(v === 'settings' ? '/user/settings' : '/user/profile')} /></div>
      {tab === 'settings' ? <SettingsPanel user={user} /> : <ProfileForm user={user} />}
      <DemoBanner className="mt-6">Profile changes are saved in this browser only. Stage 2 stores them in MySQL via PHP.</DemoBanner>
    </>
  );
}
