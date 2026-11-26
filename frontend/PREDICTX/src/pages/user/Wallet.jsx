// Wallet: balance (sum of the server-side ledger), top-up via Razorpay, history.
import { useState } from 'react';
import { Wallet as WalletIcon, Plus, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { Field, Modal, PageHeader, StatCard } from '../../components/ui';
import TransactionTable from '../../components/sections/TransactionTable';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useAsync } from '../../hooks/useAsync';
import { getWallet, payOnline } from '../../services/purchases';
import { cx, inr } from '../../utils/format';

const PRESETS = [100, 250, 500, 1000];

export default function Wallet() {
  const { user } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(250);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { data: wallet } = useAsync(() => getWallet(), [user.id]);

  async function topUp() {
    if (!Number.isInteger(amount) || amount < 10 || amount > 10000) return setError('Enter a whole amount between ₹10 and ₹10,000.');
    setBusy(true);
    setError('');
    try {
      await payOnline({ type: 'WALLET_TOPUP', amount });
      toast.success(`${inr(amount)} added to your wallet.`, 'Wallet topped up');
      setOpen(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Wallet" subtitle="Use wallet credit to unlock predictions instantly." actions={<button className="btn-primary" onClick={() => { setError(''); setOpen(true); }}><Plus className="h-4 w-4" /> Add money</button>} />
      <div className="mb-8 grid gap-4 md:grid-cols-3">
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-solid to-deep p-6 text-ink shadow-[0_20px_60px_-25px_rgba(57,255,20,.9)]">
          <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10" />
          <WalletIcon className="h-6 w-6" />
          <p className="mt-6 text-sm text-ink/80">Available balance</p>
          <p className="font-display text-4xl font-bold">{wallet ? inr(wallet.balance) : '…'}</p>
          <p className="mt-2 text-xs text-ink/70">{user.name}</p>
        </div>
        <StatCard icon={ArrowDownLeft} color="green" label="Total added" value={wallet ? inr(wallet.totalAdded) : '…'} />
        <StatCard icon={ArrowUpRight} color="orange" label="Spent from wallet" value={wallet ? inr(wallet.totalSpent) : '…'} />
      </div>
      <h2 id="history" className="mb-4 text-xl font-semibold">Transaction history</h2>
      <TransactionTable userId={user.id} />
      <p className="mt-6 text-xs text-muted">Wallet credit is added only after the payment is verified by our server. Credit can be used for predictions and subscriptions.</p>

      <Modal open={open} onClose={() => !busy && setOpen(false)} title="Add money" size="sm"
        footer={<><button className="btn-ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</button><button className="btn-primary" onClick={topUp} disabled={busy}>{busy ? <><span className="spinner" /> Waiting for payment…</> : `Pay ${inr(amount || 0)}`}</button></>}>
        <div className="grid grid-cols-4 gap-2">
          {PRESETS.map((p) => <button key={p} type="button" onClick={() => setAmount(p)} className={cx('chip justify-center', amount === p && 'active')}>{inr(p)}</button>)}
        </div>
        <Field label="Custom amount (₹)" error={error} className="mt-4">
          <input className={cx('input', error && 'input-error')} type="number" min="10" max="10000" step="1" value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
        </Field>
        <p className="mt-4 text-xs text-muted">You’ll pay securely with UPI, card or net banking through Razorpay.</p>
      </Modal>
    </>
  );
}
