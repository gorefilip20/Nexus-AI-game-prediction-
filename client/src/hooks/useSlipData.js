import { useCallback, useEffect, useState } from 'react';

async function getJson(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`${url} responded ${response.status}`);
  return response.json();
}

/** Loads the prediction slips and tracker audit from the Fastify engine. */
export function useSlipData() {
  const [predictions, setPredictions] = useState([]);
  const [tracker, setTracker] = useState(null);
  const [state, setState] = useState('loading');
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setState('loading');

    Promise.all([
      getJson('/api/predictions', controller.signal),
      getJson('/api/tracker', controller.signal),
    ])
      .then(([predictionPayload, trackerPayload]) => {
        setPredictions(predictionPayload.predictions ?? []);
        setTracker(trackerPayload);
        setState('ready');
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setState('error');
      });

    return () => controller.abort();
  }, [reloadToken]);

  return { predictions, tracker, state, reload };
}
