import { useCallback, useEffect, useState } from 'react';

const REFRESH_INTERVAL_MS = 5 * 60_000;

async function getJson(url, signal) {
  const response = await fetch(url, { signal });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.message ?? `${url} responded ${response.status}`);
  }
  return body;
}

/**
 * Loads the live board and the settlement tracker.
 *
 * Polls on the same cadence as the server's fixture cache, so the dashboard
 * stays current without spending extra upstream quota.
 */
export function useSlipData() {
  const [predictions, setPredictions] = useState([]);
  const [tracker, setTracker] = useState(null);
  const [meta, setMeta] = useState({ live: false, provider: null, fetchedAt: null, degraded: [] });
  const [state, setState] = useState('loading');
  const [error, setError] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    let timer;

    const load = async (isInitial) => {
      if (isInitial) setState('loading');

      try {
        const [board, trackerPayload] = await Promise.all([
          getJson('/api/predictions', controller.signal),
          getJson('/api/tracker', controller.signal),
        ]);

        setPredictions(board.predictions ?? []);
        setTracker(trackerPayload);
        setMeta({
          live: Boolean(board.live),
          provider: board.provider,
          fetchedAt: board.fetchedAt,
          degraded: board.degraded ?? [],
        });
        setState('ready');
        setError(null);
      } catch (err) {
        if (err.name === 'AbortError') return;
        // A failed refresh should not blank a board that is already on screen.
        setError(err.message);
        setState((current) => (current === 'ready' ? 'ready' : 'error'));
      } finally {
        if (!controller.signal.aborted) {
          timer = setTimeout(() => load(false), REFRESH_INTERVAL_MS);
        }
      }
    };

    load(true);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [reloadToken]);

  return { predictions, tracker, meta, state, error, reload };
}
