import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Send, TriangleAlert } from 'lucide-react';

const MAX_MESSAGE_LENGTH = 500;

const STATUS_COPY = {
  open: 'Connected to the lounge engine.',
  connecting: 'Connecting to the lounge engine…',
  disconnected: 'Disconnected — retrying automatically.',
};

function MessageBubble({ message, isOwn }) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        isOwn ? 'border-[#00e701]/25 bg-[#00e701]/5' : 'border-[#213743] bg-[#0f212e]'
      }`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-black text-white">{message.user}</span>
        <span className="shrink-0 text-[10px] text-[#8a96a3]">{message.time}</span>
      </div>
      <p className="mt-1 break-words text-sm text-[#e2e8f0]">{message.msg}</p>
      {message.tag ? (
        <code className="mt-2 inline-block rounded border border-[#213743] bg-[#1a2c38] px-2 py-0.5 font-mono text-[10px] font-bold text-[#00e701]">
          {message.tag}
        </code>
      ) : null}
    </div>
  );
}

export default function ChatPanel({ messages, online, status, notice, onSend, username }) {
  const [draft, setDraft] = useState('');
  const scrollRef = useRef(null);

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

  const isOpen = status === 'open';

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
      <aside className="rounded-xl border border-[#213743] bg-[#1a2c38] p-3 sm:p-4 lg:col-span-1 lg:space-y-4">
        {/* Compact header row on phones; the full stack returns at lg. */}
        <div className="flex items-center justify-between gap-3 lg:block">
          <div className="min-w-0">
            <h3 className="text-md font-extrabold text-white lg:mb-2">Punter Lounge</h3>
            <p className="hidden text-xs text-[#8a96a3] lg:block">
              Real-time synchronization engine connecting users globally over a single
              WebSocket room.
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2 rounded-lg border border-[#213743] bg-[#0f212e] px-3 py-2 lg:mt-4 lg:w-full lg:block lg:px-3 lg:py-3">
            <div className="hidden text-[10px] font-bold uppercase tracking-wider text-[#8a96a3] lg:mb-1 lg:block">
              Users Online
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                  isOpen ? 'animate-pulse bg-[#00e701]' : 'bg-[#8a96a3]'
                }`}
              />
              <span className="text-lg font-black text-white lg:text-2xl">{online}</span>
              <span className="text-[10px] uppercase text-[#8a96a3] lg:hidden">online</span>
            </div>
          </div>
        </div>

        <p className="mt-2 text-[11px] leading-relaxed text-[#8a96a3] lg:mt-0">
          {STATUS_COPY[status] ?? STATUS_COPY.disconnected}
        </p>

        <p className="mt-2 hidden rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-[11px] leading-relaxed text-amber-200/80 lg:mt-0 lg:block">
          Messages here are posted by whoever is connected. Nothing said in the room is
          verified advice — treat slip codes as unvetted user content.
        </p>
      </aside>

      <div className="flex h-[65dvh] min-h-[380px] flex-col overflow-hidden rounded-xl border border-[#213743] bg-[#1a2c38] lg:col-span-3 lg:h-[60vh]">
        <div ref={scrollRef} className="nexus-scroll flex-1 space-y-4 overflow-y-auto p-4">
          {messages.length === 0 ? (
            <p className="pt-8 text-center text-sm text-[#8a96a3]">
              No messages yet. Say hello to the lounge.
            </p>
          ) : (
            messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                isOwn={message.user === username}
              />
            ))
          )}
        </div>

        {notice ? (
          <div className="flex items-center gap-2 border-t border-amber-500/25 bg-amber-500/10 px-4 py-2 text-xs text-amber-200">
            <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
            <span>{notice}</span>
          </div>
        ) : null}

        <form
          onSubmit={handleSubmit}
          className="flex items-center gap-2 border-t border-[#213743] bg-[#0f212e] p-3 sm:gap-3 sm:p-4"
        >
          <input
            type="text"
            value={draft}
            maxLength={MAX_MESSAGE_LENGTH}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={isOpen ? 'Message the lounge…' : 'Reconnecting…'}
            aria-label="Message the punter lounge"
            disabled={!isOpen}
            className="min-h-[44px] w-full min-w-0 flex-1 rounded-lg border border-[#213743] bg-[#1a2c38] px-3 py-2.5 text-base text-white placeholder:text-[#8a96a3] focus:border-[#00e701]/50 focus:outline-none disabled:opacity-50 sm:px-4 sm:text-sm"
          />
          <button
            type="submit"
            disabled={!isOpen || !draft.trim()}
            className="flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-lg bg-[#00e701] px-3 py-2.5 text-sm font-black text-black transition hover:bg-[#00c900] disabled:cursor-not-allowed disabled:opacity-40 sm:px-4"
          >
            <Send className="h-4 w-4" />
            <span className="hidden sm:inline">Send</span>
          </button>
        </form>
      </div>
    </div>
  );
}
