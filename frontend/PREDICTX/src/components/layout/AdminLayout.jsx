// Admin area layout — completely separate session from the user area.
import { Navigate, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Users, CalendarRange, Target, Newspaper, Crown, ReceiptText, BarChart3, Settings, ExternalLink, Cpu } from 'lucide-react';
import DashboardShell from './DashboardShell';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';

const NAV = [
  { to: '/admin/dashboard', label: 'Overview', icon: LayoutDashboard },
  { to: '/admin/users', label: 'Users', icon: Users },
  { to: '/admin/matches', label: 'Matches', icon: CalendarRange },
  { to: '/admin/predictions', label: 'Predictions', icon: Target },
  { to: '/admin/news', label: 'Sports News', icon: Newspaper },
  { to: '/admin/model', label: 'Models', icon: Cpu },
  { to: '/admin/subscriptions', label: 'Subscriptions', icon: Crown },
  { to: '/admin/transactions', label: 'Transactions', icon: ReceiptText },
  { to: '/admin/analytics', label: 'Revenue Analytics', icon: BarChart3 },
  { to: '/admin/settings', label: 'Settings', icon: Settings },
];

export default function AdminLayout() {
  const { admin, ready, adminLogout } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  if (!ready) return <div className="flex min-h-screen items-center justify-center"><span className="spinner" /></div>;
  if (!admin) return <Navigate to="/admin/login" replace />;

  async function handleLogout() {
    await adminLogout();
    toast.info('Admin session ended.');
    navigate('/admin/login');
  }

  return (
    <DashboardShell
      admin
      nav={NAV}
      home="/admin/dashboard"
      onLogout={handleLogout}
      topbarRight={(
        <>
          <a href="#/" target="_blank" rel="noreferrer" className="btn-ghost btn-sm"><ExternalLink className="h-3.5 w-3.5" /> View site</a>
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-solid to-deep text-ink text-xs font-bold" title={admin.email}>SA</span>
        </>
      )}
      sidebarFooter={<p className="text-center text-[11px] text-muted">Signed in as {admin.name}</p>}
    />
  );
}
