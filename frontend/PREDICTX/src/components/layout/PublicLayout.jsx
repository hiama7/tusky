// Public site shell: sticky glass navbar (with mobile drawer) + footer.
import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Menu, X, Mail, MapPin, LayoutDashboard } from 'lucide-react';
import { Logo } from '../ui';
import { SITE } from '../../content/site';
import { POLICY_LINKS } from '../../content/policies';
import { PointerGlow, ScrollProgress } from '../ui/effects';
import { useAuth } from '../../context/AuthContext';
import { cx } from '../../utils/format';

const NAV = [
  { to: '/', label: 'Home', end: true },
  { to: '/sports', label: 'Sports' },
  { to: '/news', label: 'News' },
  { to: '/user/predictions', label: 'Predictions' },
  { to: '/pricing', label: 'Pricing' },
  { to: '/about', label: 'About' },
];

function Navbar() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { user } = useAuth();
  const { pathname } = useLocation();

  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10);
    onScroll();
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const linkCls = ({ isActive }) => cx('relative rounded-lg px-3 py-2 text-sm transition-colors after:absolute after:inset-x-3 after:bottom-0.5 after:h-0.5 after:origin-left after:rounded-full after:bg-gradient-to-r after:from-glow after:to-accent after:transition-transform after:duration-300', isActive ? 'text-white after:scale-x-100' : 'text-muted after:scale-x-0 hover:text-white hover:after:scale-x-100');

  return (
    <header className={cx('fixed inset-x-0 top-0 z-50 transition-all duration-300', scrolled ? 'border-b border-white/5 bg-ink/80 backdrop-blur-xl' : 'bg-transparent')}>
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 md:px-6" aria-label="Main">
        <Logo />
        <div className="hidden items-center gap-1 lg:flex">
          {NAV.map((n) => <NavLink key={n.to} to={n.to} end={n.end} className={linkCls}>{n.label}</NavLink>)}
        </div>
        <div className="hidden items-center gap-2 lg:flex">
          {user ? (
            <Link to="/user/dashboard" className="btn-primary"><LayoutDashboard className="h-4 w-4" /> Dashboard</Link>
          ) : (
            <>
              <Link to="/login" className="btn-ghost">Login</Link>
              <Link to="/register" className="btn-primary">Get Started</Link>
            </>
          )}
        </div>
        <button className="rounded-lg p-2 text-white lg:hidden" onClick={() => setOpen((o) => !o)} aria-label="Toggle menu" aria-expanded={open}>
          {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </nav>

      {/* Mobile drawer */}
      <div className={cx('overflow-hidden border-white/5 bg-ink-2/95 backdrop-blur-xl transition-[max-height] duration-300 lg:hidden', open ? 'max-h-[480px] border-b' : 'max-h-0')}>
        <div className="flex flex-col gap-1 px-4 py-4">
          {NAV.map((n) => <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => cx('rounded-lg px-3 py-2.5 text-sm', isActive ? 'bg-white/5 text-white' : 'text-muted')}>{n.label}</NavLink>)}
          <div className="mt-3 grid grid-cols-2 gap-2">
            {user ? (
              <Link to="/user/dashboard" className="btn-primary col-span-2">Go to Dashboard</Link>
            ) : (
              <>
                <Link to="/login" className="btn-ghost">Login</Link>
                <Link to="/register" className="btn-primary">Get Started</Link>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

function Footer() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const cols = [
    { title: 'Platform', links: [['Predictions', '/user/predictions'], ['Sports', '/sports'], ['Pricing', '/pricing'], ['Free Trial', '/user/free-trial']] },
    { title: 'Company', links: [['About', '/about'], ['News', '/news'], ['Admin Login', '/admin/login'], ['Create Account', '/register']] },
    { title: 'Account', links: [['Login', '/login'], ['Dashboard', '/user/dashboard'], ['My Purchases', '/user/purchases'], ['Wallet', '/user/wallet']] },
  ];
  return (
    <footer className="relative mt-24 border-t border-white/5 bg-ink-2/60">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 md:grid-cols-2 md:px-6 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <Logo />
          <p className="mt-4 max-w-sm text-sm text-muted">Match win probabilities from models trained on past results, with recent form and head-to-head records.</p>
          {(SITE.email || SITE.address) && (
            <ul className="mt-5 space-y-2 text-sm text-muted">
              {SITE.email && <li className="flex items-center gap-2"><Mail className="h-4 w-4" /> {SITE.email}</li>}
              {SITE.address && <li className="flex items-center gap-2"><MapPin className="h-4 w-4" /> {SITE.address}</li>}
            </ul>
          )}
        </div>
        {cols.map((c) => (
          <div key={c.title}>
            <p className="text-sm font-semibold">{c.title}</p>
            <ul className="mt-4 space-y-2.5 text-sm">
              {c.links.map(([label, to]) => <li key={label}><button onClick={() => navigate(to)} className="text-muted transition-colors hover:text-white">{label}</button></li>)}
            </ul>
          </div>
        ))}
      </div>
      <div className="mx-auto max-w-7xl px-4 md:px-6">
        <div className="glass flex flex-col gap-3 p-5 sm:flex-row sm:items-center">
          <p className="flex-1 text-sm"><b>Your first prediction is free.</b> <span className="text-muted">Create an account and pick any upcoming match.</span></p>
          <Link to={user ? '/user/free-trial' : '/register'} className="btn-primary">{user ? 'Use my free trial' : 'Create free account'}</Link>
        </div>
      </div>
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-8 text-xs text-muted md:flex-row md:flex-wrap md:justify-between md:px-6">
        <p>© {new Date().getFullYear()} TUSKY. Predictions are probabilistic analysis for entertainment & research only.</p>
        <nav className="flex flex-wrap gap-x-4 gap-y-1" aria-label="Legal">
          {POLICY_LINKS.map(([label, to]) => <Link key={to} to={to} className="hover:text-white">{label}</Link>)}
        </nav>
        <p className="w-full">Football data provided by the Football-Data.org API.</p>
      </div>
    </footer>
  );
}

export default function PublicLayout() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <ScrollProgress />
      <PointerGlow />
      <Navbar />
      <main key={pathname} className="page-enter"><Outlet /></main>
      <Footer />
    </div>
  );
}
