// Revenue analytics with Chart.js: daily, weekly, monthly, yearly revenue,
// subscription growth and prediction sales, plus date-range filters.
import { useState } from 'react';
import { Download, IndianRupee, Target, Crown, TrendingUp } from 'lucide-react';
import { Chips, DemoBanner, PageHeader, Skeleton, StatCard } from '../../components/ui';
import { AreaChart, BarChart } from '../../components/charts/RevenueCharts';
import { COLORS } from '../../components/charts/setup';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import { getRevenueAggregates, getRevenueSeries } from '../../services/admin';
import { inr, num } from '../../utils/format';

const RANGES = [{ value: 'today', label: 'Today' }, { value: '7d', label: 'Last 7 Days' }, { value: '30d', label: 'Last 30 Days' }, { value: '90d', label: 'Last 90 Days' }];

function ChartCard({ title, children, className = '' }) {
  return <section className={`card ${className}`}><h2 className="mb-4 font-semibold">{title}</h2>{children}</section>;
}

export default function AdminAnalytics() {
  const toast = useToast();
  const [range, setRange] = useState('30d');
  const { data: series, loading } = useAsync(() => getRevenueSeries(range), [range]);
  const { data: agg } = useAsync(() => getRevenueAggregates(), []);

  const sum = (arr) => (arr || []).reduce((s, v) => s + v, 0);
  const total = sum(series?.total);
  const pred = sum(series?.predictions);
  const subs = sum(series?.subscriptions);
  const rangeLabel = RANGES.find((r) => r.value === range).label;

  function exportCsv() {
    if (!series) return;
    const rows = [['Label', 'Predictions', 'Subscriptions', 'Total'], ...series.labels.map((l, i) => [l, series.predictions[i], series.subscriptions[i], series.total[i]])];
    const blob = new Blob([rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `tusky-sample-revenue-${range}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success('Sample revenue CSV downloaded.');
  }

  return (
    <>
      <PageHeader title="Revenue Analytics" subtitle="Sample revenue data with live demo purchases added to today." actions={<button className="btn-ghost" onClick={exportCsv}><Download className="h-4 w-4" /> Export CSV</button>} />
      <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <Chips options={RANGES} value={range} onChange={setRange} />
        <DemoBanner className="py-2">Sample demonstration data — not real revenue.</DemoBanner>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard demo icon={IndianRupee} label={`Revenue · ${rangeLabel}`} value={series ? inr(total) : '…'} />
        <StatCard demo icon={Target} color="green" label="Prediction sales" value={series ? inr(pred) : '…'} hint={series ? `≈ ${num(Math.round(pred / 45))} unlocks` : ''} />
        <StatCard demo icon={Crown} color="purple" label="Subscription revenue" value={series ? inr(subs) : '…'} />
        <StatCard demo icon={TrendingUp} color="orange" label="Avg per period" value={series ? inr(Math.round(total / series.labels.length)) : '…'} hint={range === 'today' ? 'per hour' : 'per day'} />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <ChartCard title={`1. ${range === 'today' ? 'Hourly' : 'Daily'} Revenue — ${rangeLabel}`} className="xl:col-span-2">
          {loading || !series ? <Skeleton className="h-[300px]" /> : <AreaChart height={300} labels={series.labels} series={[{ label: 'Total revenue', data: series.total, color: COLORS.blue }]} />}
        </ChartCard>
        <ChartCard title="2. Weekly Revenue (last 12 weeks)">
          {agg ? <BarChart labels={agg.weeks.map((w) => w.label)} series={[{ label: 'Revenue', data: agg.weeks.map((w) => w.total), color: COLORS.purple }]} /> : <Skeleton className="h-[280px]" />}
        </ChartCard>
        <ChartCard title="3. Monthly Revenue (last 12 months)">
          {agg ? <AreaChart labels={agg.months.map((m) => m.label)} series={[{ label: 'Revenue', data: agg.months.map((m) => m.total), color: COLORS.green }]} /> : <Skeleton className="h-[280px]" />}
        </ChartCard>
        <ChartCard title="4. Yearly Revenue">
          {agg ? <BarChart labels={agg.yearly.map((y) => y.label)} series={[{ label: 'Revenue', data: agg.yearly.map((y) => y.total), color: COLORS.orange }]} /> : <Skeleton className="h-[280px]" />}
        </ChartCard>
        <ChartCard title="5. Subscription Growth (active subscribers)">
          {agg ? <AreaChart labels={agg.subGrowth.map((m) => m.label)} series={[{ label: 'Subscribers', data: agg.subGrowth.map((m) => m.total), color: COLORS.purple }]} /> : <Skeleton className="h-[280px]" />}
        </ChartCard>
        <ChartCard title={`6. Match Prediction Sales vs Subscriptions — ${rangeLabel}`} className="xl:col-span-2">
          {loading || !series ? <Skeleton className="h-[300px]" /> : <BarChart height={300} stacked labels={series.labels} series={[{ label: 'Prediction sales', data: series.predictions, color: COLORS.blue }, { label: 'Subscriptions', data: series.subscriptions, color: COLORS.purple }]} />}
        </ChartCard>
      </div>
    </>
  );
}
