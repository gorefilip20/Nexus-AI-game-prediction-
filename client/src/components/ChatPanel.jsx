import { useEffect, useLayoutEffect, useRef, useState } from 'react';

const MAX_MESSAGE_LENGTH = 500;

const STATUS_COPY = {
  open: 'Connected to the lounge.',
  connecting: 'Connecting to the lounge…',
  disconnected: 'Disconnected — retrying automatically.',
};

export default function ChatPanel({ messages, online, status, notice, onSend, username }) {
  const [draft, setDraft] = useState('');
  const scrollRef = useRef(null);
  const isOpen = status === 'open';

  // Pin to the newest message, but leave the reader alone if they scrolled up.
  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
    if (distanceFromBottom < 160) node.scrollTop = node.scrollHeight;
  }, [messages]);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, []);

  const handleSubmit = (event) => {
    event.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (onSend({ user: username, msg: trimmed })) setDraft('');
  };

  return (
    <div>
      <div className="flex items-start justify-between gap-4 border-b-2 border-nx-div pb-4">
        <div className="min-w-0">
          <h1 className="text-[26px] font-extrabold leading-tight sm:text-[30px]">
            Punter lounge
          </h1>
          <p className="mt-1.5 text-[13px] text-nx-muted">
            {STATUS_COPY[status] ?? STATUS_COPY.disconnected}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[10px] font-extrabold uppercase tracking-[.05em] text-nx-faint">
            Online
          </div>
          <div className="nx-num text-[24px] font-extrabold leading-none sm:text-[26px]">
            {online}
          </div>
        </div>
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-nx-faint">
        Messages are posted by whoever is connected. Nothing said here is verified advice —
        treat slip codes shared in the room as unvetted user content.
      </p>

      <div
        ref={scrollRef}
        className="nx-scroll mt-4 max-h-[52dvh] min-h-[340px] overflow-y-auto border border-nx-div px-3"
      >
        {messages.length === 0 ? (
          <p className="py-16 text-center text-[12px] text-nx-faint">
            No messages yet. Say hello to the lounge.
          </p>
        ) : (
          messages.map((message, index) => (
            <div
              key={message.id}
              className={`py-3 ${index > 0 ? 'border-t border-nx-div' : ''}`}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span
                  className={`truncate text-[12px] font-bold ${
                    message.user === username ? 'text-nx-accent' : 'text-nx-text'
                  }`}
                >
                  {message.user}
                </span>
                <span className="nx-num shrink-0 text-[11px] text-nx-faint">{message.time}</span>
              </div>
              <p className="mt-1 break-words text-[13px] leading-relaxed text-nx-muted">
                {message.msg}
              </p>
              {message.tag ? (
                <code className="nx-num mt-1.5 inline-block border border-nx-div px-1.5 py-0.5 text-[10px] font-bold text-nx-accent">
                  {message.tag}
                </code>
              ) : null}
            </div>
          ))
        )}
      </div>

      {notice ? (
        <p className="mt-2 text-[11px] text-nx-accent-hi">{notice}</p>
      ) : null}

      <form onSubmit={handleSubmit} className="mt-3 flex gap-2">
        <label className="sr-only" htmlFor="nx-composer">
          Message the punter lounge
        </label>
        <input
          id="nx-composer"
          type="text"
          value={draft}
          maxLength={MAX_MESSAGE_LENGTH}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={isOpen ? 'Message the lounge…' : 'Reconnecting…'}
          disabled={!isOpen}
          className="min-h-[44px] w-full min-w-0 flex-1 border border-nx-div bg-nx-surface px-3 text-[16px] text-nx-text placeholder:text-nx-faint disabled:opacity-50 sm:text-[13px]"
        />
        <button
          type="submit"
          disabled={!isOpen || !draft.trim()}
          className="min-h-[44px] shrink-0 bg-nx-accent px-4 text-[12px] font-extrabold uppercase tracking-[.05em] text-nx-bg disabled:cursor-not-allowed disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </div>
  );
}
