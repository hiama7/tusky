// Admin settings: platform preferences (demo) + reset demo data.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Save, Trash2, ShieldCheck } from 'lucide-react';
import { DemoBanner, Field, Modal, PageHeader } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { read, resetDemo, write } from '../../services/storage';

const DEFAULTS = { siteName: 'TUSKY', supportEmail: 'support@tusky.app', currency: 'INR', defaultPrice: 49, maintenance: false, trialEnabled: true };

export default function AdminSettings() {
  const toast = useToast();
  const navigate = useNavigate();
  const { admin } = useAuth();
  const [form, setForm] = useState(() => ({ ...DEFAULTS, ...(read('adminSettings') || {}) }));
  const [resetOpen, setResetOpen] = useState(false);

  function save(e) {
    e.preventDefault();
    if (!(Number(form.defaultPrice) > 0)) return toast.error('Default price must be greater than zero.');
    write('adminSettings', form);
    toast.success('Settings saved (demo).');
  }

  function doReset() {
    resetDemo();
    toast.success('Demo data reset. Please sign in again.');
    navigate('/admin/login');
  }

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  return (
    <>
      <PageHeader title="Settings" subtitle="Platform configuration for the demo admin console." />
      <div className="grid gap-5 lg:grid-cols-3">
        <form onSubmit={save} className="card space-y-4 lg:col-span-2">
          <h2 className="font-semibold">General</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Site name"><input className="input" value={form.siteName} onChange={set('siteName')} /></Field>
            <Field label="Support email"><input className="input" type="email" value={form.supportEmail} onChange={set('supportEmail')} /></Field>
            <Field label="Currency"><select className="input" value={form.currency} onChange={set('currency')}><option>INR</option></select></Field>
            <Field label="Default prediction price (₹)"><input className="input" type="number" min="1" value={form.defaultPrice} onChange={set('defaultPrice')} /></Field>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-blue" checked={form.trialEnabled} onChange={set('trialEnabled')} /> Offer one free prediction to new users</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-blue" checked={form.maintenance} onChange={set('maintenance')} /> Maintenance mode banner (preview only)</label>
          <div className="flex justify-end"><button className="btn-primary"><Save className="h-4 w-4" /> Save settings</button></div>
        </form>
        <div className="space-y-5">
          <section className="card">
            <h2 className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-4 w-4 text-green" /> Admin account</h2>
            <p className="mt-3 text-sm">{admin?.name}</p>
            <p className="text-sm text-muted">{admin?.email} · {admin?.role}</p>
          </section>
          <section className="card">
            <h2 className="flex items-center gap-2 font-semibold text-red"><Trash2 className="h-4 w-4" /> Reset demo data</h2>
            <p className="mt-2 text-sm text-muted">Restores sample matches, predictions and news, and clears demo accounts, purchases and admin edits in this browser.</p>
            <button className="btn-danger mt-4" onClick={() => setResetOpen(true)}>Reset demo data</button>
          </section>
        </div>
      </div>
      <DemoBanner className="mt-6">Settings are stored in this browser only. In Stage 2 they live in a MySQL settings table and are read by the PHP backend.</DemoBanner>
      <Modal open={resetOpen} onClose={() => setResetOpen(false)} title="Reset all demo data?" size="sm"
        footer={<><button className="btn-ghost" onClick={() => setResetOpen(false)}>Cancel</button><button className="btn-danger" onClick={doReset}>Reset everything</button></>}>
        <p className="text-sm text-muted">This clears all TUSKY demo data in this browser, including user and admin sessions. It can’t be undone.</p>
      </Modal>
    </>
  );
}
