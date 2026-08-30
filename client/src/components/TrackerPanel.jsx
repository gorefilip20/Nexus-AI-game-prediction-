import { CheckCircle, Flame, ShieldCheck, TrendingUp, XCircle } from 'lucide-react';
import SampleDataNotice from './SampleDataNotice.jsx';

function StatTile({ Icon, iconClass, valueClass, label, value, withDivider }) {
  return (
    <div className={withDivider ? 'pr-4 md:border-r md:border-[#2f4553]/40' : ''}>
      <div className="mb-1 text-xs font-bold uppercase tracking-wider text-[#8a96a3]">
        {label}
      </div>
      <div
        className={`flex items-center justify-center space-x-2 text-4xl font-black md:justify-start ${valueClass}`}
      >
        <Icon className={`h-8 w-8 ${iconClass}`} />
        <span>{value}</span>
      </div>
    </div>
  );
}

function SettlementBadge({ status }) {
  const isWin = status === 'WIN';
  const Icon = isWin ? CheckCircle : XCircle;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-black ${
        isWin
          ? 'border border-[#00e701]/20 bg-[#00e701]/10 text-[#00e701]'
          : 'border border-red-500/20 bg-red-500/10 text-red-400'
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {isWin ? 'WIN' : 'LOSS'}
    </span>
  );
}

export default function TrackerPanel({ tracker }) {
  const { overallWinRate, currentStreak, totalBetsAnalyzed, pastResults } = tracker;

  return (
    <div className="space-y-6">
      <SampleDataNotice />

      <div className="grid grid-cols-1 gap-6 rounded-xl border border-[#2f4553] bg-gradient-to-r from-[#1a2c38] to-[#213743] p-6 text-center md:grid-cols-3 md:text-left">
        <StatTile
          Icon={ShieldCheck}
          iconClass="text-[#00e701]"
          valueClass="text-[#00e701]"
          label="Sample Win Rate"
          value={overallWinRate}
          withDivider
        />
        <StatTile
          Icon={Flame}
          iconClass="text-orange-500"
          valueClass="text-orange-500"
          label="Current Run Streak"
          value={currentStreak}
          withDivider
        />
        <StatTile
          Icon={TrendingUp}
          iconClass="text-blue-400"
          valueClass="text-white"
          label="Rows In Sample"
          value={totalBetsAnalyzed}
        />
      </div>

      <p className="text-xs text-[#8a96a3]">
        These headline figures are computed from the {pastResults.length} demo rows in the
        table below, so the summary always matches the audit. A real deployment should
        derive them from settled, independently verifiable results.
      </p>

      <div className="overflow-hidden rounded-xl border border-[#213743] bg-[#1a2c38]">
        <div className="border-b border-[#213743] bg-[#213743]/30 px-6 py-4">
          <h2 className="text-lg font-extrabold text-white">Historic Multi-League Set Audit</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-[#213743] bg-[#0f212e] text-xs font-bold uppercase text-[#8a96a3]">
                <th scope="col" className="p-4">Fixture / League</th>
                <th scope="col" className="p-4">Target Market Pick</th>
                <th scope="col" className="p-4">Book Odds</th>
                <th scope="col" className="p-4 text-center">Settlement Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#213743]">
              {pastResults.map((log) => (
                <tr key={log.id} className="text-sm transition hover:bg-[#213743]/20">
                  <td className="p-4">
                    <span className="block font-bold text-white">{log.match}</span>
                    <span className="text-xs text-[#8a96a3]">
                      {log.sport} • {log.league}
                    </span>
                  </td>
                  <td className="p-4 font-semibold text-[#e2e8f0]">{log.pick}</td>
                  <td className="p-4 font-mono text-[#00e701]">{log.odds}</td>
                  <td className="p-4 text-center">
                    <SettlementBadge status={log.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
