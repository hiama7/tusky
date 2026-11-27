// What needs attention: stale fixtures or results, failed jobs, old backups.
import { Activity, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { useAsync } from '../../hooks/useAsync';
import { getSystemHealth } from '../../services/admin';
import { cx } from '../../utils/format';

const LEVEL = { ok: [CheckCircle2, 'text-green'], warn: [AlertTriangle, 'text-orange'], fail: [XCircle, 'text-red'] };

export default function SystemHealth() {
  const { data } = useAsync(() => getSystemHealth(), []);
  if (!data) return null;
  return (
    <section className={cx('card', data.status === 'fail' && 'border-red/50')} aria-label="System health">
      <h2 className="flex items-center gap-2 font-semibold"><Activity className="h-4 w-4 text-brand" /> System health</h2>
      <ul className="mt-3 grid gap-2 text-sm md:grid-cols-2">
        {data.checks.map((c) => {
          const [Icon, tone] = LEVEL[c.level];
          return <li key={c.name} className="flex gap-2"><Icon className={cx('mt-0.5 h-4 w-4 shrink-0', tone)} aria-label={c.level} /><span className={c.level === 'ok' ? 'text-muted' : ''}>{c.message}</span></li>;
        })}
      </ul>
    </section>
  );
}
