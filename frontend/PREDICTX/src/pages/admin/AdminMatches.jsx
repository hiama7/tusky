// Match management: add / edit / delete (or archive) / publish / set price /
// update status / record results. Teams and tournaments can be picked from the
// catalogue or typed (the server creates them inside the chosen sport).
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Pencil, Trash2, Search, Send, EyeOff, Flag } from 'lucide-react';
import { Chips, DataTable, EmptyState, Field, Modal, PageHeader, StatusBadge, TeamCrest } from '../../components/ui';
import ImageUpload from '../../components/ui/ImageUpload';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import { deleteMatch, getAdminMatches, getCatalogue, patchMatch, saveMatch, setMatchResult } from '../../services/admin';
import { cx, fmtDateTime, inr } from '../../utils/format';

const STATUSES = ['UPCOMING', 'LIVE', 'COMPLETED', 'CANCELLED', 'POSTPONED'];
const pad = (n) => String(n).padStart(2, '0');
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

const EMPTY = { sportId: '', tournamentName: '', teamAName: '', teamBName: '', date: '', time: '19:30', venue: '', conditions: '', predictionPrice: 49, status: 'UPCOMING', published: false, featured: false };

function toForm(m) {
  const d = new Date(m.date);
  return {
    id: m.id, sportId: m.sportId, tournamentName: m.tournament, teamAName: m.teamA.name, teamBName: m.teamB.name,
    date: localDate(d), time: localTime(d), venue: m.venue, conditions: m.conditions || '', predictionPrice: m.price,
    status: m.status, published: m.published, featured: m.featured, image: m.image,
  };
}

export default function AdminMatches() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [view, setView] = useState('all');
  const [form, setForm] = useState(null);
  const [image, setImage] = useState({ file: null, remove: false });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState(null);
  const [priceEdit, setPriceEdit] = useState(null);
  const [result, setResult] = useState(null);
  const { data, loading, error } = useAsync(() => getAdminMatches({ q, status: view === 'all' ? undefined : view }), [q, view]);
  const { data: catalogue } = useAsync(() => getCatalogue(), []);

  const sports = catalogue?.sports || [];
  const teamsFor = useMemo(() => (catalogue?.teams || []).filter((t) => t.sportId === Number(form?.sportId)), [catalogue, form?.sportId]);
  const toursFor = useMemo(() => (catalogue?.tournaments || []).filter((t) => t.sportId === Number(form?.sportId)), [catalogue, form?.sportId]);

  useEffect(() => {
    if (params.get('new') && sports.length) { openNew(); setParams({}, { replace: true }); }
  }, [params, sports.length]); // eslint-disable-line react-hooks/exhaustive-deps

  function openNew() {
    setErrors({});
    setImage({ file: null, remove: false });
    setForm({ ...EMPTY, sportId: sports[0]?.dbId || '' });
  }

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  async function submit(e) {
    e.preventDefault();
    const errs = {};
    if (!form.date) errs.startsAt = 'Pick a date';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    const startsAt = new Date(`${form.date}T${form.time || '00:00'}`);
    const fields = {
      sportId: form.sportId, tournamentName: form.tournamentName, teamAName: form.teamAName, teamBName: form.teamBName,
      startsAt: startsAt.toISOString(), venue: form.venue, conditions: form.conditions || undefined, predictionPrice: form.predictionPrice,
      status: form.status, published: form.published, featured: form.featured, removeImage: image.remove || undefined,
    };
    try {
      await saveMatch(form.id, fields, image.file);
      toast.success(form.id ? 'Match updated.' : form.published ? 'Match created and published.' : 'Match saved as a draft.');
      setForm(null);
    } catch (err) {
      setErrors({ form: err.message, ...err.fields });
    } finally {
      setBusy(false);
    }
  }

  async function quick(m, body, msg) {
    try {
      await patchMatch(m.id, body);
      toast.success(msg);
    } catch (e) {
      toast.error(e.message);
    }
  }

  async function savePrice() {
    try {
      await patchMatch(priceEdit.match.id, { predictionPrice: Number(priceEdit.price) });
      toast.success(`Prediction price set to ${inr(priceEdit.price)}.`);
      setPriceEdit(null);
    } catch (e) {
      toast.error(e.fields.predictionPrice || e.message);
    }
  }

  async function saveResult() {
    try {
      await setMatchResult(result.match.id, { outcome: result.outcome, scoreSummary: result.score || null, resultDescription: result.description });
      toast.success('Result saved and match marked completed.');
      setResult(null);
    } catch (e) {
      toast.error(Object.values(e.fields)[0] || e.message);
    }
  }

  async function confirmDelete() {
    try {
      const r = await deleteMatch(del.id);
      toast.success(r.archived ? 'Match has purchases, so it was archived and unpublished.' : 'Match deleted.');
      setDel(null);
    } catch (e) {
      toast.error(e.message);
    }
  }

  if (error) return <EmptyState title="Couldn’t load matches" text={error.message} />;
  return (
    <>
      <PageHeader title="Matches" subtitle="Create fixtures, set prediction prices, publish and record results." actions={<button className="btn-primary" onClick={openNew} disabled={!sports.length}><Plus className="h-4 w-4" /> Add Match</button>} />
      <div className="glass mb-5 flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
        <Chips options={[{ value: 'all', label: 'All' }, { value: 'published', label: 'Published' }, { value: 'draft', label: 'Drafts' }, { value: 'archived', label: 'Archived' }]} value={view} onChange={setView} />
        <label className="relative md:w-72"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" /><input className="input pl-9" placeholder="Search matches…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search matches" /></label>
      </div>

      <DataTable loading={loading} rows={data || []} empty="No matches here yet." columns={[
        { key: 'match', label: 'Match', render: (m) => (
          <div className="flex items-center gap-3 text-left">
            {m.image ? <img src={m.image} alt="" className="h-9 w-12 rounded-lg object-cover" /> : <div className="flex -space-x-2"><TeamCrest team={m.teamA} size="sm" /><TeamCrest team={m.teamB} size="sm" /></div>}
            <div><p className="font-medium">{m.teamA.name} vs {m.teamB.name}</p><p className="text-xs text-muted">{m.tournament}{m.isDemo ? ' · sample' : ''}</p></div>
          </div>
        ) },
        { key: 'sport', label: 'Sport', render: (m) => <span style={{ color: m.sportColor }}>{m.sportName}</span> },
        { key: 'date', label: 'Date & time', render: (m) => <span className="text-muted">{fmtDateTime(m.date)}</span> },
        { key: 'price', label: 'Price', render: (m) => <button className="font-semibold underline decoration-dotted underline-offset-4 hover:text-brand" onClick={() => setPriceEdit({ match: m, price: m.price })} title="Set price">{inr(m.price)}</button> },
        { key: 'status', label: 'Status', render: (m) => (
          <select className="input !w-32 !py-1 text-xs" value={m.status} onChange={(e) => quick(m, { status: e.target.value }, `Status set to ${e.target.value}.`)} aria-label="Match status">
            {STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
        ) },
        { key: 'published', label: 'Visibility', render: (m) => <StatusBadge status={m.archived ? 'Archived' : m.published ? 'Published' : 'Draft'} /> },
        { key: 'prediction', label: 'Prediction', render: (m) => (m.predictionStatus ? <StatusBadge status={m.predictionStatus} /> : <span className="text-xs text-muted">none</span>) },
        { key: 'actions', label: 'Actions', render: (m) => (
          <div className="flex justify-end gap-1.5">
            {!m.archived && <button className={cx('btn-sm', m.published ? 'btn-ghost' : 'btn-success')} onClick={() => quick(m, { published: !m.published }, m.published ? 'Match unpublished.' : 'Match is now visible to users.')}>{m.published ? <><EyeOff className="h-3.5 w-3.5" /> Unpublish</> : <><Send className="h-3.5 w-3.5" /> Publish</>}</button>}
            <button className="btn-ghost btn-sm" onClick={() => setResult({ match: m, outcome: 'TEAM_A', score: '', description: '' })} aria-label="Record result" title="Record result"><Flag className="h-3.5 w-3.5" /></button>
            <button className="btn-ghost btn-sm" onClick={() => { setErrors({}); setImage({ file: null, remove: false }); setForm(toForm(m)); }} aria-label="Edit match"><Pencil className="h-3.5 w-3.5" /></button>
            {!m.archived && <button className="btn-ghost btn-sm text-red" onClick={() => setDel(m)} aria-label="Delete match"><Trash2 className="h-3.5 w-3.5" /></button>}
          </div>
        ) },
      ]} />

      <Modal open={!!form} onClose={() => !busy && setForm(null)} title={form?.id ? 'Edit Match' : 'Add Match'} size="lg">
        {form && (
          <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
            {errors.form && <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red sm:col-span-2">{errors.form}</p>}
            <Field label="Sport" error={errors.sportId}><select className="input" value={form.sportId} onChange={set('sportId')}>{sports.map((s) => <option key={s.dbId} value={s.dbId}>{s.name}</option>)}</select></Field>
            <Field label="Tournament" error={errors.tournamentName} hint="Pick an existing one or type a new name">
              <input className={cx('input', errors.tournamentName && 'input-error')} list="tour-options" value={form.tournamentName} onChange={set('tournamentName')} placeholder="e.g. T20 World Series" />
              <datalist id="tour-options">{toursFor.map((t) => <option key={t.id} value={t.name} />)}</datalist>
            </Field>
            <Field label="Team A" error={errors.teamAName}>
              <input className={cx('input', errors.teamAName && 'input-error')} list="team-options" value={form.teamAName} onChange={set('teamAName')} placeholder="Home team" />
            </Field>
            <Field label="Team B" error={errors.teamBName}>
              <input className={cx('input', errors.teamBName && 'input-error')} list="team-options" value={form.teamBName} onChange={set('teamBName')} placeholder="Away team" />
              <datalist id="team-options">{teamsFor.map((t) => <option key={t.id} value={t.name} />)}</datalist>
            </Field>
            <Field label="Date" error={errors.startsAt}><input type="date" className={cx('input', errors.startsAt && 'input-error')} value={form.date} onChange={set('date')} /></Field>
            <Field label="Time (your local time)"><input type="time" className="input" value={form.time} onChange={set('time')} /></Field>
            <Field label="Venue" error={errors.venue} className="sm:col-span-2"><input className={cx('input', errors.venue && 'input-error')} value={form.venue} onChange={set('venue')} placeholder="Stadium, City" /></Field>
            <Field label="Pitch / playing conditions (optional)" error={errors.conditions} className="sm:col-span-2"><input className="input" value={form.conditions} onChange={set('conditions')} placeholder="e.g. Dry surface, dew expected late" /></Field>
            <Field label="Prediction Price (₹)" error={errors.predictionPrice}><input type="number" min="1" step="0.01" className={cx('input', errors.predictionPrice && 'input-error')} value={form.predictionPrice} onChange={set('predictionPrice')} /></Field>
            <Field label="Match status"><select className="input" value={form.status} onChange={set('status')}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select></Field>
            <Field label="Match image (optional)" className="sm:col-span-2"><ImageUpload current={form.image} onChange={setImage} onError={toast.error} /></Field>
            <div className="flex flex-wrap gap-5 text-sm text-muted sm:col-span-2">
              <label className="flex items-center gap-2"><input type="checkbox" className="accent-brand" checked={form.published} onChange={set('published')} /> Published (visible to users)</label>
              <label className="flex items-center gap-2"><input type="checkbox" className="accent-brand" checked={form.featured} onChange={set('featured')} /> Feature on homepage</label>
            </div>
            <div className="flex justify-end gap-2 border-t border-white/5 pt-4 sm:col-span-2">
              <button type="button" className="btn-ghost" onClick={() => setForm(null)}>Cancel</button>
              <button className="btn-primary" disabled={busy}>{busy ? <span className="spinner" /> : form.id ? 'Save changes' : 'Create match'}</button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!priceEdit} onClose={() => setPriceEdit(null)} title="Set prediction price" size="sm"
        footer={<><button className="btn-ghost" onClick={() => setPriceEdit(null)}>Cancel</button><button className="btn-primary" onClick={savePrice}>Save price</button></>}>
        {priceEdit && <>
          <p className="mb-3 text-sm text-muted">{priceEdit.match.teamA.name} vs {priceEdit.match.teamB.name}. New orders use this price immediately.</p>
          <input type="number" min="1" step="0.01" className="input" value={priceEdit.price} onChange={(e) => setPriceEdit({ ...priceEdit, price: e.target.value })} aria-label="Price in rupees" />
        </>}
      </Modal>

      <Modal open={!!result} onClose={() => setResult(null)} title="Record match result" size="sm"
        footer={<><button className="btn-ghost" onClick={() => setResult(null)}>Cancel</button><button className="btn-primary" onClick={saveResult}>Save result</button></>}>
        {result && (
          <div className="space-y-4">
            <Field label="Outcome">
              <select className="input" value={result.outcome} onChange={(e) => setResult({ ...result, outcome: e.target.value })}>
                <option value="TEAM_A">{result.match.teamA.name} won</option>
                <option value="TEAM_B">{result.match.teamB.name} won</option>
                <option value="DRAW">Draw / tie / no result</option>
              </select>
            </Field>
            <Field label="Score (optional)"><input className="input" value={result.score} onChange={(e) => setResult({ ...result, score: e.target.value })} placeholder="e.g. 182/6 – 175/9" /></Field>
            <Field label="Result description"><input className="input" value={result.description} onChange={(e) => setResult({ ...result, description: e.target.value })} placeholder="e.g. India won by 7 runs" /></Field>
            <p className="text-xs text-muted">Only enter verified results — they are used to measure prediction accuracy.</p>
          </div>
        )}
      </Modal>

      <Modal open={!!del} onClose={() => setDel(null)} title="Delete match?" size="sm"
        footer={<><button className="btn-ghost" onClick={() => setDel(null)}>Cancel</button><button className="btn-danger" onClick={confirmDelete}>Delete</button></>}>
        <p className="text-sm text-muted">Delete <b className="text-white">{del?.teamA.name} vs {del?.teamB.name}</b> and its prediction? If customers have bought it, it will be archived instead so their records stay intact.</p>
      </Modal>
    </>
  );
}
