// SAMPLE DEMONSTRATION DATA for the admin dashboard and revenue charts.
// These are not real business figures. Stage 2: GET /api/admin/analytics.php
export const ADMIN_SAMPLE_STATS = {
  totalUsers: 5240,
  activeSubscribers: 1850,
  totalPredictions: 420,
  totalMatches: 680,
  totalRevenue: 245000,
  todayRevenue: 8500,
};

function seeded(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

/** Daily sample revenue for the last 365 days (oldest → newest). */
export const DAILY_REVENUE = (() => {
  const r = seeded(42);
  const out = [];
  for (let i = 364; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const trend = 3500 + (364 - i) * 13; // slow growth
    const weekend = [0, 6].includes(d.getDay()) ? 1.35 : 1;
    const predictions = Math.round((trend * weekend * (0.7 + r() * 0.5)) / 10) * 10;
    const subscriptions = Math.round((trend * 0.6 * (0.6 + r() * 0.6)) / 10) * 10;
    out.push({ date: d.toISOString().slice(0, 10), predictions, subscriptions, total: predictions + subscriptions, newSubs: Math.round(4 + r() * 9 + (364 - i) / 60) });
  }
  // keep "today" aligned with the headline sample figure
  out[out.length - 1] = { ...out[out.length - 1], predictions: 5100, subscriptions: 3400, total: 8500 };
  return out;
})();

/** Hourly sample revenue for "today" — scaled so the hours add up to the ₹8,500 sample figure. */
export const HOURLY_TODAY = (() => {
  const weights = Array.from({ length: 24 }, (_, h) => Math.max(0.1, Math.sin(((h - 6) / 24) * Math.PI * 2) * 0.5 + 0.6));
  const sum = weights.reduce((s, w) => s + w, 0);
  const rows = weights.map((w, h) => ({ hour: `${String(h).padStart(2, '0')}:00`, total: Math.round((8500 * w) / sum) }));
  rows[20].total += 8500 - rows.reduce((s, r) => s + r.total, 0); // absorb rounding
  return rows;
})();

export const SPORT_SALES_SHARE = { Cricket: 38, Football: 27, Basketball: 11, Tennis: 8, Esports: 7, Hockey: 5, Badminton: 2, Volleyball: 2 };
