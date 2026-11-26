// =========================================================
// Reusable UI building blocks used across public, user and admin pages.
// =========================================================
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { X, FlaskConical, Inbox } from 'lucide-react';
import { cx } from '../../utils/format';

/* ---------- Brand logo ---------- */
export function Logo({ to = '/', admin = false, className = '' }) {
  return (
    <Link to={to} className={cx('flex items-center gap-2.5 font-display', className)} aria-label="TUSKY home">
      <img src="assets/logos/tusky-mark.svg" alt="" className="h-9 w-9" />
      <span className="text-xl font-bold tracking-tight">
        TUSKY{admin && <span className="ml-1.5 align-middle text-[10px] font-semibold uppercase tracking-widest text-purple">Admin</span>}
      </span>
    </Link>
  );
}

/* ---------- Demo labels ---------- */
export function DemoTag({ children = 'Demo data', className = '' }) {
  return (
    <span className={cx('badge-orange', className)} title="Demonstration content — not real data">
      <FlaskConical className="h-3 w-3" /> {children}
    </span>
  );
}

export function DemoBanner({ children, className = '' }) {
  return (
    <div className={cx('flex items-start gap-3 rounded-xl border border-orange/25 bg-orange/[.07] px-4 py-3 text-sm text-orange/90', className)} role="note">
      <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

/* ---------- Modal (animated, closes on Esc / backdrop) ---------- */
export function Modal({ open, onClose, title, children, size = 'md', footer }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;
  const width = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }[size];
  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end justify-center p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" style={{ animation: 'fade-up .2s ease both' }} onClick={onClose} />
      <div className={cx('glass relative flex max-h-[92vh] w-full flex-col rounded-b-none sm:rounded-2xl shadow-2xl animate-scale-in', width)} style={{ background: 'linear-gradient(160deg,#151D2E,#101625)' }}>
        <div className="flex items-center justify-between border-b border-white/5 px-5 py-4">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-white/5 hover:text-white" aria-label="Close dialog"><X className="h-5 w-5" /></button>
        </div>
        <div className="overflow-y-auto px-5 py-5">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-white/5 px-5 py-4">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/* ---------- Skeletons ---------- */
export const Skeleton = ({ className = '' }) => <div className={cx('skeleton', className)} />;
export function CardSkeleton({ count = 3, className = 'h-48' }) {
  return Array.from({ length: count }, (_, i) => <Skeleton key={i} className={cx('rounded-2xl', className)} />);
}

/* ---------- Animated number (count-up when it scrolls into view) ---------- */
export function AnimatedNumber({ value, prefix = '', suffix = '', duration = 1400 }) {
  const [shown, setShown] = useState(0);
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    let raf;
    const start = () => {
      const t0 = performance.now();
      const tick = (t) => {
        const p = Math.min(1, (t - t0) / duration);
        setShown(Math.round(value * (1 - Math.pow(1 - p, 3))));
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { start(); io.disconnect(); }
    });
    if (el) io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [value, duration]);
  return <span ref={ref}>{prefix}{shown.toLocaleString('en-IN')}{suffix}</span>;
}

/* ---------- Stat card ---------- */
export function StatCard({ icon: Icon, label, value, hint, color = 'blue', demo = false, className = '' }) {
  const tones = { blue: 'bg-blue/15 text-blue', purple: 'bg-purple/15 text-purple', green: 'bg-green/15 text-green', orange: 'bg-orange/15 text-orange', red: 'bg-red/15 text-red' };
  return (
    <div className={cx('card card-lift page-enter', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className={cx('stat-icon', tones[color])}>{Icon && <Icon className="h-5 w-5" />}</div>
        {demo && <DemoTag>Sample</DemoTag>}
      </div>
      <p className="mt-4 text-sm text-muted">{label}</p>
      <p className="mt-1 font-display text-2xl font-bold">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

/* ---------- Probability bar ---------- */
export function ProbBar({ value, color = '#386BFF', label, delay = 0 }) {
  return (
    <div>
      {label && (
        <div className="mb-1.5 flex justify-between text-sm">
          <span className="text-muted">{label}</span>
          <span className="font-semibold">{value}%</span>
        </div>
      )}
      <div className="bar-track">
        <div className="bar-fill" style={{ width: `${value}%`, background: `linear-gradient(90deg, ${color}, ${color}aa)`, animationDelay: `${delay}ms` }} />
      </div>
    </div>
  );
}

/* ---------- Team crest (generated initials badge — not an official logo) ---------- */
export function TeamCrest({ team, size = 'md' }) {
  const s = { sm: 'h-9 w-9 text-[10px]', md: 'h-12 w-12 text-xs', lg: 'h-20 w-20 text-base' }[size];
  return (
    <div
      className={cx('relative flex shrink-0 items-center justify-center rounded-2xl font-display font-bold tracking-wider text-white shadow-lg', s)}
      style={{ background: `linear-gradient(145deg, ${team.color}, ${team.color}55)`, boxShadow: `0 8px 24px -10px ${team.color}` }}
      aria-hidden="true"
    >
      <span className="absolute inset-[3px] rounded-[13px] border border-white/20" />
      {team.short}
    </div>
  );
}

/* ---------- Empty state ---------- */
export function EmptyState({ icon: Icon = Inbox, title, text, action }) {
  return (
    <div className="glass flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="stat-icon mb-4 bg-white/5 text-muted"><Icon className="h-5 w-5" /></div>
      <p className="font-semibold">{title}</p>
      {text && <p className="mt-1 max-w-sm text-sm text-muted">{text}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/* ---------- Page header ---------- */
export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold md:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/* ---------- Form field ---------- */
export function Field({ label, error, children, hint, className = '' }) {
  return (
    <div className={className}>
      {label && <label className="label">{label}</label>}
      {children}
      {error ? <p className="field-error">{error}</p> : hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

/* ---------- Filter chips ---------- */
export function Chips({ options, value, onChange }) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {options.map((o) => {
        const v = typeof o === 'string' ? o : o.value;
        const l = typeof o === 'string' ? o : o.label;
        return (
          <button key={v} type="button" onClick={() => onChange(v)} className={cx('chip', value === v && 'active')} aria-pressed={value === v}>
            {l}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- Responsive data table ---------- */
/** columns: [{ key, label, render?(row), className? }] — rows become cards on mobile. */
export function DataTable({ columns, rows, empty = 'No records found.', loading }) {
  if (loading) return <div className="space-y-2"><Skeleton className="h-12" /><Skeleton className="h-12" /><Skeleton className="h-12" /><Skeleton className="h-12" /></div>;
  if (!rows?.length) return <EmptyState title={empty} />;
  return (
    <div className="table-wrap">
      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>{columns.map((c) => <th key={c.key} className={c.className}>{c.label}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id ?? i}>
                {columns.map((c) => (
                  <td key={c.key} data-label={c.label} className={c.className}>{c.render ? c.render(r) : r[c.key]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------- Status badge mapping ---------- */
const STATUS_TONE = {
  Active: 'badge-green', Success: 'badge-green', published: 'badge-green', Published: 'badge-green', used: 'badge-muted',
  Pending: 'badge-orange', draft: 'badge-orange', Trial: 'badge-purple', available: 'badge-green',
  Expired: 'badge-muted', None: 'badge-muted', Cancelled: 'badge-red', Failed: 'badge-red', Blocked: 'badge-red', Refunded: 'badge-blue',
  'Partially refunded': 'badge-blue', Draft: 'badge-orange', Unpublished: 'badge-muted', Scheduled: 'badge-purple', Archived: 'badge-muted',
  UPCOMING: 'badge-blue', LIVE: 'badge-red', COMPLETED: 'badge-green', CANCELLED: 'badge-muted', POSTPONED: 'badge-orange',
  PUBLISHED: 'badge-green', DRAFT: 'badge-orange', UNPUBLISHED: 'badge-muted', Available: 'badge-green', Used: 'badge-muted',
};
export const StatusBadge = ({ status }) => <span className={STATUS_TONE[status] || 'badge-muted'}>{status}</span>;

/* ---------- Click-outside hook for dropdowns ---------- */
export function useClickOutside(onOutside) {
  const ref = useRef(null);
  useEffect(() => {
    const handler = (e) => ref.current && !ref.current.contains(e.target) && onOutside();
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onOutside]);
  return ref;
}
