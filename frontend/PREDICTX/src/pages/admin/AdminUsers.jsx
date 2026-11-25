// User management: search, filters, view details, block/unblock (demo).
import { useState } from 'react';
import { Search, Eye, Ban, CheckCircle2 } from 'lucide-react';
import { DataTable, DemoBanner, Modal, PageHeader, StatusBadge } from '../../components/ui';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import { getUsers, setUserBlocked } from '../../services/admin';
import { fmtDate, inr } from '../../utils/format';

export default function AdminUsers() {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [sub, setSub] = useState('all');
  const [status, setStatus] = useState('all');
  const [view, setView] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const { data, loading } = useAsync(() => getUsers(), []);

  const rows = (data || []).filter((u) =>
    (!q || `${u.id} ${u.name} ${u.email}`.toLowerCase().includes(q.toLowerCase()))
    && (sub === 'all' || u.subscription === sub)
    && (status === 'all' || u.status === status));

  async function toggleBlock() {
    const u = confirm;
    const block = u.status !== 'Blocked';
    await setUserBlocked(u.id, block);
    toast[block ? 'warning' : 'success'](`${u.name} has been ${block ? 'blocked' : 'unblocked'}.`);
    setConfirm(null);
    setView(null);
  }

  return (
    <>
      <PageHeader title="Users" subtitle={`${data ? data.length : '…'} users · sample people plus accounts registered in this browser`} />
      <div className="glass mb-5 grid gap-3 p-4 md:grid-cols-[1fr_200px_180px]">
        <label className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" /><input className="input pl-9" placeholder="Search by ID, name or email…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search users" /></label>
        <select className="input" value={sub} onChange={(e) => setSub(e.target.value)} aria-label="Filter by subscription"><option value="all">All subscriptions</option><option>Active</option><option>Trial</option><option>Expired</option><option>Cancelled</option><option>None</option></select>
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by account status"><option value="all">All statuses</option><option>Active</option><option>Blocked</option></select>
      </div>

      <DataTable loading={loading} rows={rows} empty="No users match these filters." columns={[
        { key: 'id', label: 'User ID', render: (u) => <span className="font-mono text-xs">{u.id}</span> },
        { key: 'name', label: 'Name', render: (u) => <span className="font-medium">{u.name}{u.registeredHere && <span className="badge-blue ml-2">Registered here</span>}</span> },
        { key: 'email', label: 'Email', render: (u) => <span className="text-muted">{u.email}</span> },
        { key: 'registeredAt', label: 'Registered', render: (u) => <span className="text-muted">{fmtDate(u.registeredAt)}</span> },
        { key: 'subscription', label: 'Subscription', render: (u) => <StatusBadge status={u.subscription} /> },
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
      <DemoBanner className="mt-5">Sample users are fictional. Blocking a user who registered in this browser prevents their demo login.</DemoBanner>

      <Modal open={!!view} onClose={() => setView(null)} title="User details" footer={view && <button className={view.status === 'Blocked' ? 'btn-success' : 'btn-danger'} onClick={() => setConfirm(view)}>{view.status === 'Blocked' ? 'Unblock user' : 'Block user'}</button>}>
        {view && (
          <div>
            <div className="flex items-center gap-4">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue to-purple font-bold">{view.name.split(' ').map((p) => p[0]).join('').slice(0, 2)}</span>
              <div><p className="text-lg font-semibold">{view.name}</p><p className="text-sm text-muted">{view.email}</p></div>
            </div>
            <dl className="mt-6 grid grid-cols-2 gap-4 text-sm">
              {[['User ID', view.id], ['Phone', view.phone || '—'], ['Registered', fmtDate(view.registeredAt)], ['Subscription', <StatusBadge key="s" status={view.subscription} />], ['Purchases', view.purchases], ['Total spent', inr(view.spent)], ['Account status', <StatusBadge key="a" status={view.status} />]].map(([k, v]) => (
                <div key={k} className="rounded-xl bg-white/[.03] p-3"><dt className="text-xs text-muted">{k}</dt><dd className="mt-1 font-medium">{v}</dd></div>
              ))}
            </dl>
          </div>
        )}
      </Modal>

      <Modal open={!!confirm} onClose={() => setConfirm(null)} title={confirm?.status === 'Blocked' ? 'Unblock user?' : 'Block user?'} size="sm"
        footer={<><button className="btn-ghost" onClick={() => setConfirm(null)}>Cancel</button><button className={confirm?.status === 'Blocked' ? 'btn-success' : 'btn-danger'} onClick={toggleBlock}>Confirm</button></>}>
        <p className="text-sm text-muted">{confirm?.status === 'Blocked' ? `${confirm?.name} will be able to log in again.` : `${confirm?.name} will not be able to log in (demo).`}</p>
      </Modal>
    </>
  );
}
