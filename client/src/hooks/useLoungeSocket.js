import { useCallback, useEffect, useRef, useState } from 'react';

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15_000;

function resolveSocketUrl(path) {
  const explicit = import.meta.env.VITE_WS_URL;
  if (explicit) return explicit;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${path}`;
}

/**
 * Keeps a single punter-lounge socket open, replaying room history on connect
 * and reconnecting with exponential backoff when the engine drops.
 */
export function useLoungeSocket(path = '/ws/punter-lounge') {
  const [messages, setMessages] = useState([]);
  const [online, setOnline] = useState(0);
  const [status, setStatus] = useState('connecting');
  const [notice, setNotice] = useState(null);

  const socketRef = useRef(null);
  const attemptsRef = useRef(0);
  const retryTimerRef = useRef(null);
  const closedByUsRef = useRef(false);

  useEffect(() => {
    closedByUsRef.current = false;

    const connect = () => {
      setStatus((current) => (current === 'open' ? current : 'connecting'));

      let socket;
      try {
        socket = new WebSocket(resolveSocketUrl(path));
      } catch {
        scheduleReconnect();
        return;
      }
      socketRef.current = socket;

      socket.onopen = () => {
        attemptsRef.current = 0;
        setStatus('open');
        setNotice(null);
      };

      socket.onmessage = (event) => {
        let payload;
        try {
          payload = JSON.parse(event.data);
        } catch {
          return;
        }

        if (payload.type === 'history') {
          setMessages(Array.isArray(payload.messages) ? payload.messages : []);
        } else if (payload.type === 'message' && payload.message) {
          setMessages((current) => [...current, payload.message]);
        } else if (payload.type === 'presence') {
          setOnline(Number(payload.online) || 0);
        } else if (payload.type === 'error') {
          setNotice(payload.message ?? 'The lounge rejected that message.');
        }
      };

      socket.onerror = () => setNotice('Lost contact with the lounge engine.');

      socket.onclose = () => {
        socketRef.current = null;
        setOnline(0);
        if (closedByUsRef.current) return;
        setStatus('disconnected');
        scheduleReconnect();
      };
    };

    const scheduleReconnect = () => {
      if (closedByUsRef.current) return;
      const delay = Math.min(
        RECONNECT_BASE_MS * 2 ** attemptsRef.current,
        RECONNECT_MAX_MS,
      );
      attemptsRef.current += 1;
      retryTimerRef.current = setTimeout(connect, delay);
    };

    connect();

    return () => {
      closedByUsRef.current = true;
      clearTimeout(retryTimerRef.current);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [path]);

  const send = useCallback((payload) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setNotice('Not connected — your message was not sent.');
      return false;
    }
    socket.send(JSON.stringify(payload));
    return true;
  }, []);

  return { messages, online, status, notice, send };
}
