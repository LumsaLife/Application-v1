/**
 * The Lumsa lotus.
 *
 * Eight petals radiating from a centre — the outer pair swept wide, the inner
 * ones lifting. Drawn as strokes rather than fills so it reads as light rather
 * than as a solid shape, and so it inherits the gold token in both themes.
 */
export function Logo({
  size = 32,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <g
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* Centre petal */}
        <path d="M24 8c3.6 5 5.4 10 5.4 15.4 0 5-1.8 9.4-5.4 13-3.6-3.6-5.4-8-5.4-13C18.6 18 20.4 13 24 8z" />
        {/* Inner pair */}
        <path d="M24 36.4c-4.3-1.6-7.6-4.2-9.9-7.7-2.3-3.6-3.3-7.6-3-12 4.2 1.2 7.6 3.5 10 6.9 2.4 3.4 3.4 7.7 2.9 12.8z" />
        <path d="M24 36.4c4.3-1.6 7.6-4.2 9.9-7.7 2.3-3.6 3.3-7.6 3-12-4.2 1.2-7.6 3.5-10 6.9-2.4 3.4-3.4 7.7-2.9 12.8z" />
        {/* Outer pair, swept wide */}
        <path d="M24 36.8c-5.6.4-10.2-.8-13.8-3.6-3.6-2.8-5.8-6.6-6.6-11.4 4.8-.4 9 .8 12.6 3.4 3.6 2.6 6.2 6.5 7.8 11.6z" />
        <path d="M24 36.8c5.6.4 10.2-.8 13.8-3.6 3.6-2.8 5.8-6.6 6.6-11.4-4.8-.4-9 .8-12.6 3.4-3.6 2.6-6.2 6.5-7.8 11.6z" />
      </g>
      {/* The light at the centre */}
      <circle cx="24" cy="37.5" r="1.9" fill="currentColor" opacity="0.9" />
    </svg>
  );
}

/** Logo plus wordmark, for headers and the login screen. */
export function Wordmark({ size = 28 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2.5 text-gold">
      <Logo size={size} />
      <span
        className="font-display tracking-[0.02em] text-text"
        style={{ fontSize: size * 0.72 }}
      >
        Lumsa
      </span>
    </span>
  );
}
