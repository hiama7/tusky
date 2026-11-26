// Homepage: hero, stats, sport categories, featured matches, how it works,
// pricing, sample testimonials, about.
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Sparkles, TrendingUp, Activity, Target, UserPlus, Trophy, CalendarCheck, Unlock, Star, Quote, ShieldCheck, Cpu, LineChart } from 'lucide-react';
import { AnimatedNumber, CardSkeleton, DemoTag, EmptyState, ProbBar, TeamCrest } from '../../components/ui';
import MatchCard from '../../components/match/MatchCard';
import StadiumArt from '../../components/graphics/StadiumArt';
import { Reveal, useTilt } from '../../components/ui/effects';
import SportsGrid from '../../components/sections/SportsGrid';
import PricingPlans from '../../components/sections/PricingPlans';
import { TESTIMONIALS } from '../../content/testimonials';
import { useAsync } from '../../hooks/useAsync';
import { getMatches } from '../../services/matches';
import { useAuth } from '../../context/AuthContext';

const TICKER = [
  ['Cricket', '#39FF14'], ['Football', '#39FF14'], ['Basketball', '#39FF14'], ['Tennis', '#39FF14'],
  ['Hockey', '#39FF14'], ['Badminton', '#39FF14'], ['Volleyball', '#39FF14'], ['Esports', '#39FF14'],
];

/** Moving strip of sports. The list is doubled so the loop has no seam. */
function Ticker() {
  return (
    <div className="marquee mb-12 border-y border-white/5 bg-white/[.02] py-3.5" aria-hidden="true">
      <div className="marquee-track">
        {[...TICKER, ...TICKER, ...TICKER, ...TICKER].map(([name, color], i) => (
          <span key={i} className="flex items-center gap-3 px-6 font-display text-sm font-semibold uppercase tracking-[.2em] text-white/60">
            <span className="h-2 w-2 rotate-45" style={{ background: color, boxShadow: `0 0 12px ${color}` }} />
            {name}
          </span>
        ))}
      </div>
    </div>
  );
}

function Hero() {
  const tilt = useTilt();
  return (
    <section className="relative isolate overflow-hidden pt-32 pb-16 md:pt-40 md:pb-20">
      {/* animated background */}
      <StadiumArt className="absolute inset-x-0 -bottom-10 -z-10 h-48 w-full opacity-40" />

      <div className="mx-auto grid max-w-7xl items-center gap-14 px-4 md:px-6 lg:grid-cols-2">
        <div className="page-enter">
          <span className="badge-glow ring-gradient !px-3 !py-1"><Sparkles className="h-3 w-3" /> AI-powered sports analytics</span>
          <h1 className="mt-5 text-4xl font-bold leading-[1.05] sm:text-5xl lg:text-6xl">
            <span className="text-gradient">Predict Smarter.</span><br />Analyze Better.<br />Stay Ahead.
          </h1>
          <p className="mt-6 max-w-xl text-base text-muted md:text-lg">
            Experience the next generation of sports analytics with AI-powered predictions, advanced match statistics, and detailed performance insights.
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

        {/* Floating analytics cards (illustrative) */}
        <div ref={tilt} className="relative mx-auto h-[420px] w-full max-w-lg" aria-hidden="true">
          <div className="tilt absolute inset-0">
            {/* orbit rings */}
            <svg viewBox="0 0 400 400" className="absolute left-1/2 top-1/2 h-[125%] w-[125%] -translate-x-1/2 -translate-y-1/2">
              <g className="origin-center animate-spin-slow">
                <circle cx="200" cy="200" r="168" fill="none" stroke="#39FF14" strokeOpacity=".25" strokeDasharray="2 9" />
                <circle cx="368" cy="200" r="5" fill="#B4FFA6" />
                <circle cx="81" cy="81" r="3.5" fill="#6EE7FF" />
              </g>
              <circle cx="200" cy="200" r="128" fill="none" stroke="#FFFFFF" strokeOpacity=".16" />
            </svg>
            <div className="glass ring-gradient absolute inset-x-6 top-8 p-6 shadow-2xl animate-float">
              <div className="flex items-center justify-between">
                <span className="badge-green"><span className="live-dot mr-1" /> Live model</span>
                <span className="text-xs text-muted">T20 World Series</span>
              </div>
              <div className="mt-5 flex items-center justify-between">
                <div className="flex items-center gap-3"><TeamCrest team={{ short: 'IND', color: '#1E6BFF' }} /><span className="font-semibold">India</span></div>
                <span className="text-xs text-muted">vs</span>
                <div className="flex items-center gap-3"><span className="font-semibold">Australia</span><TeamCrest team={{ short: 'AUS', color: '#F5B800' }} /></div>
              </div>
              <div className="mt-6 space-y-3">
                <ProbBar label="Win probability" value={65} color="#39FF14" />
                <ProbBar value={35} color="#FFB82E" delay={200} />
              </div>
            </div>
            <div className="glass absolute -left-2 bottom-16 w-48 p-4 shadow-2xl animate-float sm:-left-8" style={{ animationDelay: '-2s' }}>
              <p className="flex items-center gap-2 text-xs text-muted"><TrendingUp className="h-4 w-4 text-green" /> Model accuracy</p>
              <p className="mt-1 font-display text-2xl font-bold">71.4%</p>
              <svg viewBox="0 0 120 30" className="mt-2 h-8 w-full"><polyline className="draw-line" pathLength="1" points="0,25 15,22 30,24 45,15 60,17 75,10 90,12 105,5 120,7" fill="none" stroke="#2EE6A8" strokeWidth="2.5" strokeLinecap="round" /></svg>
              <p className="text-[10px] text-muted">Sample figure</p>
            </div>
            <div className="glass absolute -right-2 bottom-4 w-52 p-4 shadow-2xl animate-float sm:-right-6" style={{ animationDelay: '-4s' }}>
              <p className="flex items-center gap-2 text-xs text-muted"><Activity className="h-4 w-4 text-accent" /> Head-to-head</p>
              <div className="mt-3 flex h-16 items-end gap-1.5">
                {[40, 65, 30, 80, 55, 90, 70].map((h, i) => <span key={i} className="grow-bar flex-1 rounded-t bg-gradient-to-t from-deep via-brand to-glow" style={{ height: `${h}%`, animationDelay: `${300 + i * 80}ms` }} />)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

const STATS = [
  { value: 10000, suffix: '+', label: 'Matches Analyzed', icon: LineChart },
  { value: 25, suffix: '+', label: 'Sports Tournaments', icon: Trophy },
  { value: 5000, suffix: '+', label: 'Registered Users', icon: UserPlus },
  { value: 1000, suffix: '+', label: 'Predictions Published', icon: Target },
];

const STEPS = [
  { icon: UserPlus, title: 'Register', text: 'Create your free account in under a minute.' },
  { icon: Trophy, title: 'Choose your sport', text: 'Cricket, football, tennis, esports and more.' },
  { icon: CalendarCheck, title: 'Select an upcoming match', text: 'Browse fixtures with dates, venues and prices.' },
  { icon: Unlock, title: 'Unlock its prediction', text: 'Get probabilities, analysis and key insights.' },
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
  const { data: matches, loading } = useAsync(() => getMatches({ upcoming: true }), [user?.id]);
  const featured = (matches || []).filter((m) => m.featured).slice(0, 6);

  useEffect(() => {
    if (scrollTo) setTimeout(() => document.getElementById(scrollTo)?.scrollIntoView({ behavior: 'smooth' }), 150);
  }, [scrollTo]);

  return (
    <>
      <Hero />
      <Ticker />

      {/* Statistics */}
      <section className="mx-auto max-w-7xl px-4 md:px-6">
        <Reveal className="glass ring-gradient grid grid-cols-2 gap-6 p-6 md:grid-cols-4 md:p-8">
          {STATS.map(({ value, suffix, label, icon: Icon }) => (
            <div key={label} className="text-center">
              <Icon className="mx-auto h-5 w-5 text-glow" />
              <p className="mt-2 font-display text-3xl font-bold md:text-4xl"><AnimatedNumber value={value} suffix={suffix} /></p>
              <p className="mt-1 text-sm text-muted">{label}</p>
            </div>
          ))}
        </Reveal>
        <p className="mt-2 text-center text-[11px] text-muted">Demonstration figures — not real business statistics.</p>
      </section>

      <Section eyebrow="Sports" title="Pick your arena" sub="Eight sports, one analytics engine. Explore upcoming fixtures and unlock the matches you care about." action={<Link to="/sports" className="btn-ghost">All sports <ArrowRight className="h-4 w-4" /></Link>}>
        <SportsGrid />
      </Section>

      <Section eyebrow="Featured" title="Upcoming featured matches" sub="Every prediction is locked until you unlock it — individually, with a subscription, or with your free trial." action={<Link to="/user/matches" className="btn-ghost">View all matches <ArrowRight className="h-4 w-4" /></Link>}>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {loading ? <CardSkeleton count={6} className="h-72" /> : featured.length ? featured.map((m) => <MatchCard key={m.id} match={m} />) : <div className="sm:col-span-2 lg:col-span-3"><EmptyState title="No featured matches right now" text="Check back soon — new fixtures are added regularly." /></div>}
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

      <Section eyebrow="Testimonials" title="What fans are saying" action={<DemoTag>Sample testimonials</DemoTag>}>
        <div className="grid gap-5 md:grid-cols-3">
          {TESTIMONIALS.map((t) => (
            <figure key={t.name} className="card card-lift">
              <Quote className="h-6 w-6 text-accent" />
              <blockquote className="mt-3 text-sm leading-relaxed text-white/90">“{t.text}”</blockquote>
              <div className="mt-4 flex text-orange">{Array.from({ length: 5 }, (_, i) => <Star key={i} className="h-4 w-4" fill={i < t.rating ? 'currentColor' : 'none'} />)}</div>
              <figcaption className="mt-3 flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-solid to-deep text-ink text-xs font-bold">{t.name[0]}</span>
                <span><span className="block text-sm font-semibold">{t.name}</span><span className="text-xs text-muted">{t.role}</span></span>
              </figcaption>
            </figure>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">These testimonials are sample content created for the design demo.</p>
      </Section>

      <Section id="about" eyebrow="About TUSKY" title="Analytics first, hype never">
        <div className="grid gap-6 lg:grid-cols-3">
          <p className="text-muted lg:col-span-2">
            TUSKY combines historical results, player form, venue and weather signals into transparent match probabilities. Every prediction shows its reasoning — team analysis, head-to-head records and key insights — so you can make up your own mind. Predictions are for entertainment and analysis only and never guarantee outcomes.
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
