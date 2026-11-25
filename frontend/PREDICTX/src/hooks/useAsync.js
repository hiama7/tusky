import { useCallback, useEffect, useRef, useState } from 'react';
import { CHANGE_EVENT } from '../services/storage';

/**
 * Runs an async service call and re-runs it whenever `deps` change or demo
 * data changes anywhere in the app (so lists stay in sync after a purchase).
 * Returns { data, loading, error, reload }.
 * The first load shows `loading=true` (skeletons); later refreshes are silent.
 */
export function useAsync(fn, deps = [], { live = true } = {}) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const seq = useRef(0);

  const run = useCallback((silent = false) => {
    const id = ++seq.current;
    if (!silent) setState((s) => ({ ...s, loading: true, error: null }));
    Promise.resolve()
      .then(() => fnRef.current())
      .then((data) => id === seq.current && setState({ data, loading: false, error: null }))
      .catch((error) => id === seq.current && setState({ data: null, loading: false, error }));
  }, []);

  useEffect(() => {
    run(false);
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!live) return undefined;
    const onChange = () => run(true);
    window.addEventListener(CHANGE_EVENT, onChange);
    return () => window.removeEventListener(CHANGE_EVENT, onChange);
  }, [run, live]);

  return { ...state, reload: () => run(true) };
}
