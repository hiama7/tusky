// User management: server-side search & filters, full user details (purchases,
// subscriptions, free trial, transactions), block / unblock.
import { useEffect, useState } from 'react';
import { Search, Eye } from 'lucide-react';
import { DataTable, EmptyState, Modal, PageHeader, Skeleton, StatusBadge } from '../../components/ui';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import { getUser, getUsers, setUserBlocked } from '../../services/admin';
import { fmtDate, fmtDateTime, inr } from '../../utils/format';

function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function UserDetails({ id }) {
  const { data, loading, error } = useAsync(() => getUser(id), [id]);
  if (loading) return <div className="space-y-3"><Skeleton className="h-16" /><Skeleton className="h-32" /></div>;
  if (error) return <p className="text-sm text-red">{error.message}</p>;
  const { user, purchases, subscriptions, trial, transactions, walletBalance } = data;
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-solid to-deep text-ink font-bold">{user.name.split(' ').map((p) => p[0]).join('').slice(0, 2)}</span>
        <div><p className="text-lg font-semibold">{user.name}</p><p className="text-sm text-muted">{user.email} · {user.phone || 'no phone'}</p></div>
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        {[['User ID', user.id], ['Registered', fmtDate(user.registeredAt)], ['Account', <StatusBadge key="a" status={user.status} />], ['Wallet', inr(walletBalance)]].map(([k, v]) => (
          <div key={k} className="rounded-xl bg-white/[.03] p-3"><dt className="text-xs text-muted">{k}</dt><dd className="mt-1 font-medium">{v}</dd></div>
        ))}
      </dl>
      <section>
        <h4 className="mb-2 text-sm font-semibold">Free trial</h4>
        <p className="text-sm text-muted">{trial ? <>Used on <b className="text-white">{trial.match.teamA.name} vs {trial.match.teamB.name}</b> · {fmtDateTime(trial.activatedAt)}</> : 'Not used yet'}</p>
      </section>
      <section>
        <h4 className="mb-2 text-sm font-semibold">Purchases ({purchases.length})</h4>
        {purchases.length ? <ul className="space-y-1 text-sm">{purchases.map((p, i) => <li key={i} className="flex justify-between gap-3 text-muted"><span>{p.match.teamA.name} vs {p.match.teamB.name}</span><span>{inr(p.amount)} · <StatusBadge status={p.status === 'ACTIVE' ? 'Active' : 'Refunded'} /></span></li>)}</ul> : <p className="text-sm text-muted">None</p>}
      </section>
      <section>
        <h4 className="mb-2 text-sm font-semibold">Subscriptions ({subscriptions.length})</h4>
        {subscriptions.length ? <ul className="space-y-1 text-sm">{subscriptions.map((s) => <li key={s.id} className="flex justify-between gap-3 text-muted"><span>{s.plan?.name}</span><span>{fmtDate(s.start)} → {fmtDate(s.end)} · <StatusBadge status={s.status} /></span></li>)}</ul> : <p className="text-sm text-muted">None</p>}
      </section>
      <section>
        <h4 className="mb-2 text-sm font-semibold">Recent transactions</h4>
        {transactions.length ? <ul className="space-y-1 text-sm">{transactions.slice(0, 10).map((t) => <li key={t.id} className="flex justify-between gap-3 text-muted"><span className="truncate">{t.item}</span><span className="shrink-0">{inr(t.amount)} · <StatusBadge status={t.status} /></span></li>)}</ul> : <p className="text-sm text-muted">None</p>}
      </section>
    </div>
  );
}

export default function AdminUsers() {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [sub, setSub] = useState('all');
  const [status, setStatus] = useState('all');
  const [view, setView] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  const query = useDebounced(q);
  const { data, loading, error } = useAsync(() => getUsers({ q: query, subscription: sub, status }), [query, sub, status]);

  async function toggleBlock() {
    const u = confirm;
    const block = u.status !== 'Blocked';
    setBusy(true);
    try {
      await setUserBlocked(u.id, block);
      toast[block ? 'warning' : 'success'](`${u.name} has been ${block ? 'blocked and signed out everywhere' : 'unblocked'}.`);
      setConfirm(null);
      setView(null);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (error) return <EmptyState title="Couldn’t load users" text={error.message} />;
  return (
    <>
      <PageHeader title="Users" subtitle={`${data ? data.pagination.total : '…'} registered users`} />
      <div className="glass mb-5 grid gap-3 p-4 md:grid-cols-[1fr_200px_180px]">
        <label className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" /><input className="input pl-9" placeholder="Search by ID, name or email…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search users" /></label>
        <select className="input" value={sub} onChange={(e) => setSub(e.target.value)} aria-label="Filter by subscription"><option value="all">All subscriptions</option><option>Active</option><option>Expired</option><option>None</option></select>
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by account status"><option value="all">All statuses</option><option>Active</option><option>Blocked</option></select>
      </div>

      <DataTable loading={loading} rows={data?.items || []} empty="No users match these filters." columns={[
        { key: 'id', label: 'User ID', render: (u) => <span className="font-mono text-xs">{u.id}</span> },
        { key: 'name', label: 'Name', render: (u) => <span className="font-medium">{u.name}</span> },
        { key: 'email', label: 'Email', render: (u) => <span className="text-muted">{u.email}</span> },
        { key: 'registeredAt', label: 'Registered', render: (u) => <span className="text-muted">{fmtDate(u.registeredAt)}</span> },
        { key: 'subscription', label: 'Subscription', render: (u) => <StatusBadge status={u.subscription} /> },
        { key: 'trial', label: 'Trial', render: (u) => <StatusBadge status={u.trial} /> },
        { key: 'purchases', label: 'Purchases' },
        { key: 'spent', label: 'Total Spent', render: (u) => inr(u.spent) },
        { key: 'status', label: 'Account', render: (u) => <StatusBadge status={u.status} /> },
        { key: 'actions', label: 'Actions', render: (u) => (
          <div className="flex justify-end gap-1.5">
            <button className="btn-ghost btn-sm" onClick={() => setView(u)} aria-label={`View ${u.name}`}><Eye className="h-3.5 w-3.5" /></button>
            <button className={u.status === 'Blocked' ? 'btn-success btn-sm' : 'btn-ghost btn-sm text-red'} onClick={() => setConfirm(u)}>{u.status === 'Blocked' ? 'Unblock' : 'Block'}</button>
          </div>
        ) },
      ]} />

      <Modal open={!!view} onClose={() => setView(null)} title="User details" size="lg" footer={view && <button className={view.status === 'Blocked' ? 'btn-success' : 'btn-danger'} onClick={() => setConfirm(view)}>{view.status === 'Blocked' ? 'Unblock user' : 'Block user'}</button>}>
        {view && <UserDetails id={view.id} />}
      </Modal>

      <Modal open={!!confirm} onClose={() => setConfirm(null)} title={confirm?.status === 'Blocked' ? 'Unblock user?' : 'Block user?'} size="sm"
        footer={<><button className="btn-ghost" onClick={() => setConfirm(null)}>Cancel</button><button className={confirm?.status === 'Blocked' ? 'btn-success' : 'btn-danger'} onClick={toggleBlock} disabled={busy}>{busy ? <span className="spinner" /> : 'Confirm'}</button></>}>
        <p className="text-sm text-muted">{confirm?.status === 'Blocked' ? `${confirm?.name} will be able to log in again.` : `${confirm?.name} will be signed out on every device and won’t be able to log in.`}</p>
      </Modal>
    </>
  );
}
