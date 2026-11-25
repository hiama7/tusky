// Prediction management: add / edit / delete / publish, probabilities,
// analysis, insights and confidence level.
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Pencil, Trash2, Send, EyeOff, Search } from 'lucide-react';
import { Chips, DataTable, Field, Modal, PageHeader, ProbBar, StatusBadge, TeamCrest } from '../../components/ui';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import { deletePrediction, getMatches, getPredictions, savePrediction, setPredictionStatus } from '../../services/matches';
import { cx, fmtDateTime } from '../../utils/format';

const EMPTY = { matchId: '', probA: 50, confidence: 'Medium', summary: '', insights: '', strengthsA: '', strengthsB: '', status: 'draft' };
const lines = (t) => t.split('\n').map((s) => s.trim()).filter(Boolean);

export default function AdminPredictions() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('');
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState(null);
  const { data, loading } = useAsync(async () => {
    const [matches, preds] = await Promise.all([getMatches({ includeDrafts: true }), getPredictions()]);
    return { matches, preds };
  }, []);

  useEffect(() => {
    if (params.get('new')) { setForm(EMPTY); setParams({}, { replace: true }); }
  }, [params, setParams]);

  const matches = data?.matches || [];
  const byId = useMemo(() => Object.fromEntries(matches.map((m) => [m.id, m])), [matches]);
  const rows = (data?.preds || [])
    .map((p) => ({ ...p, match: byId[p.matchId] }))
    .filter((p) => p.match)
    .filter((p) => tab === 'all' || p.status === tab)
    .filter((p) => !q || `${p.match.teamA.name} ${p.match.teamB.name}`.toLowerCase().includes(q.toLowerCase()));
  const withoutPrediction = matches.filter((m) => !(data?.preds || []).some((p) => p.matchId === m.id));

  function edit(p) {
    setErrors({});
    setForm({ id: p.id, matchId: p.matchId, probA: p.probA, confidence: p.confidence, summary: p.summary || '', insights: (p.insights || []).join('\n'), strengthsA: (p.teamA?.strengths || []).join('\n'), strengthsB: (p.teamB?.strengths || []).join('\n'), status: p.status });
  }

  async function submit(e) {
    e.preventDefault();
    const errs = {};
    if (!form.matchId) errs.matchId = 'Select a match';
    if (form.summary.trim().length < 20) errs.summary = 'Write at least 20 characters of analysis';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    const existing = (data?.preds || []).find((p) => p.id === form.id);
    try {
      await savePrediction({
        id: form.id, matchId: form.matchId, probA: Number(form.probA), confidence: form.confidence, summary: form.summary.trim(),
        insights: lines(form.insights), status: form.status,
        teamA: { ...(existing?.teamA || { form: [], weaknesses: [] }), strengths: lines(form.strengthsA) },
        teamB: { ...(existing?.teamB || { form: [], weaknesses: [] }), strengths: lines(form.strengthsB) },
      });
      toast.success(form.id ? 'Prediction updated.' : 'Prediction created.');
      setForm(null);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  const fm = form && byId[form.matchId];
  return (
    <>
      <PageHeader title="Predictions" subtitle="Set probabilities, write analysis and publish predictions." actions={<button className="btn-primary" onClick={() => { setErrors({}); setForm(EMPTY); }}><Plus className="h-4 w-4" /> Add Prediction</button>} />
      <div className="glass mb-5 flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
        <Chips options={[{ value: 'all', label: 'All' }, { value: 'published', label: 'Published' }, { value: 'draft', label: 'Drafts' }]} value={tab} onChange={setTab} />
        <label className="relative md:w-72"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" /><input className="input pl-9" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search predictions" /></label>
      </div>

      <DataTable loading={loading} rows={rows} empty="No predictions found." columns={[
        { key: 'match', label: 'Match', render: (p) => (
          <div className="flex items-center gap-3 text-left"><div className="flex -space-x-2"><TeamCrest team={p.match.teamA} size="sm" /><TeamCrest team={p.match.teamB} size="sm" /></div><div><p className="font-medium">{p.match.teamA.name} vs {p.match.teamB.name}</p><p className="text-xs text-muted">{fmtDateTime(p.match.date)}</p></div></div>
        ) },
        { key: 'prob', label: 'Team A / Team B', render: (p) => <div className="w-44"><div className="mb-1 flex justify-between text-xs"><span>{p.match.teamA.short} {p.probA}%</span><span>{p.match.teamB.short} {p.probB}%</span></div><ProbBar value={p.probA} color={p.match.teamA.color} /></div> },
        { key: 'confidence', label: 'Confidence', render: (p) => <span className={{ High: 'badge-green', Medium: 'badge-orange', Low: 'badge-red' }[p.confidence] || 'badge-muted'}>{p.confidence}</span> },
        { key: 'status', label: 'Status', render: (p) => <StatusBadge status={p.status} /> },
        { key: 'actions', label: 'Actions', render: (p) => (
          <div className="flex justify-end gap-1.5">
            <button className={cx('btn-sm', p.status === 'published' ? 'btn-ghost' : 'btn-success')} onClick={async () => { await setPredictionStatus(p.id, p.status === 'published' ? 'draft' : 'published'); toast.success(p.status === 'published' ? 'Prediction unpublished.' : 'Prediction published to users.'); }}>
              {p.status === 'published' ? <><EyeOff className="h-3.5 w-3.5" /> Unpublish</> : <><Send className="h-3.5 w-3.5" /> Publish</>}
            </button>
            <button className="btn-ghost btn-sm" onClick={() => edit(p)} aria-label="Edit prediction"><Pencil className="h-3.5 w-3.5" /></button>
            <button className="btn-ghost btn-sm text-red" onClick={() => setDel(p)} aria-label="Delete prediction"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        ) },
      ]} />

      <Modal open={!!form} onClose={() => !busy && setForm(null)} title={form?.id ? 'Edit Prediction' : 'Add Prediction'} size="lg">
        {form && (
          <form onSubmit={submit} noValidate className="space-y-4">
            <Field label="Match" error={errors.matchId}>
              <select className={cx('input', errors.matchId && 'input-error')} value={form.matchId} onChange={(e) => setForm({ ...form, matchId: e.target.value })} disabled={!!form.id}>
                <option value="">Select a match…</option>
                {(form.id ? matches : withoutPrediction).map((m) => <option key={m.id} value={m.id}>{m.teamA.name} vs {m.teamB.name} — {fmtDateTime(m.date)}{m.status === 'draft' ? ' (draft match)' : ''}</option>)}
              </select>
            </Field>
            <div className="rounded-xl border border-white/5 bg-ink-2 p-4">
              <div className="mb-3 flex justify-between text-sm"><span>{fm?.teamA.name || 'Team A'} probability: <b>{form.probA}%</b></span><span>{fm?.teamB.name || 'Team B'}: <b>{100 - form.probA}%</b></span></div>
              <input type="range" min="1" max="99" value={form.probA} onChange={(e) => setForm({ ...form, probA: Number(e.target.value) })} className="w-full accent-blue" aria-label="Team A probability" />
              <div className="mt-3 grid grid-cols-2 gap-3">
                <Field label="Team A %"><input type="number" min="1" max="99" className="input" value={form.probA} onChange={(e) => setForm({ ...form, probA: Math.min(99, Math.max(1, Number(e.target.value) || 1)) })} /></Field>
                <Field label="Team B % (auto)"><input className="input opacity-70" value={100 - form.probA} readOnly /></Field>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Confidence level"><select className="input" value={form.confidence} onChange={(e) => setForm({ ...form, confidence: e.target.value })}><option>High</option><option>Medium</option><option>Low</option></select></Field>
              <Field label="Status"><select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="draft">Draft</option><option value="published">Published</option></select></Field>
            </div>
            <Field label="Match analysis" error={errors.summary}><textarea rows={4} className={cx('input', errors.summary && 'input-error')} value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} placeholder="Explain the reasoning behind this prediction…" /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Team A strengths (one per line)"><textarea rows={3} className="input" value={form.strengthsA} onChange={(e) => setForm({ ...form, strengthsA: e.target.value })} /></Field>
              <Field label="Team B strengths (one per line)"><textarea rows={3} className="input" value={form.strengthsB} onChange={(e) => setForm({ ...form, strengthsB: e.target.value })} /></Field>
            </div>
            <Field label="Key insights (one per line)"><textarea rows={3} className="input" value={form.insights} onChange={(e) => setForm({ ...form, insights: e.target.value })} /></Field>
            <div className="flex justify-end gap-2 border-t border-white/5 pt-4">
              <button type="button" className="btn-ghost" onClick={() => setForm(null)}>Cancel</button>
              <button className="btn-primary" disabled={busy}>{busy ? <span className="spinner" /> : form.id ? 'Save changes' : 'Create prediction'}</button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!del} onClose={() => setDel(null)} title="Delete prediction?" size="sm"
        footer={<><button className="btn-ghost" onClick={() => setDel(null)}>Cancel</button><button className="btn-danger" onClick={async () => { await deletePrediction(del.id); toast.success('Prediction deleted.'); setDel(null); }}>Delete</button></>}>
        <p className="text-sm text-muted">Users will see “Prediction coming soon” for <b className="text-white">{del?.match?.teamA.name} vs {del?.match?.teamB.name}</b>.</p>
      </Modal>
    </>
  );
}
