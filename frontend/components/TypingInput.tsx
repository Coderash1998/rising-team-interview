"use client";

import { useEffect, useRef } from "react";
import { logger } from "@/lib/logger";

interface TypingInputProps {
  value: string;
  onChange: (next: string) => void;
}

/**
 * Bottom-anchored input. Auto-focuses on mount and refocuses on Cmd/Ctrl+K.
 * Uses an animated conic-gradient flowing-line border defined in globals.css
 * (`.flow-border`) which rotates around the input perimeter.
 */
export function TypingInput({ value, onChange }: TypingInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    logger.info("TypingInput mounted; focused input");
  }, []);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      const isCmdK =
        (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
      if (isCmdK) {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        logger.info("Cmd/Ctrl+K shortcut: refocused input");
      }
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  return (
    <div className="flex w-full flex-col items-center gap-2 px-4 pb-8 sm:pb-10">
      <div className="w-full max-w-3xl">
        <label
          htmlFor="mirror-input"
          className="mb-2 block text-center font-mono text-[11px] uppercase tracking-[0.3em] text-zinc-500"
        >
          input <span className="opacity-60">— press ⌘K for actions</span>
        </label>
        <div className="flow-border px-5 py-4">
          <input
            id="mirror-input"
            ref={inputRef}
            data-testid="typing-input"
            type="text"
            value={value}
            onChange={(event) => {
              const next = event.target.value;
              logger.debug("TypingInput change", { length: next.length });
              onChange(next);
            }}
            placeholder="type anything…"
            autoComplete="off"
            spellCheck={false}
            className="w-full bg-transparent font-mono text-base tracking-tight text-zinc-100 caret-terminal-green placeholder:text-zinc-600 focus:outline-none sm:text-lg"
          />
        </div>
      </div>
    </div>
  );
}
