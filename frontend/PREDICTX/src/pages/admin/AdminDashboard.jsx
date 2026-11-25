// Admin overview: sample KPI cards (+ live demo revenue), revenue trend,
// sales by sport, recent transactions and quick actions.
import { Link } from 'react-router-dom';
import { Users, Crown, Target, CalendarRange, IndianRupee, TrendingUp, Plus, ArrowRight } from 'lucide-react';
import { DataTable, DemoBanner, PageHeader, Skeleton, StatCard, StatusBadge } from '../../components/ui';
import { AreaChart, DonutChart } from '../../components/charts/RevenueCharts';
import { COLORS } from '../../components/charts/setup';
import { useAsync } from '../../hooks/useAsync';
import { getAdminStats, getRevenueSeries, getTransactions } from '../../services/admin';
import { SPORT_SALES_SHARE } from '../../data/demo/analytics';
import { fmtDateTime, inr, num } from '../../utils/format';

export default function AdminDashboard() {
  const { data: stats } = useAsync(() => getAdminStats(), []);
  const { data: series } = useAsync(() => getRevenueSeries('30d'), []);
  const { data: txns, loading: txLoading } = useAsync(() => getTransactions(), []);

  const s = stats;
  return (
    <>
      <PageHeader title="Overview" subtitle="Platform performance at a glance." actions={<>
        <Link to="/admin/matches?new=1" className="btn-ghost"><Plus className="h-4 w-4" /> Add match</Link>
        <Link to="/admin/predictions?new=1" className="btn-primary"><Plus className="h-4 w-4" /> New prediction</Link>
      </>} />
      <DemoBanner className="mb-6"><b>Sample demonstration data.</b> KPI figures are fixed sample values. Revenue cards also add any demo purchases made in this browser{s?.demo?.count ? ` (${s.demo.count} so far, ${inr(s.demo.total)})` : ''}.</DemoBanner>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {s ? (
          <>
            <StatCard demo icon={Users} label="Total Users" value={num(s.totalUsers)} hint="+4.2% vs last month" />
            <StatCard demo icon={Crown} color="purple" label="Active Subscribers" value={num(s.activeSubscribers)} hint="35% of users" />
            <StatCard demo icon={Target} color="green" label="Total Predictions" value={num(s.totalPredictions)} hint={`${s.livePredictions} published in this demo`} />
            <StatCard demo icon={CalendarRange} color="orange" label="Total Matches" value={num(s.totalMatches)} hint={`${s.liveMatches} in this demo`} />
            <StatCard demo icon={IndianRupee} color="blue" label="Total Revenue" value={inr(s.totalRevenue)} hint="All time" />
            <StatCard demo icon={TrendingUp} color="green" label="Today's Revenue" value={inr(s.todayRevenue)} hint={s.demo.today ? `incl. ${inr(s.demo.today)} demo purchases` : 'Since midnight'} />
          </>
        ) : Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-40 rounded-2xl" />)}
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-3">
        <section className="card xl:col-span-2">
          <div className="mb-4 flex items-center justify-between"><h2 className="font-semibold">Revenue — last 30 days</h2><Link to="/admin/analytics" className="text-xs text-blue hover:underline">Full analytics</Link></div>
          {series ? <AreaChart labels={series.labels} series={[{ label: 'Predictions', data: series.predictions, color: COLORS.blue }, { label: 'Subscriptions', data: series.subscriptions, color: COLORS.purple }]} /> : <Skeleton className="h-[280px]" />}
        </section>
        <section className="card">
          <h2 className="mb-4 font-semibold">Prediction sales by sport</h2>
          <DonutChart labels={Object.keys(SPORT_SALES_SHARE)} values={Object.values(SPORT_SALES_SHARE)} colors={['#20D9A0', '#386BFF', '#FFB547', '#C6F432', '#E879F9', '#38BDF8', '#8657FF', '#FF5263']} height={280} />
        </section>
      </div>

      <section className="mt-6">
        <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-semibold">Recent transactions</h2><Link to="/admin/transactions" className="flex items-center gap-1 text-sm text-blue hover:underline">View all <ArrowRight className="h-4 w-4" /></Link></div>
        <DataTable loading={txLoading} rows={(txns || []).slice(0, 6)} columns={[
          { key: 'id', label: 'Transaction', render: (t) => <span className="font-mono text-xs">{t.id}</span> },
          { key: 'customer', label: 'Customer' },
          { key: 'item', label: 'Item', render: (t) => <span className="text-muted">{t.item}</span> },
          { key: 'amount', label: 'Amount', render: (t) => <b>{inr(t.amount)}</b> },
          { key: 'date', label: 'Date', render: (t) => <span className="text-muted">{fmtDateTime(t.date)}</span> },
          { key: 'status', label: 'Status', render: (t) => <span className="flex items-center gap-1.5"><StatusBadge status={t.status} />{t.demo && <span className="badge-blue">Demo</span>}</span> },
        ]} />
      </section>
    </>
  );
}
