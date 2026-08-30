import { TriangleAlert } from 'lucide-react';

/**
 * The slips, odds and settlement history in this build are seeded sample rows,
 * not model output or audited results. Say so on screen rather than letting the
 * "AI verified" framing imply a track record the app cannot evidence.
 */
export default function SampleDataNotice({ className = '' }) {
  return (
    <div
      className={`flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 ${className}`}
    >
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
      <p className="text-xs leading-relaxed text-amber-200/90">
        <span className="font-bold text-amber-300">Sample data.</span> The fixtures,
        probabilities, odds and settlement history below are demo content for this
        build — not model predictions and not a record of settled wagers. Wire the
        engine to a real data source before presenting any of it as fact. Betting
        carries real financial risk; no prediction is verified.
      </p>
    </div>
  );
}
