// Prediction management: create / edit / delete, draft or publish, unpublish,
// probabilities (two- or three-outcome), analysis, confidence and version history.
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Pencil, Trash2, Send, EyeOff, Search, History } from 'lucide-react';
import { Chips, DataTable, EmptyState, Field, Modal, PageHeader, ProbBar, Skeleton, StatusBadge, TeamCrest } from '../../components/ui';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import { deletePrediction, getAdminMatches, getAdminPrediction, getAdminPredictions, publishPrediction, savePrediction, unpublishPrediction } from '../../services/admin';
import { cx, fmtDateTime } from '../../utils/format';

const lines = (t) => t.split('\n').map((s) => s.trim()).filter(Boolean);
const formList = (t) => t.toUpperCase().split(/[\s,]+/).filter((x) => ['W', 'L', 'D'].includes(x)).slice(0, 10);

const EMPTY = {
  matchId: '', outcomeFormat: 'TWO_WAY', teamAProbability: 50, teamBProbability: 50, drawProbability: 0, predictedOutcome: '', confidenceLevel: 'MEDIUM',
  summary: '', strengthsA: '', weaknessesA: '', formA: '', strengthsB: '', weaknessesB: '', formB: '',
  players: [], h2hPlayed: 0, h2hA: 0, h2hB: 0, h2hD: 0, keyFactors: '', pitchAnalysis: '', weatherAnalysis: '', source: 'MANUAL', modelVersion: '',
};

function toForm(p) {
  return {
    id: p.id, matchId: p.matchId, outcomeFormat: p.outcomeFormat, teamAProbability: p.probA, teamBProbability: p.probB, drawProbability: p.probDraw ?? 0,
    predictedOutcome: p.predictedOutcome, confidenceLevel: p.confidenceLevel, summary: p.summary,
    strengthsA: p.teamA.strengths.join('\n'), weaknessesA: p.teamA.weaknesses.join('\n'), formA: p.teamA.form.join(' '),
    strengthsB: p.teamB.strengths.join('\n'), weaknessesB: p.teamB.weaknesses.join('\n'), formB: p.teamB.form.join(' '),
    players: p.players, h2hPlayed: p.h2h.played, h2hA: p.h2h.aWins, h2hB: p.h2h.bWins, h2hD: p.h2h.draws,
    keyFactors: p.insights.join('\n'), pitchAnalysis: p.pitch || '', weatherAnalysis: p.weather || '', source: p.source, modelVersion: p.modelVersion || '', status: p.status,
  };
}

function toBody(f, publish) {
  const three = f.outcomeFormat === 'THREE_WAY';
  return {
    matchId: Number(f.matchId), outcomeFormat: f.outcomeFormat,
    teamAProbability: Number(f.teamAProbability), teamBProbability: Number(f.teamBProbability), drawProbability: three ? Number(f.drawProbability) : null,
    predictedOutcome: f.predictedOutcome || undefined, confidenceLevel: f.confidenceLevel, summary: f.summary,
    teamA: { strengths: lines(f.strengthsA), weaknesses: lines(f.weaknessesA), form: formList(f.formA) },
    teamB: { strengths: lines(f.strengthsB), weaknesses: lines(f.weaknessesB), form: formList(f.formB) },
    players: f.players.filter((p) => p.name.trim()).map((p) => ({ ...p, rating: Number(p.rating) || 0 })),
    headToHead: { played: Number(f.h2hPlayed) || 0, aWins: Number(f.h2hA) || 0, bWins: Number(f.h2hB) || 0, draws: Number(f.h2hD) || 0 },
    keyFactors: lines(f.keyFactors), pitchAnalysis: f.pitchAnalysis || null, weatherAnalysis: f.weatherAnalysis || null,
    source: f.source, modelVersion: f.source === 'MODEL' ? f.modelVersion || null : null, publish,
  };
}

function Versions({ id }) {
  const { data, loading } = useAsync(() => getAdminPrediction(id), [id]);
  if (loading) return <Skeleton className="h-32" />;
  if (!data.versions.length) return <p className="text-sm text-muted">Not published yet — versions are created on each publish.</p>;
  return (
    <ul className="space-y-3">
      {data.versions.map((v) => (
        <li key={v.version} className="rounded-xl border border-white/5 bg-white/[.02] p-3 text-sm">
          <p className="font-medium">Version {v.version} <span className="text-xs text-muted">· {fmtDateTime(v.publishedAt)}{v.publishedBy ? ` · ${v.publishedBy}` : ''}</span></p>
          <p className="mt-1 text-xs text-muted">A {v.snapshot.probA}% · B {v.snapshot.probB}%{v.snapshot.probDraw !== null ? ` · Draw ${v.snapshot.probDraw}%` : ''} · {v.snapshot.predictedOutcome} · {v.snapshot.confidence}</p>
        </li>
      ))}
    </ul>
  );
}

export default function AdminPredictions() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('');
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState(null);
  const [versions, setVersions] = useState(null);
  const { data, loading, error } = useAsync(() => getAdminPredictions({ q, status: tab === 'all' ? undefined : tab }), [q, tab]);
  const { data: matches } = useAsync(() => getAdminMatches(), []);

  const withPrediction = useMemo(() => new Set((matches || []).filter((m) => m.predictionStatus).map((m) => m.id)), [matches]);
  const fm = form && (matches || []).find((m) => m.id === Number(form.matchId));

  useEffect(() => {
    if (params.get('new') && matches) { setErrors({}); setForm(EMPTY); setParams({}, { replace: true }); }
  }, [params, matches, setParams]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  function pickMatch(e) {
    const m = (matches || []).find((x) => x.id === Number(e.target.value));
    setForm((f) => ({ ...f, matchId: e.target.value, outcomeFormat: m?.outcomeFormat || 'TWO_WAY' }));
  }

  async function submit(publish) {
    setBusy(true);
    setErrors({});
    try {
      await savePrediction(form.id, toBody(form, publish));
      toast.success(publish ? 'Prediction published.' : form.id && form.status === 'PUBLISHED' ? 'Prediction updated (new version published).' : 'Prediction saved as draft.');
      setForm(null);
    } catch (err) {
      setErrors({ form: err.message, ...err.fields });
    } finally {
      setBusy(false);
    }
  }

  async function act(fn, msg) {
    try { await fn(); toast.success(msg); } catch (e) { toast.error(e.message); }
  }

  const total = Number(form?.teamAProbability || 0) + Number(form?.teamBProbability || 0) + (form?.outcomeFormat === 'THREE_WAY' ? Number(form?.drawProbability || 0) : 0);

  if (error) return <EmptyState title="Couldn’t load predictions" text={error.message} />;
  return (
    <>
      <PageHeader title="Predictions" subtitle="Enter probabilities and analysis, save drafts, publish versions." actions={<button className="btn-primary" onClick={() => { setErrors({}); setForm(EMPTY); }}><Plus className="h-4 w-4" /> Add Prediction</button>} />
      <div className="glass mb-5 flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
        <Chips options={[{ value: 'all', label: 'All' }, { value: 'published', label: 'Published' }, { value: 'draft', label: 'Drafts & unpublished' }]} value={tab} onChange={setTab} />
        <label className="relative md:w-72"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" /><input className="input pl-9" placeholder="Search by team…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search predictions" /></label>
      </div>

      <DataTable loading={loading} rows={data || []} empty="No predictions found." columns={[
        { key: 'match', label: 'Match', render: (p) => (
          <div className="flex items-center gap-3 text-left"><div className="flex -space-x-2"><TeamCrest team={p.match.teamA} size="sm" /><TeamCrest team={p.match.teamB} size="sm" /></div><div><p className="font-medium">{p.match.teamA.name} vs {p.match.teamB.name}</p><p className="text-xs text-muted">{fmtDateTime(p.match.date)}</p></div></div>
        ) },
        { key: 'prob', label: 'Probabilities', render: (p) => <div className="w-48"><div className="mb-1 flex justify-between text-xs"><span>{p.match.teamA.short} {p.probA}%</span>{p.probDraw !== null && <span>D {p.probDraw}%</span>}<span>{p.match.teamB.short} {p.probB}%</span></div><ProbBar value={p.probA} color={p.match.teamA.color} /></div> },
        { key: 'confidence', label: 'Confidence', render: (p) => <span className={{ High: 'badge-green', Medium: 'badge-orange', Low: 'badge-red' }[p.confidence]}>{p.confidence}</span> },
        { key: 'version', label: 'Version', render: (p) => <button className="text-xs text-blue hover:underline" onClick={() => setVersions(p)}>v{p.version} · {p.versions} saved</button> },
        { key: 'status', label: 'Status', render: (p) => <StatusBadge status={p.status} /> },
        { key: 'actions', label: 'Actions', render: (p) => (
          <div className="flex justify-end gap-1.5">
            <button className={cx('btn-sm', p.status === 'PUBLISHED' ? 'btn-ghost' : 'btn-success')} onClick={() => act(() => (p.status === 'PUBLISHED' ? unpublishPrediction(p.id) : publishPrediction(p.id)), p.status === 'PUBLISHED' ? 'Prediction unpublished.' : 'Prediction published to users.')}>
              {p.status === 'PUBLISHED' ? <><EyeOff className="h-3.5 w-3.5" /> Unpublish</> : <><Send className="h-3.5 w-3.5" /> Publish</>}
            </button>
            <button className="btn-ghost btn-sm" onClick={() => setVersions(p)} aria-label="Version history"><History className="h-3.5 w-3.5" /></button>
            <button className="btn-ghost btn-sm" onClick={() => { setErrors({}); setForm(toForm(p)); }} aria-label="Edit prediction"><Pencil className="h-3.5 w-3.5" /></button>
            <button className="btn-ghost btn-sm text-red" onClick={() => setDel(p)} aria-label="Delete prediction"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        ) },
      ]} />

      <Modal open={!!form} onClose={() => !busy && setForm(null)} title={form?.id ? 'Edit Prediction' : 'Add Prediction'} size="xl">
        {form && (
          <form onSubmit={(e) => { e.preventDefault(); submit(false); }} noValidate className="space-y-5">
            {errors.form && <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red">{errors.form}</p>}
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Match" error={errors.matchId} className="sm:col-span-2">
                <select className={cx('input', errors.matchId && 'input-error')} value={form.matchId} onChange={pickMatch} disabled={!!form.id}>
                  <option value="">Select a match…</option>
                  {(matches || []).filter((m) => form.id || !withPrediction.has(m.id)).map((m) => <option key={m.id} value={m.id}>{m.teamA.name} vs {m.teamB.name} — {fmtDateTime(m.date)}{m.published ? '' : ' (draft match)'}</option>)}
                </select>
              </Field>
              <Field label="Outcome format">
                <select className="input" value={form.outcomeFormat} onChange={set('outcomeFormat')}>
                  <option value="TWO_WAY">Two outcomes (A / B)</option>
                  <option value="THREE_WAY">Three outcomes (A / Draw / B)</option>
                </select>
              </Field>
            </div>

            <div className="rounded-xl border border-white/5 bg-ink-2 p-4">
              <div className={cx('grid gap-3', form.outcomeFormat === 'THREE_WAY' ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
                <Field label={`${fm?.teamA.name || 'Team A'} %`} error={errors.teamAProbability}><input type="number" min="0" max="100" step="0.01" className="input" value={form.teamAProbability} onChange={set('teamAProbability')} /></Field>
                {form.outcomeFormat === 'THREE_WAY' && <Field label="Draw %" error={errors.drawProbability}><input type="number" min="0" max="100" step="0.01" className="input" value={form.drawProbability} onChange={set('drawProbability')} /></Field>}
                <Field label={`${fm?.teamB.name || 'Team B'} %`} error={errors.teamBProbability}><input type="number" min="0" max="100" step="0.01" className="input" value={form.teamBProbability} onChange={set('teamBProbability')} /></Field>
              </div>
              <p className={cx('mt-2 text-xs', Math.abs(total - 100) < 0.001 ? 'text-green' : 'text-orange')}>Total: {Number(total.toFixed(2))}% {Math.abs(total - 100) < 0.001 ? '✓' : '(must equal 100%)'}</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <Field label="Predicted outcome" error={errors.predictedOutcome}>
                  <select className="input" value={form.predictedOutcome} onChange={set('predictedOutcome')}>
                    <option value="">Most likely (automatic)</option>
                    <option value="TEAM_A">{fm?.teamA.name || 'Team A'}</option>
                    <option value="TEAM_B">{fm?.teamB.name || 'Team B'}</option>
                    {form.outcomeFormat === 'THREE_WAY' && <option value="DRAW">Draw</option>}
                  </select>
                </Field>
                <Field label="Confidence level"><select className="input" value={form.confidenceLevel} onChange={set('confidenceLevel')}><option value="HIGH">High</option><option value="MEDIUM">Medium</option><option value="LOW">Low</option></select></Field>
                <Field label="Source">
                  <select className="input" value={form.source} onChange={set('source')}><option value="MANUAL">Manual (analyst)</option><option value="MODEL">Prediction model</option></select>
                </Field>
              </div>
              {form.source === 'MODEL' && <Field label="Model version" className="mt-3"><input className="input" value={form.modelVersion} onChange={set('modelVersion')} placeholder="e.g. cricket-gbm-v3" /></Field>}
            </div>

            <Field label="Match analysis" error={errors.summary}><textarea rows={4} className={cx('input', errors.summary && 'input-error')} value={form.summary} onChange={set('summary')} placeholder="Explain the reasoning behind this prediction…" /></Field>

            <div className="grid gap-4 md:grid-cols-2">
              {['A', 'B'].map((t) => (
                <fieldset key={t} className="space-y-3 rounded-xl border border-white/5 p-4">
                  <legend className="px-1 text-sm font-semibold">{(t === 'A' ? fm?.teamA.name : fm?.teamB.name) || `Team ${t}`}</legend>
                  <Field label="Strengths (one per line)"><textarea rows={3} className="input" value={form[`strengths${t}`]} onChange={set(`strengths${t}`)} /></Field>
                  <Field label="Watch-outs (one per line)"><textarea rows={2} className="input" value={form[`weaknesses${t}`]} onChange={set(`weaknesses${t}`)} /></Field>
                  <Field label="Recent form (W / L / D, newest last)"><input className="input" value={form[`form${t}`]} onChange={set(`form${t}`)} placeholder="W W L W D" /></Field>
                </fieldset>
              ))}
            </div>

            <fieldset className="rounded-xl border border-white/5 p-4">
              <legend className="px-1 text-sm font-semibold">Player analysis</legend>
              <div className="space-y-2">
                {form.players.map((p, i) => (
                  <div key={i} className="grid grid-cols-[1fr_80px_1fr_80px_auto] gap-2">
                    <input className="input" placeholder="Player name" value={p.name} onChange={(e) => setForm((f) => ({ ...f, players: f.players.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) }))} />
                    <select className="input" value={p.team} onChange={(e) => setForm((f) => ({ ...f, players: f.players.map((x, j) => (j === i ? { ...x, team: e.target.value } : x)) }))}><option value="A">A</option><option value="B">B</option></select>
                    <input className="input" placeholder="Key stat" value={p.stat} onChange={(e) => setForm((f) => ({ ...f, players: f.players.map((x, j) => (j === i ? { ...x, stat: e.target.value } : x)) }))} />
                    <input className="input" type="number" min="0" max="100" placeholder="0–100" value={p.rating} onChange={(e) => setForm((f) => ({ ...f, players: f.players.map((x, j) => (j === i ? { ...x, rating: e.target.value } : x)) }))} />
                    <button type="button" className="btn-ghost btn-sm" onClick={() => setForm((f) => ({ ...f, players: f.players.filter((_, j) => j !== i) }))} aria-label="Remove player"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                ))}
              </div>
              <button type="button" className="btn-ghost btn-sm mt-3" onClick={() => setForm((f) => ({ ...f, players: [...f.players, { name: '', team: 'A', stat: '', rating: 75 }] }))}><Plus className="h-3.5 w-3.5" /> Add player</button>
            </fieldset>

            <div className="grid gap-4 md:grid-cols-2">
              <fieldset className="rounded-xl border border-white/5 p-4">
                <legend className="px-1 text-sm font-semibold">Head-to-head</legend>
                <div className="grid grid-cols-4 gap-2">
                  {[['h2hPlayed', 'Played'], ['h2hA', 'A wins'], ['h2hB', 'B wins'], ['h2hD', 'Draws']].map(([k, l]) => <Field key={k} label={l}><input type="number" min="0" className="input" value={form[k]} onChange={set(k)} /></Field>)}
                </div>
                {errors.headToHead && <p className="field-error">{errors.headToHead}</p>}
              </fieldset>
              <Field label="Key factors / insights (one per line)"><textarea rows={4} className="input" value={form.keyFactors} onChange={set('keyFactors')} /></Field>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Pitch / conditions analysis"><textarea rows={2} className="input" value={form.pitchAnalysis} onChange={set('pitchAnalysis')} /></Field>
              <Field label="Weather"><textarea rows={2} className="input" value={form.weatherAnalysis} onChange={set('weatherAnalysis')} /></Field>
            </div>
            <p className="text-xs text-muted">Enter only information you have verified — don’t invent statistics.</p>

            <div className="flex flex-wrap justify-end gap-2 border-t border-white/5 pt-4">
              <button type="button" className="btn-ghost" onClick={() => setForm(null)}>Cancel</button>
              {form.status !== 'PUBLISHED' && <button className="btn-ghost" disabled={busy}>{busy ? <span className="spinner" /> : 'Save as draft'}</button>}
              <button type="button" className="btn-primary" disabled={busy} onClick={() => submit(true)}>{busy ? <span className="spinner" /> : form.status === 'PUBLISHED' ? 'Save & publish new version' : 'Publish'}</button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!versions} onClose={() => setVersions(null)} title={versions ? `Version history — ${versions.match.teamA.name} vs ${versions.match.teamB.name}` : ''} size="md">
        {versions && <Versions id={versions.id} />}
      </Modal>

      <Modal open={!!del} onClose={() => setDel(null)} title="Delete prediction?" size="sm"
        footer={<><button className="btn-ghost" onClick={() => setDel(null)}>Cancel</button><button className="btn-danger" onClick={async () => { await act(() => deletePrediction(del.id), 'Prediction deleted.'); setDel(null); }}>Delete</button></>}>
        <p className="text-sm text-muted">Users will see “Prediction coming soon” for <b className="text-white">{del?.match.teamA.name} vs {del?.match.teamB.name}</b>. Predictions that customers have unlocked can’t be deleted — unpublish them instead.</p>
      </Modal>
    </>
  );
}
