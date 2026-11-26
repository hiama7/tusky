// User overview — data from GET /api/users/me/dashboard plus the match list:
// account & trial status, stats, upcoming matches, recent unlocks, favourite
// sports, recent news, notifications and the activity timeline.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, Gift, ShoppingBag, CalendarClock, Wallet, ArrowRight, Heart, Newspaper, Bell, History, Crown, Plus, Check } from 'lucide-react';
import { CardSkeleton, Chips, EmptyState, Modal, Skeleton, StatCard, TeamCrest } from '../../components/ui';
import MatchCard from '../../components/match/MatchCard';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useAsync } from '../../hooks/useAsync';
import { getMatches, getSports } from '../../services/matches';
import { getDashboard, setFavourites } from '../../services/purchases';
import { getNews } from '../../services/news';
import { cx, fmtDate, inr, timeAgo } from '../../utils/format';

function FavouriteSports({ favourites, sports }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState(favourites);
  const [busy, setBusy] = useState(false);
  const byId = Object.fromEntries((sports || []).map((s) => [s.id, s]));

  async function save() {
    setBusy(true);
    try {
      await setFavourites(picked);
      toast.success('Favourite sports updated.');
      setOpen(false);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <div className="mb-4 flex items-center justify-between"><h2 className="flex items-center gap-2 font-semibold"><Heart className="h-4 w-4 text-red" /> Favourite sports</h2><button className="btn-ghost btn-sm" onClick={() => { setPicked(favourites); setOpen(true); }}>Edit</button></div>
      {favourites.length ? (
        <div className="flex flex-wrap gap-2">
          {favourites.map((id) => byId[id] && <Link key={id} to={`/user/matches?sport=${id}`} className="chip" style={{ color: byId[id].color }}>{byId[id].name}</Link>)}
        </div>
      ) : <button onClick={() => setOpen(true)} className="flex items-center gap-2 text-sm text-muted hover:text-white"><Plus className="h-4 w-4" /> Add your favourite sports</button>}
      <Modal open={open} onClose={() => setOpen(false)} title="Favourite sports" size="sm" footer={<><button className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button><button className="btn-primary" onClick={save} disabled={busy}>{busy ? <span className="spinner" /> : 'Save'}</button></>}>
        <div className="grid grid-cols-2 gap-2">
          {(sports || []).map((s) => {
            const on = picked.includes(s.id);
            return (
              <button key={s.id} type="button" onClick={() => setPicked((p) => (on ? p.filter((x) => x !== s.id) : [...p, s.id]))} className={cx('flex items-center justify-between rounded-xl border px-3 py-2.5 text-sm transition', on ? 'border-blue bg-blue/10' : 'border-white/10 hover:border-white/25')} aria-pressed={on}>
                {s.name} {on && <Check className="h-4 w-4 text-blue" />}
              </button>
            );
          })}
        </div>
      </Modal>
    </section>
  );
}

const DOT = { purchase: 'bg-blue', trial: 'bg-green', wallet: 'bg-orange', subscription: 'bg-purple', account: 'bg-muted' };

export default function Dashboard() {
  const { user } = useAuth();
  const [sport, setSport] = useState('all');
  const { data: d, loading: dashLoading, error } = useAsync(() => getDashboard(), [user.id]);
  const { data: matches, loading } = useAsync(() => getMatches({ upcoming: true, sport }), [sport, user.id]);
  const { data: sports } = useAsync(() => getSports(), []);
  const { data: news } = useAsync(() => getNews({ limit: 4 }), [], { live: false });

  if (error) return <EmptyState title="Couldn’t load your dashboard" text={error.message} />;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const sub = d?.subscription;
  const trial = d?.trial;

  return (
    <div className="space-y-8">
      <section className="glass relative overflow-hidden p-6 md:p-8">
        <div className="blob -right-10 -top-10 h-56 w-56 bg-purple opacity-30" />
        <div className="relative flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm text-muted">{greeting},</p>
            <h1 className="mt-1 text-2xl font-bold md:text-3xl">{user.name} 👋</h1>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <span className="badge-green"><ShieldCheck className="h-3 w-3" /> Account {user.status || 'Active'}</span>
              {d && (sub ? <span className="badge-purple"><Crown className="h-3 w-3" /> {sub.plan?.name} until {fmtDate(sub.end)}</span> : <span className="badge-muted">No active subscription</span>)}
              {trial && <span className={trial.status === 'available' ? 'badge-blue' : 'badge-muted'}><Gift className="h-3 w-3" /> Free trial {trial.status === 'available' ? 'available' : 'used'}</span>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to="/user/matches" className="btn-primary">Browse matches <ArrowRight className="h-4 w-4" /></Link>
            {trial?.status === 'available' && <Link to="/user/free-trial" className="btn-success"><Gift className="h-4 w-4" /> Claim free prediction</Link>}
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={ShoppingBag} color="blue" label="Unlocked predictions" value={d ? d.stats.purchased : '…'} hint="Purchases + free trial" />
        <StatCard icon={CalendarClock} color="purple" label="Upcoming matches" value={d ? d.stats.upcomingMatches : '…'} hint="Across all sports" />
        <StatCard icon={Gift} color="green" label="Free trial status" value={trial ? (trial.status === 'available' ? 'Available' : 'Used') : '…'} hint={trial?.status === 'used' ? `Used ${fmtDate(trial.activatedAt)}` : 'One free prediction'} />
        <StatCard icon={Wallet} color="orange" label="Wallet balance" value={d ? inr(d.stats.walletBalance) : '…'} hint={<Link to="/user/wallet" className="hover:text-white">Manage wallet →</Link>} />
      </div>

      <section>
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h2 className="text-xl font-semibold">Upcoming Matches</h2>
          <Link to="/user/matches" className="text-sm text-blue hover:underline">View all</Link>
        </div>
        <div className="mb-4"><Chips options={[{ value: 'all', label: 'All' }, ...(sports || []).map((x) => ({ value: x.id, label: x.name }))]} value={sport} onChange={setSport} /></div>
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {loading ? <CardSkeleton count={3} className="h-72" /> : matches?.length ? matches.slice(0, 6).map((m) => <MatchCard key={m.id} match={m} />) : <div className="sm:col-span-2 xl:col-span-3"><EmptyState title="No upcoming matches for this sport" /></div>}
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-center justify-between"><h2 className="text-xl font-semibold">Recently Unlocked Predictions</h2><Link to="/user/purchases" className="text-sm text-blue hover:underline">My purchases</Link></div>
        {dashLoading ? <div className="grid gap-3 md:grid-cols-3"><CardSkeleton count={3} className="h-20" /></div> : d.recentPurchases.length ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {d.recentPurchases.map((p) => (
              <Link key={p.matchId} to={`/user/match/${p.matchId}`} className="glass card-lift flex items-center gap-3 p-4">
                <div className="flex -space-x-2"><TeamCrest team={p.match.teamA} size="sm" /><TeamCrest team={p.match.teamB} size="sm" /></div>
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{p.match.teamA.name} vs {p.match.teamB.name}</p><p className="text-xs text-muted">{p.method} · {timeAgo(p.date)}</p></div>
                <span className="badge-green">Unlocked</span>
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState icon={ShoppingBag} title="No unlocked predictions yet" text="Unlock a match or use your free trial — it will show up here." action={<Link to="/user/matches" className="btn-primary">Find a match</Link>} />
        )}
      </section>

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5">
          {d ? <FavouriteSports key={(d.user.favourites || []).join(',')} favourites={d.user.favourites || []} sports={sports} /> : <Skeleton className="h-32 rounded-2xl" />}
          <section className="card">
            <h2 className="mb-4 flex items-center gap-2 font-semibold"><Bell className="h-4 w-4 text-orange" /> Notifications</h2>
            {d?.notifications?.length ? (
              <ul className="space-y-3">
                {d.notifications.map((n) => <li key={n.id} className="text-sm"><p className={cx('font-medium', n.read && 'text-muted')}>{n.title}</p><p className="text-xs text-muted">{n.body}</p></li>)}
              </ul>
            ) : <p className="text-sm text-muted">No notifications yet.</p>}
          </section>
        </div>

        <section className="card">
          <div className="mb-4 flex items-center justify-between"><h2 className="flex items-center gap-2 font-semibold"><Newspaper className="h-4 w-4 text-blue" /> Recent news</h2><Link to="/user/news" className="text-xs text-blue hover:underline">All news</Link></div>
          {news?.items?.length ? (
            <ul className="space-y-4">
              {news.items.map((n) => (
                <li key={n.id}><Link to="/user/news" className="group flex gap-3">{n.image && <img src={n.image} alt="" className="h-14 w-20 shrink-0 rounded-lg object-cover" />}<span><span className="line-clamp-2 text-sm font-medium group-hover:text-blue">{n.title}</span><span className="text-[11px] text-muted">{n.category} · {timeAgo(n.date)}</span></span></Link></li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted">No news yet.</p>}
        </section>

        <section className="card">
          <h2 className="mb-4 flex items-center gap-2 font-semibold"><History className="h-4 w-4 text-purple" /> Activity timeline</h2>
          {d?.activity?.length ? (
            <ol>
              {d.activity.map((a) => (
                <li key={a.id} className="timeline-item">
                  <span className={cx('timeline-dot', DOT[a.kind] || 'bg-muted')} />
                  <p className="text-sm">{a.text}</p>
                  <p className="text-[11px] text-muted">{timeAgo(a.date)}</p>
                </li>
              ))}
            </ol>
          ) : <p className="text-sm text-muted">Your activity will appear here.</p>}
        </section>
      </div>
    </div>
  );
}
