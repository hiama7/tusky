// Per-page title, description and canonical address, plus one anonymous page-view
// count for public pages (no cookie, no identifier; skipped if the browser asks
// not to be tracked).
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { PAGES } from '../content/pages';
import { API_BASE } from '../services/api';

const setTag = (selector, attribute, value) => document.head.querySelector(selector)?.setAttribute(attribute, value);

export default function SiteMeta() {
  const { pathname } = useLocation();
  const counted = useRef('');

  useEffect(() => {
    const page = PAGES[pathname];
    const title = page ? page.title : 'TUSKY';
    const description = page?.description || PAGES['/'].description;
    document.title = title;
    setTag('meta[name="description"]', 'content', description);
    setTag('meta[property="og:title"]', 'content', title);
    setTag('meta[property="og:description"]', 'content', description);
    setTag('link[rel="canonical"]', 'href', `${window.location.origin}${pathname}`);
    // only public pages are listed, so signed-in activity is never counted
    setTag('meta[name="robots"]', 'content', page ? 'index,follow' : 'noindex');

    const optedOut = navigator.doNotTrack === '1' || navigator.globalPrivacyControl === true;
    if (!page || optedOut || counted.current === pathname) return;
    counted.current = pathname;
    fetch(`${API_BASE}/hit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: pathname }), credentials: 'omit', keepalive: true }).catch(() => {});
  }, [pathname]);

  return null;
}
