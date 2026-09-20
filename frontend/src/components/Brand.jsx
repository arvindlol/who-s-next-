export default function Brand() {
  return (
    <span className="brand">
      <svg viewBox="0 0 28 28" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id="g" x1="0" y1="0" x2="28" y2="28">
            <stop stopColor="#cfe9ff" /><stop offset="1" stopColor="#16c1b0" />
          </linearGradient>
        </defs>
        <path d="M4 7h20M8 14h12M12 21h4" stroke="url(#g)" strokeWidth="3" strokeLinecap="round" />
      </svg>
      Who’s Next
    </span>
  )
}
