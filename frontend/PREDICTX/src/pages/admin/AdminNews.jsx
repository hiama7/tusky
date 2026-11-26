// News management: add / edit / delete, image upload, categories, publish /
// unpublish and scheduled publishing (a future publish date).
import { useState } from 'react';
import { Plus, Pencil, Trash2, Send, EyeOff, Search, Download } from 'lucide-react';
import { Chips, DataTable, EmptyState, Field, Modal, PageHeader, StatusBadge } from '../../components/ui';
import ImageUpload from '../../components/ui/ImageUpload';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import { deleteNews, getAdminNews, importNews, saveNews, setNewsStatus } from '../../services/admin';
import { NEWS_CATEGORIES } from '../../services/news';
import { cx, fmtDateTime, num } from '../../utils/format';

const EMPTY = { title: '', category: 'Cricket', description: '', content: '', status: 'DRAFT', publishAt: '', featured: false, trending: false };
const pad = (n) => String(n).padStart(2, '0');
const toLocalInput = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };

export default function AdminNews() {
  const toast = useToast();
  const [cat, setCat] = useState('All');
  const [q, setQ] = useState('');
  const [form, setForm] = useState(null);
  const [image, setImage] = useState({ file: null, remove: false });
  const [errors, setErrors] = useState({});
  const [del, setDel] = useState(null);
  const [busy, setBusy] = useState(false);
  const { data, loading, error } = useAsync(() => getAdminNews({ category: cat, q }), [cat, q]);

  function edit(n) {
    setErrors({});
    setImage({ file: null, remove: false });
    setForm({ id: n.id, title: n.title, category: n.category, description: n.excerpt, content: n.body || '', status: n.status, publishAt: n.publishedAt ? toLocalInput(n.publishedAt) : '', featured: n.featured, trending: n.trending, image: n.image });
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      const fields = {
        title: form.title, category: form.category, description: form.description, content: form.content, status: form.status,
        publishedAt: form.publishAt ? new Date(form.publishAt).toISOString() : undefined, featured: form.featured, trending: form.trending, removeImage: image.remove || undefined,
      };
      await saveNews(form.id, fields, image.file);
      const scheduled = form.status === 'PUBLISHED' && form.publishAt && new Date(form.publishAt) > new Date();
      toast.success(scheduled ? 'Article scheduled.' : form.id ? 'Article updated.' : 'Article saved.');
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

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const statusLabel = (n) => (n.scheduled ? 'Scheduled' : { PUBLISHED: 'Published', DRAFT: 'Draft', UNPUBLISHED: 'Unpublished' }[n.status]);

  if (error) return <EmptyState title="Couldn’t load news" text={error.message} />;
  return (
    <>
      <PageHeader title="Sports News" subtitle="Write, categorise, schedule and publish news articles." actions={<>
        <button className="btn-ghost" onClick={() => act(async () => { const r = await importNews(); if (r.message) throw new Error(r.message); }, 'Imported articles saved as drafts for review.')}><Download className="h-4 w-4" /> Import from provider</button>
        <button className="btn-primary" onClick={() => { setErrors({}); setImage({ file: null, remove: false }); setForm(EMPTY); }}><Plus className="h-4 w-4" /> Add News</button>
      </>} />
      <div className="glass mb-5 flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
        <Chips options={['All', ...NEWS_CATEGORIES]} value={cat} onChange={setCat} />
        <label className="relative lg:w-64"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" /><input className="input pl-9" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search news" /></label>
      </div>

      <DataTable loading={loading} rows={data || []} empty="No articles found." columns={[
        { key: 'title', label: 'Article', render: (n) => <div className="flex items-center gap-3 text-left">{n.image && <img src={n.image} alt="" className="h-10 w-14 rounded-lg object-cover" />}<p className="line-clamp-2 max-w-xs font-medium">{n.title}</p></div> },
        { key: 'category', label: 'Category', render: (n) => <span className="badge-brand">{n.category}</span> },
        { key: 'date', label: 'Publish date', render: (n) => <span className="text-muted">{n.publishedAt ? fmtDateTime(n.publishedAt) : '—'}</span> },
        { key: 'views', label: 'Views', render: (n) => num(n.views) },
        { key: 'status', label: 'Status', render: (n) => <span className="flex items-center gap-1.5"><StatusBadge status={statusLabel(n)} />{n.source === 'PROVIDER' && <span className="badge-muted">Imported</span>}</span> },
        { key: 'actions', label: 'Actions', render: (n) => (
          <div className="flex justify-end gap-1.5">
            <button className={cx('btn-sm', n.status === 'PUBLISHED' ? 'btn-ghost' : 'btn-success')} onClick={() => act(() => setNewsStatus(n.id, n.status === 'PUBLISHED' ? 'UNPUBLISHED' : 'PUBLISHED'), n.status === 'PUBLISHED' ? 'Article unpublished.' : 'Article published.')}>
              {n.status === 'PUBLISHED' ? <><EyeOff className="h-3.5 w-3.5" /> Unpublish</> : <><Send className="h-3.5 w-3.5" /> Publish</>}
            </button>
            <button className="btn-ghost btn-sm" onClick={() => edit(n)} aria-label="Edit article"><Pencil className="h-3.5 w-3.5" /></button>
            <button className="btn-ghost btn-sm text-red" onClick={() => setDel(n)} aria-label="Delete article"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        ) },
      ]} />

      <Modal open={!!form} onClose={() => !busy && setForm(null)} title={form?.id ? 'Edit Article' : 'Add News'} size="lg">
        {form && (
          <form onSubmit={submit} noValidate className="space-y-4">
            {errors.form && <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red">{errors.form}</p>}
            <Field label="Title" error={errors.title}><input className={cx('input', errors.title && 'input-error')} value={form.title} onChange={set('title')} /></Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Category"><select className="input" value={form.category} onChange={set('category')}>{NEWS_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
              <Field label="Status"><select className="input" value={form.status} onChange={set('status')}><option value="DRAFT">Draft</option><option value="PUBLISHED">Published</option><option value="UNPUBLISHED">Unpublished</option></select></Field>
              <Field label="Publish date (future = scheduled)" error={errors.publishedAt}><input type="datetime-local" className="input" value={form.publishAt} onChange={set('publishAt')} /></Field>
            </div>
            <Field label="Summary" error={errors.description}><textarea rows={2} className={cx('input', errors.description && 'input-error')} value={form.description} onChange={set('description')} /></Field>
            <Field label="Article body" error={errors.content}><textarea rows={8} className={cx('input', errors.content && 'input-error')} value={form.content} onChange={set('content')} /></Field>
            <Field label="Cover image" hint="If you skip this, a sport illustration is shown."><ImageUpload current={form.image} onChange={setImage} onError={toast.error} /></Field>
            <div className="flex flex-wrap gap-5 text-sm text-muted">
              <label className="flex items-center gap-2"><input type="checkbox" className="accent-brand" checked={form.featured} onChange={set('featured')} /> Featured</label>
              <label className="flex items-center gap-2"><input type="checkbox" className="accent-brand" checked={form.trending} onChange={set('trending')} /> Trending</label>
            </div>
            <div className="flex justify-end gap-2 border-t border-white/5 pt-4">
              <button type="button" className="btn-ghost" onClick={() => setForm(null)}>Cancel</button>
              <button className="btn-primary" disabled={busy}>{busy ? <span className="spinner" /> : form.id ? 'Save changes' : 'Create article'}</button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!del} onClose={() => setDel(null)} title="Delete article?" size="sm"
        footer={<><button className="btn-ghost" onClick={() => setDel(null)}>Cancel</button><button className="btn-danger" onClick={async () => { await act(() => deleteNews(del.id), 'Article deleted.'); setDel(null); }}>Delete</button></>}>
        <p className="text-sm text-muted">“{del?.title}” and its image will be permanently removed.</p>
      </Modal>
    </>
  );
}
