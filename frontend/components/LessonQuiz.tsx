"use client";

import { useEffect, useRef, useState } from "react";

import {
  generateLessonQuiz,
  submitLessonQuiz,
  type Lesson,
  type QuizPublic,
  type QuizQuestionResult,
  type QuizScoreResponse,
} from "@/lib/api";
import { logger } from "@/lib/logger";

interface LessonQuizProps {
  sessionId: string;
  lessonIndex: number;
  totalLessons: number;
  lesson: Lesson;
  onBack: () => void;
  /** Called after submission so the parent can mirror updated quiz_progress. */
  onProgressChange?: (
    lessonIndex: number,
    progress: { passed: boolean; best_score_pct: number; attempts: number },
  ) => void;
  /** Called when the user wants to advance after passing — typically picks the next lesson. */
  onAdvance?: () => void;
}

type Phase = "loading" | "taking" | "scoring" | "result" | "error";

const PASS_THRESHOLD = 80;

export function LessonQuiz({
  sessionId,
  lessonIndex,
  totalLessons,
  lesson,
  onBack,
  onProgressChange,
  onAdvance,
}: LessonQuizProps) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [quiz, setQuiz] = useState<QuizPublic | null>(null);
  const [answers, setAnswers] = useState<(number | null)[]>([]);
  const [result, setResult] = useState<QuizScoreResponse | null>(null);

  const inflightRef = useRef<AbortController | null>(null);

  useEffect(() => {
    fetchQuiz();
    return () => {
      inflightRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, lessonIndex]);

  async function fetchQuiz() {
    inflightRef.current?.abort();
    const controller = new AbortController();
    inflightRef.current = controller;
    setPhase("loading");
    setError(null);
    setResult(null);
    try {
      const response = await generateLessonQuiz(
        sessionId,
        lessonIndex,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (response.status === "ok" && response.quiz) {
        setQuiz(response.quiz);
        setAnswers(new Array(response.quiz.questions.length).fill(null));
        setPhase("taking");
        return;
      }
      const msg =
        response.message ??
        response.errors?.lesson_index ??
        response.errors?.quiz ??
        "Couldn't generate a quiz for this lesson.";
      logger.error("LessonQuiz: generate failed", response);
      setError(msg);
      setPhase("error");
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      logger.error("LessonQuiz: generate threw", err);
      setError("We couldn't reach the server. Check your connection.");
      setPhase("error");
    }
  }

  function selectOption(qIdx: number, optIdx: number) {
    setAnswers((prev) => {
      const next = [...prev];
      next[qIdx] = optIdx;
      return next;
    });
  }

  const allAnswered = answers.every((a) => a !== null);

  async function submit() {
    if (!quiz || !allAnswered) return;
    inflightRef.current?.abort();
    const controller = new AbortController();
    inflightRef.current = controller;
    setPhase("scoring");
    setError(null);
    try {
      const response = await submitLessonQuiz(
        sessionId,
        lessonIndex,
        answers as number[],
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (response.status === "ok" && response.results && response.progress) {
        setResult(response);
        setPhase("result");
        onProgressChange?.(lessonIndex, response.progress);
        return;
      }
      const msg =
        response.message ??
        response.errors?.answers ??
        response.errors?.quiz ??
        "Couldn't score your quiz.";
      logger.error("LessonQuiz: submit failed", response);
      setError(msg);
      setPhase("taking");
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      logger.error("LessonQuiz: submit threw", err);
      setError("We couldn't reach the server. Check your connection.");
      setPhase("taking");
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <header className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-5 backdrop-blur sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onBack}
            className="font-mono text-[11px] uppercase tracking-[0.25em] text-zinc-500 transition hover:text-zinc-200"
          >
            ← back to plan
          </button>
          <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-zinc-500">
            quiz · lesson {lessonIndex + 1} of {totalLessons}
          </span>
        </div>
        <h2 className="mt-3 text-xl font-semibold text-zinc-100 sm:text-2xl">
          {lesson.title}
        </h2>
        <p className="mt-2 text-xs text-zinc-500">
          5 questions · pass with {PASS_THRESHOLD}% to unlock the next lesson
        </p>
      </header>

      {phase === "loading" && (
        <div
          data-testid="quiz-loading"
          className="rounded-2xl border border-zinc-800 bg-zinc-950/40 p-10 text-center font-mono text-xs uppercase tracking-[0.25em] text-zinc-500 backdrop-blur"
        >
          Building your quiz…
        </div>
      )}

      {phase === "error" && (
        <div
          role="alert"
          className="rounded-2xl border border-red-500/40 bg-red-500/10 p-6 text-sm text-red-200 backdrop-blur"
        >
          <p>{error}</p>
          <button
            type="button"
            onClick={fetchQuiz}
            className="mt-4 rounded-lg border border-red-400/40 bg-red-400/10 px-4 py-2 text-xs text-red-100 transition hover:bg-red-400/20"
          >
            Try again
          </button>
        </div>
      )}

      {(phase === "taking" || phase === "scoring") && quiz && (
        <>
          <ol className="space-y-4" data-testid="quiz-questions">
            {quiz.questions.map((q, qIdx) => (
              <QuestionCard
                key={qIdx}
                index={qIdx}
                question={q.question}
                options={q.options}
                selectedIndex={answers[qIdx]}
                disabled={phase === "scoring"}
                onSelect={(opt) => selectOption(qIdx, opt)}
              />
            ))}
          </ol>

          {error && (
            <p
              role="alert"
              className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300"
            >
              {error}
            </p>
          )}

          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-zinc-500">
              {answers.filter((a) => a !== null).length}/{answers.length} answered
            </span>
            <button
              type="button"
              onClick={submit}
              disabled={!allAnswered || phase === "scoring"}
              data-testid="quiz-submit"
              className="rounded-xl border border-emerald-400/70 bg-emerald-400/10 px-5 py-2.5 text-sm font-medium text-emerald-100 transition hover:bg-emerald-400/20 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:bg-transparent disabled:text-zinc-600"
            >
              {phase === "scoring" ? "Scoring…" : "Submit quiz"}
            </button>
          </div>
        </>
      )}

      {phase === "result" && result && quiz && (
        <ResultView
          quiz={quiz}
          result={result}
          isLastLesson={lessonIndex === totalLessons - 1}
          onRetake={fetchQuiz}
          onAdvance={onAdvance}
          onBack={onBack}
        />
      )}
    </div>
  );
}

function QuestionCard({
  index,
  question,
  options,
  selectedIndex,
  disabled,
  onSelect,
}: {
  index: number;
  question: string;
  options: string[];
  selectedIndex: number | null;
  disabled: boolean;
  onSelect: (optIdx: number) => void;
}) {
  return (
    <li
      data-testid={`quiz-question-${index}`}
      className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5 backdrop-blur sm:p-6"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full border border-emerald-400/40 bg-emerald-400/10 font-mono text-xs font-semibold text-emerald-200">
          {index + 1}
        </span>
        <p className="text-base text-zinc-100 sm:text-lg">{question}</p>
      </div>

      <div className="mt-4 space-y-2 sm:pl-10">
        {options.map((opt, optIdx) => {
          const checked = selectedIndex === optIdx;
          return (
            <label
              key={optIdx}
              className={`flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 transition ${
                checked
                  ? "border-emerald-400/70 bg-emerald-400/10 shadow-[0_0_18px_rgba(52,211,153,0.18)]"
                  : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-600"
              } ${disabled ? "pointer-events-none opacity-60" : ""}`}
            >
              <input
                type="radio"
                name={`q-${index}`}
                checked={checked}
                onChange={() => onSelect(optIdx)}
                disabled={disabled}
                className="mt-1 h-4 w-4 accent-emerald-400"
              />
              <span className="text-sm text-zinc-200">{opt}</span>
            </label>
          );
        })}
      </div>
    </li>
  );
}

function ResultView({
  quiz,
  result,
  isLastLesson,
  onRetake,
  onAdvance,
  onBack,
}: {
  quiz: QuizPublic;
  result: QuizScoreResponse;
  isLastLesson: boolean;
  onRetake: () => void;
  onAdvance?: () => void;
  onBack: () => void;
}) {
  const passed = !!result.passed;
  const scorePct = result.score_pct ?? 0;
  const correct = result.correct_count ?? 0;
  const total = result.total ?? 0;
  const results = result.results ?? [];
  const progress = result.progress;

  return (
    <>
      <div
        data-testid="quiz-result-summary"
        className={`rounded-2xl border p-6 backdrop-blur sm:p-8 ${
          passed
            ? "border-emerald-500/50 bg-emerald-400/10 shadow-[0_0_40px_rgba(16,185,129,0.18)]"
            : "border-amber-500/40 bg-amber-400/10"
        }`}
      >
        <p
          className={`font-mono text-[11px] uppercase tracking-[0.3em] ${
            passed ? "text-emerald-300" : "text-amber-300"
          }`}
        >
          {passed ? "Passed" : "Not yet"}
        </p>
        <h3 className="mt-3 text-3xl font-semibold text-zinc-100 sm:text-4xl">
          {scorePct}%{" "}
          <span className="text-zinc-500">·</span>{" "}
          <span className="text-base text-zinc-400 sm:text-lg">
            {correct} of {total} correct
          </span>
        </h3>
        <p className="mt-3 text-sm leading-relaxed text-zinc-300">
          {passed
            ? isLastLesson
              ? "That's the whole plan. Strong finish."
              : "Lesson cleared. The next lesson is unlocked — keep going."
            : `You need ${PASS_THRESHOLD}% to unlock the next lesson. Review the explanations below and try again.`}
        </p>
        {progress && (
          <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.25em] text-zinc-500">
            best: {progress.best_score_pct}% · attempts: {progress.attempts}
          </p>
        )}
      </div>

      <ol className="space-y-3" data-testid="quiz-result-questions">
        {quiz.questions.map((q, qIdx) => {
          const r = results[qIdx];
          if (!r) return null;
          return (
            <ResultRow
              key={qIdx}
              index={qIdx}
              question={q.question}
              options={q.options}
              correctIndex={r.correct_index}
              selected={r.selected}
              wasCorrect={r.was_correct}
              explanation={r.explanation}
            />
          );
        })}
      </ol>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-zinc-200 transition hover:border-zinc-500"
        >
          Back to plan
        </button>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={onRetake}
            data-testid="quiz-retake"
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-zinc-200 transition hover:border-emerald-400/60 hover:text-emerald-200"
          >
            Retake with fresh questions
          </button>
          {passed && !isLastLesson && onAdvance && (
            <button
              type="button"
              onClick={onAdvance}
              data-testid="quiz-advance"
              className="rounded-lg border border-emerald-400/70 bg-emerald-400/15 px-4 py-2 text-sm font-medium text-emerald-100 transition hover:bg-emerald-400/25"
            >
              Next lesson →
            </button>
          )}
        </div>
      </div>
    </>
  );
}

function ResultRow({
  index,
  question,
  options,
  correctIndex,
  selected,
  wasCorrect,
  explanation,
}: {
  index: number;
  question: string;
  options: string[];
  correctIndex: number;
  selected: number;
  wasCorrect: boolean;
  explanation: string;
}) {
  return (
    <li
      data-testid={`quiz-result-${index}`}
      className={`rounded-2xl border p-5 backdrop-blur sm:p-6 ${
        wasCorrect
          ? "border-emerald-500/30 bg-zinc-950/60"
          : "border-red-500/40 bg-zinc-950/60"
      }`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`flex h-7 w-7 flex-none items-center justify-center rounded-full border font-mono text-xs font-semibold ${
            wasCorrect
              ? "border-emerald-400/60 bg-emerald-400/10 text-emerald-200"
              : "border-red-400/60 bg-red-400/10 text-red-200"
          }`}
        >
          {wasCorrect ? "✓" : "✗"}
        </span>
        <div className="flex-1">
          <p className="text-sm font-medium text-zinc-100 sm:text-base">
            {question}
          </p>
          <ul className="mt-3 space-y-1.5 text-sm">
            {options.map((opt, optIdx) => {
              const isCorrect = optIdx === correctIndex;
              const isSelected = optIdx === selected;
              const tone = isCorrect
                ? "text-emerald-200"
                : isSelected
                  ? "text-red-300"
                  : "text-zinc-400";
              return (
                <li key={optIdx} className={`flex items-start gap-2 ${tone}`}>
                  <span className="select-none font-mono text-[11px] uppercase">
                    {isCorrect ? "ans" : isSelected ? "you" : "—"}
                  </span>
                  <span className="flex-1">{opt}</span>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 text-xs leading-relaxed text-zinc-300">
            {explanation}
          </p>
        </div>
      </div>
    </li>
  );
}
