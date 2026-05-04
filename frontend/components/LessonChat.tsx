"use client";

import { useEffect, useRef, useState } from "react";

import {
  sendLessonMessage,
  type ChatTurn,
  type Lesson,
} from "@/lib/api";
import { logger } from "@/lib/logger";

interface LessonChatProps {
  sessionId: string;
  lessonIndex: number;
  totalLessons: number;
  lesson: Lesson;
  initialHistory: ChatTurn[];
  onBack: () => void;
  /** Called whenever the chat transcript advances so the parent can keep its mirror in sync. */
  onHistoryChange?: (lessonIndex: number, history: ChatTurn[]) => void;
  /** Phase 3 will replace this with the real quiz handoff. */
  onReadyForQuiz?: (lessonIndex: number) => void;
}

export function LessonChat({
  sessionId,
  lessonIndex,
  totalLessons,
  lesson,
  initialHistory,
  onBack,
  onHistoryChange,
  onReadyForQuiz,
}: LessonChatProps) {
  const [history, setHistory] = useState<ChatTurn[]>(initialHistory);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inflightRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll on every history change so the latest reply is visible.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [history.length, sending]);

  useEffect(() => {
    inputRef.current?.focus();
    return () => {
      inflightRef.current?.abort();
    };
  }, []);

  async function handleSend() {
    const trimmed = input.trim();
    if (!trimmed || sending) return;
    inflightRef.current?.abort();
    const controller = new AbortController();
    inflightRef.current = controller;
    setError(null);
    setSending(true);

    // Optimistically append the user turn so the UI reflects the action
    // immediately. The server response replaces the whole history (it's the
    // source of truth) so this is harmless if the call fails.
    const optimistic: ChatTurn[] = [
      ...history,
      { role: "user", content: trimmed },
    ];
    setHistory(optimistic);
    setInput("");

    try {
      const response = await sendLessonMessage(
        sessionId,
        lessonIndex,
        trimmed,
        controller.signal,
      );
      if (controller.signal.aborted) return;

      if (response.status === "ok" && response.history) {
        setHistory(response.history);
        onHistoryChange?.(lessonIndex, response.history);
        return;
      }
      if (response.status === "invalid") {
        const msg =
          response.errors?.message ??
          response.errors?.lesson_index ??
          "That message was rejected. Try rephrasing.";
        logger.warn("LessonChat: invalid", response.errors);
        setError(msg);
        // Roll back the optimistic user turn.
        setHistory(history);
        setInput(trimmed);
        return;
      }
      // status === "error" → upstream Claude failed
      logger.error("LessonChat: upstream error", response.message);
      setError(response.message ?? "The tutor is unavailable. Try again.");
      setHistory(history);
      setInput(trimmed);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      logger.error("LessonChat: send failed", err);
      setError("We couldn't reach the server. Check your connection.");
      setHistory(history);
      setInput(trimmed);
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter to send, Shift+Enter for newline (chat-app convention).
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  }

  const isEmpty = history.length === 0;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col">
      {/* Header */}
      <div className="rounded-t-2xl border border-zinc-800 border-b-0 bg-zinc-950/70 p-5 backdrop-blur sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onBack}
            className="font-mono text-[11px] uppercase tracking-[0.25em] text-zinc-500 transition hover:text-zinc-200"
          >
            ← back to plan
          </button>
          <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-zinc-500">
            lesson {lessonIndex + 1} of {totalLessons} · {lesson.estimated_minutes} min
          </span>
        </div>
        <h2 className="mt-3 text-xl font-semibold text-zinc-100 sm:text-2xl">
          {lesson.title}
        </h2>
        <p className="mt-2 text-sm text-zinc-400">{lesson.summary}</p>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        data-testid="lesson-chat-history"
        className="flex h-[55vh] flex-col gap-4 overflow-y-auto border-x border-zinc-800 bg-zinc-950/40 p-5 backdrop-blur sm:p-6"
      >
        {isEmpty && !sending && (
          <div className="my-auto text-center text-sm text-zinc-500">
            <p>Say hi to start the lesson.</p>
            <p className="mt-1 text-xs text-zinc-600">
              Tip: tell the tutor what you already know about{" "}
              <span className="text-zinc-400">{lesson.title}</span> — they&apos;ll
              calibrate from there.
            </p>
          </div>
        )}

        {history.map((turn, idx) => (
          <ChatBubble key={idx} turn={turn} />
        ))}

        {sending && (
          <div className="flex justify-start">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 px-4 py-3 text-sm text-zinc-400">
              <span className="inline-flex gap-1">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-400" />
                <span
                  className="h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-400"
                  style={{ animationDelay: "0.15s" }}
                />
                <span
                  className="h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-400"
                  style={{ animationDelay: "0.3s" }}
                />
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="rounded-b-2xl border border-zinc-800 border-t-0 bg-zinc-950/70 p-4 backdrop-blur sm:p-5">
        {error && (
          <p
            role="alert"
            className="mb-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300"
          >
            {error}
          </p>
        )}
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your reply… (Shift+Enter for newline)"
            rows={2}
            disabled={sending}
            data-testid="lesson-chat-input"
            className="flex-1 resize-none rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-400/60 focus:outline-none focus:ring-1 focus:ring-emerald-400/30 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!input.trim() || sending}
            data-testid="lesson-chat-send"
            className="rounded-xl border border-emerald-400/70 bg-emerald-400/10 px-4 py-3 text-sm font-medium text-emerald-100 transition hover:bg-emerald-400/20 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:bg-transparent disabled:text-zinc-600"
          >
            Send
          </button>
        </div>

        <div className="mt-3 flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-zinc-600">
            {history.length > 0
              ? `${history.length} turn${history.length === 1 ? "" : "s"}`
              : "ready"}
          </span>
          <button
            type="button"
            onClick={() => onReadyForQuiz?.(lessonIndex)}
            disabled={history.length < 2}
            title={
              history.length < 2
                ? "Chat with the tutor before taking the quiz"
                : "Quiz coming in Phase 3"
            }
            className="rounded-lg border border-zinc-800 px-3 py-1.5 text-xs text-zinc-400 transition hover:border-emerald-400/60 hover:text-emerald-200 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-zinc-800 disabled:hover:text-zinc-400"
          >
            I&apos;m done — quiz me
          </button>
        </div>
      </div>
    </div>
  );
}

function ChatBubble({ turn }: { turn: ChatTurn }) {
  const isUser = turn.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        data-role={turn.role}
        className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
          isUser
            ? "border border-emerald-400/40 bg-emerald-400/10 text-emerald-50"
            : "border border-zinc-800 bg-zinc-900/70 text-zinc-100"
        }`}
      >
        {turn.content}
      </div>
    </div>
  );
}
