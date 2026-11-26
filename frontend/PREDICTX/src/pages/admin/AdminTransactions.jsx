// Transaction management: search, filters, details and refunds (full or partial).
import { useEffect, useState } from 'react';
import { Search, IndianRupee, CheckCircle2, Clock, XCircle, Undo2, AlertTriangle } from 'lucide-react';
import { DataTable, EmptyState, Field, Modal, PageHeader, StatCard, StatusBadge } from '../../components/ui';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import { getTransactions, refundTransaction } from '../../services/admin';
import { cx, fmtDateTime, inr } from '../../utils/format';

function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function AdminTransactions() {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [type, setType] = useState('all');
  const [view, setView] = useState(null);
  const [refund, setRefund] = useState(null);
  const [refundForm, setRefundForm] = useState({ amount: '', reason: '' });
  const [refundErr, setRefundErr] = useState({});
  const [busy, setBusy] = useState(false);
  const query = useDebounced(q);
  const { data, loading, error } = useAsync(() => getTransactions({ q: query, status, type }), [query, status, type]);
  const rows = data?.items || [];
  const c = data?.counts || {};

  async function doRefund() {
    setBusy(true);
    setRefundErr({});
    try {
      const body = { reason: refundForm.reason };
      if (refundForm.amount) body.amount = Number(refundForm.amount);
      const r = await refundTransaction(refund.dbId, body);
      toast.success(`₹${r.refunded} refunded (${r.status}).`);
      setRefund(null);
      setView(null);
    } catch (e) {
      setRefundErr({ form: e.message, ...e.fields });
    } finally {
      setBusy(false);
    }
  }

  if (error) return <EmptyState title="Couldn’t load transactions" text={error.message} />;
  const refundable = (t) => ['Success', 'Partially refunded'].includes(t.status);
  return (
    <>
      <PageHeader title="Transactions" subtitle="Every payment, subscription and wallet top-up." />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={CheckCircle2} color="green" label="Successful" value={(c.CAPTURED || 0) + (c.PARTIALLY_REFUNDED || 0)} />
        <StatCard icon={Clock} color="orange" label="Pending (unpaid orders)" value={c.CREATED || 0} />
        <StatCard icon={XCircle} color="red" label="Failed" value={c.FAILED || 0} />
        <StatCard icon={Undo2} color="blue" label="Refunded" value={(c.REFUNDED || 0) + (c.PARTIALLY_REFUNDED || 0)} />
      </div>
      <div className="glass mb-5 grid gap-3 p-4 md:grid-cols-[1fr_180px_180px]">
        <label className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" /><input className="input pl-9" placeholder="Search reference, payment id, customer…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search transactions" /></label>
        <select className="input" value={type} onChange={(e) => setType(e.target.value)} aria-label="Filter by type"><option value="all">All types</option><option value="prediction">Predictions</option><option value="subscription">Subscriptions</option><option value="wallet">Wallet top-ups</option></select>
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status"><option value="all">All statuses</option><option>Success</option><option>Pending</option><option>Failed</option><option>Refunded</option><option>Partially refunded</option></select>
      </div>
      <DataTable loading={loading} rows={rows} empty="No transactions match these filters." columns={[
        { key: 'id', label: 'Reference', render: (t) => <button className="font-mono text-xs text-blue hover:underline" onClick={() => setView(t)}>{t.id}</button> },
        { key: 'customer', label: 'Customer', render: (t) => <span className="font-medium">{t.customer}</span> },
        { key: 'item', label: 'Match / Item', render: (t) => <span className="text-muted">{t.item}{t.isDuplicate && <span className="badge-orange ml-2">Duplicate</span>}</span> },
        { key: 'amount', label: 'Amount', render: (t) => <b>{inr(t.amount)}</b> },
        { key: 'method', label: 'Method', render: (t) => <span className="text-muted">{t.method}</span> },
        { key: 'date', label: 'Payment Date', render: (t) => <span className="text-muted">{fmtDateTime(t.date)}</span> },
        { key: 'status', label: 'Status', render: (t) => <StatusBadge status={t.status} /> },
      ]} />

      <Modal open={!!view} onClose={() => setView(null)} title="Transaction details" size="md"
        footer={view && refundable(view) && <button className="btn-danger" onClick={() => { setRefundForm({ amount: '', reason: '' }); setRefundErr({}); setRefund(view); }}><Undo2 className="h-4 w-4" /> Refund</button>}>
        {view && (
          <>
            {view.isDuplicate && <p className="mb-4 flex items-start gap-2 rounded-lg bg-orange/10 px-3 py-2 text-xs text-orange"><AlertTriangle className="h-4 w-4 shrink-0" /> The customer already owned this item when this payment was captured. Refund it.</p>}
            <dl className="space-y-3 text-sm">
              {[['Reference', view.id], ['Customer', `${view.customer} (${view.email})`], ['Type', view.type], ['Item', view.item], ['Amount', inr(view.amount)], ['Refunded', inr(view.refundedAmount)], ['Method', view.method], ['Razorpay order', view.gatewayOrderId || '—'], ['Razorpay payment', view.gatewayPaymentId || '—'], ['Created', fmtDateTime(view.createdAt)], ['Status', <StatusBadge key="s" status={view.status} />], ['Failure reason', view.failureReason || '—']].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 border-b border-white/5 pb-2"><dt className="text-muted">{k}</dt><dd className="break-all text-right font-medium">{v}</dd></div>
              ))}
            </dl>
            {view.refunds?.length > 0 && (
              <>
                <h4 className="mt-5 text-sm font-semibold">Refunds</h4>
                <ul className="mt-2 space-y-1 text-sm text-muted">{view.refunds.map((r) => <li key={r.id} className="flex justify-between"><span>{fmtDateTime(r.date)} · {r.reason}</span><span>{inr(r.amount)} · {r.status}</span></li>)}</ul>
              </>
            )}
          </>
        )}
      </Modal>

      <Modal open={!!refund} onClose={() => !busy && setRefund(null)} title="Issue refund" size="sm"
        footer={<><button className="btn-ghost" onClick={() => setRefund(null)} disabled={busy}>Cancel</button><button className="btn-danger" onClick={doRefund} disabled={busy}>{busy ? <span className="spinner" /> : 'Refund'}</button></>}>
        {refund && (
          <div className="space-y-4">
            <p className="text-sm text-muted">{refund.item} · paid {inr(refund.amount)}{refund.refundedAmount ? `, ${inr(refund.refundedAmount)} already refunded` : ''}. {refund.method === 'TUSKY Wallet' ? 'The amount goes back to the customer’s wallet.' : 'The amount is refunded through Razorpay.'} A full refund removes the access this payment granted.</p>
            {refundErr.form && <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red">{refundErr.form}</p>}
            <Field label={`Amount (leave empty for the full remaining ${inr(refund.amount - refund.refundedAmount)})`} error={refundErr.amount}>
              <input className={cx('input', refundErr.amount && 'input-error')} type="number" min="1" step="0.01" value={refundForm.amount} onChange={(e) => setRefundForm({ ...refundForm, amount: e.target.value })} />
            </Field>
            <Field label="Reason" error={refundErr.reason}>
              <input className={cx('input', refundErr.reason && 'input-error')} value={refundForm.reason} onChange={(e) => setRefundForm({ ...refundForm, reason: e.target.value })} placeholder="e.g. Duplicate payment" />
            </Field>
          </div>
        )}
      </Modal>
    </>
  );
}
