// Match management: add / edit / delete / publish / set price.
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Pencil, Trash2, Search, Send, EyeOff } from 'lucide-react';
import { Chips, DataTable, Field, Modal, PageHeader, StatusBadge, TeamCrest } from '../../components/ui';
import ImageUpload from '../../components/ui/ImageUpload';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import { deleteMatch, getMatches, saveMatch, setMatchStatus } from '../../services/matches';
import { SPORTS, sportById } from '../../data/demo/sports';
import { cx, fmtDateTime, inr } from '../../utils/format';

const PALETTE = ['#386BFF', '#8657FF', '#20D9A0', '#FFB547', '#FF5263', '#38BDF8', '#E879F9', '#F5B800'];
const shortCode = (name) => name.replace(/[^A-Za-z ]/g, '').split(' ').filter(Boolean).map((w) => w.slice(0, w.length > 4 ? 3 : 3)).join('').slice(0, 3).toUpperCase() || 'TBD';

const EMPTY = { sport: 'cricket', teamA: '', teamB: '', tournament: '', date: '', time: '19:30', venue: '', image: '', price: 49, status: 'draft' };

function toForm(m) {
  const d = new Date(m.date);
  const pad = (n) => String(n).padStart(2, '0');
  return {
    id: m.id, sport: m.sport, teamA: m.teamA.name, teamB: m.teamB.name, tournament: m.tournament,
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    venue: m.venue, image: m.image || '', price: m.price, status: m.status, _colors: [m.teamA.color, m.teamB.color], featured: m.featured,
  };
}

function validate(f) {
  const e = {};
  if (f.teamA.trim().length < 2) e.teamA = 'Required';
  if (f.teamB.trim().length < 2) e.teamB = 'Required';
  if (f.teamA.trim() && f.teamA.trim().toLowerCase() === f.teamB.trim().toLowerCase()) e.teamB = 'Teams must be different';
  if (!f.tournament.trim()) e.tournament = 'Required';
  if (!f.date) e.date = 'Required';
  if (!f.time) e.time = 'Required';
  if (!f.venue.trim()) e.venue = 'Required';
  if (!(Number(f.price) >= 1 && Number(f.price) <= 9999)) e.price = 'Enter ₹1 – ₹9,999';
  return e;
}

export default function AdminMatches() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState(null);
  const [priceEdit, setPriceEdit] = useState(null);
  const { data, loading } = useAsync(() => getMatches({ includeDrafts: true, q }), [q]);

  useEffect(() => {
    if (params.get('new')) { setForm(EMPTY); setParams({}, { replace: true }); }
  }, [params, setParams]);

  const rows = (data || []).filter((m) => status === 'all' || m.status === status);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    const errs = validate(form);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    const [cA, cB] = form._colors || [PALETTE[Math.floor(Math.random() * 8)], PALETTE[Math.floor(Math.random() * 8)]];
    const match = {
      id: form.id, sport: form.sport, tournament: form.tournament.trim(), venue: form.venue.trim(), image: form.image,
      price: Number(form.price), status: form.status, featured: form.featured,
      date: new Date(`${form.date}T${form.time}`).toISOString(),
      teamA: { name: form.teamA.trim(), short: shortCode(form.teamA), color: cA },
      teamB: { name: form.teamB.trim(), short: shortCode(form.teamB), color: cB === cA ? PALETTE[(PALETTE.indexOf(cA) + 3) % 8] : cB },
    };
    try {
      await saveMatch(match);
      toast.success(form.id ? 'Match updated.' : 'Match created as a draft. Publish it to show it to users.');
      setForm(null);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function togglePublish(m) {
    const next = m.status === 'published' ? 'draft' : 'published';
    await setMatchStatus(m.id, next);
    toast.success(next === 'published' ? `${m.teamA.name} vs ${m.teamB.name} is now live for users.` : 'Match unpublished.');
  }

  async function savePrice() {
    const price = Number(priceEdit.price);
    if (!(price >= 1 && price <= 9999)) return toast.error('Enter a price between ₹1 and ₹9,999.');
    await saveMatch({ ...priceEdit.match, price });
    toast.success(`Prediction price set to ${inr(price)}.`);
    setPriceEdit(null);
  }

  return (
    <>
      <PageHeader title="Matches" subtitle="Create fixtures, set prediction prices and publish them." actions={<button className="btn-primary" onClick={() => { setErrors({}); setForm(EMPTY); }}><Plus className="h-4 w-4" /> Add Match</button>} />
      <div className="glass mb-5 flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
        <Chips options={[{ value: 'all', label: 'All' }, { value: 'published', label: 'Published' }, { value: 'draft', label: 'Drafts' }]} value={status} onChange={setStatus} />
        <label className="relative md:w-72"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" /><input className="input pl-9" placeholder="Search matches…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search matches" /></label>
      </div>

      <DataTable loading={loading} rows={rows} empty="No matches yet — add your first one." columns={[
        { key: 'match', label: 'Match', render: (m) => (
          <div className="flex items-center gap-3 text-left">
            {m.image ? <img src={m.image} alt="" className="h-9 w-12 rounded-lg object-cover" /> : <div className="flex -space-x-2"><TeamCrest team={m.teamA} size="sm" /><TeamCrest team={m.teamB} size="sm" /></div>}
            <div><p className="font-medium">{m.teamA.name} vs {m.teamB.name}</p><p className="text-xs text-muted">{m.tournament}</p></div>
          </div>
        ) },
        { key: 'sport', label: 'Sport', render: (m) => <span style={{ color: sportById(m.sport)?.color }}>{sportById(m.sport)?.name}</span> },
        { key: 'date', label: 'Date & time', render: (m) => <span className="text-muted">{fmtDateTime(m.date)}</span> },
        { key: 'venue', label: 'Venue', render: (m) => <span className="text-muted">{m.venue}</span> },
        { key: 'price', label: 'Price', render: (m) => <button className="font-semibold underline decoration-dotted underline-offset-4 hover:text-blue" onClick={() => setPriceEdit({ match: m, price: m.price })} title="Set price">{inr(m.price)}</button> },
        { key: 'status', label: 'Status', render: (m) => <StatusBadge status={m.status} /> },
        { key: 'actions', label: 'Actions', render: (m) => (
          <div className="flex justify-end gap-1.5">
            <button className={cx('btn-sm', m.status === 'published' ? 'btn-ghost' : 'btn-success')} onClick={() => togglePublish(m)}>{m.status === 'published' ? <><EyeOff className="h-3.5 w-3.5" /> Unpublish</> : <><Send className="h-3.5 w-3.5" /> Publish</>}</button>
            <button className="btn-ghost btn-sm" onClick={() => { setErrors({}); setForm(toForm(m)); }} aria-label="Edit match"><Pencil className="h-3.5 w-3.5" /></button>
            <button className="btn-ghost btn-sm text-red" onClick={() => setDel(m)} aria-label="Delete match"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        ) },
      ]} />

      {/* Add / edit form */}
      <Modal open={!!form} onClose={() => !busy && setForm(null)} title={form?.id ? 'Edit Match' : 'Add Match'} size="lg">
        {form && (
          <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
            <Field label="Sport"><select className="input" value={form.sport} onChange={set('sport')}>{SPORTS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
            <Field label="Tournament" error={errors.tournament}><input className={cx('input', errors.tournament && 'input-error')} value={form.tournament} onChange={set('tournament')} placeholder="e.g. T20 World Series" /></Field>
            <Field label="Team A" error={errors.teamA}><input className={cx('input', errors.teamA && 'input-error')} value={form.teamA} onChange={set('teamA')} placeholder="Home team" /></Field>
            <Field label="Team B" error={errors.teamB}><input className={cx('input', errors.teamB && 'input-error')} value={form.teamB} onChange={set('teamB')} placeholder="Away team" /></Field>
            <Field label="Date" error={errors.date}><input type="date" className={cx('input', errors.date && 'input-error')} value={form.date} onChange={set('date')} /></Field>
            <Field label="Time (IST)" error={errors.time}><input type="time" className={cx('input', errors.time && 'input-error')} value={form.time} onChange={set('time')} /></Field>
            <Field label="Venue" error={errors.venue} className="sm:col-span-2"><input className={cx('input', errors.venue && 'input-error')} value={form.venue} onChange={set('venue')} placeholder="Stadium, City" /></Field>
            <Field label="Prediction Price (₹)" error={errors.price}><input type="number" min="1" className={cx('input', errors.price && 'input-error')} value={form.price} onChange={set('price')} /></Field>
            <Field label="Status"><select className="input" value={form.status} onChange={set('status')}><option value="draft">Draft</option><option value="published">Published</option></select></Field>
            <Field label="Match Image (optional)" className="sm:col-span-2"><ImageUpload value={form.image} onChange={(image) => setForm((f) => ({ ...f, image }))} onError={toast.error} /></Field>
            <label className="flex items-center gap-2 text-sm text-muted sm:col-span-2"><input type="checkbox" className="accent-blue" checked={!!form.featured} onChange={(e) => setForm((f) => ({ ...f, featured: e.target.checked }))} /> Feature on homepage</label>
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
          <p className="mb-3 text-sm text-muted">{priceEdit.match.teamA.name} vs {priceEdit.match.teamB.name}</p>
          <input type="number" min="1" className="input" value={priceEdit.price} onChange={(e) => setPriceEdit({ ...priceEdit, price: e.target.value })} aria-label="Price in rupees" />
        </>}
      </Modal>

      <Modal open={!!del} onClose={() => setDel(null)} title="Delete match?" size="sm"
        footer={<><button className="btn-ghost" onClick={() => setDel(null)}>Cancel</button><button className="btn-danger" onClick={async () => { await deleteMatch(del.id); toast.success('Match and its prediction deleted.'); setDel(null); }}>Delete</button></>}>
        <p className="text-sm text-muted">Delete <b className="text-white">{del?.teamA.name} vs {del?.teamB.name}</b> and its prediction from the demo data? Existing demo purchase records are kept.</p>
      </Modal>
    </>
  );
}
