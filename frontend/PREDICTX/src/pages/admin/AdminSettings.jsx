// Admin settings: sports / teams / tournaments catalogue, admin password,
// data-provider integration status and the admin audit log.
import { useState } from 'react';
import { Plus, ShieldCheck, KeyRound, Plug, ScrollText, Trophy, Users2, Medal } from 'lucide-react';
import { DataTable, Field, Modal, PageHeader, Skeleton, StatusBadge } from '../../components/ui';
import PasswordInput from '../../components/ui/PasswordInput';
import TwoFactorPanel from '../../components/admin/TwoFactorPanel';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useAsync } from '../../hooks/useAsync';
import { changePassword } from '../../services/auth';
import { createSport, createTeam, createTournament, getAdminLogs, getCatalogue, getIntegrations } from '../../services/admin';
import { passwordIssue } from '../../utils/validation';
import { cx, fmtDateTime } from '../../utils/format';

function Catalogue() {
  const toast = useToast();
  const { data, loading } = useAsync(() => getCatalogue(), []);
  const [modal, setModal] = useState(null); // { kind: 'sport'|'team'|'tournament', form }
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const open = (kind) => {
    setErrors({});
    const firstSport = data?.sports?.[0]?.dbId || '';
    setModal({ kind, form: kind === 'sport' ? { name: '', outcomeFormat: 'TWO_WAY', color: '#386BFF', description: '' } : kind === 'team' ? { sportId: firstSport, name: '', shortName: '', country: '', color: '#386BFF' } : { sportId: firstSport, name: '', season: '' } });
  };
  const set = (k) => (e) => setModal((m) => ({ ...m, form: { ...m.form, [k]: e.target.value } }));

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    const f = { ...modal.form };
    if (f.sportId) f.sportId = Number(f.sportId);
    Object.keys(f).forEach((k) => f[k] === '' && delete f[k]);
    try {
      await ({ sport: createSport, team: createTeam, tournament: createTournament }[modal.kind])(f);
      toast.success(`${modal.kind[0].toUpperCase()}${modal.kind.slice(1)} added.`);
      setModal(null);
    } catch (err) {
      setErrors({ form: err.message, ...err.fields });
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Skeleton className="h-64 rounded-2xl" />;
  const sportName = (id) => data.sports.find((s) => s.dbId === id)?.name;
  return (
    <section className="card">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold"><Trophy className="h-4 w-4 text-green" /> Sports catalogue</h2>
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost btn-sm" onClick={() => open('sport')}><Plus className="h-3.5 w-3.5" /> Sport</button>
          <button className="btn-ghost btn-sm" onClick={() => open('team')}><Plus className="h-3.5 w-3.5" /> Team</button>
          <button className="btn-ghost btn-sm" onClick={() => open('tournament')}><Plus className="h-3.5 w-3.5" /> Tournament</button>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-3 [&>div]:min-w-0">
        <div><p className="mb-2 flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted"><Medal className="h-3.5 w-3.5" /> Sports ({data.sports.length})</p>
          <ul className="max-h-64 space-y-1 overflow-y-auto text-sm">{data.sports.map((s) => <li key={s.dbId} className="flex justify-between gap-3 rounded-lg bg-white/[.03] px-3 py-1.5"><span className="min-w-0 truncate" style={{ color: s.color }}>{s.name}</span><span className="text-xs text-muted">{s.outcomeFormat === 'THREE_WAY' ? '3-way' : '2-way'} · {s.matches} matches</span></li>)}</ul></div>
        <div><p className="mb-2 flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted"><Users2 className="h-3.5 w-3.5" /> Teams ({data.teams.length})</p>
          <ul className="max-h-64 space-y-1 overflow-y-auto text-sm">{data.teams.map((t) => <li key={t.id} className="flex justify-between gap-3 rounded-lg bg-white/[.03] px-3 py-1.5"><span className="min-w-0 truncate">{t.name}</span><span className="min-w-0 truncate text-right text-xs text-muted">{t.short} · {sportName(t.sportId)}</span></li>)}</ul></div>
        <div><p className="mb-2 flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted"><Trophy className="h-3.5 w-3.5" /> Tournaments ({data.tournaments.length})</p>
          <ul className="max-h-64 space-y-1 overflow-y-auto text-sm">{data.tournaments.map((t) => <li key={t.id} className="flex justify-between gap-3 rounded-lg bg-white/[.03] px-3 py-1.5"><span className="min-w-0 truncate">{t.name}{t.season ? ` ${t.season}` : ''}</span><span className="min-w-0 truncate text-right text-xs text-muted">{sportName(t.sportId)}</span></li>)}</ul></div>
      </div>

      <Modal open={!!modal} onClose={() => !busy && setModal(null)} title={modal ? `Add ${modal.kind}` : ''} size="sm">
        {modal && (
          <form onSubmit={save} noValidate className="space-y-4">
            {errors.form && <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red">{errors.form}</p>}
            {modal.kind !== 'sport' && <Field label="Sport"><select className="input" value={modal.form.sportId} onChange={set('sportId')}>{data.sports.map((s) => <option key={s.dbId} value={s.dbId}>{s.name}</option>)}</select></Field>}
            <Field label="Name" error={errors.name}><input className="input" value={modal.form.name} onChange={set('name')} /></Field>
            {modal.kind === 'sport' && <>
              <Field label="Outcome format"><select className="input" value={modal.form.outcomeFormat} onChange={set('outcomeFormat')}><option value="TWO_WAY">Two outcomes (no draws)</option><option value="THREE_WAY">Three outcomes (draws possible)</option></select></Field>
              <Field label="Description"><input className="input" value={modal.form.description} onChange={set('description')} /></Field>
              <Field label="Colour" error={errors.color}><input type="color" className="input h-10 p-1" value={modal.form.color} onChange={set('color')} /></Field>
            </>}
            {modal.kind === 'team' && <>
              <Field label="Short code (2–5 letters, optional)" error={errors.shortName}><input className="input" maxLength={5} value={modal.form.shortName} onChange={set('shortName')} /></Field>
              <Field label="Country (optional)"><input className="input" value={modal.form.country} onChange={set('country')} /></Field>
              <Field label="Colour"><input type="color" className="input h-10 p-1" value={modal.form.color} onChange={set('color')} /></Field>
            </>}
            {modal.kind === 'tournament' && <Field label="Season (optional)"><input className="input" value={modal.form.season} onChange={set('season')} placeholder="2026" /></Field>}
            <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={() => setModal(null)}>Cancel</button><button className="btn-primary" disabled={busy}>{busy ? <span className="spinner" /> : 'Add'}</button></div>
          </form>
        )}
      </Modal>
    </section>
  );
}

function AdminPassword() {
  const toast = useToast();
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    const errs = {};
    const issue = passwordIssue(pw.next);
    if (issue) errs.next = issue;
    if (pw.next !== pw.confirm) errs.confirm = 'Passwords do not match.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      await changePassword(pw.current, pw.next, pw.confirm, 'admin');
      toast.success('Admin password changed. Other sessions were signed out.');
      setPw({ current: '', next: '', confirm: '' });
    } catch (err) {
      setErrors({ current: err.fields.currentPassword || err.message, next: err.fields.newPassword });
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} noValidate className="card space-y-3">
      <h2 className="flex items-center gap-2 font-semibold"><KeyRound className="h-4 w-4 text-brand" /> Change admin password</h2>
      <Field label="Current password" error={errors.current}><PasswordInput error={errors.current} value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
      <Field label="New password" error={errors.next}><PasswordInput error={errors.next} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
      <Field label="Confirm new password" error={errors.confirm}><PasswordInput error={errors.confirm} value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></Field>
      <div className="flex justify-end"><button className="btn-primary" disabled={busy}>{busy ? <span className="spinner" /> : 'Update password'}</button></div>
    </form>
  );
}

export default function AdminSettings() {
  const { admin } = useAuth();
  const { data: integrations } = useAsync(() => getIntegrations(), [], { live: false });
  const { data: logs, loading: logsLoading } = useAsync(() => getAdminLogs(), []);

  return (
    <>
      <PageHeader title="Settings" subtitle="Catalogue, account security, integrations and the audit log." />
      <div className="space-y-5">
        <Catalogue />
        <div className="grid gap-5 lg:grid-cols-3">
          <AdminPassword />
          <TwoFactorPanel />
          <section className="card">
            <h2 className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-4 w-4 text-green" /> Admin account</h2>
            <p className="mt-3 text-sm">{admin?.name}</p>
            <p className="text-sm text-muted">{admin?.email}</p>
            <p className="mt-3 text-xs text-muted">New administrators are created on the server with <code className="rounded bg-white/5 px-1">npm run create-admin</code>. Admin rights can’t be granted from the website.</p>
          </section>
          <section className="card">
            <h2 className="flex items-center gap-2 font-semibold"><Plug className="h-4 w-4 text-accent" /> Data providers</h2>
            {integrations ? (
              <ul className="mt-3 space-y-2 text-sm">
                <li className="flex justify-between"><span>Sports data</span><span className={cx(integrations.sportsData.configured ? 'text-green' : 'text-muted')}>{integrations.sportsData.provider}</span></li>
                <li className="flex justify-between"><span>News</span><span className={cx(integrations.news.configured ? 'text-green' : 'text-muted')}>{integrations.news.provider}</span></li>
              </ul>
            ) : <Skeleton className="mt-3 h-12" />}
            <p className="mt-3 text-xs text-muted">Matches are entered manually until a provider is configured on the server (SPORTS_DATA_PROVIDER / NEWS_PROVIDER). Imported news always arrives as drafts for review.</p>
          </section>
        </div>
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold"><ScrollText className="h-4 w-4 text-orange" /> Audit log</h2>
          <DataTable loading={logsLoading} rows={logs || []} empty="No admin actions recorded yet." columns={[
            { key: 'date', label: 'When', render: (l) => <span className="text-muted">{fmtDateTime(l.date)}</span> },
            { key: 'admin', label: 'Admin' },
            { key: 'action', label: 'Action', render: (l) => <StatusBadge status={l.action} /> },
            { key: 'description', label: 'Details', render: (l) => <span className="text-muted">{l.description}</span> },
            { key: 'ip', label: 'IP', render: (l) => <span className="font-mono text-xs text-muted">{l.ip}</span> },
          ]} />
        </section>
      </div>
    </>
  );
}
