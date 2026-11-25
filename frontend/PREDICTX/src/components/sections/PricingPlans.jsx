// Per-match pricing + subscription plan cards. `onChoose(plan)` is optional —
// without it, buttons send the visitor to the subscription page (or register).
import { useNavigate } from 'react-router-dom';
import { Check, Lock, Sparkles } from 'lucide-react';
import { PLANS, SINGLE_MATCH_PRICING } from '../../data/demo/plans';
import { useAuth } from '../../context/AuthContext';
import { cx, inr } from '../../utils/format';

export default function PricingPlans({ onChoose, activePlanId }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const choose = (plan) => (onChoose ? onChoose(plan) : navigate(user ? `/user/subscription?plan=${plan.id}` : '/register'));

  return (
    <div className="grid gap-5 lg:grid-cols-4">
      {/* Single match pricing */}
      <div className="card card-lift flex flex-col">
        <div className="stat-icon bg-orange/15 text-orange"><Lock className="h-5 w-5" /></div>
        <h3 className="mt-4 text-lg font-semibold">Single Match</h3>
        <p className="text-sm text-muted">Pay only for the predictions you want.</p>
        <p className="mt-4 font-display text-3xl font-bold">₹19<span className="text-base font-medium text-muted"> – ₹59</span></p>
        <ul className="mt-4 space-y-2 text-sm">
          {SINGLE_MATCH_PRICING.map((p) => (
            <li key={p.label} className="flex justify-between gap-2 border-b border-white/5 pb-2 text-muted"><span>{p.label}</span><span className="font-semibold text-white">₹{p.price}</span></li>
          ))}
        </ul>
        <div className="mt-auto pt-6"><button onClick={() => navigate(user ? '/user/matches' : '/register')} className="btn-ghost w-full">Browse matches</button></div>
      </div>

      {PLANS.map((p) => (
        <div key={p.id} className={cx('card card-lift relative flex flex-col', p.popular && 'border-blue/50 shadow-[0_20px_60px_-25px_rgba(56,107,255,.8)]')}>
          {p.popular && <span className="badge absolute -top-3 left-1/2 -translate-x-1/2 bg-gradient-to-r from-blue to-purple text-white"><Sparkles className="h-3 w-3" /> Most popular</span>}
          <h3 className="text-lg font-semibold">{p.name}</h3>
          <p className="text-sm text-muted">Unlimited predictions while active.</p>
          <p className="mt-4 font-display text-3xl font-bold">{inr(p.price)}<span className="text-base font-medium text-muted">/{p.period}</span></p>
          <ul className="mt-4 space-y-2.5 text-sm">
            {p.features.map((f) => <li key={f} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-green" />{f}</li>)}
          </ul>
          <div className="mt-auto pt-6">
            <button onClick={() => choose(p)} disabled={activePlanId === p.id} className={cx('w-full', p.popular ? 'btn-primary' : 'btn-ghost')}>
              {activePlanId === p.id ? 'Current plan' : `Choose ${p.name}`}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
