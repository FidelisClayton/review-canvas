// One stroke weight, one grid. Referenced with <Icon name="..." />.
export function IconSprite() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        <linearGradient id="spark-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#b56cf0" />
          <stop offset="1" stopColor="#6a22a8" />
        </linearGradient>
        <symbol id="i-spark" viewBox="0 0 16 16">
          <path d="M8 1l1.6 4.4L14 7l-4.4 1.6L8 13l-1.6-4.4L2 7l4.4-1.6z" fill="url(#spark-grad)" />
          <path d="M13 11l.6 1.4L15 13l-1.4.6L13 15l-.6-1.4L11 13l1.4-.6z" fill="url(#spark-grad)" />
        </symbol>
        <symbol id="i-plus" viewBox="0 0 16 16"><path d="M8 3v10M3 8h10" /></symbol>
        <symbol id="i-minus" viewBox="0 0 16 16"><path d="M3 8h10" /></symbol>
        <symbol id="i-fit" viewBox="0 0 16 16"><path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" /></symbol>
        <symbol id="i-chev" viewBox="0 0 16 16"><path d="M4 6l4 4 4-4" /></symbol>
        <symbol id="i-close" viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" /></symbol>
        <symbol id="i-cmt" viewBox="0 0 16 16"><path d="M8 3.5v9M3.5 8h9" /></symbol>
        <symbol id="i-trash" viewBox="0 0 16 16"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" /></symbol>
        <symbol id="i-course" viewBox="0 0 16 16"><path d="M2.5 3.5h11M2.5 8h11M2.5 12.5h7" /></symbol>
        <symbol id="i-send" viewBox="0 0 16 16"><path d="M2.5 8h9M8 4.5L11.5 8 8 11.5M13.5 3v10" /></symbol>
        <symbol id="i-arrow" viewBox="0 0 16 16"><path d="M3 8h10M9.5 4.5 13 8l-3.5 3.5" /></symbol>
        <symbol id="i-external" viewBox="0 0 16 16"><path d="M9.5 2.5h4v4M13.5 2.5 7.5 8.5M12 9.5v4h-9.5V4h4" /></symbol>
      </defs>
    </svg>
  );
}

export function Icon({ name, className = "icon" }: { name: string; className?: string }) {
  return (
    <svg className={className} aria-hidden="true">
      <use href={`#i-${name}`} />
    </svg>
  );
}
