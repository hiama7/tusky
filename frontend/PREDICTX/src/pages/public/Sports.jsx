// Public sports page: category grid + upcoming matches with sport filter.
import { useState } from 'react';
import MatchCard from '../../components/match/MatchCard';
import SportsGrid from '../../components/sections/SportsGrid';
import { Chips, CardSkeleton, EmptyState } from '../../components/ui';
import { useAsync } from '../../hooks/useAsync';
import { getMatches, getSports } from '../../services/matches';
import { useAuth } from '../../context/AuthContext';

export default function Sports() {
  const [sport, setSport] = useState('all');
  const { user } = useAuth(); // unlock badges depend on who is logged in
  const { data, loading, error } = useAsync(() => getMatches({ sport, upcoming: true }), [sport, user?.id]);
  const { data: sports } = useAsync(() => getSports(), []);
  return (
    <div className="mx-auto max-w-7xl px-4 pt-28 md:px-6">
      <p className="eyebrow">Sports</p>
      <h1 className="section-title mt-2">Matches by sport</h1>
      <p className="section-sub">Choose a sport to explore its upcoming fixtures and predictions.</p>
      <div className="mt-10"><SportsGrid /></div>

      <h2 className="mt-16 text-2xl font-bold">Upcoming matches</h2>
      <div className="my-5"><Chips options={[{ value: 'all', label: 'All sports' }, ...(sports || []).filter((s) => s.upcomingMatches > 0).map((s) => ({ value: s.id, label: s.name }))]} value={sport} onChange={setSport} /></div>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {loading ? <CardSkeleton count={3} className="h-72" /> : error ? <div className="sm:col-span-2 lg:col-span-3"><EmptyState title="Couldn’t load matches" text={error.message} /></div> : data?.length ? data.map((m) => <MatchCard key={m.id} match={m} />) : <div className="sm:col-span-2 lg:col-span-3"><EmptyState title="No upcoming matches for this sport yet" /></div>}
      </div>
    </div>
  );
}
