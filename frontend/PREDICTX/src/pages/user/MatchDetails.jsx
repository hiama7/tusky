// =========================================================
// Match prediction page — the core feature.
// Locked: values are blurred behind an "Unlock" overlay.
// Unlocked (purchase / free trial / subscription): full analysis + chart.
// The SERVER decides whether the viewer may see the prediction: when locked,
// the API returns only { locked, price, available } — no probabilities or analysis.
// =========================================================
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Lock, MapPin, CalendarDays, Clock3, Trophy, ArrowLeft, Gift, Crown, Sparkles, ShieldAlert,
  Users, BarChart3, Swords, Lightbulb, Percent, CheckCircle2, Unlock, Gauge,
} from 'lucide-react';
import { DemoTag, EmptyState, Modal, ProbBar, Skeleton, TeamCrest } from '../../components/ui';
import ProbabilityChart from '../../components/match/ProbabilityChart';
import PaymentModal from '../../components/match/PaymentModal';
import LeagueTable from '../../components/match/LeagueTable';
import { useToast } from '../../context/ToastContext';
import { useAsync } from '../../hooks/useAsync';
import { getMatch, getPrediction } from '../../services/matches';
import { getWallet } from '../../services/purchases';
import { activateTrial, getTrial } from '../../services/trial';
import { cx, fmtDate, fmtTime, inr, startsIn } from '../../utils/format';

/** Placeholder rendered under the blur — the real values are never sent to a locked viewer. */
const LOCKED_PLACEHOLDER = {
  probA: 50, probB: 50, probDraw: null, confidence: '—', summary: 'Unlock this match to read the full analysis for this fixture.',
  teamA: { form: ['?', '?', '?', '?', '?'], strengths: ['Hidden', 'Hidden'], weaknesses: ['Hidden'] },
  teamB: { form: ['?', '?', '?', '?', '?'], strengths: ['Hidden', 'Hidden'], weaknesses: ['Hidden'] },
  players: [{ name: 'Player ••••', team: 'A', stat: '•• · ••', rating: 80 }, { name: 'Player ••••', team: 'A', stat: '•• · ••', rating: 70 }, { name: 'Player ••••', team: 'B', stat: '•• · ••', rating: 75 }, { name: 'Player ••••', team: 'B', stat: '•• · ••', rating: 65 }],
  h2h: { played: 0, aWins: 0, bWins: 0, draws: 0 },
  insights: ['Hidden insight ••••••••••••', 'Hidden insight ••••••••••', 'Hidden insight •••••••••••••'],
};

function Panel({ icon: Icon, title, children, className = '' }) {
  return (
    <section className={cx('card', className)}>
      <h3 className="mb-4 flex items-center gap-2 font-semibold"><Icon className="h-4 w-4 text-brand" /> {title}</h3>
      {children}
    </section>
  );
}

function FormDots({ form }) {
  return (
    <div className="flex gap-1">
      {form.map((r, i) => (
        <span key={i} className={cx('flex h-6 w-6 items-center justify-center rounded-md text-[10px] font-bold', r === 'W' ? 'bg-green/20 text-green' : r === 'L' ? 'bg-red/20 text-red' : 'bg-white/10 text-muted')}>{r}</span>
      ))}
    </div>
  );
}

/** The analysis sections — rendered blurred (with placeholder data) when locked. */
function Analysis({ match, p, locked }) {
  // The ML model has no player or strengths data: hide those blocks rather than show empty ones.
  const hasNotes = [p.teamA, p.teamB].some((t) => t.strengths.length || t.weaknesses.length);
  return (
    <div className={cx('grid gap-5 lg:grid-cols-2', locked && 'locked-blur')} aria-hidden={locked}>
      <Panel icon={Users} title="Team analysis" className="lg:col-span-2">
        <div className="grid gap-6 md:grid-cols-2">
          {[['teamA', match.teamA], ['teamB', match.teamB]].map(([key, team]) => (
            <div key={key}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-medium"><TeamCrest team={team} size="sm" /> {team.name}</div>
                <FormDots form={p[key].form} />
              </div>
              {hasNotes && <>
              <p className="mt-4 text-xs uppercase tracking-wider text-muted">Strengths</p>
              <ul className="mt-2 space-y-1.5 text-sm">{p[key].strengths.map((s, i) => <li key={i} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green" />{s}</li>)}</ul>
              <p className="mt-4 text-xs uppercase tracking-wider text-muted">Watch-outs</p>
              <ul className="mt-2 space-y-1.5 text-sm">{p[key].weaknesses.map((s, i) => <li key={i} className="flex gap-2"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-orange" />{s}</li>)}</ul>
              </>}
            </div>
          ))}
        </div>
      </Panel>

      {p.players.length > 0 && <Panel icon={BarChart3} title="Player statistics">
        <ul className="space-y-4">
          {p.players.map((pl, i) => (
            <li key={i}>
              <div className="mb-1.5 flex items-center justify-between text-sm">
                <span><span className="font-medium">{pl.name}</span> <span className="text-xs text-muted">· {pl.team === 'A' ? match.teamA.short : match.teamB.short}</span></span>
                <span className="text-xs text-muted">{pl.stat}</span>
              </div>
              <ProbBar value={pl.rating} color={pl.team === 'A' ? match.teamA.color : match.teamB.color} delay={i * 120} />
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[11px] text-muted">Form rating out of 100{match.isDemo ? ' (sample data)' : ''}.</p>
      </Panel>}

      <Panel icon={Swords} title="Head-to-head record" className={p.players.length ? '' : 'lg:col-span-2'}>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="rounded-xl bg-white/5 p-3"><p className="font-display text-2xl font-bold" style={{ color: match.teamA.color }}>{p.h2h.aWins}</p><p className="text-xs text-muted">{match.teamA.short} wins</p></div>
          <div className="rounded-xl bg-white/5 p-3"><p className="font-display text-2xl font-bold text-muted">{p.h2h.draws}</p><p className="text-xs text-muted">Draws / NR</p></div>
          <div className="rounded-xl bg-white/5 p-3"><p className="font-display text-2xl font-bold" style={{ color: match.teamB.color }}>{p.h2h.bWins}</p><p className="text-xs text-muted">{match.teamB.short} wins</p></div>
        </div>
        <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-white/5">
          {p.h2h.played > 0 && (
            <>
              <span className="bar-fill" style={{ width: `${(p.h2h.aWins / p.h2h.played) * 100}%`, background: match.teamA.color }} />
              <span style={{ width: `${(p.h2h.draws / p.h2h.played) * 100}%` }} className="bg-white/20" />
              <span className="bar-fill" style={{ width: `${(p.h2h.bWins / p.h2h.played) * 100}%`, background: match.teamB.color, animationDelay: '200ms' }} />
            </>
          )}
        </div>
        <p className="mt-2 text-xs text-muted">{p.h2h.played} meetings in total</p>
      </Panel>

      <Panel icon={Lightbulb} title="Match insights" className="lg:col-span-2">
        <ul className="grid gap-3 md:grid-cols-3">
          {p.insights.map((t, i) => <li key={i} className="rounded-xl border border-white/5 bg-white/[.03] p-4 text-sm"><Sparkles className="mb-2 h-4 w-4 text-accent" />{t}</li>)}
        </ul>
      </Panel>
    </div>
  );
}

export default function MatchDetails() {
  const { id } = useParams();
  const toast = useToast();
  const [payOpen, setPayOpen] = useState(false);
  const [trialOpen, setTrialOpen] = useState(false);
  const [trialBusy, setTrialBusy] = useState(false);
  const [justUnlocked, setJustUnlocked] = useState(false);

  const { data, loading, error } = useAsync(async () => {
    const [match, access, trial, wallet] = await Promise.all([getMatch(id), getPrediction(id), getTrial(), getWallet()]);
    return { match, access, trial, wallet };
  }, [id]);

  if (loading) return <div className="space-y-5"><Skeleton className="h-56 rounded-2xl" /><Skeleton className="h-72 rounded-2xl" /><Skeleton className="h-64 rounded-2xl" /></div>;
  if (error || !data) return <EmptyState title="Match not found" text={error?.status === 404 ? 'It may have been removed by an administrator.' : error?.message} action={<Link to="/user/matches" className="btn-primary">Browse matches</Link>} />;

  const { match, access, trial, wallet } = data;
  const unlocked = access.locked === false;
  const reason = access.unlockReason; // 'purchase' | 'trial' | 'subscription'
  const available = unlocked || access.available;
  const p = unlocked ? access.prediction : LOCKED_PLACEHOLDER;
  const threeWay = unlocked && p.probDraw !== null;
  const onSale = ['UPCOMING', 'LIVE', 'POSTPONED'].includes(match.status);

  async function confirmTrial() {
    setTrialBusy(true);
    try {
      await activateTrial(match.id);
      toast.success(`${match.teamA.name} vs ${match.teamB.name} unlocked with your free trial.`, 'Free trial used');
      setTrialOpen(false);
      setJustUnlocked(true);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setTrialBusy(false);
    }
  }

  const reasonLabel = { purchase: 'Purchased', trial: 'Unlocked with free trial', subscription: 'Included in your subscription' }[reason];

  return (
    <div className="space-y-6">
      <Link to="/user/matches" className="inline-flex items-center gap-2 text-sm text-muted hover:text-white"><ArrowLeft className="h-4 w-4" /> All matches</Link>

      {/* Match header */}
      <section className="glass relative overflow-hidden p-6 md:p-8">
        <div className="relative">
          <div className="flex flex-wrap items-center gap-2">
            <span className="badge-muted" style={{ color: match.sportColor }}>{match.sportName}</span>
            <span className="badge-brand">{match.tournament}</span>
            <span className="badge-muted">{match.status === 'UPCOMING' ? startsIn(match.date) : match.status}</span>
            {match.isDemo && <DemoTag>Sample fixture</DemoTag>}
            {unlocked && <span className="badge-green"><Unlock className="h-3 w-3" /> {reasonLabel}</span>}
          </div>
          <h1 className="sr-only">{match.teamA.name} vs {match.teamB.name}</h1>
          <div className="mt-8 flex items-center justify-between gap-4">
            <div className="flex flex-1 flex-col items-center gap-3 text-center md:flex-row md:text-left">
              <TeamCrest team={match.teamA} size="lg" />
              <p className="font-display text-xl font-bold md:text-3xl">{match.teamA.name}</p>
            </div>
            <span className="font-display text-xl font-bold text-muted md:text-2xl">VS</span>
            <div className="flex flex-1 flex-col-reverse items-center gap-3 text-center md:flex-row md:justify-end md:text-right">
              <p className="font-display text-xl font-bold md:text-3xl">{match.teamB.name}</p>
              <TeamCrest team={match.teamB} size="lg" />
            </div>
          </div>
          <div className="mt-8 grid gap-3 border-t border-white/5 pt-5 text-sm text-muted sm:grid-cols-2 lg:grid-cols-4">
            <p className="flex items-center gap-2"><Trophy className="h-4 w-4" /> {match.tournament}</p>
            <p className="flex items-center gap-2"><CalendarDays className="h-4 w-4" /> {fmtDate(match.date, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}</p>
            <p className="flex items-center gap-2"><Clock3 className="h-4 w-4" /> {fmtTime(match.date)} IST</p>
            <p className="flex items-center gap-2"><MapPin className="h-4 w-4" /> {match.venue}</p>
          </div>
          {match.result && (
            <p className="mt-4 rounded-xl bg-green/10 px-4 py-3 text-sm text-green"><b>Result:</b> {match.result.description}{match.result.score ? ` (${match.result.score})` : ''}</p>
          )}
        </div>
      </section>

      {!available ? (
        <EmptyState icon={Percent} title="Prediction coming soon" text="Our analysts haven’t published a prediction for this match yet. Check back closer to the start time." />
      ) : (
        <>
          {/* Prediction card */}
          <section className="glass relative overflow-hidden">
            <div className={cx('grid gap-6 p-6 md:p-8 lg:grid-cols-5', !unlocked && 'locked-blur')} aria-hidden={!unlocked}>
              <div className="lg:col-span-3">
                <p className="eyebrow">Win probability</p>
                <div className="mt-5 space-y-5">
                  <div>
                    <div className="mb-2 flex items-end justify-between"><span className="font-semibold">{match.teamA.name} Winning Probability</span><span className="font-display text-3xl font-bold" style={{ color: match.teamA.color }}>{p.probA}%</span></div>
                    <ProbBar value={p.probA} color={match.teamA.color} />
                  </div>
                  {threeWay && (
                    <div>
                      <div className="mb-2 flex items-end justify-between"><span className="font-semibold">Draw</span><span className="font-display text-3xl font-bold text-muted">{p.probDraw}%</span></div>
                      <ProbBar value={p.probDraw} color="#A7B4D6" delay={100} />
                    </div>
                  )}
                  <div>
                    <div className="mb-2 flex items-end justify-between"><span className="font-semibold">{match.teamB.name} Winning Probability</span><span className="font-display text-3xl font-bold" style={{ color: match.teamB.color }}>{p.probB}%</span></div>
                    <ProbBar value={p.probB} color={match.teamB.color} delay={200} />
                  </div>
                </div>
                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <span className="badge-accent"><Gauge className="h-3 w-3" /> Confidence: {p.confidence}</span>
                  {unlocked && <span className="badge-muted">{p.source === 'MODEL' ? `Model ${p.modelVersion || ''}` : 'Analyst prediction'} · v{p.version}</span>}
                  {unlocked && p.isDemo && <DemoTag>Sample content</DemoTag>}
                </div>
                <p className="mt-4 text-sm leading-relaxed text-muted">{p.summary}</p>
                {unlocked && (p.pitch || p.weather) && (
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {p.pitch && <p className="rounded-xl bg-white/[.03] p-3 text-xs text-muted"><b className="text-white">Pitch / conditions:</b> {p.pitch}</p>}
                    {p.weather && <p className="rounded-xl bg-white/[.03] p-3 text-xs text-muted"><b className="text-white">Weather:</b> {p.weather}</p>}
                  </div>
                )}
              </div>
              <div className="lg:col-span-2">
                {unlocked ? <ProbabilityChart match={match} prediction={p} /> : <div className="mx-auto h-64 w-64 rounded-full border-[18px] border-white/10" />}
              </div>
            </div>

            {/* Lock overlay */}
            {!unlocked && (
              <div className="absolute inset-0 flex items-center justify-center bg-ink/40 p-4">
                <div className="glass w-full max-w-md p-6 text-center shadow-2xl animate-scale-in" style={{ background: 'linear-gradient(160deg,rgba(9,14,29,.95),rgba(6,9,20,.95))' }}>
                  <div className="pulse-ring mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-orange/15"><Lock className="h-7 w-7 text-orange" /></div>
                  <h2 className="mt-4 text-xl font-bold">Unlock Detailed Match Prediction</h2>
                  <p className="mt-1 text-sm text-muted">Win probabilities, recent form, head-to-head and match insights.</p>
                  <p className="mt-4 font-display text-4xl font-bold">{inr(access.price)}</p>
                  {onSale ? (
                    <>
                      <button className="btn-primary btn-lg mt-5 w-full" onClick={() => setPayOpen(true)}>UNLOCK NOW – {inr(access.price)}</button>
                      {trial.status === 'available' && (
                        <button className="btn-success mt-2 w-full" onClick={() => setTrialOpen(true)}><Gift className="h-4 w-4" /> Use my free trial instead</button>
                      )}
                      <Link to="/user/subscription" className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted hover:text-white"><Crown className="h-3.5 w-3.5" /> Or unlock with a subscription</Link>
                    </>
                  ) : <p className="mt-4 text-sm text-muted">This match is {match.status.toLowerCase()}, so its prediction is no longer on sale.</p>}
                </div>
              </div>
            )}
          </section>

          {justUnlocked && unlocked && (
            <div className="flex items-center gap-3 rounded-xl border border-green/25 bg-green/10 px-4 py-3 text-sm text-green page-enter">
              <CheckCircle2 className="h-5 w-5" /> Prediction unlocked and added to <Link to="/user/purchases" className="font-semibold underline">My Purchases</Link>.
            </div>
          )}

          {/* Detailed analysis (blurred placeholders when locked) */}
          <div className="relative">
            {!unlocked && <p className="mb-3 flex items-center gap-2 text-sm text-muted"><Lock className="h-4 w-4 text-orange" /> Preview — unlock to reveal recent form, head-to-head records and match insights.</p>}
            <Analysis match={match} p={p} locked={!unlocked} />
          </div>

          <LeagueTable matchId={match.id} />

          <p className="text-center text-xs text-muted">Predictions are probabilistic analysis for entertainment and research. They never guarantee a result.</p>
        </>
      )}

      <PaymentModal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        title={`${match.teamA.name} vs ${match.teamB.name}`}
        subtitle={`${match.tournament} · ${fmtDate(match.date)}`}
        amount={access.price ?? match.price}
        walletBalance={wallet.balance}
        item={{ type: 'PREDICTION', matchId: match.id }}
        onSuccess={() => { setJustUnlocked(true); toast.success('Scroll down for the full analysis.', 'Prediction unlocked'); }}
      />

      <Modal open={trialOpen} onClose={() => !trialBusy && setTrialOpen(false)} title="Use your free trial?" size="sm"
        footer={<><button className="btn-ghost" onClick={() => setTrialOpen(false)} disabled={trialBusy}>Cancel</button><button className="btn-success" onClick={confirmTrial} disabled={trialBusy}>{trialBusy ? <><span className="spinner" /> Activating…</> : 'Confirm & unlock'}</button></>}>
        <p className="text-sm text-muted">Your free trial can be used <b className="text-white">once</b>. It will unlock only <b className="text-white">{match.teamA.name} vs {match.teamB.name}</b>; all other matches stay locked.</p>
      </Modal>
    </div>
  );
}
