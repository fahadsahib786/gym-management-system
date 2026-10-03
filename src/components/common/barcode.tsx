import { code128Widths } from "@/lib/barcode";

/**
 * Code 128 barcode as crisp SVG at a physical size. `moduleMm` is the narrowest bar: 0.254 mm (10 mil) is a
 * whole number of printer dots at 300 and 600 dpi and scans well with any USB scanner. A quiet zone of 10
 * modules is kept on both sides.
 */
export function Barcode({
  value,
  heightMm = 10,
  moduleMm = 0.254,
  className,
}: {
  value: string;
  heightMm?: number;
  moduleMm?: number;
  className?: string;
}) {
  const quiet = 10;
  const widths = code128Widths(value);
  const total = widths.reduce((a, b) => a + b, 0) + quiet * 2;
  const bars: { x: number; w: number }[] = [];
  let x = quiet;
  widths.forEach((w, i) => {
    if (i % 2 === 0) bars.push({ x, w });
    x += w;
  });
  return (
    <svg
      role="img"
      aria-label={`Barcode ${value}`}
      viewBox={`0 0 ${total} 10`}
      preserveAspectRatio="none"
      shapeRendering="crispEdges"
      style={{ width: `${total * moduleMm}mm`, height: `${heightMm}mm` }}
      className={className}
    >
      <rect width={total} height={10} fill="#fff" />
      {bars.map((b) => (
        <rect key={b.x} x={b.x} width={b.w} height={10} fill="#000" />
      ))}
    </svg>
  );
}
