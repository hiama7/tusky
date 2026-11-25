// Transaction management: ID, customer, match purchased, amount, date, status.
import { useState } from 'react';
import { Search, IndianRupee, CheckCircle2, Clock, XCircle } from 'lucide-react';
import { DataTable, DemoBanner, Modal, PageHeader, StatCard, StatusBadge } from '../../components/ui';
import { useAsync } from '../../hooks/useAsync';
import { getTransactions } from '../../services/admin';
import { fmtDateTime, inr } from '../../utils/format';

export default function AdminTransactions() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [type, setType] = useState('all');
  const [view, setView] = useState(null);
  const { data, loading } = useAsync(() => getTransactions(), []);
  const all = data || [];
  const rows = all.filter((t) => (status === 'all' || t.status === status) && (type === 'all' || t.type === type) && (!q || `${t.id} ${t.customer} ${t.item}`.toLowerCase().includes(q.toLowerCase())));
  const success = all.filter((t) => t.status === 'Success' && t.type !== 'wallet');

  return (
    <>
      <PageHeader title="Transactions" subtitle="All payments across predictions, subscriptions and wallet top-ups." />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard demo icon={IndianRupee} label="Successful revenue" value={inr(success.reduce((s, t) => s + t.amount, 0))} />
        <StatCard demo icon={CheckCircle2} color="green" label="Successful" value={all.filter((t) => t.status === 'Success').length} />
        <StatCard demo icon={Clock} color="orange" label="Pending" value={all.filter((t) => t.status === 'Pending').length} />
        <StatCard demo icon={XCircle} color="red" label="Failed / Refunded" value={all.filter((t) => ['Failed', 'Refunded'].includes(t.status)).length} />
      </div>
      <div className="glass mb-5 grid gap-3 p-4 md:grid-cols-[1fr_180px_180px]">
        <label className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" /><input className="input pl-9" placeholder="Search by ID, customer or item…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search transactions" /></label>
        <select className="input" value={type} onChange={(e) => setType(e.target.value)} aria-label="Filter by type"><option value="all">All types</option><option value="prediction">Predictions</option><option value="subscription">Subscriptions</option><option value="wallet">Wallet</option></select>
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status"><option value="all">All statuses</option><option>Success</option><option>Pending</option><option>Failed</option><option>Refunded</option></select>
      </div>
      <DataTable loading={loading} rows={rows} empty="No transactions match these filters." columns={[
        { key: 'id', label: 'Transaction ID', render: (t) => <button className="font-mono text-xs text-blue hover:underline" onClick={() => setView(t)}>{t.id}</button> },
        { key: 'customer', label: 'Customer', render: (t) => <span className="font-medium">{t.customer}</span> },
        { key: 'item', label: 'Match / Item', render: (t) => <span className="text-muted">{t.item}</span> },
        { key: 'amount', label: 'Amount', render: (t) => <b>{inr(t.amount)}</b> },
        { key: 'method', label: 'Method', render: (t) => <span className="text-muted">{t.method}</span> },
        { key: 'date', label: 'Payment Date', render: (t) => <span className="text-muted">{fmtDateTime(t.date)}</span> },
        { key: 'status', label: 'Status', render: (t) => <span className="flex items-center gap-1.5"><StatusBadge status={t.status} />{t.demo && <span className="badge-blue">Demo</span>}</span> },
      ]} />
      <DemoBanner className="mt-5">Sample transactions plus demo payments made in this browser. No real payments are processed in Stage 1.</DemoBanner>

      <Modal open={!!view} onClose={() => setView(null)} title="Transaction details" size="sm">
        {view && (
          <dl className="space-y-3 text-sm">
            {[['Transaction ID', view.id], ['Customer', `${view.customer} (${view.email})`], ['Type', view.type], ['Item', view.item], ['Amount', inr(view.amount)], ['Method', view.method], ['Date', fmtDateTime(view.date)], ['Status', <StatusBadge key="s" status={view.status} />], ['Source', view.demo ? 'Demo purchase in this browser' : 'Sample data']].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 border-b border-white/5 pb-2"><dt className="text-muted">{k}</dt><dd className="text-right font-medium">{v}</dd></div>
            ))}
          </dl>
        )}
      </Modal>
    </>
  );
}
