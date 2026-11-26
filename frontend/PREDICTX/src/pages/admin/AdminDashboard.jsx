// Admin overview — real figures from MySQL (GET /api/admin/dashboard).
// Revenue counts only captured payments; refunds are shown separately.
import { Link } from 'react-router-dom';
import { Users, Crown, Target, CalendarRange, IndianRupee, TrendingUp, Plus, ArrowRight, Undo2, XCircle } from 'lucide-react';
import { DataTable, EmptyState, PageHeader, Skeleton, StatCard, StatusBadge } from '../../components/ui';
import { AreaChart, DonutChart } from '../../components/charts/RevenueCharts';
import { COLORS } from '../../components/charts/setup';
import { useAsync } from '../../hooks/useAsync';
import { getDashboard } from '../../services/admin';
import { fmtDateTime, inr, num } from '../../utils/format';

const SPORT_COLORS = ['#20D9A0', '#386BFF', '#FFB547', '#C6F432', '#E879F9', '#38BDF8', '#8657FF', '#FF5263'];

export default function AdminDashboard() {
  const { data, loading, error } = useAsync(() => getDashboard(), []);
  if (error) return <EmptyState title="Couldn’t load the dashboard" text={error.message} />;
  const s = data?.stats;
  const series = data?.revenue30d;

  return (
    <>
      <PageHeader title="Overview" subtitle="Live platform figures from the database." actions={<>
        <Link to="/admin/matches?new=1" className="btn-ghost"><Plus className="h-4 w-4" /> Add match</Link>
        <Link to="/admin/predictions?new=1" className="btn-primary"><Plus className="h-4 w-4" /> New prediction</Link>
      </>} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {loading ? Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-40 rounded-2xl" />) : (
          <>
            <StatCard icon={Users} label="Registered users" value={num(s.users.total)} hint={`${num(s.users.active)} active · ${num(s.users.blocked)} blocked`} />
            <StatCard icon={Crown} color="accent" label="Active subscribers" value={num(s.subscribers.active)} hint={`${num(s.subscribers.total)} have ever subscribed`} />
            <StatCard icon={Target} color="green" label="Published predictions" value={num(s.predictions.published)} hint={`${num(s.predictions.total)} total · ${num(s.purchases.successful)} unlocks sold`} />
            <StatCard icon={CalendarRange} color="orange" label="Matches" value={num(s.matches.total)} hint={`${s.matches.upcoming} upcoming · ${s.matches.live} live · ${s.matches.completed} completed`} />
            <StatCard icon={IndianRupee} color="brand" label="Net revenue (all time)" value={inr(s.revenue.allTime.net)} hint={`${inr(s.revenue.allTime.gross)} sales − ${inr(s.revenue.allTime.refunds)} refunds`} />
            <StatCard icon={TrendingUp} color="green" label="Today's revenue" value={inr(s.revenue.today.net)} hint={`Week ${inr(s.revenue.week.net)} · Month ${inr(s.revenue.month.net)} · Year ${inr(s.revenue.year.net)}`} />
            <StatCard icon={Undo2} color="accent" label="Refunds" value={inr(s.refunds.amount)} hint={`${s.refunds.count} processed`} />
            <StatCard icon={XCircle} color="red" label="Failed payments" value={num(s.transactions.failed)} hint={`${num(s.transactions.successful)} successful · ${num(s.transactions.pending)} pending`} />
          </>
        )}
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-3">
        <section className="card xl:col-span-2">
          <div className="mb-4 flex items-center justify-between"><h2 className="font-semibold">Net revenue — last 30 days</h2><Link to="/admin/analytics" className="text-xs text-brand hover:underline">Full analytics</Link></div>
          {series ? <AreaChart labels={series.labels.map((l) => l.slice(5))} series={[{ label: 'Predictions', data: series.predictions, color: COLORS.brand }, { label: 'Subscriptions', data: series.subscriptions, color: COLORS.accent }]} /> : <Skeleton className="h-[280px]" />}
        </section>
        <section className="card">
          <h2 className="mb-4 font-semibold">Prediction sales by sport</h2>
          {data?.salesBySport?.length
            ? <DonutChart labels={data.salesBySport.map((r) => r.sport)} values={data.salesBySport.map((r) => r.total)} colors={SPORT_COLORS} height={280} />
            : <p className="py-16 text-center text-sm text-muted">{loading ? 'Loading…' : 'No prediction sales yet.'}</p>}
        </section>
      </div>

      <section className="mt-6">
        <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-semibold">Recent transactions</h2><Link to="/admin/transactions" className="flex items-center gap-1 text-sm text-brand hover:underline">View all <ArrowRight className="h-4 w-4" /></Link></div>
        <DataTable loading={loading} rows={data?.recentTransactions || []} empty="No transactions yet." columns={[
          { key: 'id', label: 'Reference', render: (t) => <span className="font-mono text-xs">{t.id}</span> },
          { key: 'customer', label: 'Customer' },
          { key: 'item', label: 'Item', render: (t) => <span className="text-muted">{t.item}</span> },
          { key: 'amount', label: 'Amount', render: (t) => <b>{inr(t.amount)}</b> },
          { key: 'date', label: 'Date', render: (t) => <span className="text-muted">{fmtDateTime(t.date)}</span> },
          { key: 'status', label: 'Status', render: (t) => <StatusBadge status={t.status} /> },
        ]} />
      </section>
    </>
  );
}
