// =============================================================================
// Free trial — one free match prediction per account, enforced by the server
// (MySQL unique constraint + locked transaction). Logging out, clearing browser
// storage or using another device cannot reset it.
// =============================================================================
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Gift, CheckCircle2, CreditCard, Repeat, PartyPopper, Lock, Search } from 'lucide-react';
import { EmptyState, Modal, Skeleton, TeamCrest } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useAsync } from '../../hooks/useAsync';
import { getPredictions } from '../../services/matches';
import { activateTrial, getTrial } from '../../services/trial';
import { cx, fmtDateTime, inr } from '../../utils/format';

const FEATURES = [
  { icon: Gift, title: 'One free match prediction', text: 'Full probabilities, analysis and insights.' },
  { icon: CreditCard, title: 'No payment required', text: 'Activate without adding any payment method.' },
  { icon: Repeat, title: 'One-time usage', text: 'Choose wisely — it can be used only once.' },
];

export default function FreeTrial() {
  const { user } = useAuth();
  const toast = useToast();
  const [selected, setSelected] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');

  const { data: trial, error } = useAsync(() => getTrial(), [user.id]);
  const { data: predictions, loading } = useAsync(() => getPredictions(), [user.id]);

  const eligible = (predictions || [])
    .filter((p) => !p.unlocked && ['UPCOMING', 'LIVE', 'POSTPONED'].includes(p.match.status))
    .map((p) => p.match)
    .filter((m) => !q || `${m.teamA.name} ${m.teamB.name} ${m.tournament}`.toLowerCase().includes(q.toLowerCase()));
  const used = trial?.status === 'used';

  async function activate() {
    setBusy(true);
    try {
      await activateTrial(selected.id);
      toast.success(`${selected.teamA.name} vs ${selected.teamB.name} is now unlocked.`, 'Free trial activated');
      setConfirm(false);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (error) return <EmptyState title="Couldn’t load your trial status" text={error.message} />;
  return (
    <div className="space-y-8">
      <section className="glass relative overflow-hidden p-8 text-center md:p-12">
        <div className="grid-bg absolute inset-0" />
        <div className="blob left-0 top-0 h-64 w-64 bg-green opacity-30" />
        <div className="blob bottom-0 right-0 h-64 w-64 bg-purple opacity-30" style={{ animationDelay: '-4s' }} />
        <div className="relative">
          <div className="mx-auto flex h-16 w-16 animate-float items-center justify-center rounded-2xl bg-gradient-to-br from-green to-blue"><Gift className="h-8 w-8 text-white" /></div>
          <h1 className="mt-6 text-3xl font-bold md:text-5xl">Your First Prediction <span className="text-gradient">Is On Us!</span></h1>
          <p className="mx-auto mt-3 max-w-xl text-muted">Pick any upcoming match and unlock its complete prediction for free.</p>
          <div className="mt-5 flex justify-center">
            {trial ? (
              <span className={cx('badge px-4 py-1.5 text-xs', used ? 'bg-white/10 text-muted' : 'bg-green/15 text-green')}>Trial status: {used ? 'USED' : 'AVAILABLE'}</span>
            ) : <Skeleton className="h-7 w-40 rounded-full" />}
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        {FEATURES.map(({ icon: Icon, title, text }) => (
          <div key={title} className="card card-lift"><div className="stat-icon bg-green/15 text-green"><Icon className="h-5 w-5" /></div><p className="mt-4 font-semibold">{title}</p><p className="mt-1 text-sm text-muted">{text}</p></div>
        ))}
      </div>

      {used ? (
        <section className="card page-enter text-center">
          <PartyPopper className="mx-auto h-10 w-10 text-green" />
          <h2 className="mt-3 text-xl font-bold">Free trial already used</h2>
          {trial.match ? (
            <p className="mt-1 text-sm text-muted">You unlocked <b className="text-white">{trial.match.teamA.name} vs {trial.match.teamB.name}</b> on {fmtDateTime(trial.activatedAt)}. All other matches remain locked.</p>
          ) : <p className="mt-1 text-sm text-muted">Activated on {fmtDateTime(trial.activatedAt)}.</p>}
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {trial.matchId && <Link to={`/user/match/${trial.matchId}`} className="btn-primary">View my free prediction</Link>}
            <Link to="/user/subscription" className="btn-ghost">See subscription plans</Link>
          </div>
        </section>
      ) : trial && (
        <section>
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <h2 className="text-xl font-semibold">1. Select one match</h2>
            <label className="relative md:w-72"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" /><input className="input pl-9" placeholder="Search matches…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search matches" /></label>
          </div>
          {!loading && !eligible.length ? <EmptyState title="No eligible matches right now" text="New predictions are published regularly — check back soon." /> : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {loading ? Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />) : eligible.map((m) => (
                <button key={m.id} type="button" onClick={() => setSelected(m)} className={cx('glass flex items-center gap-3 p-4 text-left transition-all', selected?.id === m.id ? 'ring-2 ring-green' : 'hover:border-white/20')} aria-pressed={selected?.id === m.id}>
                  <div className="flex -space-x-2"><TeamCrest team={m.teamA} size="sm" /><TeamCrest team={m.teamB} size="sm" /></div>
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{m.teamA.name} vs {m.teamB.name}</p><p className="truncate text-xs text-muted">{m.sportName} · {fmtDateTime(m.date)}</p></div>
                  {selected?.id === m.id ? <CheckCircle2 className="h-5 w-5 text-green" /> : <span className="flex items-center gap-1 text-xs text-muted"><Lock className="h-3 w-3" />{inr(m.price)}</span>}
                </button>
              ))}
            </div>
          )}
          <div className="glass sticky bottom-4 mt-6 flex flex-col items-center justify-between gap-3 p-4 shadow-2xl sm:flex-row">
            <p className="text-sm">{selected ? <>2. Confirm: <b>{selected.teamA.name} vs {selected.teamB.name}</b> <span className="text-muted">(worth {inr(selected.price)})</span></> : <span className="text-muted">Select a match above to continue.</span>}</p>
            <button className="btn-success btn-lg w-full sm:w-auto" disabled={!selected} onClick={() => setConfirm(true)}><Gift className="h-4 w-4" /> ACTIVATE FREE TRIAL</button>
          </div>
        </section>
      )}

      <p className="text-center text-xs text-muted">One free trial per account. It is recorded on our servers, so it can’t be reset by logging out or clearing your browser.</p>

      <Modal open={confirm} onClose={() => !busy && setConfirm(false)} title="Confirm free trial activation" size="sm"
        footer={<><button className="btn-ghost" onClick={() => setConfirm(false)} disabled={busy}>Cancel</button><button className="btn-success" onClick={activate} disabled={busy}>{busy ? <><span className="spinner" /> Activating…</> : 'Yes, unlock this match'}</button></>}>
        {selected && <p className="text-sm text-muted">This will use your one-time free trial to unlock <b className="text-white">{selected.teamA.name} vs {selected.teamB.name}</b>. Other matches will stay locked and the trial can’t be moved to another match later.</p>}
      </Modal>
    </div>
  );
}
