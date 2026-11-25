// DEMO DATA — pricing. Stage 2: GET /api/plans.php
export const SINGLE_MATCH_PRICING = [
  { label: 'Badminton / Volleyball', price: 19 },
  { label: 'Tennis / Esports', price: 29 },
  { label: 'Basketball / Hockey', price: 39 },
  { label: 'Cricket / Football', price: '49–59' },
];

export const PLANS = [
  { id: 'weekly', name: 'Weekly Pass', price: 199, period: 'week', days: 7, features: ['All predictions for 7 days', 'Match insights & player stats', 'Email alerts'], popular: false },
  { id: 'monthly', name: 'Pro Monthly', price: 599, period: 'month', days: 30, features: ['All predictions for 30 days', 'Full head-to-head history', 'Priority notifications', 'Early access to new sports'], popular: true },
  { id: 'yearly', name: 'Elite Yearly', price: 4999, period: 'year', days: 365, features: ['Everything in Pro', '2 months free', 'Advanced analytics dashboard', 'Dedicated support'], popular: false },
];

export const planById = (id) => PLANS.find((p) => p.id === id);
