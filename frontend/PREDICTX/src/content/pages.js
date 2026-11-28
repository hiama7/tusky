// The public pages: used for titles, descriptions, the sitemap and view counts.
// Keep in step with PUBLIC_PAGES in backend/PREDICTX/src/services/pageViewService.js.
export const PAGES = {
  '/': { title: 'TUSKY — match win probabilities', description: 'Match win probabilities from models trained on past results, with recent form and head-to-head records.' },
  '/sports': { title: 'Matches by sport — TUSKY', description: 'Upcoming fixtures with predictions, by sport and competition.' },
  '/news': { title: 'Sports news — TUSKY', description: 'Headlines with links to the publishers.' },
  '/track-record': { title: 'Prediction track record — TUSKY', description: 'Every finished match against the numbers published before it started, misses included.' },
  '/pricing': { title: 'Pricing — TUSKY', description: 'Unlock one match or subscribe. One-time payments, no automatic renewal.' },
  '/about': { title: 'About — TUSKY', description: 'What TUSKY predicts, and what its models do not know.' },
  '/terms': { title: 'Terms of Use — TUSKY' },
  '/privacy': { title: 'Privacy Policy — TUSKY' },
  '/refunds': { title: 'Refund Policy — TUSKY' },
  '/disclaimer': { title: 'Disclaimer and data sources — TUSKY' },
  '/register': { title: 'Create an account — TUSKY' },
  '/login': { title: 'Log in — TUSKY' },
};
