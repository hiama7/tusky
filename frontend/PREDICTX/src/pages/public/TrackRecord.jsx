// Every pre-match prediction against the actual result, hits and misses alike.
import { CheckCircle2, XCircle } from 'lucide-react';
import { EmptyState, Skeleton } from '../../components/ui';
import { useAsync } from '../../hooks/useAsync';
import { getTrackRecord } from '../../services/matches';
import { cx, fmtDate } from '../../utils/format';

const SMALL_SAMPLE = 100;
const pickName = (code, m) => (code === 'DRAW' ? 'Draw' : code === 'TEAM_A' ? m.teamA : m.teamB);

function Figure({ label, value, hint }) {
  return (
    <div className="card">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 font-display text-3xl font-bold">{value}</p>
      <p className="mt-1 text-xs text-muted">{hint}</p>
    </div>
  );
}

export default function TrackRecord() {
  const { data, loading, error } = useAsync(() => getTrackRecord(), []);
  const s = data?.summary;
  return (
    <div className="mx-auto max-w-5xl px-4 pt-28 md:px-6">
      <p className="eyebrow">Track record</p>
      <h1 className="section-title mt-2">What we said, and what happened</h1>
      <p className="section-sub">
        Each finished match is compared with the numbers published before it started. They cannot be edited afterwards, and misses are counted the same as hits.
      </p>

      {loading ? <Skeleton className="mt-10 h-40 rounded-2xl" /> : error ? <div className="mt-10"><EmptyState title="Couldn’t load the track record" text={error.message} /></div> : (
        <>
          {s.matches === 0 ? (
            <div className="mt-10"><EmptyState title="No finished matches to judge yet" text={data.awaitingResult ? `${data.awaitingResult} published predictions are waiting for their results.` : 'Results appear here after matches with published predictions finish.'} /></div>
          ) : (
            <>
              {s.matches < SMALL_SAMPLE && (
                <p className="mt-8 rounded-xl border border-orange/40 bg-orange/10 px-4 py-3 text-sm text-orange" role="note">
                  Only {s.matches} matches so far. Figures from a sample this small can move a lot and say little yet.
                </p>
              )}
              <div className="mt-6 grid gap-4 sm:grid-cols-3">
                <Figure label="Right result picked" value={`${s.accuracy}%`} hint={`${s.correct} of ${s.matches} matches`} />
                <Figure label="Always picking the first (home) side" value={`${s.homeBaseline}%`} hint="The figure to beat, on the same matches" />
                <Figure label="Probability error (Brier)" value={s.brier} hint="0 is perfect; lower is better" />
              </div>

              <h2 className="mt-12 text-xl font-bold">Do the percentages mean what they say?</h2>
              <div className="card mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-muted"><tr><th className="py-2">Favourite’s chance</th><th className="py-2 text-right">Matches</th><th className="py-2 text-right">Said</th><th className="py-2 text-right">Happened</th></tr></thead>
                  <tbody>{s.calibration.map((b) => <tr key={b.band} className="border-t border-white/5"><td className="py-2">{b.band}</td><td className="py-2 text-right">{b.matches}</td><td className="py-2 text-right">{b.predicted}%</td><td className="py-2 text-right">{b.happened}%</td></tr>)}</tbody>
                </table>
              </div>

              <h2 className="mt-12 text-xl font-bold">Latest results</h2>
              <ul className="mt-4 space-y-3">
                {data.items.map((m) => (
                  <li key={m.matchId} className="card flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="font-semibold">{m.teamA} vs {m.teamB} <span className="text-muted">{m.score}</span></p>
                      <p className="text-xs text-muted">{m.tournament} · {fmtDate(m.startsAt)}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-sm">
                      <span className="text-muted tabular-nums">{m.probA}%{m.probDraw !== null && ` / ${m.probDraw}%`} / {m.probB}%</span>
                      <span className={cx('flex items-center gap-1 font-semibold', m.correct ? 'text-green' : 'text-red')}>
                        {m.correct ? <CheckCircle2 className="h-4 w-4" aria-label="Correct" /> : <XCircle className="h-4 w-4" aria-label="Wrong" />} Picked {pickName(m.predicted, m)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}
