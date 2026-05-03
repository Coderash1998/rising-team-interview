/**
 * Decorative scanline overlay layered on top of the dot grid in globals.css.
 * Pure CSS, no JS state — safe to render server-side.
 */
export function GridBackground() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 opacity-30 [background:repeating-linear-gradient(0deg,rgba(57,255,20,0.04)_0px,rgba(57,255,20,0.04)_1px,transparent_1px,transparent_3px)]"
    />
  );
}
