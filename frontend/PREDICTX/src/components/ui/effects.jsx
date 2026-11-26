// Motion helpers: scroll reveal, pointer-following card light, scroll progress
// bar and a subtle 3D tilt. All are decorative; content works without them.
import { useEffect, useRef, useState } from 'react';
import { cx } from '../../utils/format';

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Fades its children up the first time they scroll into view. */
export function Reveal({ children, className = '', delay = 0 }) {
  const ref = useRef(null);
  const [shown, setShown] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (shown) return undefined;
    // threshold 0: a tall block (a long grid on a phone) can never be 10% visible
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) setShown(true); }, { rootMargin: '0px 0px -40px 0px' });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [shown]);
  return <div ref={ref} className={cx('reveal', shown && 'in', className)} style={{ transitionDelay: `${delay}ms` }}>{children}</div>;
}

/** Records the pointer position on the hovered `.card-lift`, for its CSS glow. */
export function PointerGlow() {
  useEffect(() => {
    const onMove = (e) => {
      const card = e.target.closest?.('.card-lift');
      if (!card) return;
      const r = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${e.clientX - r.left}px`);
      card.style.setProperty('--my', `${e.clientY - r.top}px`);
    };
    document.addEventListener('pointermove', onMove, { passive: true });
    return () => document.removeEventListener('pointermove', onMove);
  }, []);
  return null;
}

/** Thin gradient bar showing how far down the page you are. */
export function ScrollProgress() {
  const ref = useRef(null);
  useEffect(() => {
    const update = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (ref.current) ref.current.style.transform = `scaleX(${max > 0 ? Math.min(1, window.scrollY / max) : 0})`;
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => { window.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
  }, []);
  return <div ref={ref} className="fixed inset-x-0 top-0 z-[60] h-0.5 origin-left bg-gradient-to-r from-glow via-accent to-warm" style={{ transform: 'scaleX(0)' }} aria-hidden="true" />;
}

/** Ref for a container whose `.tilt` child leans toward the mouse. */
export function useTilt(max = 6) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || reducedMotion() || !window.matchMedia('(pointer: fine)').matches) return undefined;
    const set = (x, y) => {
      el.style.setProperty('--ry', `${x * max}deg`);
      el.style.setProperty('--rx', `${-y * max}deg`);
    };
    const onMove = (e) => {
      const r = el.getBoundingClientRect();
      set((e.clientX - r.left) / r.width * 2 - 1, (e.clientY - r.top) / r.height * 2 - 1);
    };
    const onLeave = () => set(0, 0);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    return () => { el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerleave', onLeave); };
  }, [max]);
  return ref;
}
