// Current league table for a match's competition, with the two teams marked.
// Renders nothing when the server has no table for it.
import { ListOrdered } from 'lucide-react';
import { useAsync } from '../../hooks/useAsync';
import { getStandings } from '../../services/matches';
import { cx } from '../../utils/format';

const COLUMNS = [['played', 'P'], ['won', 'W'], ['drawn', 'D'], ['lost', 'L'], ['goalDifference', 'GD'], ['points', 'Pts']];

export default function LeagueTable({ matchId }) {
  const { data } = useAsync(() => getStandings(matchId), [matchId], { live: false });
  if (!data?.available) return null;
  return (
    <section className="card">
      <h3 className="mb-4 flex items-center gap-2 font-semibold"><ListOrdered className="h-4 w-4 text-brand" /> {data.competition} table</h3>
      <div className="max-h-96 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-card text-[11px] uppercase text-muted">
            <tr>
              <th className="px-2 py-2 text-left">#</th>
              <th className="px-2 py-2 text-left">Team</th>
              {COLUMNS.map(([key, label]) => <th key={key} className={cx('px-2 py-2 text-right', ['won', 'drawn', 'lost'].includes(key) && 'hidden sm:table-cell')}>{label}</th>)}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={`${r.position}-${r.team}`} className={cx('border-t border-white/5', r.side && 'bg-brand/10 font-semibold')}>
                <td className="px-2 py-2 text-muted">{r.position}</td>
                <td className={cx('px-2 py-2', r.side && 'text-brand')}>{r.team}</td>
                {COLUMNS.map(([key]) => <td key={key} className={cx('px-2 py-2 text-right tabular-nums', ['won', 'drawn', 'lost'].includes(key) && 'hidden sm:table-cell')}>{r[key]}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11px] text-muted">{data.attribution}</p>
    </section>
  );
}
