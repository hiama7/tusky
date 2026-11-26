// =============================================================================
// Checkout modal. Two ways to pay:
//   * Online (UPI / card / net banking) through Razorpay Checkout
//   * TUSKY wallet balance
// The price shown comes from the server. Nothing unlocks in the browser: the
// server verifies the payment (signature + Razorpay API) before granting access.
// =============================================================================
import { useEffect, useState } from 'react';
import { Smartphone, CreditCard, Landmark, Wallet, CheckCircle2, ShieldCheck } from 'lucide-react';
import { Modal } from '../ui';
import { payOnline, payWithWallet } from '../../services/purchases';
import { cx, inr } from '../../utils/format';

const METHODS = [
  { id: 'upi', label: 'UPI', icon: Smartphone, hint: 'Pay with any UPI app' },
  { id: 'card', label: 'Debit / Credit Card', icon: CreditCard, hint: 'Visa, Mastercard, RuPay' },
  { id: 'netbanking', label: 'Net Banking', icon: Landmark, hint: 'All major banks' },
  { id: 'wallet', label: 'TUSKY Wallet', icon: Wallet, hint: 'Uses your wallet balance' },
];

/**
 * props: open, onClose, title, subtitle, amount, walletBalance,
 *        item = { type: 'PREDICTION', matchId } | { type: 'SUBSCRIPTION', planId }
 *        onSuccess(result)
 */
export default function PaymentModal({ open, onClose, title, subtitle, amount, walletBalance = 0, item, onSuccess }) {
  const [method, setMethod] = useState('upi');
  const [step, setStep] = useState('select'); // select | processing | success | error
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (open) { setStep('select'); setError(''); setMethod('upi'); setResult(null); }
  }, [open]);

  async function pay() {
    setStep('processing');
    setError('');
    try {
      const res = method === 'wallet' ? await payWithWallet(item) : await payOnline(item, { method });
      setResult(res);
      setStep('success');
    } catch (e) {
      setError(e.message || 'Payment failed.');
      setStep('error');
    }
  }

  function finish() {
    onSuccess?.(result);
    onClose();
  }

  const busy = step === 'processing';
  const lowWallet = walletBalance < amount;
  return (
    <Modal open={open} onClose={busy ? undefined : step === 'success' ? finish : onClose} title="Secure Checkout" size="md">
      {step === 'success' ? (
        <div className="py-4 text-center">
          <div className="pulse-ring mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green/15"><CheckCircle2 className="h-9 w-9 text-green" /></div>
          <h4 className="mt-5 text-xl font-bold">{result?.duplicate ? 'Payment received' : 'Payment successful'}</h4>
          <p className="mt-1 text-sm text-muted">{title} — {inr(result?.transaction?.amount ?? amount)} via {result?.transaction?.method || 'online payment'}</p>
          {result?.transaction?.id && <p className="mt-1 text-xs text-muted">Reference: {result.transaction.id}</p>}
          {result?.duplicate && <p className="mt-3 rounded-lg bg-orange/10 px-3 py-2 text-xs text-orange">You already owned this item, so this payment will be refunded by our team.</p>}
          <button className="btn-primary mt-6 w-full" onClick={finish}>Continue</button>
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-white/5 bg-ink-2 p-4">
            <p className="text-xs uppercase tracking-wider text-muted">You are unlocking</p>
            <p className="mt-1 font-semibold">{title}</p>
            {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
            <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-3">
              <span className="text-sm text-muted">Amount payable</span>
              <span className="font-display text-2xl font-bold">{inr(amount)}</span>
            </div>
          </div>

          <p className="label mt-5">Choose a payment option</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {METHODS.map((m) => {
              const Icon = m.icon;
              const isWallet = m.id === 'wallet';
              return (
                <button key={m.id} type="button" disabled={busy || (isWallet && lowWallet)} onClick={() => setMethod(m.id)}
                  className={cx('flex items-start gap-3 rounded-xl border p-3 text-left transition-all disabled:cursor-not-allowed disabled:opacity-50', method === m.id ? 'border-brand bg-brand/10' : 'border-white/10 hover:border-white/25')}
                  aria-pressed={method === m.id}>
                  <Icon className={cx('mt-0.5 h-5 w-5', method === m.id ? 'text-brand' : 'text-muted')} />
                  <span>
                    <span className="block text-sm font-medium">{m.label}</span>
                    <span className={cx('block text-[11px]', isWallet && lowWallet ? 'text-orange' : 'text-muted')}>
                      {isWallet ? `Balance ${inr(walletBalance)}${lowWallet ? ' — too low' : ''}` : m.hint}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {step === 'error' && <p className="mt-4 rounded-lg bg-red/10 px-3 py-2 text-sm text-red" role="alert">{error}</p>}

          <div className="mt-5 flex items-start gap-2 rounded-lg bg-white/[.04] px-3 py-2.5 text-xs text-muted">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-green" />
            <span>Online payments are processed by Razorpay. TUSKY never sees your card or UPI details, and access is granted only after the payment is verified on our server.</span>
          </div>

          <button className="btn-primary btn-lg mt-5 w-full" onClick={pay} disabled={busy}>
            {busy ? <><span className="spinner" /> {method === 'wallet' ? 'Paying from wallet…' : 'Waiting for payment…'}</> : `Pay ${inr(amount)}`}
          </button>
        </>
      )}
    </Modal>
  );
}
