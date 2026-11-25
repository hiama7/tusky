// DEMO DATA — sample news articles (fictional content for UI demonstration).
// Stage 2: GET /api/news.php (fed by a news API + admin-written posts).
export const NEWS_CATEGORIES = ['Cricket', 'Football', 'Basketball', 'Tennis', 'Transfer News', 'Tournament News', 'Player Updates'];

const daysAgo = (d, h = 9) => {
  const t = new Date();
  t.setDate(t.getDate() - d);
  t.setHours(h, 0, 0, 0);
  return t.toISOString();
};

const img = (sport) => `assets/images/sports/${sport}.svg`;

export const DEMO_NEWS = [
  { id: 'n1', title: 'Spin twins set to headline India’s plan for the T20 World Series opener', category: 'Cricket', image: img('cricket'), author: 'TUSKY Desk', date: daysAgo(0, 8), featured: true, trending: true, views: 18420,
    excerpt: 'With a dry surface expected in Ahmedabad, the hosts are likely to field two wrist-spinners against a pace-heavy visiting attack.',
    body: 'Team sources suggest the hosts will back spin in the middle overs, a phase where they have conceded just 6.8 runs per over this season. The visitors, meanwhile, are weighing an extra batter to counter the turn. Our model rates the toss as more important than usual at this venue, with dew expected late in the evening.\n\nThis is sample editorial content created for the TUSKY Stage 1 demo.' },
  { id: 'n2', title: 'Midfield maestro agrees terms on record summer move — sample report', category: 'Transfer News', image: img('football'), author: 'Transfer Room', date: daysAgo(0, 11), trending: true, views: 15210,
    excerpt: 'Negotiations are said to be in the final stage, with medicals pencilled in for next week.',
    body: 'The move would make the midfielder the most expensive signing in the club’s history. Analysts expect his progressive passing numbers — among the best in the league — to transform the side’s build-up play.\n\nThis is sample editorial content created for the TUSKY Stage 1 demo.' },
  { id: 'n3', title: 'Bay Titans extend winning streak to nine with dominant fourth quarter', category: 'Basketball', image: img('basketball'), author: 'Hoops Lab', date: daysAgo(1), featured: true, views: 9640,
    excerpt: 'A 34–18 final quarter sealed another statement win as the Titans climb to the top of the standings.',
    body: 'The Titans’ defensive rating over the streak sits at a league-best 104.2. Their bench outscored the opposition 41–22, highlighting a depth advantage our model weighs heavily in upcoming fixtures.\n\nThis is sample editorial content created for the TUSKY Stage 1 demo.' },
  { id: 'n4', title: 'Moreno battles past cramp to reach Indoor Masters semi-final', category: 'Tennis', image: img('tennis'), author: 'Baseline', date: daysAgo(1, 15), trending: true, views: 7210,
    excerpt: 'The world No. 6 saved three match points before taking the deciding tie-break 9–7.',
    body: 'Moreno will face Petrov next, a matchup where serve-hold rates on indoor hard courts favour the Spaniard slightly. Recovery time will be a key factor after a three-hour quarter-final.\n\nThis is sample editorial content created for the TUSKY Stage 1 demo.' },
  { id: 'n5', title: 'Global Arena Masters: format, schedule and teams to watch', category: 'Tournament News', image: img('esports'), author: 'TUSKY Desk', date: daysAgo(2), views: 5480,
    excerpt: 'Sixteen teams, a double-elimination bracket and the largest prize pool of the season.',
    body: 'Nova Esports enter as top seeds after an unbeaten group stage. Our draft-based model highlights map pool depth as the decisive factor in a best-of-three format.\n\nThis is sample editorial content created for the TUSKY Stage 1 demo.' },
  { id: 'n6', title: 'Star opener ruled out of ODI Tri-Series with hamstring strain', category: 'Player Updates', image: img('cricket'), author: 'Medical Room', date: daysAgo(2, 14), trending: true, views: 11030,
    excerpt: 'The left-hander is expected to miss three weeks; a debutant is likely to open.',
    body: 'Losing their most consistent opener lowers the side’s projected powerplay total by an estimated 6 runs. The selectors have named an uncapped replacement in the squad.\n\nThis is sample editorial content created for the TUSKY Stage 1 demo.' },
  { id: 'n7', title: 'Brazil vs Argentina: five numbers that define the rivalry', category: 'Football', image: img('football'), author: 'Data Desk', date: daysAgo(3), featured: true, views: 13220,
    excerpt: 'From shots on target to set-piece goals, here is what the data says before the Friendly Cup clash.',
    body: 'The last ten meetings produced only 1.9 goals per game on average, and the side that scored first went unbeaten in eight of them. Expect a tight, tactical opening half.\n\nThis is sample editorial content created for the TUSKY Stage 1 demo.' },
  { id: 'n8', title: 'India hockey unveils young squad for Pro League home leg', category: 'Tournament News', image: img('hockey'), author: 'TUSKY Desk', date: daysAgo(4), views: 4310,
    excerpt: 'Five uncapped players earn call-ups as the coach looks to build depth before the world championships.',
    body: 'The squad blends experience in defence with pace up front. Circle-entry conversion — a key metric in our hockey model — has improved by 11% over the last season.\n\nThis is sample editorial content created for the TUSKY Stage 1 demo.' },
  { id: 'n9', title: 'Sharma climbs to career-high ranking after Asia Open run', category: 'Player Updates', image: img('badminton'), author: 'Shuttle Notes', date: daysAgo(5), views: 3890,
    excerpt: 'Back-to-back wins over top-ten opponents lift the shuttler into the world top eight.',
    body: 'Sharma’s average rally length has dropped to 7.2 shots, reflecting a more aggressive net game that has paid off against defensive players.\n\nThis is sample editorial content created for the TUSKY Stage 1 demo.' },
  { id: 'n10', title: 'Harbor Kings complete mid-season trade for veteran point guard', category: 'Transfer News', image: img('basketball'), author: 'Hoops Lab', date: daysAgo(6), views: 6120,
    excerpt: 'The Kings send two second-round picks in exchange for proven playoff experience.',
    body: 'The addition improves the Kings’ assist-to-turnover ratio, their weakest area this season. Our model nudges their playoff probability up by 5 points.\n\nThis is sample editorial content created for the TUSKY Stage 1 demo.' },
].map((n) => ({ status: 'published', ...n }));
