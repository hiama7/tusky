// Upcoming matches with search + sport / tournament / lock-status filters.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, SlidersHorizontal, CalendarX } from 'lucide-react';
import MatchCard from '../../components/match/MatchCard';
import { CardSkeleton, Chips, EmptyState, PageHeader } from '../../components/ui';
import { SPORTS } from '../../data/demo/sports';
import { useAuth } from '../../context/AuthContext';
import { useAsync } from '../../hooks/useAsync';
import { getMatches } from '../../services/matches';
import { isUnlocked } from '../../services/purchases';

export default function Matches() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const sport = params.get('sport') || 'all';
  const [q, setQ] = useState('');
  const [tournament, setTournament] = useState('all');
  const [lock, setLock] = useState('all');

  const { data, loading } = useAsync(() => getMatches({ sport, q, tournament, upcomingOnly: true }), [sport, q, tournament]);
  const { data: allMatches } = useAsync(() => getMatches({ upcomingOnly: true }), []);
  const tournaments = useMemo(() => [...new Set((allMatches || []).filter((m) => sport === 'all' || m.sport === sport).map((m) => m.tournament))], [allMatches, sport]);

  const rows = (data || []).filter((m) => lock === 'all' || (lock === 'unlocked') === isUnlocked(user.id, m.id));

  const setSport = (s) => {
    setTournament('all');
    setParams(s === 'all' ? {} : { sport: s });
  };

  return (
    <>
      <PageHeader title="Upcoming Matches" subtitle="Search fixtures and unlock the predictions you want." />
      <div className="glass mb-6 space-y-4 p-4">
        <Chips options={[{ value: 'all', label: 'All sports' }, ...SPORTS.map((s) => ({ value: s.id, label: s.name }))]} value={sport} onChange={setSport} />
        <div className="grid gap-3 md:grid-cols-[1fr_220px_180px]">
          <label className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input className="input pl-9" placeholder="Search team, tournament or venue…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search matches" />
          </label>
          <select className="input" value={tournament} onChange={(e) => setTournament(e.target.value)} aria-label="Filter by tournament">
            <option value="all">All tournaments</option>
            {tournaments.map((t) => <option key={t}>{t}</option>)}
          </select>
          <select className="input" value={lock} onChange={(e) => setLock(e.target.value)} aria-label="Filter by status">
            <option value="all">Locked & unlocked</option>
            <option value="locked">Locked only</option>
            <option value="unlocked">Unlocked only</option>
          </select>
        </div>
        <p className="flex items-center gap-2 text-xs text-muted"><SlidersHorizontal className="h-3.5 w-3.5" /> {loading ? 'Loading…' : `${rows.length} match${rows.length === 1 ? '' : 'es'} found`}</p>
      </div>

      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {loading ? <CardSkeleton count={6} className="h-72" /> : rows.map((m) => <MatchCard key={m.id} match={m} unlocked={isUnlocked(user.id, m.id)} />)}
      </div>
      {!loading && !rows.length && (
        <EmptyState icon={CalendarX} title="No matches found" text="Try a different sport, tournament or search term." action={<button className="btn-ghost" onClick={() => { setQ(''); setLock('all'); setSport('all'); }}>Reset filters</button>} />
      )}
    </>
  );
}
