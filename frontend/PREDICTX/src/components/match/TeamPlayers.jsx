// Both squads with this season's league figures. "–" means the data source did not
// list the player among the leading scorers, so the number is not known here.
// Renders nothing when the server has no squads.
import { useState } from 'react';
import { Users } from 'lucide-react';
import { Chips } from '../ui';
import { useAsync } from '../../hooks/useAsync';
import { getMatchPlayers } from '../../services/matches';

const COLUMNS = [['played', 'Apps', 'Matches played'], ['goals', 'G', 'Goals'], ['assists', 'A', 'Assists'], ['penalties', 'Pen', 'Penalty goals']];
const SHOWN = 12;

export default function TeamPlayers({ matchId }) {
  const { data } = useAsync(() => getMatchPlayers(matchId), [matchId], { live: false });
  const [chosen, setChosen] = useState('');
  const [all, setAll] = useState(false);
  if (!data?.available) return null;
  const team = data.teams.find((t) => t.name === chosen) || data.teams[0];
  const players = all ? team.players : team.players.slice(0, SHOWN);

  return (
    <section className="card">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 font-semibold"><Users className="h-4 w-4 text-brand" /> Players</h3>
        {data.teams.length > 1 && <Chips options={data.teams.map((t) => t.name)} value={team.name} onChange={setChosen} />}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-[11px] uppercase text-muted">
            <tr>
              <th className="px-2 py-2 text-left">Player</th>
              <th className="hidden px-2 py-2 text-left sm:table-cell">Position</th>
              <th className="hidden px-2 py-2 text-left md:table-cell">Nationality</th>
              <th className="hidden px-2 py-2 text-right sm:table-cell">Age</th>
              {COLUMNS.map(([key, label, title]) => <th key={key} className="px-2 py-2 text-right" title={title}><abbr title={title} className="no-underline">{label}</abbr></th>)}
            </tr>
          </thead>
          <tbody>
            {players.map((p) => (
              <tr key={p.id} className="border-t border-white/5">
                <td className="px-2 py-2 font-medium">{p.name}</td>
                <td className="hidden px-2 py-2 text-muted sm:table-cell">{p.position || '–'}</td>
                <td className="hidden px-2 py-2 text-muted md:table-cell">{p.nationality || '–'}</td>
                <td className="hidden px-2 py-2 text-right tabular-nums text-muted sm:table-cell">{p.age ?? '–'}</td>
                {COLUMNS.map(([key]) => <td key={key} className="px-2 py-2 text-right tabular-nums">{p[key] ?? '–'}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {team.players.length > SHOWN && <button className="btn-ghost btn-sm mt-3" onClick={() => setAll((v) => !v)}>{all ? 'Show fewer' : `Show all ${team.players.length} players`}</button>}
      <p className="mt-3 text-[11px] text-muted">
        {data.hasFigures ? 'League figures this season, for the competition’s leading scorers only; “–” means not listed.' : 'Scoring figures are unavailable right now.'} {data.attribution}
      </p>
    </section>
  );
}
