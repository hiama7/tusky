// DEMO DATA — sport categories shown across the site.
// In Stage 2 this list comes from GET /api/sports.php.
export const SPORTS = [
  { id: 'cricket', name: 'Cricket', image: 'assets/images/sports/cricket.svg', color: '#20D9A0', tagline: 'T20, ODI & Test analytics' },
  { id: 'football', name: 'Football', image: 'assets/images/sports/football.svg', color: '#386BFF', tagline: 'League & cup match models' },
  { id: 'basketball', name: 'Basketball', image: 'assets/images/sports/basketball.svg', color: '#FFB547', tagline: 'Pace & efficiency ratings' },
  { id: 'tennis', name: 'Tennis', image: 'assets/images/sports/tennis.svg', color: '#C6F432', tagline: 'Surface-aware player form' },
  { id: 'badminton', name: 'Badminton', image: 'assets/images/sports/badminton.svg', color: '#8657FF', tagline: 'Rally length & serve stats' },
  { id: 'hockey', name: 'Hockey', image: 'assets/images/sports/hockey.svg', color: '#38BDF8', tagline: 'Circle entries & conversions' },
  { id: 'volleyball', name: 'Volleyball', image: 'assets/images/sports/volleyball.svg', color: '#FF5263', tagline: 'Set-by-set momentum' },
  { id: 'esports', name: 'Esports', image: 'assets/images/sports/esports.svg', color: '#E879F9', tagline: 'Map pools & draft stats' },
];

export const sportById = (id) => SPORTS.find((s) => s.id === id);
