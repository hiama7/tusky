// ML dashboard: which models are live, how they measured, where football is weak,
// and how published predictions have done. Every number comes from a file or table.
import { DataTable, EmptyState, PageHeader, Skeleton, StatCard } from '../../components/ui';
import { Activity, CalendarClock, Gauge, Target } from 'lucide-react';
import { useAsync } from '../../hooks/useAsync';
import { getModelReport } from '../../services/admin';
import { fmtDate } from '../../utils/format';

const pct = (v, digits = 1) => `${(v * 100).toFixed(digits)}%`;
const daysSince = (iso) => Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);

export default function AdminModel() {
  const { data, loading, error } = useAsync(() => getModelReport(), []);
  if (loading) return <Skeleton className="h-64 rounded-2xl" />;
  if (error) return <EmptyState title="Couldn’t load the model report" text={error.message} />;
  const { football: f, cricket, weakness: w, trackRecord: t } = data;

  return (
    <>
      <PageHeader title="Prediction models" subtitle="Measured results only. Re-run `npm run ml:weakness` to refresh the weakness analysis." />
      {!f ? <EmptyState title="No model report on this server" text="The ML artifacts folder is not available here." /> : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard icon={Target} label="Football: right result" value={f.validation ? pct(f.validation.accuracy) : '—'} hint={f.baseline ? `Base rates: ${pct(f.baseline.accuracy)} · ${f.validation?.matches} matches` : ''} />
          <StatCard icon={Gauge} color="accent" label="Football: RPS (lower is better)" value={f.validation?.rps?.toFixed(4) ?? '—'} hint={f.baseline ? `Base rates: ${f.baseline.rps.toFixed(4)}` : ''} />
          <StatCard icon={CalendarClock} color="orange" label="Results used up to" value={fmtDate(f.dataThrough)} hint={`${daysSince(f.dataThrough)} days old`} />
          <StatCard icon={Activity} color="green" label="Published and finished" value={t.matches} hint={t.matches ? `${t.accuracy}% right; home-side baseline ${t.homeBaseline}%` : 'No results yet'} />
        </div>
      )}
      {f && <p className="mt-3 text-xs text-muted">Live model: {f.version}, trained {fmtDate(f.trainedAt)}. Figures above are from rolling validation since {fmtDate(f.validationFrom)}.</p>}

      {w && (
        <section className="mt-8">
          <h2 className="mb-1 text-lg font-semibold">Where football is weak</h2>
          <p className="mb-3 text-sm text-muted">Fitted before {w.cutoff}, scored on {w.matches} later matches. Skill is the improvement over quoting base rates; overlapping ranges are not clearly different.</p>
          <DataTable rows={Object.entries(w.segments).map(([name, s]) => ({ id: name, name, ...s }))} columns={[
            { key: 'name', label: 'Matches' },
            { key: 'matches', label: 'Count' },
            { key: 'accuracy', label: 'Right result', render: (r) => pct(r.accuracy) },
            { key: 'home_baseline', label: 'Home wins', render: (r) => pct(r.home_baseline) },
            { key: 'skill', label: 'Skill (95% range)', render: (r) => `${pct(r.skill)} (${pct(r.skill_ci95[0])} to ${pct(r.skill_ci95[1])})` },
          ]} />
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="card text-sm">
              <h3 className="font-semibold">Home favourites: said and happened</h3>
              <ul className="mt-2 space-y-1 text-muted">{w.home_favourites.map((b) => <li key={b.from}>{b.matches} matches: said {pct(b.predicted)}, happened {pct(b.observed)}</li>)}</ul>
            </div>
            <div className="card text-sm">
              <h3 className="font-semibold">Draws</h3>
              <p className="mt-2 text-muted">Happened {pct(w.draws.observed_rate)}, predicted {pct(w.draws.mean_predicted)} on average. A draw was the most likely outcome {w.draws.times_top_pick} times.</p>
              <h3 className="mt-3 font-semibold">Calibration fix tested</h3>
              <p className="mt-1 text-muted">Log-loss change {pct(w.calibration_fix.relative_log_loss_gain, 2)}; {w.calibration_fix.interval_above_zero ? 'a small measured gain' : 'no gain'}. Not applied to the live model.</p>
            </div>
          </div>
        </section>
      )}

      {cricket.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-semibold">Cricket models</h2>
          <DataTable rows={cricket.map((c) => ({ id: c.format, ...c }))} columns={[
            { key: 'format', label: 'Format' },
            { key: 'version', label: 'Version' },
            { key: 'dataThrough', label: 'Data up to', render: (c) => fmtDate(c.dataThrough) },
          ]} />
          <p className="mt-2 text-xs text-muted">No upcoming cricket fixtures reach the site yet.</p>
        </section>
      )}
    </>
  );
}
