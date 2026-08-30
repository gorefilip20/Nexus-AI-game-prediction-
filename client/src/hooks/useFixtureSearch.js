import { useCallback, useEffect, useRef, useState } from 'react';

const DEBOUNCE_MS = 350;
const MIN_QUERY_LENGTH = 2;

/**
 * Debounced fixture search.
 *
 * Each keystroke would otherwise cost upstream schedule requests against a
 * 100/day quota, so queries are debounced and in-flight requests are aborted
 * when the query moves on.
 */
export function useFixtureSearch() {
  const [query, setQuery] = useState('');
  const [sport, setSport] = useState('');
  const [days, setDays] = useState(2);
  const [state, setState] = useState('idle');
  const [response, setResponse] = useState(null);
  const [error, setError] = useState(null);

  const controllerRef = useRef(null);

  const clear = useCallback(() => {
    controllerRef.current?.abort();
    setQuery('');
    setResponse(null);
    setError(null);
    setState('idle');
  }, []);

  useEffect(() => {
    const trimmed = query.trim();

    if (trimmed.length < MIN_QUERY_LENGTH) {
      controllerRef.current?.abort();
      setResponse(null);
      setError(null);
      setState('idle');
      return undefined;
    }

    setState('searching');

    const timer = setTimeout(async () => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;

      const params = new URLSearchParams({ q: trimmed, days: String(days) });
      if (sport) params.set('sport', sport);

      try {
        const res = await fetch(`/api/search?${params}`, { signal: controller.signal });
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.message ?? `Search failed (${res.status})`);

        setResponse(body);
        setError(null);
        setState('done');
      } catch (err) {
        if (err.name === 'AbortError') return;
        setError(err.message);
        setState('error');
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, sport, days]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  return { query, setQuery, sport, setSport, days, setDays, state, response, error, clear };
}
