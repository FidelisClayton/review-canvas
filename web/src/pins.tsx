// Every control has its own punch pattern, like a real orienteering control punch.
const PATTERNS = [0b101010101, 0b110011011, 0b011101110, 0b100111001, 0b111000111, 0b010111010, 0b101101101, 0b001111100, 0b110101011, 0b011010110, 0b111101111, 0b100010001, 0b010101010];

export function pinDots(ctl: string): { cx: number; cy: number }[] {
  const n = parseInt(ctl, 10) || 0;
  const bits = PATTERNS[n % PATTERNS.length]!;
  const dots: { cx: number; cy: number }[] = [];
  for (let i = 0; i < 9; i++) if (bits & (1 << i)) dots.push({ cx: 3.5 + (i % 3) * 5.5, cy: 3.5 + Math.floor(i / 3) * 5.5 });
  return dots;
}

export function Pins({ ctl, size = 18, color = "#7b2cbf" }: { ctl: string; size?: number; color?: string }) {
  return (
    <svg viewBox="0 0 18 18" width={size} height={size} fill={color} aria-hidden="true">
      {pinDots(ctl).map((d, i) => (
        <circle key={i} cx={d.cx} cy={d.cy} r={1.7} />
      ))}
    </svg>
  );
}
