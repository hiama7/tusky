// Subscription management: active / expired / cancelled, plans, revenue.
import { useState } from 'react';
import { Crown, CheckCircle2, Clock, XCircle, IndianRupee } from 'lucide-react';
import { Chips, DataTable, DemoBanner, PageHeader, StatCard, StatusBadge } from '../../components/ui';
import { useAsync } from '../../hooks/useAsync';
import { getSubscriptions } from '../../services/admin';
import { PLANS, planById } from '../../data/demo/plans';
import { fmtDate, inr } from '../../utils/format';

export default function AdminSubscriptions() {
  const [tab, setTab] = useState('all');
  const { data, loading } = useAsync(() => getSubscriptions(), []);
  const all = data || [];
  const count = (s) => all.filter((x) => x.status === s).length;
  const revenue = all.reduce((s, x) => s + x.amount, 0);
  const rows = all.filter((x) => tab === 'all' || x.status === tab);

  return (
    <>
      <PageHeader title="Subscriptions" subtitle="Plans, subscriber status and subscription revenue." />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard demo icon={CheckCircle2} color="green" label="Active Subscriptions" value={loading ? '…' : count('Active')} />
        <StatCard demo icon={Clock} color="orange" label="Expired Subscriptions" value={loading ? '…' : count('Expired')} />
        <StatCard demo icon={XCircle} color="red" label="Cancelled Subscriptions" value={loading ? '…' : count('Cancelled')} />
        <StatCard demo icon={IndianRupee} color="blue" label="Revenue Generated" value={loading ? '…' : inr(revenue)} />
      </div>

      <h2 className="mb-4 text-lg font-semibold">Subscription Plans</h2>
      <div className="mb-8 grid gap-4 md:grid-cols-3">
        {PLANS.map((p) => {
          const subs = all.filter((x) => x.plan === p.id);
          return (
            <div key={p.id} className="card card-lift">
              <div className="flex items-center justify-between"><p className="flex items-center gap-2 font-semibold"><Crown className="h-4 w-4 text-purple" /> {p.name}</p>{p.popular && <span className="badge-blue">Popular</span>}</div>
              <p className="mt-3 font-display text-2xl font-bold">{inr(p.price)}<span className="text-sm font-normal text-muted">/{p.period}</span></p>
              <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-white/[.03] p-2"><p className="text-muted">Subscribers</p><p className="mt-0.5 text-base font-semibold">{subs.length}</p></div>
                <div className="rounded-lg bg-white/[.03] p-2"><p className="text-muted">Revenue</p><p className="mt-0.5 text-base font-semibold">{inr(subs.reduce((s, x) => s + x.amount, 0))}</p></div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mb-4"><Chips options={['all', 'Active', 'Expired', 'Cancelled'].map((v) => ({ value: v, label: v === 'all' ? 'All' : v }))} value={tab} onChange={setTab} /></div>
      <DataTable loading={loading} rows={rows} empty="No subscriptions in this state." columns={[
        { key: 'id', label: 'ID', render: (s) => <span className="font-mono text-xs">{s.id}</span> },
        { key: 'customer', label: 'Customer', render: (s) => <span className="font-medium">{s.customer}{s.demo && <span className="badge-blue ml-2">Demo</span>}</span> },
        { key: 'plan', label: 'Plan', render: (s) => planById(s.plan)?.name },
        { key: 'start', label: 'Start', render: (s) => <span className="text-muted">{fmtDate(s.start)}</span> },
        { key: 'end', label: 'Ends', render: (s) => <span className="text-muted">{fmtDate(s.end)}</span> },
        { key: 'amount', label: 'Amount', render: (s) => inr(s.amount) },
        { key: 'status', label: 'Status', render: (s) => <StatusBadge status={s.status} /> },
      ]} />
      <DemoBanner className="mt-5">Sample subscription records, plus any subscriptions purchased in this browser (marked Demo).</DemoBanner>
    </>
  );
}
