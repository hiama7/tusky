// Finished matches and their scores.
import { Link } from 'react-router-dom';
import { Flag } from 'lucide-react';
import { CardSkeleton, EmptyState, PageHeader } from '../../components/ui';
import { useAsync } from '../../hooks/useAsync';
import { getResults } from '../../services/matches';
import { fmtDate } from '../../utils/format';

export default function Results() {
  const { data, loading, error } = useAsync(() => getResults(), []);
  return (
    <>
      <PageHeader title="Results" subtitle="Finished matches listed on this site." actions={<Link to="/track-record" className="btn-ghost">How our predictions did</Link>} />
      {error ? <EmptyState title="Couldn’t load results" text={error.message} />
        : loading ? <div className="space-y-3"><CardSkeleton count={4} className="h-20" /></div>
          : !data.length ? <EmptyState icon={Flag} title="No results yet" text="Scores appear here after listed matches finish." />
            : (
              <ul className="space-y-3">
                {data.map((m) => (
                  <li key={m.id}>
                    <Link to={`/user/match/${m.id}`} className="card card-lift flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                      <span className="font-semibold">{m.teamA.name} vs {m.teamB.name}</span>
                      <span className="text-sm text-muted">{m.result?.score || m.result?.description || 'Finished'} · {m.tournament} · {fmtDate(m.date)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
    </>
  );
}
