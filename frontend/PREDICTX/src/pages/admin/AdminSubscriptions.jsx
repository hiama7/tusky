// Subscriptions: status counts, revenue, subscriber list, and plan management
// (create / edit price, duration, features, sport access, active/inactive).
import { useState } from 'react';
import { Crown, CheckCircle2, Clock, XCircle, IndianRupee, Plus, Pencil } from 'lucide-react';
import { Chips, DataTable, EmptyState, Field, Modal, PageHeader, StatCard, StatusBadge } from '../../components/ui';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import { getCatalogue, getPlans, getSubscriptions, savePlan } from '../../services/admin';
import { cx, fmtDate, inr } from '../../utils/format';

const EMPTY_PLAN = { code: '', planName: '', description: '', price: 199, durationDays: 30, features: '', allSports: true, sportIds: [], popular: false, sortOrder: 0, status: 'ACTIVE' };

export default function AdminSubscriptions() {
  const toast = useToast();
  const [tab, setTab] = useState('all');
  const [plan, setPlan] = useState(null);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const { data, loading, error } = useAsync(() => getSubscriptions({ status: tab === 'all' ? undefined : tab }), [tab]);
  const { data: plans } = useAsync(() => getPlans(), []);
  const { data: catalogue } = useAsync(() => getCatalogue(), []);
  const c = data?.counts || {};

  function editPlan(p) {
    setErrors({});
    const sportIds = (catalogue?.sports || []).filter((s) => p.sports.includes(s.id)).map((s) => s.dbId);
    setPlan({ id: p.id, code: p.code, planName: p.name, description: p.description || '', price: p.price, durationDays: p.days, features: p.features.join('\n'), allSports: p.allSports, sportIds, popular: p.popular, sortOrder: 0, status: p.status });
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      await savePlan(plan.id, {
        code: plan.code.trim(), planName: plan.planName.trim(), description: plan.description || null, price: Number(plan.price), durationDays: Number(plan.durationDays),
        features: plan.features.split('\n').map((s) => s.trim()).filter(Boolean), allSports: plan.allSports, sportIds: plan.sportIds, popular: plan.popular, sortOrder: Number(plan.sortOrder) || 0, status: plan.status,
      });
      toast.success(plan.id ? 'Plan updated. Existing subscribers keep their current period.' : 'Plan created.');
      setPlan(null);
    } catch (err) {
      setErrors({ form: err.message, ...err.fields });
    } finally {
      setBusy(false);
    }
  }

  const set = (k) => (e) => setPlan((p) => ({ ...p, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  if (error) return <EmptyState title="Couldn’t load subscriptions" text={error.message} />;
  return (
    <>
      <PageHeader title="Subscriptions" subtitle="Plans, subscriber status and subscription revenue." />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={CheckCircle2} color="green" label="Active subscriptions" value={c.ACTIVE || 0} />
        <StatCard icon={Clock} color="orange" label="Expired subscriptions" value={c.EXPIRED || 0} />
        <StatCard icon={XCircle} color="red" label="Cancelled subscriptions" value={c.CANCELLED || 0} />
        <StatCard icon={IndianRupee} color="blue" label="Net subscription revenue" value={data ? inr(data.revenue.net) : '…'} hint={data ? `${inr(data.revenue.gross)} gross · ${inr(data.revenue.refunds)} refunded` : ''} />
      </div>

      <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-semibold">Subscription Plans</h2><button className="btn-primary btn-sm" onClick={() => { setErrors({}); setPlan(EMPTY_PLAN); }}><Plus className="h-3.5 w-3.5" /> New plan</button></div>
      <div className="mb-8 grid gap-4 md:grid-cols-3">
        {(plans || []).map((p) => (
          <div key={p.id} className={cx('card card-lift', p.status === 'INACTIVE' && 'opacity-60')}>
            <div className="flex items-center justify-between"><p className="flex items-center gap-2 font-semibold"><Crown className="h-4 w-4 text-purple" /> {p.name}</p><span className="flex gap-1">{p.popular && <span className="badge-blue">Popular</span>}<StatusBadge status={p.status === 'ACTIVE' ? 'Active' : 'Inactive'} /></span></div>
            <p className="mt-3 font-display text-2xl font-bold">{inr(p.price)}<span className="text-sm font-normal text-muted"> / {p.days} days</span></p>
            <p className="mt-1 text-xs text-muted">{p.allSports ? 'All sports' : `Sports: ${p.sports.join(', ')}`}</p>
            <div className="mt-4 flex items-center justify-between text-xs"><span className="text-muted">{data?.perPlan?.[p.id] || 0} subscriptions sold</span><button className="btn-ghost btn-sm" onClick={() => editPlan(p)}><Pencil className="h-3.5 w-3.5" /> Edit</button></div>
          </div>
        ))}
      </div>

      <div className="mb-4"><Chips options={['all', 'Active', 'Expired', 'Cancelled'].map((v) => ({ value: v, label: v === 'all' ? 'All' : v }))} value={tab} onChange={setTab} /></div>
      <DataTable loading={loading} rows={data?.items || []} empty="No subscriptions in this state." columns={[
        { key: 'reference', label: 'Reference', render: (s) => <span className="font-mono text-xs">{s.reference}</span> },
        { key: 'customer', label: 'Customer', render: (s) => <span className="font-medium">{s.customer}</span> },
        { key: 'plan', label: 'Plan', render: (s) => s.planName },
        { key: 'start', label: 'Start', render: (s) => <span className="text-muted">{fmtDate(s.start)}</span> },
        { key: 'end', label: 'Ends', render: (s) => <span className="text-muted">{fmtDate(s.end)}</span> },
        { key: 'amount', label: 'Amount', render: (s) => inr(s.amount) },
        { key: 'status', label: 'Status', render: (s) => <StatusBadge status={s.upcoming ? 'Scheduled' : s.status} /> },
      ]} />

      <Modal open={!!plan} onClose={() => !busy && setPlan(null)} title={plan?.id ? 'Edit plan' : 'New plan'} size="lg">
        {plan && (
          <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
            {errors.form && <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red sm:col-span-2">{errors.form}</p>}
            <Field label="Plan name" error={errors.planName}><input className="input" value={plan.planName} onChange={set('planName')} /></Field>
            <Field label="Code (url-safe, unique)" error={errors.code}><input className="input" value={plan.code} onChange={set('code')} placeholder="premium-monthly" /></Field>
            <Field label="Price (₹)" error={errors.price}><input type="number" min="1" step="0.01" className="input" value={plan.price} onChange={set('price')} /></Field>
            <Field label="Duration (days)" error={errors.durationDays}><input type="number" min="1" className="input" value={plan.durationDays} onChange={set('durationDays')} /></Field>
            <Field label="Description" className="sm:col-span-2"><input className="input" value={plan.description} onChange={set('description')} /></Field>
            <Field label="Features (one per line)" className="sm:col-span-2"><textarea rows={4} className="input" value={plan.features} onChange={set('features')} /></Field>
            <div className="sm:col-span-2">
              <p className="label">Access policy</p>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-blue" checked={plan.allSports} onChange={set('allSports')} /> Unlocks predictions for all sports</label>
              {!plan.allSports && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {(catalogue?.sports || []).map((s) => {
                    const on = plan.sportIds.includes(s.dbId);
                    return <button type="button" key={s.dbId} className={cx('chip', on && 'active')} onClick={() => setPlan((p) => ({ ...p, sportIds: on ? p.sportIds.filter((x) => x !== s.dbId) : [...p.sportIds, s.dbId] }))}>{s.name}</button>;
                  })}
                </div>
              )}
              {errors.sportIds && <p className="field-error">{errors.sportIds}</p>}
            </div>
            <Field label="Status"><select className="input" value={plan.status} onChange={set('status')}><option value="ACTIVE">Active (on sale)</option><option value="INACTIVE">Inactive (hidden)</option></select></Field>
            <label className="mt-6 flex items-center gap-2 text-sm text-muted"><input type="checkbox" className="accent-blue" checked={plan.popular} onChange={set('popular')} /> Highlight as “Most popular”</label>
            <div className="flex justify-end gap-2 border-t border-white/5 pt-4 sm:col-span-2">
              <button type="button" className="btn-ghost" onClick={() => setPlan(null)}>Cancel</button>
              <button className="btn-primary" disabled={busy}>{busy ? <span className="spinner" /> : 'Save plan'}</button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
