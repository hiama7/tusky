// Anonymous page views for the last 30 days.
import { DataTable } from '../ui';
import { useAsync } from '../../hooks/useAsync';
import { getPageViews } from '../../services/admin';

export default function PageViews() {
  const { data, loading } = useAsync(() => getPageViews(), []);
  return (
    <section className="mt-8">
      <h2 className="mb-1 text-lg font-semibold">Page views, last 30 days{data ? `: ${data.total}` : ''}</h2>
      <p className="mb-3 text-sm text-muted">Counts of public pages only. No cookies or visitor details are kept, so this cannot tell visitors apart.</p>
      <DataTable loading={loading} rows={(data?.pages || []).map((p) => ({ id: p.path, ...p }))} empty="No views counted yet." columns={[{ key: 'path', label: 'Page' }, { key: 'views', label: 'Views' }]} />
    </section>
  );
}
