// Formatting helpers (Indian locale).
export const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
export const num = (n) => Number(n || 0).toLocaleString('en-IN');

export const fmtDate = (iso, opts = { day: 'numeric', month: 'short', year: 'numeric' }) => new Date(iso).toLocaleDateString('en-IN', opts);
export const fmtTime = (iso) => new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
export const fmtDateTime = (iso) => `${fmtDate(iso, { day: 'numeric', month: 'short' })}, ${fmtTime(iso)}`;

export function timeAgo(iso) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** "Starts in 2d 4h" style countdown label. */
export function startsIn(iso) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'Live / Completed';
  const h = Math.floor(ms / 3600e3);
  if (h < 1) return `Starts in ${Math.ceil(ms / 60e3)}m`;
  if (h < 24) return `Starts in ${h}h`;
  return `Starts in ${Math.floor(h / 24)}d ${h % 24}h`;
}

export const cx = (...classes) => classes.filter(Boolean).join(' ');
