// Grid of sport category cards (image, name, match count, Explore button).
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { SPORTS } from '../../data/demo/sports';
import { useAsync } from '../../hooks/useAsync';
import { getMatches } from '../../services/matches';

export default function SportsGrid({ exploreBase = '/user/matches' }) {
  const navigate = useNavigate();
  const { data: matches } = useAsync(() => getMatches(), []);
  const count = (id) => (matches || []).filter((m) => m.sport === id).length;

  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
      {SPORTS.map((s, i) => (
        <article key={s.id} className="glass card-lift group overflow-hidden page-enter" style={{ animationDelay: `${i * 50}ms` }}>
          <div className="relative h-36 overflow-hidden">
            <img src={s.image} alt={`${s.name} illustration`} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110" loading="lazy" />
            <div className="absolute inset-0 bg-gradient-to-t from-card via-transparent" />
            <span className="badge-muted absolute right-3 top-3 bg-ink/60 backdrop-blur">{matches ? `${count(s.id)} upcoming` : '…'}</span>
          </div>
          <div className="flex items-center justify-between gap-3 p-4">
            <div>
              <h3 className="font-semibold">{s.name}</h3>
              <p className="text-xs text-muted">{s.tagline}</p>
            </div>
            <button onClick={() => navigate(`${exploreBase}?sport=${s.id}`)} className="btn-ghost btn-sm group/btn" aria-label={`Explore ${s.name}`}>
              Explore <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover/btn:translate-x-0.5" />
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}
