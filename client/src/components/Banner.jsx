/**
 * The one banner shown above the board.
 *
 * Exactly one appears at a time, in priority order — stale, then sample, then
 * live. Stacking them would bury the message that matters. The accent left
 * border marks the two states the reader has to act on; the live state gets a
 * plain border because "working normally" should not shout.
 */
export default function Banner({ tone = 'plain', title, children, className = '' }) {
  const accent = tone === 'accent';

  return (
    <div
      role="status"
      className={`border border-nx-div px-3.5 py-3 sm:px-4 ${
        accent ? 'border-l-2 border-l-nx-accent-hi' : ''
      } ${className}`}
    >
      <p className="text-[12px] leading-relaxed text-nx-muted">
        {title ? <span className="font-bold text-nx-text">{title}</span> : null}{' '}
        {children}
      </p>
    </div>
  );
}
