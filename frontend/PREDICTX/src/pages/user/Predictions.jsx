// All published predictions with lock status. Locked rows never show numbers.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Lock, Unlock, Target, Gauge } from 'lucide-react';
import { Chips, DataTable, PageHeader, ProbBar, TeamCrest } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useAsync } from '../../hooks/useAsync';
import { getMatches, getPredictions } from '../../services/matches';
import { unlockReason } from '../../services/purchases';
import { sportById } from '../../data/demo/sports';
import { fmtDateTime, inr } from '../../utils/format';

export default function Predictions() {
  const { user } = useAuth();
  const [tab, setTab] = useState('all');
  const { data, loading } = useAsync(async () => {
    const [matches, preds] = await Promise.all([getMatches(), getPredictions()]);
    return preds
      .filter((p) => p.status === 'published')
      .map((p) => ({ ...p, match: matches.find((m) => m.id === p.matchId) }))
      .filter((p) => p.match)
      .sort((a, b) => new Date(a.match.date) - new Date(b.match.date));
  }, []);

  const rows = (data || [])
    .map((p) => ({ ...p, reason: unlockReason(user.id, p.matchId) }))
    .filter((p) => tab === 'all' || (tab === 'unlocked' ? p.reason : !p.reason));

  const columns = [
    { key: 'match', label: 'Match', render: (p) => (
      <div className="flex items-center gap-3">
        <div className="flex -space-x-2"><TeamCrest team={p.match.teamA} size="sm" /><TeamCrest team={p.match.teamB} size="sm" /></div>
        <div className="text-left"><p className="font-medium">{p.match.teamA.name} vs {p.match.teamB.name}</p><p className="text-xs text-muted">{sportById(p.match.sport)?.name} · {p.match.tournament}</p></div>
      </div>
    ) },
    { key: 'date', label: 'Starts', render: (p) => <span className="text-muted">{fmtDateTime(p.match.date)}</span> },
    { key: 'prob', label: 'Prediction', render: (p) => (p.reason ? (
      <div className="w-40"><p className="mb-1 text-xs">{p.probA >= p.probB ? p.match.teamA.short : p.match.teamB.short} <b>{Math.max(p.probA, p.probB)}%</b></p><ProbBar value={Math.max(p.probA, p.probB)} /></div>
    ) : <span className="flex items-center gap-1.5 text-muted"><Lock className="h-3.5 w-3.5 text-orange" /> Hidden</span>) },
    { key: 'confidence', label: 'Confidence', render: (p) => (p.reason ? <span className="badge-purple"><Gauge className="h-3 w-3" />{p.confidence}</span> : <span className="text-muted">—</span>) },
    { key: 'action', label: '', render: (p) => (
      <Link to={`/user/match/${p.matchId}`} className={p.reason ? 'btn-ghost btn-sm' : 'btn-primary btn-sm'}>
        {p.reason ? <><Unlock className="h-3.5 w-3.5" /> View</> : <><Lock className="h-3.5 w-3.5" /> Unlock {inr(p.match.price)}</>}
      </Link>
    ) },
  ];

  const unlockedCount = (data || []).filter((p) => unlockReason(user.id, p.matchId)).length;

  return (
    <>
      <PageHeader title="Predictions" subtitle={`${data?.length ?? '…'} published predictions · ${unlockedCount} unlocked by you`} />
      <div className="mb-5"><Chips options={[{ value: 'all', label: 'All' }, { value: 'unlocked', label: 'Unlocked' }, { value: 'locked', label: 'Locked' }]} value={tab} onChange={setTab} /></div>
      <DataTable loading={loading} columns={columns} rows={rows} empty={tab === 'unlocked' ? 'You haven’t unlocked any predictions yet.' : 'No predictions here.'} />
      {!loading && tab === 'unlocked' && !rows.length && <div className="mt-4 text-center"><Link to="/user/free-trial" className="btn-success"><Target className="h-4 w-4" /> Use your free trial</Link></div>}
    </>
  );
}
