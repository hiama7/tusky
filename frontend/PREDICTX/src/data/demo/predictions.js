// DEMO DATA — sample prediction content per match.
// A handful are hand-written; the rest are generated deterministically from the
// match id so every match has a complete (but clearly fictional) analysis.
// Stage 2: GET /api/predictions.php?match_id=… backed by the tusky ML engine.
import { DEMO_MATCHES } from './matches';

/** Small deterministic PRNG so demo numbers stay the same between reloads. */
function seeded(str) {
  let h = 2166136261;
  for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

const HAND_WRITTEN = {
  m101: {
    probA: 65,
    confidence: 'High',
    summary: 'India hold a clear edge at home: a deeper spin attack suits the Ahmedabad surface, and their top three have the best powerplay strike rate in the series.',
    teamA: { form: ['W', 'W', 'L', 'W', 'W'], strengths: ['Spin control in overs 7–15', 'Powerplay batting depth', 'Home conditions'], weaknesses: ['Death-over economy'] },
    teamB: { form: ['W', 'L', 'W', 'L', 'W'], strengths: ['Pace attack in the powerplay', 'Aggressive middle order'], weaknesses: ['Record vs spin in India', 'Inexperienced finisher'] },
    players: [
      { name: 'R. Verma', team: 'A', stat: 'Avg 52.4 · SR 138', rating: 92 },
      { name: 'A. Malhotra', team: 'A', stat: 'Econ 6.1 · 14 wkts', rating: 94 },
      { name: 'M. Carter', team: 'B', stat: 'Avg 38.9 · SR 161', rating: 89 },
      { name: 'J. Lewis', team: 'B', stat: 'Econ 7.3 · 11 wkts', rating: 84 },
    ],
    h2h: { played: 31, aWins: 19, bWins: 11, draws: 1 },
    insights: [
      'Teams batting first at this venue have won 58% of night games.',
      'Dew is expected after 21:00 — the chasing side gains a small advantage.',
      'India have won 4 of the last 5 meetings in this format.',
    ],
  },
};

const STRENGTHS = ['Strong recent form', 'Home advantage', 'Clinical finishing', 'Disciplined defence', 'Deep bench', 'Fast transitions', 'Set-piece threat', 'Experienced core'];
const WEAKNESSES = ['Inconsistent away form', 'Injury concerns', 'Slow starts', 'Fatigue from schedule', 'Discipline issues'];
const INSIGHTS = [
  'The favourite has covered the expected margin in 6 of their last 8 games.',
  'Weather models show stable conditions — no major impact expected.',
  'Both sides have scored first in over 60% of recent fixtures.',
  'Travel schedule favours the home side by roughly 36 hours of rest.',
  'Market odds have moved 4% toward the favourite in the last 24 hours (demo).',
];

function generate(match) {
  const r = seeded(match.id);
  const probA = Math.round(38 + r() * 34); // 38–72
  const pick = (arr, n) => [...arr].sort(() => r() - 0.5).slice(0, n);
  const form = () => Array.from({ length: 5 }, () => (r() > 0.42 ? 'W' : 'L'));
  const played = 8 + Math.floor(r() * 30);
  const aWins = Math.round(played * (probA / 100) * 0.9);
  const draws = match.sport === 'football' || match.sport === 'hockey' ? Math.floor(r() * 4) : 0;
  return {
    probA,
    confidence: Math.abs(probA - 50) > 14 ? 'High' : Math.abs(probA - 50) > 6 ? 'Medium' : 'Low',
    summary: `${probA >= 50 ? match.teamA.name : match.teamB.name} go in as slight favourites based on recent form, head-to-head history and venue factors. Expect a competitive contest in the ${match.tournament}.`,
    teamA: { form: form(), strengths: pick(STRENGTHS, 3), weaknesses: pick(WEAKNESSES, 1) },
    teamB: { form: form(), strengths: pick(STRENGTHS, 2), weaknesses: pick(WEAKNESSES, 2) },
    players: [
      { name: `${match.teamA.short} Key Player 1`, team: 'A', stat: 'Form rating trending up', rating: 80 + Math.floor(r() * 15) },
      { name: `${match.teamA.short} Key Player 2`, team: 'A', stat: 'Top contributor last 5', rating: 75 + Math.floor(r() * 15) },
      { name: `${match.teamB.short} Key Player 1`, team: 'B', stat: 'Most impactful this season', rating: 78 + Math.floor(r() * 15) },
      { name: `${match.teamB.short} Key Player 2`, team: 'B', stat: 'Consistent performer', rating: 72 + Math.floor(r() * 15) },
    ],
    h2h: { played, aWins, bWins: played - aWins - draws, draws },
    insights: pick(INSIGHTS, 3),
  };
}

export const DEMO_PREDICTIONS = DEMO_MATCHES
  .filter((m) => m.status === 'published')
  .map((m) => {
    const p = HAND_WRITTEN[m.id] || generate(m);
    return { id: `p-${m.id}`, matchId: m.id, ...p, probB: 100 - p.probA, status: 'published' };
  });
