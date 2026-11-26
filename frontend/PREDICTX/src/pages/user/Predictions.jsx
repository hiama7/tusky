// All published predictions with lock state. The API only includes a preview
// (favourite + probability) for predictions this user has unlocked.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Lock, Unlock, Target, Gauge } from 'lucide-react';
import { Chips, DataTable, EmptyState, PageHeader, ProbBar, TeamCrest } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useAsync } from '../../hooks/useAsync';
import { getPredictions } from '../../services/matches';
import { fmtDateTime, inr } from '../../utils/format';

const favourite = (row) => {
  const p = row.preview;
  if (p.predictedOutcome === 'DRAW') return { label: 'Draw', value: p.probDraw };
  return p.predictedOutcome === 'TEAM_B' ? { label: row.match.teamB.short, value: p.probB } : { label: row.match.teamA.short, value: p.probA };
};

export default function Predictions() {
  const { user } = useAuth();
  const [tab, setTab] = useState('all');
  const { data, loading, error } = useAsync(() => getPredictions(), [user.id]);
  const rows = (data || []).filter((p) => tab === 'all' || (tab === 'unlocked' ? p.unlocked : !p.unlocked));

  const columns = [
    { key: 'match', label: 'Match', render: (p) => (
      <div className="flex items-center gap-3">
        <div className="flex -space-x-2"><TeamCrest team={p.match.teamA} size="sm" /><TeamCrest team={p.match.teamB} size="sm" /></div>
        <div className="text-left"><p className="font-medium">{p.match.teamA.name} vs {p.match.teamB.name}</p><p className="text-xs text-muted">{p.match.sportName} · {p.match.tournament}</p></div>
      </div>
    ) },
    { key: 'date', label: 'Starts', render: (p) => <span className="text-muted">{fmtDateTime(p.match.date)}</span> },
    { key: 'prob', label: 'Prediction', render: (p) => {
      if (!p.unlocked) return <span className="flex items-center gap-1.5 text-muted"><Lock className="h-3.5 w-3.5 text-orange" /> Hidden</span>;
      const f = favourite(p);
      return <div className="w-40"><p className="mb-1 text-xs">{f.label} <b>{f.value}%</b></p><ProbBar value={f.value} /></div>;
    } },
    { key: 'confidence', label: 'Confidence', render: (p) => (p.unlocked ? <span className="badge-purple"><Gauge className="h-3 w-3" />{p.preview.confidence}</span> : <span className="text-muted">—</span>) },
    { key: 'action', label: '', render: (p) => (
      <Link to={`/user/match/${p.matchId}`} className={p.unlocked ? 'btn-ghost btn-sm' : 'btn-primary btn-sm'}>
        {p.unlocked ? <><Unlock className="h-3.5 w-3.5" /> View</> : <><Lock className="h-3.5 w-3.5" /> Unlock {inr(p.match.price)}</>}
      </Link>
    ) },
  ];

  const unlockedCount = (data || []).filter((p) => p.unlocked).length;

  if (error) return <EmptyState title="Couldn’t load predictions" text={error.message} />;
  return (
    <>
      <PageHeader title="Predictions" subtitle={`${data?.length ?? '…'} published predictions · ${unlockedCount} unlocked by you`} />
      <div className="mb-5"><Chips options={[{ value: 'all', label: 'All' }, { value: 'unlocked', label: 'Unlocked' }, { value: 'locked', label: 'Locked' }]} value={tab} onChange={setTab} /></div>
      <DataTable loading={loading} columns={columns} rows={rows.map((r) => ({ ...r, id: r.matchId }))} empty={tab === 'unlocked' ? 'You haven’t unlocked any predictions yet.' : 'No predictions here.'} />
      {!loading && tab === 'unlocked' && !rows.length && <div className="mt-4 text-center"><Link to="/user/free-trial" className="btn-success"><Target className="h-4 w-4" /> Use your free trial</Link></div>}
    </>
  );
}
