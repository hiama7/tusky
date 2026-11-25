// News management: add / edit / delete / publish, categories, image upload.
import { useState } from 'react';
import { Plus, Pencil, Trash2, Send, EyeOff, Search } from 'lucide-react';
import { Chips, DataTable, Field, Modal, PageHeader, StatusBadge } from '../../components/ui';
import ImageUpload from '../../components/ui/ImageUpload';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import { deleteNews, getNews, saveNews, setNewsStatus } from '../../services/news';
import { NEWS_CATEGORIES } from '../../data/demo/news';
import { cx, fmtDate, num } from '../../utils/format';

const EMPTY = { title: '', category: 'Cricket', excerpt: '', body: '', image: '', featured: false, trending: false, status: 'draft' };
const DEFAULT_IMG = { Cricket: 'cricket', Football: 'football', Basketball: 'basketball', Tennis: 'tennis', 'Transfer News': 'football', 'Tournament News': 'esports', 'Player Updates': 'cricket' };

export default function AdminNews() {
  const toast = useToast();
  const [cat, setCat] = useState('All');
  const [q, setQ] = useState('');
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  const [del, setDel] = useState(null);
  const [busy, setBusy] = useState(false);
  const { data, loading } = useAsync(() => getNews({ category: cat, q, includeDrafts: true }), [cat, q]);

  async function submit(e) {
    e.preventDefault();
    const errs = {};
    if (form.title.trim().length < 10) errs.title = 'Title should be at least 10 characters';
    if (form.excerpt.trim().length < 20) errs.excerpt = 'Summary should be at least 20 characters';
    if (form.body.trim().length < 40) errs.body = 'Article body should be at least 40 characters';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      await saveNews({ ...form, image: form.image || `assets/images/sports/${DEFAULT_IMG[form.category]}.svg` });
      toast.success(form.id ? 'Article updated.' : 'Article created.');
      setForm(null);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  return (
    <>
      <PageHeader title="Sports News" subtitle="Write, categorise and publish news articles." actions={<button className="btn-primary" onClick={() => { setErrors({}); setForm(EMPTY); }}><Plus className="h-4 w-4" /> Add News</button>} />
      <div className="glass mb-5 flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
        <Chips options={['All', ...NEWS_CATEGORIES]} value={cat} onChange={setCat} />
        <label className="relative lg:w-64"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" /><input className="input pl-9" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search news" /></label>
      </div>

      <DataTable loading={loading} rows={data || []} empty="No articles found." columns={[
        { key: 'title', label: 'Article', render: (n) => <div className="flex items-center gap-3 text-left"><img src={n.image} alt="" className="h-10 w-14 rounded-lg object-cover" /><p className="line-clamp-2 max-w-xs font-medium">{n.title}</p></div> },
        { key: 'category', label: 'Category', render: (n) => <span className="badge-blue">{n.category}</span> },
        { key: 'date', label: 'Date', render: (n) => <span className="text-muted">{fmtDate(n.date)}</span> },
        { key: 'views', label: 'Views', render: (n) => num(n.views) },
        { key: 'status', label: 'Status', render: (n) => <StatusBadge status={n.status} /> },
        { key: 'actions', label: 'Actions', render: (n) => (
          <div className="flex justify-end gap-1.5">
            <button className={cx('btn-sm', n.status === 'published' ? 'btn-ghost' : 'btn-success')} onClick={async () => { await setNewsStatus(n.id, n.status === 'published' ? 'draft' : 'published'); toast.success(n.status === 'published' ? 'Article unpublished.' : 'Article published.'); }}>
              {n.status === 'published' ? <><EyeOff className="h-3.5 w-3.5" /> Unpublish</> : <><Send className="h-3.5 w-3.5" /> Publish</>}
            </button>
            <button className="btn-ghost btn-sm" onClick={() => { setErrors({}); setForm(n); }} aria-label="Edit article"><Pencil className="h-3.5 w-3.5" /></button>
            <button className="btn-ghost btn-sm text-red" onClick={() => setDel(n)} aria-label="Delete article"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        ) },
      ]} />

      <Modal open={!!form} onClose={() => !busy && setForm(null)} title={form?.id ? 'Edit Article' : 'Add News'} size="lg">
        {form && (
          <form onSubmit={submit} noValidate className="space-y-4">
            <Field label="Title" error={errors.title}><input className={cx('input', errors.title && 'input-error')} value={form.title} onChange={set('title')} /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Category"><select className="input" value={form.category} onChange={set('category')}>{NEWS_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
              <Field label="Status"><select className="input" value={form.status} onChange={set('status')}><option value="draft">Draft</option><option value="published">Published</option></select></Field>
            </div>
            <Field label="Summary" error={errors.excerpt}><textarea rows={2} className={cx('input', errors.excerpt && 'input-error')} value={form.excerpt} onChange={set('excerpt')} /></Field>
            <Field label="Article body" error={errors.body}><textarea rows={6} className={cx('input', errors.body && 'input-error')} value={form.body} onChange={set('body')} /></Field>
            <Field label="Cover image" hint="If you skip this, a default sport illustration is used."><ImageUpload value={form.image?.startsWith('data:') ? form.image : ''} onChange={(image) => setForm((f) => ({ ...f, image }))} onError={toast.error} /></Field>
            <div className="flex flex-wrap gap-5 text-sm text-muted">
              <label className="flex items-center gap-2"><input type="checkbox" className="accent-blue" checked={!!form.featured} onChange={set('featured')} /> Featured</label>
              <label className="flex items-center gap-2"><input type="checkbox" className="accent-blue" checked={!!form.trending} onChange={set('trending')} /> Trending</label>
            </div>
            <div className="flex justify-end gap-2 border-t border-white/5 pt-4">
              <button type="button" className="btn-ghost" onClick={() => setForm(null)}>Cancel</button>
              <button className="btn-primary" disabled={busy}>{busy ? <span className="spinner" /> : form.id ? 'Save changes' : 'Create article'}</button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!del} onClose={() => setDel(null)} title="Delete article?" size="sm"
        footer={<><button className="btn-ghost" onClick={() => setDel(null)}>Cancel</button><button className="btn-danger" onClick={async () => { await deleteNews(del.id); toast.success('Article deleted.'); setDel(null); }}>Delete</button></>}>
        <p className="text-sm text-muted">“{del?.title}” will be removed from the demo data.</p>
      </Modal>
    </>
  );
}
