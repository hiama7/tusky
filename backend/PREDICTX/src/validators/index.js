// Zod request schemas, grouped by area. Strings are trimmed; unknown keys are stripped,
// so fields like "role" or "price" sent by a client are silently ignored where not allowed.
import { z } from 'zod';

const trimmed = (max) => z.string().trim().max(max);
const email = z.string().trim().toLowerCase().email('Enter a valid email address').max(191);
const password = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(72, 'Use at most 72 characters')
  .regex(/[A-Za-z]/, 'Include at least one letter')
  .regex(/\d/, 'Include at least one number');
const phone = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, '').replace(/^\+?91(?=\d{10}$)/, ''))
  .pipe(z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number'));
export const id = z.coerce.number().int().positive();
export const idParam = z.object({ id });
const bool = z.union([z.boolean(), z.enum(['true', 'false', '1', '0'])]).transform((v) => v === true || v === 'true' || v === '1');
const money = z.coerce.number().positive('Must be greater than zero').max(99999).multipleOf(0.01, 'At most 2 decimal places');
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #386BFF');
const pagination = { page: z.coerce.number().int().min(1).optional(), limit: z.coerce.number().int().min(1).max(100).optional() };

// ----------------------------------------------------------------------------- auth
export const auth = {
  register: z
    .object({
      fullName: trimmed(120).min(3, 'Please enter your full name'),
      email,
      phone,
      password,
      confirmPassword: z.string(),
    })
    .refine((d) => d.password === d.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match' }),
  login: z.object({ email, password: z.string().min(1, 'Password is required').max(200) }),
  forgot: z.object({ email }),
  reset: z
    .object({ token: z.string().min(20).max(200), password, confirmPassword: z.string() })
    .refine((d) => d.password === d.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match' }),
  changePassword: z
    .object({ currentPassword: z.string().min(1, 'Enter your current password'), newPassword: password, confirmPassword: z.string() })
    .refine((d) => d.newPassword === d.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match' }),
  profile: z.object({ fullName: trimmed(120).min(3).optional(), email: email.optional(), phone: phone.optional() }),
};

// ----------------------------------------------------------------------------- public queries
export const matchQuery = z.object({
  sport: trimmed(40).optional(),
  tournament: id.optional(),
  status: z.enum(['UPCOMING', 'LIVE', 'COMPLETED', 'CANCELLED', 'POSTPONED']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  q: trimmed(100).optional(),
  featured: bool.optional(),
  upcoming: bool.optional(),
  ...pagination,
});

export const newsQuery = z.object({
  category: trimmed(40).optional(),
  q: trimmed(100).optional(),
  featured: bool.optional(),
  trending: bool.optional(),
  ...pagination,
});

// ----------------------------------------------------------------------------- user
export const favourites = z.object({ sports: z.array(trimmed(40)).max(20) });
export const trialActivate = z.object({ matchId: id });

// ----------------------------------------------------------------------------- payments
export const createOrder = z.discriminatedUnion('type', [
  z.object({ type: z.literal('PREDICTION'), matchId: id }),
  z.object({ type: z.literal('SUBSCRIPTION'), planId: id }),
  z.object({ type: z.literal('WALLET_TOPUP'), amount: z.coerce.number().int('Whole rupees only') }),
]);
export const walletPay = z.discriminatedUnion('type', [
  z.object({ type: z.literal('PREDICTION'), matchId: id }),
  z.object({ type: z.literal('SUBSCRIPTION'), planId: id }),
]);
export const verifyPayment = z.object({
  razorpay_order_id: z.string().min(5).max(64),
  razorpay_payment_id: z.string().min(5).max(64),
  razorpay_signature: z.string().min(10).max(128),
});
export const paymentFailure = z.object({ orderId: z.string().min(5).max(64), reason: trimmed(255).optional() });

// ----------------------------------------------------------------------------- admin
export const adminList = z.object({
  q: trimmed(100).optional(),
  status: trimmed(30).optional(),
  type: trimmed(30).optional(),
  subscription: trimmed(30).optional(),
  sport: trimmed(40).optional(),
  category: trimmed(40).optional(),
  ...pagination,
});

export const sportBody = z.object({
  name: trimmed(60).min(2),
  description: trimmed(255).optional().nullable(),
  color: color.optional().nullable(),
  image: trimmed(255).optional().nullable(),
  outcomeFormat: z.enum(['TWO_WAY', 'THREE_WAY']).default('TWO_WAY'),
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
});

export const teamBody = z.object({
  sportId: id,
  name: trimmed(100).min(2),
  shortName: trimmed(5).min(2).optional(),
  color: color.optional().nullable(),
  country: trimmed(60).optional().nullable(),
});

export const tournamentBody = z.object({
  sportId: id,
  name: trimmed(120).min(2),
  season: trimmed(20).optional().default(''),
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
});

// Multipart forms send everything as strings — coerce.
export const matchBody = z
  .object({
    sportId: id,
    tournamentId: id.optional(),
    tournamentName: trimmed(120).min(2).optional(),
    teamAId: id.optional(),
    teamAName: trimmed(100).min(2).optional(),
    teamBId: id.optional(),
    teamBName: trimmed(100).min(2).optional(),
    startsAt: z.coerce.date(),
    venue: trimmed(160).min(2),
    conditions: trimmed(255).optional().nullable(),
    predictionPrice: money,
    status: z.enum(['UPCOMING', 'LIVE', 'COMPLETED', 'CANCELLED', 'POSTPONED']).optional(),
    published: bool.optional(),
    featured: bool.optional(),
    removeImage: bool.optional(),
  })
  .refine((d) => d.tournamentId || d.tournamentName, { path: ['tournamentName'], message: 'Choose or enter a tournament' })
  .refine((d) => d.teamAId || d.teamAName, { path: ['teamAName'], message: 'Choose or enter Team A' })
  .refine((d) => d.teamBId || d.teamBName, { path: ['teamBName'], message: 'Choose or enter Team B' });

export const matchPatch = z.object({
  status: z.enum(['UPCOMING', 'LIVE', 'COMPLETED', 'CANCELLED', 'POSTPONED']).optional(),
  published: z.boolean().optional(),
  featured: z.boolean().optional(),
  predictionPrice: money.optional(),
});

export const matchResult = z
  .object({
    outcome: z.enum(['TEAM_A', 'TEAM_B', 'DRAW']),
    scoreSummary: trimmed(120).optional().nullable(),
    resultDescription: trimmed(255).min(3),
    completedAt: z.coerce.date().optional(),
    verified: z.boolean().default(true),
  });

const strList = (n, len = 200) => z.array(trimmed(len).min(1)).max(n).default([]);
const formList = z.array(z.enum(['W', 'L', 'D'])).max(10).default([]);
const prob = z.coerce.number().min(0).max(100).multipleOf(0.01);

export const predictionBody = z.object({
  matchId: id,
  outcomeFormat: z.enum(['TWO_WAY', 'THREE_WAY']).optional(),
  teamAProbability: prob,
  teamBProbability: prob,
  drawProbability: prob.optional().nullable(),
  predictedOutcome: z.enum(['TEAM_A', 'TEAM_B', 'DRAW']).optional(),
  confidenceLevel: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  summary: trimmed(5000).min(20, 'Write at least 20 characters of analysis'),
  teamA: z.object({ strengths: strList(10), weaknesses: strList(10), form: formList }).default({ strengths: [], weaknesses: [], form: [] }),
  teamB: z.object({ strengths: strList(10), weaknesses: strList(10), form: formList }).default({ strengths: [], weaknesses: [], form: [] }),
  players: z
    .array(z.object({ name: trimmed(80).min(1), team: z.enum(['A', 'B']), stat: trimmed(120).default(''), rating: z.coerce.number().int().min(0).max(100) }))
    .max(20)
    .default([]),
  headToHead: z
    .object({ played: z.coerce.number().int().min(0), aWins: z.coerce.number().int().min(0), bWins: z.coerce.number().int().min(0), draws: z.coerce.number().int().min(0) })
    .refine((h) => h.aWins + h.bWins + h.draws <= h.played, 'Wins + draws cannot exceed matches played')
    .default({ played: 0, aWins: 0, bWins: 0, draws: 0 }),
  keyFactors: strList(10, 300),
  pitchAnalysis: trimmed(3000).optional().nullable(),
  weatherAnalysis: trimmed(3000).optional().nullable(),
  source: z.enum(['MANUAL', 'MODEL']).default('MANUAL'),
  modelVersion: trimmed(60).optional().nullable(),
  publish: z.boolean().optional(),
});

export const newsBody = z.object({
  title: trimmed(200).min(10, 'Title should be at least 10 characters'),
  description: trimmed(500).min(20, 'Summary should be at least 20 characters'),
  content: z.string().trim().min(40, 'Article body should be at least 40 characters').max(50000),
  category: z.enum(['Cricket', 'Football', 'Basketball', 'Tennis', 'Transfer News', 'Tournament News', 'Player Updates']),
  status: z.enum(['DRAFT', 'PUBLISHED', 'UNPUBLISHED']).default('DRAFT'),
  publishedAt: z.coerce.date().optional().nullable(),
  featured: bool.optional(),
  trending: bool.optional(),
  removeImage: bool.optional(),
});

export const planBody = z.object({
  code: trimmed(40).regex(/^[a-z0-9-]+$/, 'Lowercase letters, numbers and dashes only').min(2),
  planName: trimmed(80).min(2),
  description: trimmed(255).optional().nullable(),
  price: money,
  durationDays: z.coerce.number().int().min(1).max(3660),
  features: strList(12),
  allSports: z.boolean().default(true),
  sportIds: z.array(id).max(50).default([]),
  popular: z.boolean().default(false),
  sortOrder: z.coerce.number().int().min(0).max(1000).default(0),
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
});

export const mlSyncBody = z.object({ publish: z.boolean().default(false), days: z.coerce.number().int().min(1).max(60).optional() });
export const userStatus = z.object({ status: z.enum(['ACTIVE', 'BLOCKED']) });
export const refundBody = z.object({ amount: money.optional(), reason: trimmed(255).min(3, 'Give a short reason') });
export const analyticsQuery = z.object({ range: z.enum(['today', '7d', '30d', '90d', '12w', '12m', '5y']).default('30d') });
