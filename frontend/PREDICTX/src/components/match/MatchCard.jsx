// Match card used on the homepage, dashboard and matches list.
import { Link } from 'react-router-dom';
import { Lock, Unlock, CalendarDays, Clock3, Trophy } from 'lucide-react';
import { TeamCrest } from '../ui';
import { cx, fmtDate, fmtTime, inr, startsIn } from '../../utils/format';

/** `unlocked` defaults to the server-provided flag on the match. */
export default function MatchCard({ match, unlocked = match.unlocked, to, compact = false }) {
  const sport = { name: match.sportName, color: match.sportColor };
  const href = to ?? `/user/match/${match.id}`;
  return (
    <article className="glass card-lift group relative flex flex-col overflow-hidden page-enter">
      {/* stripe in the two teams' colours */}
      <div className="h-1 w-full shrink-0 opacity-80" style={{ background: `linear-gradient(90deg, ${match.teamA.color}, transparent 45%, transparent 55%, ${match.teamB.color})` }} />
      <div className="flex items-center justify-between px-5 pt-4">
        <span className="badge-muted" style={{ color: sport?.color }}>{sport?.name}</span>
        <span className="text-[11px] text-muted">{startsIn(match.date)}</span>
      </div>

      <div className={cx('flex items-center justify-between gap-2 px-5', compact ? 'py-4' : 'py-6')}>
        <div className="flex min-w-0 flex-1 flex-col items-center gap-2 text-center">
          <TeamCrest team={match.teamA} />
          <p className="w-full truncate text-sm font-semibold">{match.teamA.name}</p>
        </div>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-accent/30 bg-ink-2 font-display text-xs font-bold text-white shadow-[0_0_22px_-4px_rgba(255,255,255,.75)] transition-transform duration-500 group-hover:rotate-[360deg]">VS</span>
        <div className="flex min-w-0 flex-1 flex-col items-center gap-2 text-center">
          <TeamCrest team={match.teamB} />
          <p className="w-full truncate text-sm font-semibold">{match.teamB.name}</p>
        </div>
      </div>

      <div className="space-y-1.5 border-t border-white/5 px-5 py-3 text-xs text-muted">
        <p className="flex items-center gap-2 truncate"><Trophy className="h-3.5 w-3.5 shrink-0" /> {match.tournament}</p>
        <p className="flex items-center gap-4">
          <span className="flex items-center gap-2"><CalendarDays className="h-3.5 w-3.5" /> {fmtDate(match.date, { day: 'numeric', month: 'short' })}</span>
          <span className="flex items-center gap-2"><Clock3 className="h-3.5 w-3.5" /> {fmtTime(match.date)}</span>
        </p>
      </div>

      <div className="mt-auto flex items-center justify-between gap-3 border-t border-white/5 px-5 py-4">
        {unlocked ? (
          <span className="flex items-center gap-1.5 text-sm font-semibold text-green"><Unlock className="h-4 w-4" /> Unlocked</span>
        ) : (
          <span className="flex items-center gap-1.5 text-sm">
            <Lock className="h-4 w-4 text-orange" />
            <span className="font-display text-lg font-bold">{inr(match.price)}</span>
          </span>
        )}
        <Link to={href} className={cx('btn-sm', unlocked ? 'btn-ghost' : 'btn-primary')}>
          {unlocked ? 'View Prediction' : 'Unlock'}
        </Link>
      </div>
    </article>
  );
}
