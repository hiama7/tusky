// Grid of sport category cards (image, name, upcoming match count, Explore button).
// Sports and counts come from GET /api/sports.
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { CardSkeleton, EmptyState } from '../ui';
import { useAsync } from '../../hooks/useAsync';
import { getSports } from '../../services/matches';

export default function SportsGrid({ exploreBase = '/user/matches' }) {
  const navigate = useNavigate();
  const { data: sports, loading, error } = useAsync(() => getSports(), []);

  if (loading) return <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4"><CardSkeleton count={8} className="h-56" /></div>;
  if (error) return <EmptyState title="Couldn’t load sports" text={error.message} />;
  if (!sports?.length) return <EmptyState title="No sports available yet" />;

  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
      {[...sports].sort((a, b) => (b.upcomingMatches > 0) - (a.upcomingMatches > 0)).map((s, i) => (
        <article key={s.id} className="glass card-lift group overflow-hidden page-enter" style={{ animationDelay: `${i * 50}ms` }}>
          <div className="relative h-36 overflow-hidden bg-ink-2">
            {s.image && <img src={s.image} alt={`${s.name} illustration`} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110 group-hover:-rotate-1" loading="lazy" />}
            <div className="absolute inset-0 bg-gradient-to-t from-card via-transparent" />
            <span className="badge-muted absolute right-3 top-3 bg-ink/60 backdrop-blur">{s.upcomingMatches > 0 ? `${s.upcomingMatches} upcoming` : 'Coming soon'}</span>
          </div>
          <div className="flex items-center justify-between gap-3 p-4">
            <div>
              <h3 className="font-semibold">{s.name}</h3>
              <p className="text-xs text-muted">{s.description}</p>
            </div>
            <button onClick={() => navigate(`${exploreBase}?sport=${s.id}`)} disabled={!s.upcomingMatches} className="btn-ghost btn-sm group/btn" aria-label={`Explore ${s.name}`}>
              Explore <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover/btn:translate-x-0.5" />
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}
