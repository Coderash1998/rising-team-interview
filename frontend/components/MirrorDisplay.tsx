"use client";

interface MirrorDisplayProps {
  text: string;
  placeholder: string;
}

/**
 * Center display: large shimmering primary text with a blinking cursor.
 * The wrapper uses `overflow-visible` and generous vertical padding so glyph
 * descenders (g, p, y) and the drop-shadow glow are not clipped.
 */
export function MirrorDisplay({ text, placeholder }: MirrorDisplayProps) {
  const isEmpty = text.length === 0;
  const display = isEmpty ? placeholder : text;

  return (
    <div className="flex w-full flex-col items-center gap-6 px-6 text-center">
      <h1
        data-testid="mirror-primary"
        data-empty={isEmpty}
        className={`shimmer-text cursor-blink max-w-5xl break-words py-4 text-4xl font-semibold leading-[1.25] sm:text-5xl md:text-6xl ${
          isEmpty ? "opacity-70" : ""
        }`}
      >
        {display}
      </h1>
    </div>
  );
}
