// Demo wallet: balance, top-up (simulated), and transaction history.
import { useState } from 'react';
import { Wallet as WalletIcon, Plus, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { DemoBanner, Field, Modal, PageHeader, StatCard } from '../../components/ui';
import TransactionTable from '../../components/sections/TransactionTable';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useAsync } from '../../hooks/useAsync';
import { getUserTransactions, getWallet, topUpWallet } from '../../services/purchases';
import { cx, inr } from '../../utils/format';

const PRESETS = [100, 250, 500, 1000];

export default function Wallet() {
  const { user } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(250);
  const [method, setMethod] = useState('UPI');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { data: balance } = useAsync(() => getWallet(user.id), [user.id]);
  const { data: txns } = useAsync(() => getUserTransactions(user.id), [user.id]);

  const added = (txns || []).filter((t) => t.type === 'wallet').reduce((s, t) => s + t.amount, 0);
  const spentFromWallet = (txns || []).filter((t) => t.method === 'Wallet' && t.type !== 'wallet').reduce((s, t) => s + t.amount, 0);

  async function topUp() {
    setBusy(true);
    setError('');
    try {
      await topUpWallet(user, amount, method);
      toast.success(`${inr(amount)} demo credit added.`, 'Wallet topped up');
      setOpen(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Wallet" subtitle="Use wallet credit to unlock predictions instantly." actions={<button className="btn-primary" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Add money</button>} />
      <div className="mb-8 grid gap-4 md:grid-cols-3">
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-blue to-purple p-6 shadow-[0_20px_60px_-25px_rgba(56,107,255,.9)] md:col-span-1">
          <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10" />
          <WalletIcon className="h-6 w-6" />
          <p className="mt-6 text-sm text-white/80">Available balance</p>
          <p className="font-display text-4xl font-bold">{balance === null ? '…' : inr(balance)}</p>
          <p className="mt-2 text-xs text-white/70">Demo credit · {user.name}</p>
        </div>
        <StatCard icon={ArrowDownLeft} color="green" label="Total added" value={inr(added)} />
        <StatCard icon={ArrowUpRight} color="orange" label="Spent from wallet" value={inr(spentFromWallet)} />
      </div>
      <h2 id="history" className="mb-4 text-xl font-semibold">Transaction history</h2>
      <TransactionTable userId={user.id} />
      <DemoBanner className="mt-6">Wallet top-ups are simulated — no money is charged. In Stage 2 wallet credits are recorded only after the payment gateway confirms the payment on the server.</DemoBanner>

      <Modal open={open} onClose={() => !busy && setOpen(false)} title="Add money (demo)" size="sm"
        footer={<><button className="btn-ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</button><button className="btn-primary" onClick={topUp} disabled={busy}>{busy ? <><span className="spinner" /> Processing…</> : `Add ${inr(amount || 0)}`}</button></>}>
        <div className="grid grid-cols-4 gap-2">
          {PRESETS.map((p) => <button key={p} type="button" onClick={() => setAmount(p)} className={cx('chip justify-center', amount === p && 'active')}>{inr(p)}</button>)}
        </div>
        <Field label="Custom amount" error={error} className="mt-4">
          <input className={cx('input', error && 'input-error')} type="number" min="10" max="10000" value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
        </Field>
        <Field label="Pay using" className="mt-4">
          <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}><option>UPI</option><option>Card</option><option>Net Banking</option></select>
        </Field>
        <p className="mt-4 text-xs text-orange/90">Demo only — no real payment is made.</p>
      </Modal>
    </>
  );
}
