// Per-match pricing + subscription plan cards, all from the API:
//   * single-match prices are the live prices of upcoming matches, by sport
//   * plans come from GET /api/subscriptions/plans
// `onChoose(plan)` is optional — without it, buttons go to the subscription page (or register).
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Lock, Sparkles } from 'lucide-react';
import { CardSkeleton } from '../ui';
import { useAuth } from '../../context/AuthContext';
import { useAsync } from '../../hooks/useAsync';
import { getMatches } from '../../services/matches';
import { getPlans } from '../../services/purchases';
import { cx, inr } from '../../utils/format';

export default function PricingPlans({ onChoose, activePlanId }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: plans, loading } = useAsync(() => getPlans(), []);
  const { data: matches } = useAsync(() => getMatches({ upcoming: true }), []);
  const choose = (plan) => (onChoose ? onChoose(plan) : navigate(user ? `/user/subscription?plan=${plan.id}` : '/register'));

  const bySport = useMemo(() => {
    const map = {};
    for (const m of matches || []) {
      const r = (map[m.sportName] ||= { min: m.price, max: m.price });
      r.min = Math.min(r.min, m.price);
      r.max = Math.max(r.max, m.price);
    }
    return Object.entries(map).sort((a, b) => a[1].min - b[1].min);
  }, [matches]);
  const all = bySport.flatMap(([, r]) => [r.min, r.max]);

  return (
    <>
    <div className="grid gap-5 lg:grid-cols-4">
      <div className="card card-lift flex flex-col">
        <div className="stat-icon bg-orange/15 text-orange"><Lock className="h-5 w-5" /></div>
        <h3 className="mt-4 text-lg font-semibold">Single Match</h3>
        <p className="text-sm text-muted">Pay only for the predictions you want.</p>
        <p className="mt-4 font-display text-3xl font-bold">
          {all.length ? <>{inr(Math.min(...all))}{Math.max(...all) > Math.min(...all) && <span className="text-base font-medium text-muted"> – {inr(Math.max(...all))}</span>}</> : '—'}
        </p>
        <ul className="mt-4 space-y-2 text-sm">
          {bySport.slice(0, 6).map(([sport, r]) => (
            <li key={sport} className="flex justify-between gap-2 border-b border-white/5 pb-2 text-muted"><span>{sport}</span><span className="font-semibold text-white">{r.min === r.max ? inr(r.min) : `${inr(r.min)}–${r.max}`}</span></li>
          ))}
          {!bySport.length && <li className="text-muted">Prices appear when matches are published.</li>}
        </ul>
        <div className="mt-auto pt-6"><button onClick={() => navigate(user ? '/user/matches' : '/register')} className="btn-ghost w-full">Browse matches</button></div>
      </div>

      {loading ? <CardSkeleton count={3} className="h-96" /> : (plans || []).map((p) => (
        <div key={p.id} className={cx('card card-lift relative flex flex-col', p.popular && 'ring-gradient border-accent/40 shadow-[0_24px_70px_-25px_rgba(255,255,255,.85)]')}>
          {p.popular && <span className="badge absolute -top-3 left-1/2 -translate-x-1/2 bg-gradient-to-r from-solid to-deep text-ink"><Sparkles className="h-3 w-3" /> Recommended</span>}
          <h3 className="text-lg font-semibold">{p.name}</h3>
          <p className="text-sm text-muted">{p.description || (p.allSports ? 'Every sport while active.' : 'Selected sports while active.')}</p>
          <p className="mt-4 font-display text-3xl font-bold">{inr(p.price)}<span className="text-base font-medium text-muted">/{p.period}</span></p>
          <ul className="mt-4 space-y-2.5 text-sm">
            {p.features.map((f) => <li key={f} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-green" />{f}</li>)}
            {!p.allSports && <li className="flex gap-2 text-muted"><Check className="mt-0.5 h-4 w-4 shrink-0 text-muted" />Covers: {p.sports.join(', ')}</li>}
          </ul>
          <div className="mt-auto pt-6">
            <button onClick={() => choose(p)} disabled={activePlanId === p.id} className={cx('w-full', p.popular ? 'btn-primary' : 'btn-ghost')}>
              {activePlanId === p.id ? 'Current plan' : `Choose ${p.name}`}
            </button>
          </div>
        </div>
      ))}
    </div>
    {bySport.length > 0 && (
      <p className="mt-4 text-center text-xs text-muted">Sports with matches listed now: {bySport.map(([sport]) => sport).join(', ')}. A plan can only unlock listed matches.</p>
    )}
    </>
  );
}
