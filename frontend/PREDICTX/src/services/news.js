// =========================================================
// news.js — sports news (read for public, CRUD for admin).
// Stage 2: GET /api/news.php?category=&q=   POST/PUT/DELETE /api/admin/news.php
//          image uploads → POST /api/admin/upload.php (multipart)
// =========================================================
import { simulate, DemoError } from './api';
import { table, save, update } from './db';
import { uid } from './storage';

export function getNews({ category = 'All', q = '', includeDrafts = false } = {}) {
  return simulate(() => {
    const term = q.trim().toLowerCase();
    return table('news')
      .filter((n) => includeDrafts || n.status === 'published')
      .filter((n) => category === 'All' || n.category === category)
      .filter((n) => !term || `${n.title} ${n.excerpt} ${n.category}`.toLowerCase().includes(term))
      .sort((a, b) => new Date(b.date) - new Date(a.date));
  }, 250);
}

export function saveNews(article) {
  return simulate(() => {
    if (!article.title?.trim()) throw new DemoError('Title is required.');
    const rows = table('news');
    if (article.id) {
      save('news', rows.map((n) => (n.id === article.id ? { ...n, ...article } : n)));
      return article;
    }
    const created = { views: 0, author: 'Admin', date: new Date().toISOString(), status: 'draft', ...article, id: uid('N') };
    save('news', [created, ...rows]);
    return created;
  }, 300);
}

export const deleteNews = (id) => simulate(() => update('news', (rows) => rows.filter((n) => n.id !== id)));
export const setNewsStatus = (id, status) => simulate(() => update('news', (rows) => rows.map((n) => (n.id === id ? { ...n, status, date: status === 'published' ? new Date().toISOString() : n.date } : n))));
