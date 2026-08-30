import { Activity, Flame, MessageSquare } from 'lucide-react';

const TABS = [
  { id: 'predictions', label: 'Predictions Engine' },
  { id: 'tracker', label: 'AI Tracker', Icon: Flame, iconClass: 'text-orange-500' },
  { id: 'chat', label: 'Live Chat Room', Icon: MessageSquare, iconClass: 'text-blue-400' },
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
    <nav className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-4 border-b border-[#213743] bg-[#1a2c38] px-6 py-4">
      <div className="flex items-center space-x-2">
        <Activity className="h-7 w-7 animate-pulse text-[#00e701]" />
        <span className="text-xl font-black uppercase tracking-wider text-white">
          NexusBet <span className="text-[#00e701]">AI</span>
        </span>
      </div>

      <div className="flex rounded-lg border border-[#213743] bg-[#0f212e] p-1">
        {TABS.map(({ id, label, Icon, iconClass }) => (
          <button
            key={id}
            type="button"
            onClick={() => onTabChange(id)}
            aria-current={activeTab === id ? 'page' : undefined}
            className={`flex items-center space-x-1 rounded-md px-4 py-2 text-sm font-bold transition ${
              activeTab === id
                ? 'bg-[#213743] text-white shadow'
                : 'text-[#b1b6c0] hover:text-white'
            }`}
          >
            {Icon ? <Icon className={`h-4 w-4 ${iconClass}`} /> : null}
            <span>{label}</span>
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-[#213743] bg-[#0f212e] px-3 py-2">
        <span className={`h-2 w-2 rounded-full ${statusStyle.dot}`} />
        <span className={`text-xs font-bold uppercase tracking-wider ${statusStyle.label}`}>
          {statusLabel}
        </span>
      </div>
    </nav>
  );
}
