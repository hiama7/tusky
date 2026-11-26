// Published sports news (paginated).
import { get } from './api';

export const NEWS_CATEGORIES = ['Cricket', 'Football', 'Basketball', 'Tennis', 'Transfer News', 'Tournament News', 'Player Updates'];

/** → { items, pagination } */
export const getNews = ({ category = 'All', q = '', page = 1, limit = 12, featured, trending } = {}) =>
  get('/news', { scope: 'none', query: { category: category === 'All' ? undefined : category, q, page, limit, featured, trending } });

export const getArticle = (idOrSlug) => get(`/news/${encodeURIComponent(idOrSlug)}`, { scope: 'none' }).then((d) => d.article);
