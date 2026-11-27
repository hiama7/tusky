// Shared dashboard shell for the user and admin areas:
// collapsible sidebar (slides in on mobile) + sticky top bar + animated content.
import { Suspense, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Menu, LogOut } from 'lucide-react';
import { Logo } from '../ui';
import { PointerGlow } from '../ui/effects';
import { cx } from '../../utils/format';

/**
 * props:
 *  nav: [{ to, label, icon }]   onLogout()   home (logo link)
 *  topbarRight: ReactNode        admin: boolean (purple accent)
 *  sidebarFooter: ReactNode
 */
export default function DashboardShell({ nav, onLogout, home, topbarRight, admin = false, sidebarFooter }) {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => { setOpen(false); window.scrollTo(0, 0); }, [pathname]);

  const current = nav.find((n) => pathname.startsWith(n.to))?.label || (pathname.includes('/match/') ? 'Match Prediction' : '');

  return (
    <div className={cx('app-shell', admin && 'admin-accent')}>
      <PointerGlow />
      {/* mobile backdrop */}
      {open && <div className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden" onClick={() => setOpen(false)} />}

      <aside className={cx('sidebar', open && 'open')} aria-label="Sidebar">
        <div className="flex h-16 items-center border-b border-white/5 px-5"><Logo to={home} admin={admin} /></div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink key={to + label} to={to} className={({ isActive }) => cx('sidebar-link', isActive && 'active')}>
              <Icon className="h-[18px] w-[18px]" /> {label}
            </NavLink>
          ))}
          <button onClick={onLogout} className="sidebar-link w-full hover:!text-red">
            <LogOut className="h-[18px] w-[18px]" /> Logout
          </button>
        </nav>
        {sidebarFooter && <div className="border-t border-white/5 p-4">{sidebarFooter}</div>}
      </aside>

      <div className="main-area">
        <header className="topbar">
          <button className="rounded-lg p-2 text-white hover:bg-white/5 lg:hidden" onClick={() => setOpen(true)} aria-label="Open sidebar"><Menu className="h-5 w-5" /></button>
          <p className="truncate text-sm font-medium text-muted">{admin ? 'Admin' : 'Dashboard'} <span className="text-white/30">/</span> <span className="text-white">{current}</span></p>
          <div className="ml-auto flex items-center gap-2">{topbarRight}</div>
        </header>
        <main key={pathname} className="content page-enter"><Suspense fallback={<div className="flex min-h-[50vh] items-center justify-center"><span className="spinner" /></div>}><Outlet /></Suspense></main>
      </div>
    </div>
  );
}
