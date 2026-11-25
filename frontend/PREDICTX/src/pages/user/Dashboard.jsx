// User overview: welcome, account/trial status, stats, upcoming matches,
// recently unlocked, favourite sports, recent news, notifications & activity.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, Gift, ShoppingBag, CalendarClock, Wallet, ArrowRight, Heart, Newspaper, Bell, History, Crown, Plus, Check } from 'lucide-react';
import { CardSkeleton, Chips, EmptyState, Modal, StatCard, StatusBadge, TeamCrest } from '../../components/ui';
import MatchCard from '../../components/match/MatchCard';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useAsync } from '../../hooks/useAsync';
import { getMatches } from '../../services/matches';
import { getPurchases, getSubscription, getWallet, isUnlocked } from '../../services/purchases';
import { getTrial } from '../../services/trial';
import { getNews } from '../../services/news';
import { getActivity, getNotifications } from '../../services/notifications';
import { updateProfile } from '../../services/auth';
import { SPORTS, sportById } from '../../data/demo/sports';
import { planById } from '../../data/demo/plans';
import { cx, fmtDate, inr, timeAgo } from '../../utils/format';

function FavouriteSports({ user }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState(user.favourites || []);
  async function save() {
    await updateProfile(user.id, { favourites: picked });
    toast.success('Favourite sports updated.');
    setOpen(false);
  }
  return (
    <section className="card">
      <div className="mb-4 flex items-center justify-between"><h2 className="flex items-center gap-2 font-semibold"><Heart className="h-4 w-4 text-red" /> Favourite sports</h2><button className="btn-ghost btn-sm" onClick={() => { setPicked(user.favourites || []); setOpen(true); }}>Edit</button></div>
      {user.favourites?.length ? (
        <div className="flex flex-wrap gap-2">
          {user.favourites.map((id) => { const s = sportById(id); return s && <Link key={id} to={`/user/matches?sport=${id}`} className="chip" style={{ color: s.color }}>{s.name}</Link>; })}
        </div>
      ) : <button onClick={() => setOpen(true)} className="flex items-center gap-2 text-sm text-muted hover:text-white"><Plus className="h-4 w-4" /> Add your favourite sports</button>}
      <Modal open={open} onClose={() => setOpen(false)} title="Favourite sports" size="sm" footer={<><button className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button><button className="btn-primary" onClick={save}>Save</button></>}>
        <div className="grid grid-cols-2 gap-2">
          {SPORTS.map((s) => {
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

export default function Dashboard() {
  const { user } = useAuth();
  const [sport, setSport] = useState('all');
  const { data: matches, loading } = useAsync(() => getMatches({ upcomingOnly: true }), []);
  const { data: summary } = useAsync(async () => {
    const [purchases, trial, wallet, sub, news, notes, activity] = await Promise.all([
      getPurchases(user.id), getTrial(user.id), getWallet(user.id), getSubscription(user.id), getNews(), getNotifications(user.id), getActivity(user.id),
    ]);
    return { purchases, trial, wallet, sub, news, notes, activity };
  }, [user.id]);

  const upcoming = (matches || []).filter((m) => sport === 'all' || m.sport === sport).slice(0, 6);
  const s = summary || {};
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const subActive = s.sub?.status === 'Active';

  return (
    <div className="space-y-8">
      {/* Welcome */}
      <section className="glass relative overflow-hidden p-6 md:p-8">
        <div className="blob -right-10 -top-10 h-56 w-56 bg-purple opacity-30" />
        <div className="relative flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm text-muted">{greeting},</p>
            <h1 className="mt-1 text-2xl font-bold md:text-3xl">{user.name} 👋</h1>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <span className="badge-green"><ShieldCheck className="h-3 w-3" /> Account {user.status || 'Active'}</span>
              {subActive ? <span className="badge-purple"><Crown className="h-3 w-3" /> {planById(s.sub.planId)?.name} until {fmtDate(s.sub.end)}</span> : <span className="badge-muted">No active subscription</span>}
              {s.trial && <span className={s.trial.status === 'available' ? 'badge-blue' : 'badge-muted'}><Gift className="h-3 w-3" /> Free trial {s.trial.status === 'available' ? 'available' : 'used'}</span>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to="/user/matches" className="btn-primary">Browse matches <ArrowRight className="h-4 w-4" /></Link>
            {s.trial?.status === 'available' && <Link to="/user/free-trial" className="btn-success"><Gift className="h-4 w-4" /> Claim free prediction</Link>}
          </div>
        </div>
      </section>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={ShoppingBag} color="blue" label="Purchased predictions" value={s.purchases ? s.purchases.length : '…'} hint="Includes free-trial unlock" />
        <StatCard icon={CalendarClock} color="purple" label="Total matches available" value={matches ? matches.length : '…'} hint="Upcoming, across 8 sports" />
        <StatCard icon={Gift} color="green" label="Free trial status" value={s.trial ? (s.trial.status === 'available' ? 'Available' : 'Used') : '…'} hint={s.trial?.status === 'used' ? `Used ${fmtDate(s.trial.activatedAt)}` : 'One free prediction'} />
        <StatCard icon={Wallet} color="orange" label="Wallet balance" value={s.wallet !== undefined ? inr(s.wallet) : '…'} hint="Demo credit" />
      </div>

      {/* Upcoming */}
      <section>
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h2 className="text-xl font-semibold">Upcoming Matches</h2>
          <Link to="/user/matches" className="text-sm text-blue hover:underline">View all</Link>
        </div>
        <div className="mb-4"><Chips options={[{ value: 'all', label: 'All' }, ...SPORTS.map((x) => ({ value: x.id, label: x.name }))]} value={sport} onChange={setSport} /></div>
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {loading ? <CardSkeleton count={3} className="h-72" /> : upcoming.length ? upcoming.map((m) => <MatchCard key={m.id} match={m} unlocked={isUnlocked(user.id, m.id)} />) : <div className="sm:col-span-2 xl:col-span-3"><EmptyState title="No upcoming matches for this sport" /></div>}
        </div>
      </section>

      {/* Recently unlocked */}
      <section>
        <div className="mb-4 flex items-center justify-between"><h2 className="text-xl font-semibold">Recently Unlocked Predictions</h2><Link to="/user/purchases" className="text-sm text-blue hover:underline">My purchases</Link></div>
        {s.purchases?.length ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {s.purchases.slice(0, 6).map((p) => (
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
          <FavouriteSports user={user} />
          <section className="card">
            <h2 className="mb-4 flex items-center gap-2 font-semibold"><Bell className="h-4 w-4 text-orange" /> Notifications</h2>
            <ul className="space-y-3">
              {(s.notes || []).slice(0, 4).map((n) => <li key={n.id} className="text-sm"><p className={cx('font-medium', n.read && 'text-muted')}>{n.title}</p><p className="text-xs text-muted">{n.body}</p></li>)}
            </ul>
          </section>
        </div>

        <section className="card">
          <div className="mb-4 flex items-center justify-between"><h2 className="flex items-center gap-2 font-semibold"><Newspaper className="h-4 w-4 text-blue" /> Recent news</h2><Link to="/user/news" className="text-xs text-blue hover:underline">All news</Link></div>
          <ul className="space-y-4">
            {(s.news || []).slice(0, 4).map((n) => (
              <li key={n.id}><Link to="/user/news" className="group flex gap-3"><img src={n.image} alt="" className="h-14 w-20 shrink-0 rounded-lg object-cover" /><span><span className="line-clamp-2 text-sm font-medium group-hover:text-blue">{n.title}</span><span className="text-[11px] text-muted">{n.category} · {timeAgo(n.date)}</span></span></Link></li>
            ))}
          </ul>
        </section>

        <section className="card">
          <h2 className="mb-4 flex items-center gap-2 font-semibold"><History className="h-4 w-4 text-purple" /> Activity timeline</h2>
          {s.activity?.length ? (
            <ol>
              {s.activity.slice(0, 7).map((a) => (
                <li key={a.id} className="timeline-item">
                  <span className={cx('timeline-dot', { purchase: 'bg-blue', trial: 'bg-green', wallet: 'bg-orange', subscription: 'bg-purple' }[a.kind] || 'bg-muted')} />
                  <p className="text-sm">{a.text}</p>
                  <p className="text-[11px] text-muted">{timeAgo(a.date)}</p>
                </li>
              ))}
            </ol>
          ) : <p className="text-sm text-muted">Your activity will appear here.</p>}
          {s.sub && <p className="mt-2 text-xs text-muted">Subscription: <StatusBadge status={s.sub.status} /></p>}
        </section>
      </div>
    </div>
  );
}
