// =============================================================================
// SAMPLE (DEMO) CONTENT for development. Everything created from this file is
// stored with isDemo = true and shown in the UI with a "Sample" label.
// Team names are used for demonstration; player names and statistics are
// fictional and must not be presented as real data.
// =============================================================================

export const SPORTS = [
  { slug: 'cricket', name: 'Cricket', color: '#20D9A0', image: 'assets/images/sports/cricket.svg', outcomeFormat: 'TWO_WAY', description: 'T20, ODI and Test fixtures' },
  { slug: 'football', name: 'Football', color: '#386BFF', image: 'assets/images/sports/football.svg', outcomeFormat: 'THREE_WAY', description: 'League match probabilities' },
  { slug: 'basketball', name: 'Basketball', color: '#FFB547', image: 'assets/images/sports/basketball.svg', outcomeFormat: 'TWO_WAY', description: 'Game predictions when listed' },
  { slug: 'tennis', name: 'Tennis', color: '#C6F432', image: 'assets/images/sports/tennis.svg', outcomeFormat: 'TWO_WAY', description: 'Match predictions when listed' },
  { slug: 'badminton', name: 'Badminton', color: '#8657FF', image: 'assets/images/sports/badminton.svg', outcomeFormat: 'TWO_WAY', description: 'Match predictions when listed' },
  { slug: 'hockey', name: 'Hockey', color: '#38BDF8', image: 'assets/images/sports/hockey.svg', outcomeFormat: 'THREE_WAY', description: 'Match predictions when listed' },
  { slug: 'volleyball', name: 'Volleyball', color: '#FF5263', image: 'assets/images/sports/volleyball.svg', outcomeFormat: 'TWO_WAY', description: 'Match predictions when listed' },
  { slug: 'esports', name: 'Esports', color: '#E879F9', image: 'assets/images/sports/esports.svg', outcomeFormat: 'TWO_WAY', description: 'Match predictions when listed' },
];

export const PLANS = [
  { code: 'basic-weekly', planName: 'Basic Weekly', price: '199.00', durationDays: 7, allSports: false, sports: ['cricket', 'football'], popular: false, sortOrder: 1,
    description: 'Cricket and football, for 7 days.', features: ['Listed cricket and football matches for 7 days', 'Win probabilities, form and head-to-head'] },
  { code: 'premium-monthly', planName: 'Premium Monthly', price: '599.00', durationDays: 30, allSports: true, sports: [], popular: true, sortOrder: 2,
    description: 'Every listed match, for 30 days.', features: ['Every listed sport for 30 days', 'Win probabilities, form and head-to-head'] },
  { code: 'pro-yearly', planName: 'Pro Yearly', price: '4999.00', durationDays: 365, allSports: true, sports: [], popular: false, sortOrder: 3,
    description: 'Everything in Premium for a full year.', features: ['Everything in Premium for 365 days', 'Costs less than paying monthly'] },
];

const t = (name, short, color) => ({ name, short, color });

/** dayOffset is relative to the seed date; time is IST (HH:MM). */
export const MATCHES = [
  { sport: 'cricket', a: t('India', 'IND', '#1E6BFF'), b: t('Australia', 'AUS', '#F5B800'), tournament: 'T20 World Series', venue: 'Narendra Modi Stadium, Ahmedabad', day: 1, time: '19:30', price: '49', featured: true, conditions: 'Dry surface expected to assist spin; dew likely after 21:00' },
  { sport: 'cricket', a: t('England', 'ENG', '#D7263D'), b: t('South Africa', 'RSA', '#0B8F4D'), tournament: 'T20 World Series', venue: 'Eden Gardens, Kolkata', day: 2, time: '15:00', price: '49', featured: true },
  { sport: 'cricket', a: t('Pakistan', 'PAK', '#0F7A3D'), b: t('New Zealand', 'NZ', '#222222'), tournament: 'ODI Tri-Series', venue: 'Wankhede Stadium, Mumbai', day: 4, time: '14:00', price: '39' },
  { sport: 'cricket', a: t('Sri Lanka', 'SL', '#1B3A8C'), b: t('Bangladesh', 'BAN', '#0A7D45'), tournament: 'Asia Cup', venue: 'R. Premadasa Stadium, Colombo', day: 6, time: '18:00', price: '29' },
  { sport: 'football', a: t('Brazil', 'BRA', '#F7D300'), b: t('Argentina', 'ARG', '#6CB4EE'), tournament: 'International Friendly Cup', venue: 'Estádio Nacional, Brasília', day: 1, time: '23:30', price: '59', featured: true },
  { sport: 'football', a: t('France', 'FRA', '#1F3B8C'), b: t('Germany', 'GER', '#2B2B2B'), tournament: 'Nations Showcase', venue: 'Stade Central, Paris', day: 3, time: '00:15', price: '59' },
  { sport: 'football', a: t('Spain', 'ESP', '#C8102E'), b: t('Portugal', 'POR', '#046A38'), tournament: 'Nations Showcase', venue: 'Estadio Central, Madrid', day: 5, time: '00:15', price: '49' },
  { sport: 'basketball', a: t('Metro Hawks', 'MHK', '#E4572E'), b: t('Bay Titans', 'BTN', '#386BFF'), tournament: 'Pro Hoops League', venue: 'Arena One', day: 2, time: '06:00', price: '39', featured: true },
  { sport: 'basketball', a: t('Desert Suns', 'DSN', '#FFB547'), b: t('Harbor Kings', 'HBK', '#8657FF'), tournament: 'Pro Hoops League', venue: 'Sun Dome', day: 4, time: '07:30', price: '39' },
  { sport: 'tennis', a: t('A. Moreno', 'AMO', '#20D9A0'), b: t('L. Petrov', 'LPE', '#FF5263'), tournament: 'Indoor Masters', venue: 'Centre Court, Indoor Arena', day: 3, time: '18:00', price: '29' },
  { sport: 'badminton', a: t('R. Sharma', 'RSH', '#386BFF'), b: t('K. Tanaka', 'KTA', '#D7263D'), tournament: 'Asia Open Super 750', venue: 'KD Jadhav Hall, New Delhi', day: 2, time: '12:30', price: '19' },
  { sport: 'hockey', a: t('India', 'IND', '#1E6BFF'), b: t('Netherlands', 'NED', '#FF7A00'), tournament: 'Pro League Hockey', venue: 'Kalinga Stadium, Bhubaneswar', day: 5, time: '19:00', price: '39', featured: true },
  { sport: 'volleyball', a: t('Thunder VC', 'THU', '#8657FF'), b: t('Coastal Spikers', 'CSP', '#38BDF8'), tournament: 'Prime Volley League', venue: 'Gachibowli Indoor Stadium', day: 3, time: '20:00', price: '19' },
  { sport: 'esports', a: t('Nova Esports', 'NOV', '#E879F9'), b: t('Phantom Five', 'PH5', '#20D9A0'), tournament: 'Global Arena Masters', venue: 'Online — LAN Finals', day: 1, time: '21:00', price: '29', featured: true },
  { sport: 'esports', a: t('Iron Wolves', 'IWV', '#929CB1'), b: t('Blaze Gaming', 'BLZ', '#FF5263'), tournament: 'Global Arena Masters', venue: 'Online — LAN Finals', day: 6, time: '21:00', price: '29' },
  // a draft fixture with no prediction yet (visible to admins only)
  { sport: 'football', a: t('Netherlands', 'NED', '#FF7A00'), b: t('Belgium', 'BEL', '#C8102E'), tournament: 'Nations Showcase', venue: 'Arena Noord, Amsterdam', day: 8, time: '00:15', price: '49', draft: true },
];

const STRENGTHS = ['Strong recent form', 'Home advantage', 'Clinical finishing', 'Disciplined defence', 'Deep bench', 'Fast transitions', 'Set-piece threat', 'Experienced core'];
const WEAKNESSES = ['Inconsistent away form', 'Injury concerns', 'Slow starts', 'Fatigue from schedule', 'Discipline issues'];
const FACTORS = [
  'The favourite has covered the expected margin in most recent meetings (sample).',
  'Weather models show stable conditions — no major impact expected (sample).',
  'Both sides have scored first in a majority of recent fixtures (sample).',
  'Travel schedule favours the home side with extra rest (sample).',
];

function seeded(str) {
  let h = 2166136261;
  for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

/** Deterministic, clearly-sample prediction content for a seeded fixture. */
export function samplePrediction(m, threeWay) {
  const r = seeded(`${m.a.name}-${m.b.name}`);
  const pick = (arr, n) => [...arr].sort(() => r() - 0.5).slice(0, n);
  const form = () => Array.from({ length: 5 }, () => (threeWay && r() > 0.8 ? 'D' : r() > 0.42 ? 'W' : 'L'));
  let a = 38 + Math.floor(r() * 34);
  let d = threeWay ? 18 + Math.floor(r() * 10) : 0;
  let b = 100 - a - d;
  if (m.a.name === 'India' && m.b.name === 'Australia') { a = 65; b = 35; d = 0; }
  const played = 8 + Math.floor(r() * 30);
  const aWins = Math.round(played * (a / 100) * 0.85);
  const draws = threeWay ? Math.floor(played * 0.2) : 0;
  const top = Math.max(a, b, d);
  return {
    teamAProbability: a.toFixed(2),
    teamBProbability: b.toFixed(2),
    drawProbability: threeWay ? d.toFixed(2) : null,
    predictedOutcome: top === a ? 'TEAM_A' : top === b ? 'TEAM_B' : 'DRAW',
    confidenceLevel: Math.abs(a - b) > 25 ? 'HIGH' : Math.abs(a - b) > 10 ? 'MEDIUM' : 'LOW',
    summary: `SAMPLE ANALYSIS — ${top === a ? m.a.name : m.b.name} go in as favourites in this ${m.tournament} fixture based on illustrative form and venue factors. This is demonstration content, not real analysis.`,
    teamAnalysis: { teamA: { strengths: pick(STRENGTHS, 3), weaknesses: pick(WEAKNESSES, 1) }, teamB: { strengths: pick(STRENGTHS, 2), weaknesses: pick(WEAKNESSES, 2) } },
    recentForm: { teamA: form(), teamB: form() },
    playerAnalysis: [
      { name: `${m.a.short} Player A (sample)`, team: 'A', stat: 'Illustrative form rating', rating: 80 + Math.floor(r() * 15) },
      { name: `${m.a.short} Player B (sample)`, team: 'A', stat: 'Illustrative form rating', rating: 72 + Math.floor(r() * 15) },
      { name: `${m.b.short} Player A (sample)`, team: 'B', stat: 'Illustrative form rating', rating: 78 + Math.floor(r() * 15) },
      { name: `${m.b.short} Player B (sample)`, team: 'B', stat: 'Illustrative form rating', rating: 70 + Math.floor(r() * 15) },
    ],
    headToHead: { played, aWins, bWins: played - aWins - draws, draws },
    keyFactors: pick(FACTORS, 3),
    pitchAnalysis: m.conditions || null,
    weatherAnalysis: null,
  };
}

const img = (s) => `assets/images/sports/${s}.svg`;
const body = (lead) => `${lead}\n\nThis is sample editorial content created for the TUSKY development database. It does not describe real events.`;

export const NEWS = [
  { title: 'Spin twins set to headline the hosts’ plan for the T20 World Series opener', category: 'Cricket', image: img('cricket'), featured: true, trending: true, daysAgo: 0,
    description: 'With a dry surface expected, the hosts are likely to field two wrist-spinners against a pace-heavy visiting attack.', content: body('Team sources suggest the hosts will back spin in the middle overs. The visitors are weighing an extra batter to counter the turn.') },
  { title: 'Midfield playmaker agrees terms on record summer move (sample report)', category: 'Transfer News', image: img('football'), trending: true, daysAgo: 0,
    description: 'Negotiations are said to be in the final stage, with medicals pencilled in for next week.', content: body('The move would make the midfielder the most expensive signing in the club’s history.') },
  { title: 'Bay Titans extend winning streak to nine with dominant fourth quarter', category: 'Basketball', image: img('basketball'), featured: true, daysAgo: 1,
    description: 'A strong final quarter sealed another statement win as the Titans climb to the top of the standings.', content: body('The Titans’ bench outscored the opposition, highlighting a depth advantage.') },
  { title: 'Moreno battles past cramp to reach Indoor Masters semi-final', category: 'Tennis', image: img('tennis'), trending: true, daysAgo: 1,
    description: 'The sixth seed saved three match points before taking the deciding tie-break.', content: body('Recovery time will be a key factor after a three-hour quarter-final.') },
  { title: 'Global Arena Masters: format, schedule and teams to watch', category: 'Tournament News', image: img('esports'), daysAgo: 2,
    description: 'Sixteen teams, a double-elimination bracket and the largest prize pool of the season.', content: body('Nova Esports enter as top seeds after an unbeaten group stage.') },
  { title: 'Star opener ruled out of ODI Tri-Series with hamstring strain', category: 'Player Updates', image: img('cricket'), trending: true, daysAgo: 2,
    description: 'The left-hander is expected to miss three weeks; a debutant is likely to open.', content: body('The selectors have named an uncapped replacement in the squad.') },
  { title: 'Brazil vs Argentina: five numbers that define the rivalry', category: 'Football', image: img('football'), featured: true, daysAgo: 3,
    description: 'From shots on target to set-piece goals, a look at the rivalry before the Friendly Cup clash.', content: body('Expect a tight, tactical opening half.') },
  { title: 'Harbor Kings complete mid-season trade for veteran point guard', category: 'Transfer News', image: img('basketball'), daysAgo: 5,
    description: 'The Kings send two second-round picks in exchange for proven playoff experience.', content: body('The addition improves the Kings’ assist-to-turnover ratio, their weakest area this season.') },
];
