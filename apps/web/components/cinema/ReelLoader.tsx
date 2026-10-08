/** A spinning film reel, used wherever the room is waiting on something. */
export function ReelLoader({ className = 'size-14' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden className={`${className} animate-[reel_2.4s_linear_infinite] text-marquee`}>
      <circle cx="32" cy="32" r="29" fill="none" stroke="currentColor" strokeWidth="3" />
      <circle cx="32" cy="32" r="5" fill="currentColor" />
      {[0, 60, 120, 180, 240, 300].map((deg) => (
        <circle
          key={deg}
          cx={32 + 16 * Math.cos((deg * Math.PI) / 180)}
          cy={32 + 16 * Math.sin((deg * Math.PI) / 180)}
          r="6.5"
          fill="currentColor"
          opacity="0.85"
        />
      ))}
    </svg>
  );
}
