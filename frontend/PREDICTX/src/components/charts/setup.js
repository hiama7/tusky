// Registers the Chart.js pieces we use once, and sets dark-theme defaults.
import {
  Chart, CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement,
  Filler, Tooltip, Legend,
} from 'chart.js';

Chart.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Filler, Tooltip, Legend);

Chart.defaults.color = '#929CB1';
Chart.defaults.font.family = 'Inter, Segoe UI, system-ui, sans-serif';
Chart.defaults.borderColor = 'rgba(255,255,255,0.06)';
Chart.defaults.plugins.tooltip.backgroundColor = '#101625';
Chart.defaults.plugins.tooltip.borderColor = 'rgba(255,255,255,0.1)';
Chart.defaults.plugins.tooltip.borderWidth = 1;
Chart.defaults.plugins.tooltip.padding = 10;
Chart.defaults.plugins.legend.labels.usePointStyle = true;
Chart.defaults.plugins.legend.labels.boxWidth = 8;
Chart.defaults.animation.duration = 900;

export const COLORS = { blue: '#386BFF', purple: '#8657FF', green: '#20D9A0', orange: '#FFB547', red: '#FF5263', muted: '#929CB1' };

/** Vertical gradient fill for area charts. */
export function areaFill(color) {
  return (ctx) => {
    const { chart } = ctx;
    const { ctx: c, chartArea } = chart;
    if (!chartArea) return `${color}33`;
    const g = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
    g.addColorStop(0, `${color}55`);
    g.addColorStop(1, `${color}00`);
    return g;
  };
}

export const inrTick = (v) => `₹${v >= 100000 ? `${(v / 100000).toFixed(1)}L` : v >= 1000 ? `${Math.round(v / 1000)}k` : v}`;

export const baseOptions = (extra = {}) => ({
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index', intersect: false },
  plugins: { legend: { display: false } },
  scales: {
    x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 14 } },
    y: { beginAtZero: true, ticks: { callback: inrTick }, grid: { color: 'rgba(255,255,255,0.05)' } },
  },
  ...extra,
});
