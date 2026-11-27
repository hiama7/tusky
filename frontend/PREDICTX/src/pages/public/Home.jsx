// Homepage: hero, stats, sport categories, featured matches, how it works,
// pricing, about.
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Sparkles, Activity, Target, UserPlus, Trophy, CalendarCheck, Unlock, Lock, ShieldCheck, Cpu } from 'lucide-react';
import { AnimatedNumber, CardSkeleton, EmptyState, TeamCrest } from '../../components/ui';
import MatchCard from '../../components/match/MatchCard';
import StadiumArt from '../../components/graphics/StadiumArt';
import { Reveal, useTilt } from '../../components/ui/effects';
import SportsGrid from '../../components/sections/SportsGrid';
import PricingPlans from '../../components/sections/PricingPlans';
import { useAsync } from '../../hooks/useAsync';
import { getMatchPage } from '../../services/matches';
import { fmtDate, fmtTime, inr } from '../../utils/format';
import { useAuth } from '../../context/AuthContext';

/** Moving strip of the competitions that have matches listed. The list is repeated
 *  so the loop has no seam. */
function Ticker({ names }) {
  if (!names.length) return null;
  const loop = Array.from({ length: Math.ceil(12 / names.length) }, () => names).flat();
  return (
    <div className="marquee mb-12 border-y border-white/5 bg-white/[.02] py-3.5" aria-hidden="true">
      <div className="marquee-track">
        {[...loop, ...loop].map((name, i) => (
          <span key={i} className="flex items-center gap-3 whitespace-nowrap px-6 font-display text-sm font-semibold uppercase tracking-[.2em] text-white/60">
            <span className="h-2 w-2 rotate-45 bg-brand" />
            {name}
          </span>
        ))}
      </div>
    </div>
  );
}

/** The hero's floating cards: the next real fixture and live counts. No
 *  probabilities here — those are only sent to viewers entitled to them. */
function NextMatch({ match, total, competitions, tilt }) {
  return (
    <div ref={tilt} className="relative mx-auto h-[420px] w-full max-w-lg">
      <div className="tilt absolute inset-0">
        {/* orbit rings */}
        <svg viewBox="0 0 400 400" aria-hidden="true" className="absolute left-1/2 top-1/2 h-[125%] w-[125%] -translate-x-1/2 -translate-y-1/2">
          <g className="origin-center animate-spin-slow">
            <circle cx="200" cy="200" r="168" fill="none" stroke="#39FF14" strokeOpacity=".25" strokeDasharray="2 9" />
            <circle cx="368" cy="200" r="5" fill="#39FF14" />
            <circle cx="81" cy="81" r="3.5" fill="#FFFFFF" />
          </g>
          <circle cx="200" cy="200" r="128" fill="none" stroke="#FFFFFF" strokeOpacity=".12" />
        </svg>
        {match && (
          <Link to={`/user/match/${match.id}`} className="glass ring-gradient absolute inset-x-6 top-8 block p-6 shadow-2xl animate-float">
            <div className="flex items-center justify-between gap-3">
              <span className="badge-green">Next match</span>
              <span className="truncate text-xs text-muted">{match.tournament}</span>
            </div>
            <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-center">
              {[match.teamA, null, match.teamB].map((team) => (team ? (
                <div key={team.name} className="flex min-w-0 flex-col items-center gap-2"><TeamCrest team={team} /><span className="w-full truncate text-sm font-semibold">{team.name}</span></div>
              ) : <span key="vs" className="text-xs text-muted">vs</span>))}
            </div>
            <p className="mt-5 flex items-center justify-between border-t border-white/10 pt-4 text-xs text-muted">
              <span>{fmtDate(match.date, { day: 'numeric', month: 'short' })} · {fmtTime(match.date)}</span>
              <span className="flex items-center gap-1.5 font-semibold text-brand">{match.unlocked ? 'View prediction' : <><Lock className="h-3.5 w-3.5" /> {inr(match.price)}</>}</span>
            </p>
          </Link>
        )}
        {total > 0 && (
          <>
            <div className="glass absolute -left-2 bottom-8 w-44 p-4 shadow-2xl animate-float sm:-left-8" style={{ animationDelay: '-2s' }}>
              <p className="flex items-center gap-2 text-xs text-muted"><CalendarCheck className="h-4 w-4 text-green" /> Upcoming</p>
              <p className="mt-1 font-display text-2xl font-bold">{total}</p>
              <p className="text-[10px] text-muted">matches listed now</p>
            </div>
            <div className="glass absolute -right-2 bottom-0 w-44 p-4 shadow-2xl animate-float sm:-right-6" style={{ animationDelay: '-4s' }}>
              <p className="flex items-center gap-2 text-xs text-muted"><Trophy className="h-4 w-4 text-accent" /> Competitions</p>
              <p className="mt-1 font-display text-2xl font-bold">{competitions}</p>
              <p className="text-[10px] text-muted">with upcoming matches</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Hero({ next, total, competitions }) {
  const tilt = useTilt();
  return (
    <section className="relative isolate overflow-hidden pt-32 pb-16 md:pt-40 md:pb-20">
      {/* animated background */}
      <StadiumArt className="absolute inset-x-0 -bottom-10 -z-10 h-48 w-full opacity-40" />

      <div className="mx-auto grid max-w-7xl items-center gap-14 px-4 md:px-6 lg:grid-cols-2">
        <div className="page-enter">
          <span className="badge-glow ring-gradient !px-3 !py-1"><Sparkles className="h-3 w-3" /> Sports analytics from past results</span>
          <h1 className="mt-5 text-4xl font-bold leading-[1.05] sm:text-5xl lg:text-6xl">
            <span className="text-gradient">Predict Smarter.</span><br />Analyze Better.<br />Stay Ahead.
          </h1>
          <p className="mt-6 max-w-xl text-base text-muted md:text-lg">
            Win probabilities from a model trained on past results, with recent form and head-to-head records for each match.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/user/predictions" className="btn-primary btn-lg group">Explore Predictions <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" /></Link>
            <Link to="/user/free-trial" className="btn-ghost btn-lg">Start Free Trial</Link>
          </div>
          <div className="mt-8 flex flex-wrap items-center gap-6 text-xs text-muted">
            <span className="flex items-center gap-1.5"><ShieldCheck className="h-4 w-4 text-green" /> First prediction free</span>
            <span className="flex items-center gap-1.5"><Cpu className="h-4 w-4 text-glow" /> Model-driven insights</span>
          </div>
        </div>

        <NextMatch match={next} total={total} competitions={competitions} tilt={tilt} />
      </div>
    </section>
  );
}

const STEPS = [
  { icon: UserPlus, title: 'Register', text: 'Create your free account in under a minute.' },
  { icon: Trophy, title: 'Choose your sport', text: 'Choose one with upcoming fixtures.' },
  { icon: CalendarCheck, title: 'Select an upcoming match', text: 'Browse fixtures with dates and prices.' },
  { icon: Unlock, title: 'Unlock its prediction', text: 'See win probabilities and the numbers behind them.' },
];

function Section({ id, eyebrow, title, sub, children, action }) {
  return (
    <section id={id} className="mx-auto max-w-7xl scroll-mt-24 px-4 py-16 md:px-6 md:py-20">
      <Reveal className="mb-10 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2 className="section-title mt-2">{title}</h2>
          {sub && <p className="section-sub">{sub}</p>}
        </div>
        {action}
      </Reveal>
      <Reveal delay={120}>{children}</Reveal>
    </section>
  );
}

export default function Home({ scrollTo }) {
  const { user } = useAuth();
  const { data: page, loading, error } = useAsync(() => getMatchPage({ upcoming: true, limit: 100 }), [user?.id]);
  const matches = page?.items || [];
  const total = page?.pagination?.total ?? matches.length;
  const picked = matches.filter((m) => m.featured);
  const shown = (picked.length ? picked : matches).slice(0, 6);
  const competitions = new Set(matches.map((m) => m.tournament)).size;
  const stats = matches.length ? [
    { value: total, label: 'Upcoming matches', icon: CalendarCheck },
    { value: competitions, label: 'Competitions covered', icon: Trophy },
    { value: new Set(matches.map((m) => m.sportName)).size, label: 'Sports with fixtures', icon: Activity },
    { value: Math.min(...matches.map((m) => Number(m.price))), prefix: '₹', label: 'Predictions from', icon: Target },
  ] : [];

  useEffect(() => {
    if (scrollTo) setTimeout(() => document.getElementById(scrollTo)?.scrollIntoView({ behavior: 'smooth' }), 150);
  }, [scrollTo]);

  return (
    <>
      <Hero next={matches[0]} total={total} competitions={competitions} />
      <Ticker names={[...new Set(matches.map((m) => m.tournament))]} />

      {/* Statistics, counted from the matches listed right now */}
      {stats.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 md:px-6">
          <div className="glass ring-gradient grid grid-cols-2 gap-6 p-6 md:grid-cols-4 md:p-8">
            {stats.map(({ value, prefix, label, icon: Icon }) => (
              <div key={label} className="text-center">
                <Icon className="mx-auto h-5 w-5 text-glow" />
                <p className="mt-2 font-display text-3xl font-bold md:text-4xl"><AnimatedNumber value={value} prefix={prefix} /></p>
                <p className="mt-1 text-sm text-muted">{label}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <Section eyebrow="Sports" title="Pick your arena" sub="Pick a sport to see its upcoming fixtures and unlock the matches you care about." action={<Link to="/sports" className="btn-ghost">All sports <ArrowRight className="h-4 w-4" /></Link>}>
        <SportsGrid />
      </Section>

      <Section eyebrow="Fixtures" title="Upcoming matches" sub="Every prediction is locked until you unlock it — individually, with a subscription, or with your free trial." action={<Link to="/user/matches" className="btn-ghost">View all matches <ArrowRight className="h-4 w-4" /></Link>}>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {loading ? <CardSkeleton count={6} className="h-72" /> : error ? <div className="sm:col-span-2 lg:col-span-3"><EmptyState title="Couldn’t load matches" text={error.message} /></div> : shown.length ? shown.map((m) => <MatchCard key={m.id} match={m} />) : <div className="sm:col-span-2 lg:col-span-3"><EmptyState title="No upcoming matches right now" text="Check back soon — new fixtures are added regularly." /></div>}
        </div>
      </Section>

      <Section eyebrow="How it works" title="From sign-up to insight in four steps">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(({ icon: Icon, title, text }, i) => (
            <div key={title} className="card card-lift relative overflow-hidden">
              <span className="absolute -right-2 -top-4 font-display text-8xl font-bold text-accent/[.12]">{i + 1}</span>
              <div className="stat-icon bg-gradient-to-br from-brand/25 to-accent/25 text-white"><Icon className="h-5 w-5" /></div>
              <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-brand">Step {i + 1}</p>
              <h3 className="mt-1 font-semibold">{title}</h3>
              <p className="mt-1 text-sm text-muted">{text}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section id="pricing" eyebrow="Pricing" title="Simple, flexible pricing" sub="Unlock a single match or go unlimited with a subscription.">
        <PricingPlans />
      </Section>

      <Section id="about" eyebrow="About TUSKY" title="Analytics first, hype never">
        <div className="grid gap-6 lg:grid-cols-3">
          <p className="text-muted lg:col-span-2">
            TUSKY turns past match results into win probabilities, shown with recent form, head-to-head records and the ratings behind them. The model does not know about injuries or line-ups. Predictions are for entertainment and analysis only and never guarantee outcomes.
          </p>
          <div className="card">
            <p className="font-semibold">Ready to start?</p>
            <p className="mt-1 text-sm text-muted">Your first prediction is on us.</p>
            <Link to={user ? '/user/free-trial' : '/register'} className="btn-primary mt-4 w-full">Get Started</Link>
          </div>
        </div>
      </Section>
    </>
  );
}
