// =========================================================
// DEMO payment modal — no real money moves and no card details are collected.
// Stage 2: replace `onPay` with a call that creates a gateway order on the PHP
// server, opens the gateway's checkout, then verifies the signature server-side.
// =========================================================
import { useEffect, useState } from 'react';
import { Smartphone, CreditCard, Landmark, Wallet, CheckCircle2, ShieldAlert } from 'lucide-react';
import { Modal } from '../ui';
import { cx, inr } from '../../utils/format';

const METHODS = [
  { id: 'UPI', label: 'UPI', icon: Smartphone, hint: 'Demo VPA: demo@upi' },
  { id: 'Card', label: 'Debit / Credit Card', icon: CreditCard, hint: 'Demo card •••• 4242' },
  { id: 'Net Banking', label: 'Net Banking', icon: Landmark, hint: 'Demo Bank' },
  { id: 'Wallet', label: 'TUSKY Wallet', icon: Wallet, hint: 'Uses your demo wallet balance' },
];

/**
 * props: open, onClose, title (e.g. match name), subtitle, amount, walletBalance,
 *        onPay(method) → Promise (throws on failure), onSuccess(result)
 */
export default function PaymentModal({ open, onClose, title, subtitle, amount, walletBalance = 0, onPay, onSuccess }) {
  const [method, setMethod] = useState('UPI');
  const [step, setStep] = useState('select'); // select | processing | success | error
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (open) { setStep('select'); setError(''); setMethod('UPI'); setResult(null); }
  }, [open]);

  async function pay() {
    setStep('processing');
    try {
      const res = await onPay(method);
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
  return (
    <Modal open={open} onClose={busy ? undefined : step === 'success' ? finish : onClose} title="Secure Checkout (Demo)" size="md">
      {step === 'success' ? (
        <div className="py-4 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green/15 pulse-ring"><CheckCircle2 className="h-9 w-9 text-green" /></div>
          <h4 className="mt-5 text-xl font-bold">Demo payment successful</h4>
          <p className="mt-1 text-sm text-muted">{title} — {inr(amount)} via {method}</p>
          {result?.id && <p className="mt-1 text-xs text-muted">Reference: {result.id}</p>}
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
              const lowWallet = m.id === 'Wallet' && walletBalance < amount;
              return (
                <button
                  key={m.id}
                  type="button"
                  disabled={busy}
                  onClick={() => setMethod(m.id)}
                  className={cx('flex items-start gap-3 rounded-xl border p-3 text-left transition-all', method === m.id ? 'border-blue bg-blue/10' : 'border-white/10 hover:border-white/25')}
                  aria-pressed={method === m.id}
                >
                  <Icon className={cx('mt-0.5 h-5 w-5', method === m.id ? 'text-blue' : 'text-muted')} />
                  <span>
                    <span className="block text-sm font-medium">{m.label}</span>
                    <span className={cx('block text-[11px]', lowWallet ? 'text-orange' : 'text-muted')}>
                      {m.id === 'Wallet' ? `Balance ${inr(walletBalance)}${lowWallet ? ' — low' : ''}` : m.hint}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {step === 'error' && <p className="mt-4 rounded-lg bg-red/10 px-3 py-2 text-sm text-red">{error}</p>}

          <div className="mt-5 flex items-start gap-2 rounded-lg bg-orange/[.07] px-3 py-2.5 text-xs text-orange/90">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span><b>Demo payment.</b> No real money is charged and no payment details are collected. A real payment gateway will be connected in Stage 2.</span>
          </div>

          <button className="btn-primary btn-lg mt-5 w-full" onClick={pay} disabled={busy}>
            {busy ? <><span className="spinner" /> Processing demo payment…</> : `Pay ${inr(amount)} (Demo)`}
          </button>
        </>
      )}
    </Modal>
  );
}
