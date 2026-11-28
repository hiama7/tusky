// Recent published articles that name either team.
import { ExternalLink, Newspaper } from 'lucide-react';
import { useAsync } from '../../hooks/useAsync';
import { getMatchNews } from '../../services/matches';
import { timeAgo } from '../../utils/format';

export default function MatchNews({ matchId }) {
  const { data } = useAsync(() => getMatchNews(matchId), [matchId], { live: false });
  if (!data) return null;
  return (
    <section className="card">
      <h3 className="mb-4 flex items-center gap-2 font-semibold"><Newspaper className="h-4 w-4 text-brand" /> Team news</h3>
      {data.length ? (
        <ul className="space-y-4">
          {data.map((n) => (
            <li key={n.id} className="border-t border-white/5 pt-4 first:border-0 first:pt-0">
              <p className="font-medium">{n.title}</p>
              <p className="mt-1 line-clamp-2 text-sm text-muted">{n.excerpt}</p>
              <p className="mt-1 flex items-center gap-3 text-[11px] text-muted">
                {timeAgo(n.date)}
                {n.sourceUrl && <a href={n.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand">Read the full story <ExternalLink className="h-3 w-3" /></a>}
              </p>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-muted">No recent articles about these teams.</p>}
    </section>
  );
}
