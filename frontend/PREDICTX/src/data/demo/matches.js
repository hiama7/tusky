// DEMO DATA — sample fixtures. Team names are used for demonstration only;
// crests are generated initials badges, not official logos.
// Dates are relative to "today" so the demo always shows upcoming matches.
// Stage 2: replaced by GET /api/matches.php (fed by a sports API).

/** Returns an ISO string `days` from today at the given HH:MM local time. */
function daysFromNow(days, time) {
  const [h, m] = time.split(':').map(Number);
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

const team = (name, short, color) => ({ name, short, color });

export const DEMO_MATCHES = [
  { id: 'm101', sport: 'cricket', teamA: team('India', 'IND', '#1E6BFF'), teamB: team('Australia', 'AUS', '#F5B800'), tournament: 'T20 World Series', venue: 'Narendra Modi Stadium, Ahmedabad', date: daysFromNow(1, '19:30'), price: 49, status: 'published', featured: true },
  { id: 'm102', sport: 'cricket', teamA: team('England', 'ENG', '#D7263D'), teamB: team('South Africa', 'RSA', '#0B8F4D'), tournament: 'T20 World Series', venue: 'Eden Gardens, Kolkata', date: daysFromNow(2, '15:00'), price: 49, status: 'published', featured: true },
  { id: 'm103', sport: 'cricket', teamA: team('Pakistan', 'PAK', '#0F7A3D'), teamB: team('New Zealand', 'NZ', '#222222'), tournament: 'ODI Tri-Series', venue: 'Wankhede Stadium, Mumbai', date: daysFromNow(4, '14:00'), price: 39, status: 'published' },
  { id: 'm104', sport: 'cricket', teamA: team('Sri Lanka', 'SL', '#1B3A8C'), teamB: team('Bangladesh', 'BAN', '#0A7D45'), tournament: 'Asia Cup', venue: 'R. Premadasa Stadium, Colombo', date: daysFromNow(6, '18:00'), price: 29, status: 'published' },
  { id: 'm201', sport: 'football', teamA: team('Brazil', 'BRA', '#F7D300'), teamB: team('Argentina', 'ARG', '#6CB4EE'), tournament: 'International Friendly Cup', venue: 'Estádio Nacional, Brasília', date: daysFromNow(1, '23:30'), price: 59, status: 'published', featured: true },
  { id: 'm202', sport: 'football', teamA: team('France', 'FRA', '#1F3B8C'), teamB: team('Germany', 'GER', '#2B2B2B'), tournament: 'Nations Showcase', venue: 'Stade Central, Paris', date: daysFromNow(3, '00:15'), price: 59, status: 'published' },
  { id: 'm203', sport: 'football', teamA: team('Spain', 'ESP', '#C8102E'), teamB: team('Portugal', 'POR', '#046A38'), tournament: 'Nations Showcase', venue: 'Estadio Central, Madrid', date: daysFromNow(5, '00:15'), price: 49, status: 'published' },
  { id: 'm301', sport: 'basketball', teamA: team('Metro Hawks', 'MHK', '#E4572E'), teamB: team('Bay Titans', 'BTN', '#386BFF'), tournament: 'Pro Hoops League', venue: 'Arena One', date: daysFromNow(2, '06:00'), price: 39, status: 'published', featured: true },
  { id: 'm302', sport: 'basketball', teamA: team('Desert Suns', 'DSN', '#FFB547'), teamB: team('Harbor Kings', 'HBK', '#8657FF'), tournament: 'Pro Hoops League', venue: 'Sun Dome', date: daysFromNow(4, '07:30'), price: 39, status: 'published' },
  { id: 'm401', sport: 'tennis', teamA: team('A. Moreno', 'AMO', '#20D9A0'), teamB: team('L. Petrov', 'LPE', '#FF5263'), tournament: 'Indoor Masters — Semi Final', venue: 'Centre Court, Indoor Arena', date: daysFromNow(3, '18:00'), price: 29, status: 'published' },
  { id: 'm501', sport: 'badminton', teamA: team('R. Sharma', 'RSH', '#386BFF'), teamB: team('K. Tanaka', 'KTA', '#D7263D'), tournament: 'Asia Open Super 750', venue: 'KD Jadhav Hall, New Delhi', date: daysFromNow(2, '12:30'), price: 19, status: 'published' },
  { id: 'm601', sport: 'hockey', teamA: team('India', 'IND', '#1E6BFF'), teamB: team('Netherlands', 'NED', '#FF7A00'), tournament: 'Pro League Hockey', venue: 'Kalinga Stadium, Bhubaneswar', date: daysFromNow(5, '19:00'), price: 39, status: 'published', featured: true },
  { id: 'm701', sport: 'volleyball', teamA: team('Thunder VC', 'THU', '#8657FF'), teamB: team('Coastal Spikers', 'CSP', '#38BDF8'), tournament: 'Prime Volley League', venue: 'Gachibowli Indoor Stadium', date: daysFromNow(3, '20:00'), price: 19, status: 'published' },
  { id: 'm801', sport: 'esports', teamA: team('Nova Esports', 'NOV', '#E879F9'), teamB: team('Phantom Five', 'PH5', '#20D9A0'), tournament: 'Global Arena Masters', venue: 'Online — LAN Finals', date: daysFromNow(1, '21:00'), price: 29, status: 'published', featured: true },
  { id: 'm802', sport: 'esports', teamA: team('Iron Wolves', 'IWV', '#929CB1'), teamB: team('Blaze Gaming', 'BLZ', '#FF5263'), tournament: 'Global Arena Masters', venue: 'Online — LAN Finals', date: daysFromNow(6, '21:00'), price: 29, status: 'published' },
  { id: 'm204', sport: 'football', teamA: team('Netherlands', 'NED', '#FF7A00'), teamB: team('Belgium', 'BEL', '#C8102E'), tournament: 'Nations Showcase', venue: 'Arena Noord, Amsterdam', date: daysFromNow(8, '00:15'), price: 49, status: 'draft' },
];
