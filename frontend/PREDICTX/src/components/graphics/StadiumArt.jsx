// Decorative floodlit pitch drawn in perspective. Purely visual.
export default function StadiumArt({ className = '' }) {
  return (
    <svg viewBox="0 0 1200 320" preserveAspectRatio="xMidYMax slice" className={`pointer-events-none ${className}`} aria-hidden="true">
      <defs>
        <linearGradient id="sa-line" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#B4FFA6" stopOpacity="0" />
          <stop offset=".3" stopColor="#B4FFA6" />
          <stop offset=".7" stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* pitch */}
      <g fill="none" stroke="url(#sa-line)" strokeWidth="1.5" opacity=".55">
        <path d="M240 150 H960 L1180 310 H20 Z" />
        <path d="M600 150 V310" />
        <ellipse cx="600" cy="222" rx="125" ry="42" />
        <path d="M205 176 H320 L270 268 H78" />
        <path d="M995 176 H880 L930 268 H1122" />
      </g>
      <ellipse className="draw-line" pathLength="1" cx="600" cy="222" rx="125" ry="42" fill="none" stroke="#39FF14" strokeWidth="2" />
      <circle cx="600" cy="222" r="3" fill="#39FF14" />
    </svg>
  );
}
