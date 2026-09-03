import { useState } from 'react';

import NavBar from './components/NavBar.jsx';
import PredictionsPanel from './components/PredictionsPanel.jsx';
import TrackerPanel from './components/TrackerPanel.jsx';
import ChatPanel from './components/ChatPanel.jsx';
import SearchResults from './components/SearchResults.jsx';
import { useLoungeSocket } from './hooks/useLoungeSocket.js';
import { useSlipData } from './hooks/useSlipData.js';
import { useFixtureSearch } from './hooks/useFixtureSearch.js';

const LOCAL_USERNAME = 'Me (Manager)';

export default function App() {
  const [activeTab, setActiveTab] = useState('predictions');
  const { predictions, tracker, meta, state, error, reload } = useSlipData();
  const { messages, online, status, notice, send } = useLoungeSocket();
  const search = useFixtureSearch();

  // A live search takes over the main area: results span every sport, so scoping
  // them to whichever tab is open would hide most of them.
  const searchActive = search.query.trim().length >= 2;

  const renderPanel = () => {
    if (searchActive) {
      return (
        <SearchResults
          query={search.query}
          state={search.state}
          response={search.response}
          error={search.error}
        />
      );
    }

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

    if (activeTab === 'tracker') {
      if (state === 'loading' || !tracker) {
        return <p className="text-[12px] text-nx-faint">Loading the ledger…</p>;
      }
      return <TrackerPanel tracker={tracker} meta={meta} />;
    }

    return (
      <PredictionsPanel
        predictions={predictions}
        meta={meta}
        state={state}
        error={error}
        onRetry={reload}
      />
    );
  };

  return (
    <div className="flex min-h-screen flex-col bg-nx-bg text-nx-text">
      <NavBar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        status={status}
        searchActive={searchActive}
        query={search.query}
        onQueryChange={search.setQuery}
        sport={search.sport}
        onSportChange={search.setSport}
        days={search.days}
        onDaysChange={search.setDays}
        onClearSearch={search.clear}
      />

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        {renderPanel()}
      </main>

      <footer className="border-t-2 border-nx-div px-4 py-6 sm:px-6">
        <div className="mx-auto max-w-5xl">
          <p className="max-w-3xl text-[11px] leading-relaxed text-nx-muted">
            NexusBet AI reads public fixture and odds data. It places no bets and is not
            affiliated with any sportsbook. Displayed probabilities are bookmaker prices with
            the margin removed, not forecasts, and the win rate counts only picks this app
            recorded before kickoff. Betting risks real money and past outcomes never predict
            future ones.
          </p>
          <p className="mt-3 text-[11px] leading-relaxed text-nx-muted">
            If gambling stops being fun, support is available at{' '}
            <a
              href="https://www.begambleaware.org/"
              target="_blank"
              rel="noreferrer noopener"
              className="font-bold text-nx-accent-hi underline underline-offset-2 hover:text-nx-accent"
            >
              BeGambleAware
            </a>
            . <span className="font-bold text-nx-text">18+ only.</span>
          </p>
        </div>
      </footer>
    </div>
  );
}
