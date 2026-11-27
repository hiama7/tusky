// Upcoming matches with search + sport / tournament / date / lock-status filters (server-side).
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, SlidersHorizontal, CalendarX } from 'lucide-react';
import MatchCard from '../../components/match/MatchCard';
import { CardSkeleton, Chips, EmptyState, PageHeader } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useAsync } from '../../hooks/useAsync';
import { getMatches, getSports, getTournaments } from '../../services/matches';

function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function Matches() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const sport = params.get('sport') || 'all';
  const [q, setQ] = useState('');
  const [tournament, setTournament] = useState('all');
  const [date, setDate] = useState('');
  const [lock, setLock] = useState('all');
  const query = useDebounced(q);

  const dayRange = date ? { from: new Date(`${date}T00:00:00`).toISOString(), to: new Date(`${date}T23:59:59`).toISOString() } : {};
  const { data, loading, error } = useAsync(
    () => getMatches({ sport, q: query, tournament, upcoming: true, ...dayRange }),
    [sport, query, tournament, date, user.id],
  );
  const { data: sports } = useAsync(() => getSports(), []);
  const { data: tournaments } = useAsync(() => getTournaments(sport === 'all' ? undefined : sport), [sport]);

  const rows = (data || []).filter((m) => lock === 'all' || (lock === 'unlocked') === Boolean(m.unlocked));
  const setSport = (s) => {
    setTournament('all');
    setParams(s === 'all' ? {} : { sport: s });
  };

  return (
    <>
      <PageHeader title="Upcoming Matches" subtitle="Search fixtures and unlock the predictions you want." />
      <div className="glass mb-6 space-y-4 p-4">
        <Chips options={[{ value: 'all', label: 'All sports' }, ...(sports || []).filter((s) => s.upcomingMatches > 0 || s.id === sport).map((s) => ({ value: s.id, label: s.name }))]} value={sport} onChange={setSport} />
        <div className="grid gap-3 md:grid-cols-[1fr_200px_170px_170px]">
          <label className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input className="input pl-9" placeholder="Search team, tournament or venue…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search matches" />
          </label>
          <select className="input" value={tournament} onChange={(e) => setTournament(e.target.value)} aria-label="Filter by tournament">
            <option value="all">All tournaments</option>
            {(tournaments || []).map((t) => <option key={t.id} value={t.id}>{t.name}{t.season ? ` ${t.season}` : ''}</option>)}
          </select>
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Filter by date" />
          <select className="input" value={lock} onChange={(e) => setLock(e.target.value)} aria-label="Filter by status">
            <option value="all">Locked & unlocked</option>
            <option value="locked">Locked only</option>
            <option value="unlocked">Unlocked only</option>
          </select>
        </div>
        <p className="flex items-center gap-2 text-xs text-muted"><SlidersHorizontal className="h-3.5 w-3.5" /> {loading ? 'Loading…' : `${rows.length} match${rows.length === 1 ? '' : 'es'} found`}</p>
      </div>

      {error ? <EmptyState title="Couldn’t load matches" text={error.message} /> : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {loading ? <CardSkeleton count={6} className="h-72" /> : rows.map((m) => <MatchCard key={m.id} match={m} />)}
        </div>
      )}
      {!loading && !error && !rows.length && (
        <EmptyState icon={CalendarX} title="No matches found" text="Try a different sport, tournament, date or search term." action={<button className="btn-ghost" onClick={() => { setQ(''); setLock('all'); setDate(''); setSport('all'); }}>Reset filters</button>} />
      )}
    </>
  );
}
