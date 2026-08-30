import { Activity, Flame, MessageSquare } from 'lucide-react';

// Short labels on phones: the full ones wrap to three lines each and consume
// nearly half a 667px viewport before any content is visible.
const TABS = [
  { id: 'predictions', label: 'Predictions Engine', short: 'Slips' },
  { id: 'tracker', label: 'AI Tracker', short: 'Tracker', Icon: Flame, iconClass: 'text-orange-500' },
  { id: 'chat', label: 'Live Chat Room', short: 'Chat', Icon: MessageSquare, iconClass: 'text-blue-400' },
];

const STATUS_STYLES = {
  open: { dot: 'bg-[#00e701] animate-pulse', label: 'text-[#00e701]' },
  connecting: { dot: 'bg-amber-400 animate-pulse', label: 'text-amber-400' },
  disconnected: { dot: 'bg-red-500', label: 'text-red-400' },
};

export default function NavBar({ activeTab, onTabChange, status, online }) {
  const statusStyle = STATUS_STYLES[status] ?? STATUS_STYLES.disconnected;
  const statusLabel =
    status === 'open'
      ? `${online} online`
      : status === 'connecting'
        ? 'Connecting'
        : 'Offline';

  return (
    <nav className="sticky top-0 z-50 border-b border-[#213743] bg-[#1a2c38] px-4 py-3 sm:px-6 sm:py-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center space-x-2">
          <Activity className="h-6 w-6 shrink-0 animate-pulse text-[#00e701] sm:h-7 sm:w-7" />
          <span className="truncate text-lg font-black uppercase tracking-wider text-white sm:text-xl">
            NexusBet <span className="text-[#00e701]">AI</span>
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-2 rounded-lg border border-[#213743] bg-[#0f212e] px-2.5 py-1.5 sm:px-3 sm:py-2">
          <span className={`h-2 w-2 shrink-0 rounded-full ${statusStyle.dot}`} />
          <span className={`text-[10px] font-bold uppercase tracking-wider sm:text-xs ${statusStyle.label}`}>
            {statusLabel}
          </span>
        </div>
      </div>

      <div className="mt-3 flex rounded-lg border border-[#213743] bg-[#0f212e] p-1 sm:mt-4">
        {TABS.map(({ id, label, short, Icon, iconClass }) => (
          <button
            key={id}
            type="button"
            onClick={() => onTabChange(id)}
            aria-current={activeTab === id ? 'page' : undefined}
            aria-label={label}
            className={`flex min-h-[44px] flex-1 items-center justify-center space-x-1.5 whitespace-nowrap rounded-md px-2 py-2 text-sm font-bold transition sm:px-4 ${
              activeTab === id
                ? 'bg-[#213743] text-white shadow'
                : 'text-[#b1b6c0] hover:text-white'
            }`}
          >
            {Icon ? <Icon className={`h-4 w-4 shrink-0 ${iconClass}`} /> : null}
            <span className="sm:hidden">{short}</span>
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
