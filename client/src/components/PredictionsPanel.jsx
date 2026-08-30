import DataProvenanceNotice from './DataProvenanceNotice.jsx';
import PredictionCard from './PredictionCard.jsx';

export default function PredictionsPanel({ predictions, meta }) {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-white">Live Sports Predictive Slips</h1>
        <p className="text-sm text-[#8a96a3]">
          Upcoming football, basketball and volleyball fixtures, priced from live bookmaker
          markets and analysed against a fitted model.
        </p>
      </div>

      <DataProvenanceNotice
        live={meta.live}
        provider={meta.provider}
        fetchedAt={meta.fetchedAt}
        degraded={meta.degraded}
        className="mb-4"
      />

      <p className="mb-6 text-[11px] leading-relaxed text-[#8a96a3]">
        Slip codes are NexusBet references that decode back to the exact fixture and
        selection. They are not sportsbook booking codes and will not load a bet slip on
        Stake or elsewhere.
      </p>

      {predictions.length === 0 ? (
        <div className="rounded-xl border border-[#213743] bg-[#1a2c38] p-6 text-sm text-[#8a96a3]">
          No fixtures returned for today. This is normal out of season, or when the daily API
          quota is spent.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {predictions.map((slip) => (
            <PredictionCard key={`${slip.sport}:${slip.id}`} slip={slip} />
          ))}
        </div>
      )}
    </div>
  );
}
