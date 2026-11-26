// Revenue analytics (Chart.js) — all series computed in MySQL from captured
// payments and processed refunds. Filters: Today / 7 / 30 / 90 days.
import { useState } from 'react';
import { Download, IndianRupee, Target, Crown, Undo2, Percent } from 'lucide-react';
import { Chips, EmptyState, PageHeader, Skeleton, StatCard } from '../../components/ui';
import { AreaChart, BarChart } from '../../components/charts/RevenueCharts';
import { COLORS } from '../../components/charts/setup';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import { getAnalyticsOverview, getRevenueSeries } from '../../services/admin';
import { inr } from '../../utils/format';

const RANGES = [{ value: 'today', label: 'Today' }, { value: '7d', label: 'Last 7 Days' }, { value: '30d', label: 'Last 30 Days' }, { value: '90d', label: 'Last 90 Days' }];
const short = (l) => (l.length === 13 ? `${l.slice(11)}:00` : l.length === 10 ? l.slice(5) : l);

function ChartCard({ title, children, className = '' }) {
  return <section className={`card ${className}`}><h2 className="mb-4 font-semibold">{title}</h2>{children}</section>;
}

export default function AdminAnalytics() {
  const toast = useToast();
  const [range, setRange] = useState('30d');
  const { data: series, loading, error } = useAsync(() => getRevenueSeries(range), [range]);
  const { data: o } = useAsync(() => getAnalyticsOverview(), []);

  const sum = (arr) => (arr || []).reduce((s, v) => s + v, 0);
  const rangeLabel = RANGES.find((r) => r.value === range).label;

  function exportCsv() {
    if (!series) return;
    const rows = [['Period', 'Prediction sales', 'Subscription sales', 'Gross', 'Refunds', 'Net', 'Failed payments'],
      ...series.labels.map((l, i) => [l, series.predictions[i], series.subscriptions[i], series.gross[i], series.refunds[i], series.net[i], series.failedPayments[i]])];
    const blob = new Blob([rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `tusky-revenue-${range}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success('Revenue CSV downloaded.');
  }

  if (error) return <EmptyState title="Couldn’t load analytics" text={error.message} />;
  return (
    <>
      <PageHeader title="Revenue Analytics" subtitle="Captured payments only. Refunds are subtracted when they are processed." actions={<button className="btn-ghost" onClick={exportCsv} disabled={!series}><Download className="h-4 w-4" /> Export CSV</button>} />
      <div className="mb-6"><Chips options={RANGES} value={range} onChange={setRange} /></div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={IndianRupee} label={`Net revenue · ${rangeLabel}`} value={series ? inr(sum(series.net)) : '…'} hint={series ? `${inr(sum(series.gross))} gross` : ''} />
        <StatCard icon={Target} color="green" label="Prediction sales" value={series ? inr(sum(series.predictions)) : '…'} />
        <StatCard icon={Crown} color="purple" label="Subscription sales" value={series ? inr(sum(series.subscriptions)) : '…'} hint={series ? `${sum(series.newSubscriptions)} new subscriptions` : ''} />
        <StatCard icon={Undo2} color="orange" label="Refunds" value={series ? inr(sum(series.refunds)) : '…'} hint={series ? `${sum(series.failedPayments)} failed payments` : ''} />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <ChartCard title={`1. ${range === 'today' ? 'Hourly' : 'Daily'} Revenue — ${rangeLabel}`} className="xl:col-span-2">
          {loading || !series ? <Skeleton className="h-[300px]" /> : <AreaChart height={300} labels={series.labels.map(short)} series={[{ label: 'Net revenue', data: series.net, color: COLORS.blue }, { label: 'Refunds', data: series.refunds, color: COLORS.red }]} />}
        </ChartCard>
        <ChartCard title="2. Weekly Revenue (last 12 weeks)">
          {o ? <BarChart labels={o.weekly.labels.map((l) => l.replace('Wk of ', '').slice(5))} series={[{ label: 'Net', data: o.weekly.net, color: COLORS.purple }]} /> : <Skeleton className="h-[280px]" />}
        </ChartCard>
        <ChartCard title="3. Monthly Revenue (last 12 months)">
          {o ? <AreaChart labels={o.monthly.labels} series={[{ label: 'Net', data: o.monthly.net, color: COLORS.green }]} /> : <Skeleton className="h-[280px]" />}
        </ChartCard>
        <ChartCard title="4. Yearly Revenue">
          {o ? <BarChart labels={o.yearly.labels} series={[{ label: 'Net', data: o.yearly.net, color: COLORS.orange }]} /> : <Skeleton className="h-[280px]" />}
        </ChartCard>
        <ChartCard title="5. Subscription Growth (active subscribers at month end)">
          {o ? <BarChart money={false} labels={o.subscriberGrowth.map((p) => p.label)} series={[{ label: 'Active subscribers', data: o.subscriberGrowth.map((p) => p.active), color: COLORS.purple }]} /> : <Skeleton className="h-[280px]" />}
        </ChartCard>
        <ChartCard title={`6. Match Prediction Sales vs Subscriptions — ${rangeLabel}`} className="xl:col-span-2">
          {loading || !series ? <Skeleton className="h-[300px]" /> : <BarChart height={300} stacked labels={series.labels.map(short)} series={[{ label: 'Prediction sales', data: series.predictions, color: COLORS.blue }, { label: 'Subscriptions', data: series.subscriptions, color: COLORS.purple }]} />}
        </ChartCard>
        <ChartCard title="Prediction performance" className="xl:col-span-2">
          {o ? (
            <div className="flex flex-wrap items-center gap-6">
              <div className="flex items-center gap-3"><div className="stat-icon bg-green/15 text-green"><Percent className="h-5 w-5" /></div><div><p className="font-display text-2xl font-bold">{o.predictionPerformance.accuracy === null ? '—' : `${o.predictionPerformance.accuracy}%`}</p><p className="text-xs text-muted">{o.predictionPerformance.correct} of {o.predictionPerformance.evaluated} evaluated predictions correct</p></div></div>
              <p className="max-w-xl text-xs text-muted">{o.predictionPerformance.note} Record results on the Matches page to start tracking accuracy.</p>
            </div>
          ) : <Skeleton className="h-16" />}
        </ChartCard>
      </div>
    </>
  );
}
