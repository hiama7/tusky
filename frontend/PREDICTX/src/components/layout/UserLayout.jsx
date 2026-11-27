// User area layout: sidebar navigation, notifications dropdown, profile chip.
import { useCallback, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Trophy, CalendarClock, Target, Newspaper, ShoppingBag, Crown, Gift,
  Wallet, ReceiptText, UserRound, Settings, Bell, Flag,
} from 'lucide-react';
import DashboardShell from './DashboardShell';
import { useClickOutside } from '../ui';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useAsync } from '../../hooks/useAsync';
import { getNotifications, markAllRead } from '../../services/notifications';
import { getTrial } from '../../services/trial';
import { cx, timeAgo } from '../../utils/format';

const NAV = [
  { to: '/user/dashboard', label: 'Overview', icon: LayoutDashboard },
  { to: '/user/sports', label: 'Sports', icon: Trophy },
  { to: '/user/matches', label: 'Upcoming Matches', icon: CalendarClock },
  { to: '/user/predictions', label: 'Predictions', icon: Target },
  { to: '/user/results', label: 'Results', icon: Flag },
  { to: '/user/news', label: 'Sports News', icon: Newspaper },
  { to: '/user/purchases', label: 'My Purchases', icon: ShoppingBag },
  { to: '/user/subscription', label: 'Subscription', icon: Crown },
  { to: '/user/free-trial', label: 'Free Trial', icon: Gift },
  { to: '/user/wallet', label: 'Wallet', icon: Wallet },
  { to: '/user/transactions', label: 'Transaction History', icon: ReceiptText },
  { to: '/user/profile', label: 'Profile', icon: UserRound },
  { to: '/user/settings', label: 'Settings', icon: Settings },
];

function NotificationsMenu({ userId }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useClickOutside(close);
  const { data } = useAsync(() => getNotifications(), [userId]);
  const list = data?.items || [];
  const unread = data?.unread || 0;
  const dot = { success: 'bg-green', info: 'bg-brand', warning: 'bg-orange', error: 'bg-red' };
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="relative rounded-xl border border-white/10 bg-white/5 p-2.5 hover:bg-white/10" aria-label={`Notifications (${unread} unread)`} aria-expanded={open}>
        <Bell className="h-4 w-4" />
        {unread > 0 && <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red px-1 text-[10px] font-bold">{unread}</span>}
      </button>
      {open && (
        <div className="dropdown w-[min(22rem,calc(100vw-2rem))]">
          <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
            <p className="text-sm font-semibold">Notifications</p>
            <button className="text-xs text-brand hover:underline disabled:opacity-40" disabled={!unread} onClick={() => markAllRead()}>Mark all read</button>
          </div>
          <ul className="max-h-80 overflow-y-auto">
            {list.map((n) => (
              <li key={n.id} className={cx('flex gap-3 border-b border-white/5 px-4 py-3 last:border-0', !n.read && 'bg-brand/[.04]')}>
                <span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', dot[n.type] || 'bg-brand', n.read && 'opacity-30')} />
                <div className="min-w-0">
                  <p className="text-sm font-medium">{n.title}</p>
                  <p className="text-xs text-muted">{n.body}</p>
                  {n.date && <p className="mt-1 text-[10px] text-muted/70">{timeAgo(n.date)}</p>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function UserLayout() {
  const { user, ready, logout } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const { data: trial } = useAsync(() => (user ? getTrial() : null), [user?.id]);

  // Route guard for the UI only — every API call is authorised again on the server.
  if (!ready) return <div className="flex min-h-screen items-center justify-center"><span className="spinner" /></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;

  async function handleLogout() {
    await logout();
    toast.info('You have been logged out.');
    navigate('/login');
  }

  const initials = user.name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();

  return (
    <DashboardShell
      nav={NAV}
      home="/"
      onLogout={handleLogout}
      topbarRight={(
        <>
          <NotificationsMenu userId={user.id} />
          <Link to="/user/profile" className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 py-1.5 pl-1.5 pr-3 hover:bg-white/10">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-solid to-deep text-ink text-xs font-bold">{initials}</span>
            <span className="hidden text-sm sm:block">{user.name.split(' ')[0]}</span>
          </Link>
        </>
      )}
      sidebarFooter={trial?.status === 'available' ? (
        <Link to="/user/free-trial" className="block rounded-xl bg-gradient-to-br from-brand/25 to-accent/25 p-4 text-sm transition hover:brightness-125">
          <p className="font-semibold">🎁 Free prediction</p>
          <p className="mt-1 text-xs text-muted">Your first prediction is on us — activate it now.</p>
        </Link>
      ) : (
        <p className="text-center text-[11px] text-muted">Signed in as {user.email}</p>
      )}
    />
  );
}
