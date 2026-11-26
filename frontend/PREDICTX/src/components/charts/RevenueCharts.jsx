// Reusable Chart.js wrappers for the admin area.
import { Bar, Line, Doughnut } from 'react-chartjs-2';
import { areaFill, baseOptions, COLORS } from './setup';

export function AreaChart({ labels, series, height = 280, stacked = false }) {
  const data = {
    labels,
    datasets: series.map((s) => ({
      label: s.label,
      data: s.data,
      borderColor: s.color,
      backgroundColor: areaFill(s.color),
      fill: true,
      tension: 0.4,
      borderWidth: 2.5,
      pointRadius: 0,
      pointHoverRadius: 5,
      pointHoverBackgroundColor: s.color,
    })),
  };
  const opts = baseOptions({ plugins: { legend: { display: series.length > 1, position: 'top', align: 'end' } } });
  if (stacked) opts.scales.y.stacked = true;
  return <div style={{ height }}><Line data={data} options={opts} /></div>;
}

export function BarChart({ labels, series, height = 280, stacked = false, money = true }) {
  const data = {
    labels,
    datasets: series.map((s) => ({ label: s.label, data: s.data, backgroundColor: s.color, borderRadius: 6, maxBarThickness: 34 })),
  };
  const opts = baseOptions({ plugins: { legend: { display: series.length > 1, position: 'top', align: 'end' } } });
  if (stacked) { opts.scales.x.stacked = true; opts.scales.y.stacked = true; }
  if (!money) opts.scales.y.ticks.callback = (v) => v.toLocaleString('en-IN');
  return <div style={{ height }}><Bar data={data} options={opts} /></div>;
}

export function DonutChart({ labels, values, colors, height = 240 }) {
  const data = { labels, datasets: [{ data: values, backgroundColor: colors || Object.values(COLORS), borderColor: '#151D2E', borderWidth: 3 }] };
  const options = { responsive: true, maintainAspectRatio: false, cutout: '68%', plugins: { legend: { position: 'right' } } };
  return <div style={{ height }}><Doughnut data={data} options={options} /></div>;
}
