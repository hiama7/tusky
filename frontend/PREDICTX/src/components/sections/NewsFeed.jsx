// Sports news interface: featured, latest, trending, search, category filters,
// news cards and a "Read More" article modal. Used on /news and /user/news.
import { useMemo, useState } from 'react';
import { Search, Flame, Clock, Eye, ArrowRight, Newspaper } from 'lucide-react';
import { Chips, CardSkeleton, EmptyState, Modal, DemoTag } from '../ui';
import { useAsync } from '../../hooks/useAsync';
import { getNews } from '../../services/news';
import { NEWS_CATEGORIES } from '../../data/demo/news';
import { fmtDate, num, timeAgo } from '../../utils/format';

function NewsCard({ item, onOpen }) {
  return (
    <article className="glass card-lift group flex flex-col overflow-hidden page-enter">
      <div className="relative h-40 overflow-hidden">
        <img src={item.image} alt="" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" loading="lazy" />
        <span className="badge-blue absolute left-3 top-3 bg-ink/70 backdrop-blur">{item.category}</span>
      </div>
      <div className="flex flex-1 flex-col p-5">
        <p className="flex items-center gap-3 text-[11px] text-muted"><span className="flex items-center gap-1"><Clock className="h-3 w-3" />{timeAgo(item.date)}</span><span className="flex items-center gap-1"><Eye className="h-3 w-3" />{num(item.views)}</span></p>
        <h3 className="mt-2 line-clamp-2 font-semibold leading-snug">{item.title}</h3>
        <p className="mt-2 line-clamp-2 text-sm text-muted">{item.excerpt}</p>
        <button onClick={() => onOpen(item)} className="mt-auto flex items-center gap-1 pt-4 text-sm font-medium text-blue hover:gap-2 transition-all">Read More <ArrowRight className="h-4 w-4" /></button>
      </div>
    </article>
  );
}

export default function NewsFeed() {
  const [category, setCategory] = useState('All');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  const { data, loading } = useAsync(() => getNews({ category, q }), [category, q]);
  const { data: all } = useAsync(() => getNews(), []);

  const featured = useMemo(() => (all || []).find((n) => n.featured), [all]);
  const trending = useMemo(() => (all || []).filter((n) => n.trending).sort((a, b) => b.views - a.views).slice(0, 5), [all]);
  const filtering = category !== 'All' || q;
  const latest = (data || []).filter((n) => filtering || n.id !== featured?.id);

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <Chips options={['All', ...NEWS_CATEGORIES]} value={category} onChange={setCategory} />
        <label className="relative w-full lg:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input className="input pl-9" placeholder="Search news…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search news" />
        </label>
      </div>

      {!filtering && featured && (
        <div className="mb-8 grid gap-5 lg:grid-cols-3">
          {/* Featured story */}
          <article className="glass group relative overflow-hidden lg:col-span-2">
            <img src={featured.image} alt="" className="h-72 w-full object-cover opacity-80 transition-transform duration-700 group-hover:scale-105 md:h-80" />
            <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/60 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 p-6">
              <div className="flex flex-wrap items-center gap-2"><span className="badge-purple">Featured</span><span className="badge-blue">{featured.category}</span><DemoTag>Sample story</DemoTag></div>
              <h2 className="mt-3 max-w-2xl text-2xl font-bold md:text-3xl">{featured.title}</h2>
              <p className="mt-2 line-clamp-2 max-w-2xl text-sm text-muted">{featured.excerpt}</p>
              <button onClick={() => setOpen(featured)} className="btn-primary btn-sm mt-4">Read More</button>
            </div>
          </article>
          {/* Trending list */}
          <aside className="card">
            <p className="flex items-center gap-2 font-semibold"><Flame className="h-4 w-4 text-orange" /> Trending now</p>
            <ol className="mt-4 space-y-4">
              {trending.map((t, i) => (
                <li key={t.id}>
                  <button onClick={() => setOpen(t)} className="group flex gap-3 text-left">
                    <span className="font-display text-2xl font-bold text-white/15 group-hover:text-blue">{String(i + 1).padStart(2, '0')}</span>
                    <span>
                      <span className="line-clamp-2 text-sm font-medium group-hover:text-blue">{t.title}</span>
                      <span className="text-[11px] text-muted">{t.category} · {num(t.views)} views</span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </aside>
        </div>
      )}

      <h2 className="mb-4 text-lg font-semibold">{filtering ? `Results${category !== 'All' ? ` · ${category}` : ''}` : 'Latest news'}</h2>
      {loading ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3"><CardSkeleton count={6} className="h-80" /></div>
      ) : latest.length ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{latest.map((n) => <NewsCard key={n.id} item={n} onOpen={setOpen} />)}</div>
      ) : (
        <EmptyState icon={Newspaper} title="No stories match your search" text="Try another category or keyword." action={<button className="btn-ghost" onClick={() => { setQ(''); setCategory('All'); }}>Clear filters</button>} />
      )}

      <Modal open={!!open} onClose={() => setOpen(null)} title={open?.category || ''} size="lg">
        {open && (
          <article>
            <img src={open.image} alt="" className="h-56 w-full rounded-xl object-cover" />
            <h2 className="mt-5 text-2xl font-bold">{open.title}</h2>
            <p className="mt-2 text-xs text-muted">By {open.author} · {fmtDate(open.date)} · {num(open.views)} views</p>
            <p className="mt-4 font-medium text-white/90">{open.excerpt}</p>
            {open.body?.split('\n').filter(Boolean).map((p, i) => <p key={i} className="mt-3 text-sm leading-relaxed text-muted">{p}</p>)}
          </article>
        )}
      </Modal>
    </div>
  );
}
