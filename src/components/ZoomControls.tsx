import { ZOOM_MAX, ZOOM_MIN } from "@/hooks/use-world-canvas";
import { cn } from "@/lib/utils";

type Props = { zoom: number; onIn: () => void; onOut: () => void; onReset: () => void; className?: string; compact?: boolean };

/** Pixel-style + / − / fit stack for the map camera. */
export function ZoomControls({ zoom, onIn, onOut, onReset, className, compact }: Props) {
  const b = cn(
    "flex items-center justify-center border-2 border-border bg-card/95 font-mono text-foreground hover:border-accent hover:text-accent disabled:pointer-events-none disabled:opacity-40",
    compact ? "h-7 w-7 text-sm" : "h-8 w-8 text-base",
  );
  return (
    <div role="group" aria-label="Map zoom" className={cn("flex flex-col items-center gap-1", className)}>
      <button type="button" className={b} onClick={onIn} disabled={zoom >= ZOOM_MAX - 0.01} aria-label="Zoom in" title="Zoom in (+)">+</button>
      <span className="min-w-8 border-2 border-border bg-card/95 px-1 text-center text-[10px] leading-5 text-muted-foreground" aria-live="polite">
        {zoom.toFixed(1)}×
      </span>
      <button type="button" className={b} onClick={onOut} disabled={zoom <= ZOOM_MIN + 0.01} aria-label="Zoom out" title="Zoom out (−)">−</button>
      <button type="button" className={cn(b, "text-[10px]")} onClick={onReset} disabled={zoom <= ZOOM_MIN + 0.01} aria-label="Show whole map" title="Whole map (Esc)">FIT</button>
    </div>
  );
}
