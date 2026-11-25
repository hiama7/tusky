// My Purchases — every match this user has unlocked (paid or free trial).
import { Link } from 'react-router-dom';
import { ShoppingBag, Unlock } from 'lucide-react';
import { CardSkeleton, EmptyState, PageHeader, StatCard, TeamCrest } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useAsync } from '../../hooks/useAsync';
import { getPurchases } from '../../services/purchases';
import { sportById } from '../../data/demo/sports';
import { fmtDate, fmtDateTime, inr } from '../../utils/format';
import { IndianRupee, Gift } from 'lucide-react';

export default function Purchases() {
  const { user } = useAuth();
  const { data, loading } = useAsync(() => getPurchases(user.id), [user.id]);
  const list = data || [];
  const spent = list.reduce((s, p) => s + (p.amount || 0), 0);

  return (
    <>
      <PageHeader title="My Purchases" subtitle="Predictions you have unlocked. Each purchase unlocks one match only." />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard icon={ShoppingBag} label="Unlocked predictions" value={loading ? '…' : list.length} />
        <StatCard icon={IndianRupee} color="green" label="Total spent (demo)" value={loading ? '…' : inr(spent)} />
        <StatCard icon={Gift} color="purple" label="Free trial unlocks" value={loading ? '…' : list.filter((p) => p.method === 'Free Trial').length} />
      </div>
      {loading ? (
        <div className="grid gap-4 md:grid-cols-2"><CardSkeleton count={4} className="h-36" /></div>
      ) : list.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {list.map((p) => (
            <article key={p.matchId} className="glass card-lift p-5 page-enter">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex -space-x-2"><TeamCrest team={p.match.teamA} size="sm" /><TeamCrest team={p.match.teamB} size="sm" /></div>
                  <div><p className="font-semibold">{p.match.teamA.name} vs {p.match.teamB.name}</p><p className="text-xs text-muted">{sportById(p.match.sport)?.name} · {p.match.tournament}</p></div>
                </div>
                <span className="badge-green"><Unlock className="h-3 w-3" /> Unlocked</span>
              </div>
              <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-white/5 pt-4 text-xs">
                <div><dt className="text-muted">Paid</dt><dd className="mt-0.5 font-semibold">{p.amount ? inr(p.amount) : 'Free'}</dd></div>
                <div><dt className="text-muted">Method</dt><dd className="mt-0.5 font-semibold">{p.method}</dd></div>
                <div><dt className="text-muted">Unlocked</dt><dd className="mt-0.5 font-semibold">{fmtDateTime(p.date)}</dd></div>
              </dl>
              <div className="mt-4 flex items-center justify-between">
                <span className="text-xs text-muted">Match on {fmtDate(p.match.date)}</span>
                <Link to={`/user/match/${p.matchId}`} className="btn-primary btn-sm">View prediction</Link>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState icon={ShoppingBag} title="No purchases yet" text="Unlock any match prediction, or use your free trial, and it will appear here." action={<Link to="/user/matches" className="btn-primary">Browse matches</Link>} />
      )}
    </>
  );
}
