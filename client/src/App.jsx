import { useState } from 'react';
import { RefreshCw } from 'lucide-react';

import NavBar from './components/NavBar.jsx';
import PredictionsPanel from './components/PredictionsPanel.jsx';
import TrackerPanel from './components/TrackerPanel.jsx';
import ChatPanel from './components/ChatPanel.jsx';
import { useLoungeSocket } from './hooks/useLoungeSocket.js';
import { useSlipData } from './hooks/useSlipData.js';

const LOCAL_USERNAME = 'Me (Manager)';

function LoadingState() {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-[#213743] bg-[#1a2c38] p-6 text-sm text-[#8a96a3]">
      <RefreshCw className="h-4 w-4 animate-spin text-[#00e701]" />
      Loading engine data…
    </div>
  );
}

function ErrorState({ onRetry, message }) {
  return (
    <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6">
      <h2 className="mb-1 font-extrabold text-white">Engine unreachable</h2>
      <p className="mb-4 text-sm text-red-200/80">
        {message ?? 'Could not load slips from the Fastify engine.'} Start it with{' '}
        <code className="font-mono text-red-200">npm run dev:server</code> and retry.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-lg bg-[#00e701] px-4 py-2 text-sm font-black text-black transition hover:bg-[#00c900]"
      >
        Retry
      </button>
    </div>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState('predictions');
  const { predictions, tracker, meta, state, error, reload } = useSlipData();
  const { messages, online, status, notice, send } = useLoungeSocket();

  const renderPanel = () => {
    if (activeTab === 'chat') {
      return (
        <ChatPanel
          messages={messages}
          online={online}
          status={status}
          notice={notice}
          onSend={send}
          username={LOCAL_USERNAME}
        />
      );
    }

    if (state === 'loading') return <LoadingState />;
    if (state === 'error' || !tracker) return <ErrorState onRetry={reload} message={error} />;

    return activeTab === 'tracker' ? (
      <TrackerPanel tracker={tracker} meta={meta} />
    ) : (
      <PredictionsPanel predictions={predictions} meta={meta} />
    );
  };

  return (
    <div className="min-h-screen bg-[#0f212e] font-sans text-[#b1b6c0] antialiased">
      <NavBar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        status={status}
        online={online}
      />

      <main className="mx-auto max-w-6xl p-6">{renderPanel()}</main>

      <footer className="mx-auto max-w-6xl px-6 pb-10 text-xs leading-relaxed text-[#8a96a3]">
        NexusBet AI reads public fixture and odds data. It does not place bets and is not
        affiliated with any sportsbook. Displayed probabilities are bookmaker prices with the
        margin removed, not forecasts, and the win rate counts only picks this app recorded
        before kickoff. Betting risks real money and past outcomes never predict future ones.
        If gambling stops being fun, support is available at{' '}
        <a
          href="https://www.begambleaware.org/"
          target="_blank"
          rel="noreferrer noopener"
          className="text-[#00e701] underline underline-offset-2"
        >
          BeGambleAware
        </a>
        . 18+ only.
      </footer>
    </div>
  );
}
