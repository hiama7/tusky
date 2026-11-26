import NewsFeed from '../../components/sections/NewsFeed';
import { DemoTag } from '../../components/ui';

export default function News() {
  return (
    <div className="mx-auto max-w-7xl px-4 pt-28 md:px-6">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Newsroom</p>
          <h1 className="section-title mt-2">Sports news & analysis</h1>
          <p className="section-sub">Match previews, transfers, tournament updates and player news.</p>
        </div>
        <DemoTag>Sample articles</DemoTag>
      </div>
      <NewsFeed />
    </div>
  );
}
