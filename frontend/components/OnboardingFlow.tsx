"use client";

import { useEffect, useRef, useState } from "react";

import { LessonChat } from "@/components/LessonChat";
import { LessonQuiz } from "@/components/LessonQuiz";
import { StepIndicator } from "@/components/StepIndicator";
import {
  generatePlan,
  type ChatHistory,
  type ChatTurn,
  type GeneratePlanResponse,
  type Lesson,
  type QuizProgress,
  type QuizProgressEntry,
  type SessionDetail,
  type SkillLevel,
} from "@/lib/api";
import { logger } from "@/lib/logger";

type Step = 1 | 2 | 3;

const SKILLS: { value: SkillLevel; title: string; blurb: string }[] = [
  {
    value: "beginner",
    title: "Beginner",
    blurb: "New to the topic. Start from the fundamentals.",
  },
  {
    value: "intermediate",
    title: "Intermediate",
    blurb: "Comfortable with the basics. Ready to go deeper.",
  },
  {
    value: "advanced",
    title: "Advanced",
    blurb: "Strong working knowledge. Looking to specialise.",
  },
];

const STEP_LABELS = ["Name", "Topic", "Skill"];

interface OnboardingFlowProps {
  /** When provided, render the result view directly instead of the step form. */
  hydratedSession?: SessionDetail | null;
  /** Called when a fresh plan is generated so the parent can persist the session_id. */
  onPersist?: (detail: SessionDetail) => void;
  /** Called when the user clicks "Start over" — wipes both client and server state. */
  onReset?: () => void | Promise<void>;
}

export function OnboardingFlow({
  hydratedSession = null,
  onPersist,
  onReset,
}: OnboardingFlowProps) {
  const [step, setStep] = useState<Step>(1);
  const [name, setName] = useState(hydratedSession?.input.name ?? "");
  const [topic, setTopic] = useState(hydratedSession?.input.topic ?? "");
  const [skill, setSkill] = useState<SkillLevel | "">(
    hydratedSession?.input.skill ?? "",
  );

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<GeneratePlanResponse | null>(
    hydratedSession
      ? {
          status: "ok",
          plan: hydratedSession.plan,
          session_id: hydratedSession.session_id,
          input: hydratedSession.input,
        }
      : null,
  );
  const [chatHistory, setChatHistory] = useState<ChatHistory>(
    hydratedSession?.chat_history ?? {},
  );
  const [quizProgress, setQuizProgress] = useState<QuizProgress>(
    hydratedSession?.quiz_progress ?? {},
  );
  const [selectedLessonIndex, setSelectedLessonIndex] = useState<number | null>(
    null,
  );
  const [lessonView, setLessonView] = useState<"chat" | "quiz">("chat");

  const inflightRef = useRef<AbortController | null>(null);

  useEffect(() => {
    logger.info("OnboardingFlow mounted", { hydrated: !!hydratedSession });
    return () => {
      inflightRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isStepValid = (() => {
    if (step === 1) return name.trim().length > 0;
    if (step === 2) return topic.trim().length > 0;
    return skill !== "";
  })();

  function goNext() {
    if (!isStepValid) return;
    if (step < 3) {
      const next = (step + 1) as Step;
      logger.debug("OnboardingFlow: advance", { from: step, to: next });
      setStep(next);
    }
  }

  function goBack() {
    if (step > 1) {
      const prev = (step - 1) as Step;
      logger.debug("OnboardingFlow: back", { from: step, to: prev });
      setStep(prev);
      setSubmitError(null);
    }
  }

  async function handleSubmit() {
    if (!isStepValid || skill === "") return;
    inflightRef.current?.abort();
    const controller = new AbortController();
    inflightRef.current = controller;

    setSubmitting(true);
    setSubmitError(null);
    setFieldErrors({});

    try {
      const response = await generatePlan(
        { name, topic, skill: skill as SkillLevel },
        controller.signal,
      );
      if (controller.signal.aborted) return;

      if (response.status === "invalid") {
        logger.warn("OnboardingFlow: server validation failed", response.errors);
        setFieldErrors(response.errors ?? {});
        const firstErrorStep = response.errors?.name
          ? 1
          : response.errors?.topic
            ? 2
            : 3;
        setStep(firstErrorStep as Step);
        return;
      }

      if (response.status === "error") {
        logger.error("OnboardingFlow: upstream error", response.message);
        setSubmitError(
          response.message ??
            "Plan generation failed upstream. Please try again.",
        );
        return;
      }

      logger.info("OnboardingFlow: plan generated", {
        lessons: response.plan?.lessons.length,
        hours: response.plan?.total_estimated_hours,
      });
      setResult(response);
      if (response.plan && response.session_id && onPersist) {
        onPersist({
          session_id: response.session_id,
          input: { name, topic, skill: skill as SkillLevel },
          plan: response.plan,
          // created_at / updated_at aren't returned from /generate-plan; stub
          // them with the current timestamp so the type stays satisfied.
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
    } catch (error) {
      if ((error as Error).name === "AbortError") return;
      logger.error("OnboardingFlow: submit failed", error);
      setSubmitError(
        "We couldn't reach the server. Check your connection and try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function reset() {
    setStep(1);
    setName("");
    setTopic("");
    setSkill("");
    setResult(null);
    setChatHistory({});
    setQuizProgress({});
    setSelectedLessonIndex(null);
    setLessonView("chat");
    setSubmitError(null);
    setFieldErrors({});
    if (onReset) {
      try {
        await onReset();
      } catch (error) {
        logger.error("OnboardingFlow: onReset failed", error);
      }
    }
  }

  function handleHistoryUpdate(lessonIndex: number, history: ChatTurn[]) {
    setChatHistory((prev) => ({ ...prev, [String(lessonIndex)]: history }));
  }

  function handleQuizProgress(lessonIndex: number, entry: QuizProgressEntry) {
    setQuizProgress((prev) => ({ ...prev, [String(lessonIndex)]: entry }));
  }

  /** Lesson N is unlocked iff lesson N-1 has been passed. Lesson 0 always unlocked. */
  function isLessonUnlocked(idx: number): boolean {
    if (idx === 0) return true;
    return !!quizProgress[String(idx - 1)]?.passed;
  }

  if (result?.plan) {
    const plan = result.plan;
    const input = result.input;
    const sessionId = result.session_id;

    // Per-lesson immersive view: chat (1:1 tutor) or quiz (5-question MCQ).
    // Only entered once a session is persisted (we need its UUID).
    if (selectedLessonIndex !== null && sessionId) {
      const lesson = plan.lessons[selectedLessonIndex];
      if (lesson && lessonView === "chat") {
        return (
          <LessonChat
            sessionId={sessionId}
            lessonIndex={selectedLessonIndex}
            totalLessons={plan.lessons.length}
            lesson={lesson}
            initialHistory={chatHistory[String(selectedLessonIndex)] ?? []}
            onHistoryChange={handleHistoryUpdate}
            onBack={() => setSelectedLessonIndex(null)}
            onReadyForQuiz={() => setLessonView("quiz")}
          />
        );
      }
      if (lesson && lessonView === "quiz") {
        return (
          <LessonQuiz
            sessionId={sessionId}
            lessonIndex={selectedLessonIndex}
            totalLessons={plan.lessons.length}
            lesson={lesson}
            onBack={() => {
              setLessonView("chat");
              setSelectedLessonIndex(null);
            }}
            onProgressChange={handleQuizProgress}
            onAdvance={() => {
              const next = selectedLessonIndex + 1;
              if (next < plan.lessons.length) {
                setSelectedLessonIndex(next);
                setLessonView("chat");
              } else {
                setSelectedLessonIndex(null);
                setLessonView("chat");
              }
            }}
          />
        );
      }
    }

    return (
      <div
        className="mx-auto w-full max-w-3xl"
        data-testid="onboarding-success"
      >
        <div className="rounded-2xl border border-emerald-500/30 bg-zinc-950/70 p-6 shadow-[0_0_40px_rgba(16,185,129,0.12)] backdrop-blur sm:p-8">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-emerald-300">
            Your plan · {plan.total_estimated_hours.toFixed(1)} hrs
          </p>
          <h2 className="mt-3 text-2xl font-semibold text-zinc-100 sm:text-3xl">
            {input?.topic ?? topic}{" "}
            <span className="text-zinc-500">·</span>{" "}
            <span className="text-zinc-400">{input?.skill ?? skill}</span>
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-zinc-300 sm:text-base">
            {plan.overview}
          </p>
          {sessionId && (
            <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.25em] text-zinc-500">
              Click a lesson to start with the tutor.
            </p>
          )}
        </div>

        <ol className="mt-6 space-y-4" data-testid="plan-lessons">
          {plan.lessons.map((lesson, idx) => {
            const turns = chatHistory[String(idx)]?.length ?? 0;
            const progress = quizProgress[String(idx)];
            const unlocked = isLessonUnlocked(idx);
            return (
              <LessonCard
                key={idx}
                index={idx + 1}
                lesson={lesson}
                turns={turns}
                progress={progress}
                locked={!unlocked}
                onSelect={
                  sessionId && unlocked
                    ? () => {
                        setLessonView("chat");
                        setSelectedLessonIndex(idx);
                      }
                    : undefined
                }
                onTakeQuiz={
                  sessionId && unlocked
                    ? () => {
                        setLessonView("quiz");
                        setSelectedLessonIndex(idx);
                      }
                    : undefined
                }
              />
            );
          })}
        </ol>

        <div className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-950/60 p-6 backdrop-blur sm:p-8">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-zinc-500">
            Next steps
          </p>
          <p className="mt-2 text-sm leading-relaxed text-zinc-300 sm:text-base">
            {plan.next_steps}
          </p>
        </div>

        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={reset}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-5 py-2 text-sm text-zinc-200 transition hover:border-emerald-400/60 hover:text-emerald-200"
          >
            Generate a different plan
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="mx-auto w-full max-w-xl"
      data-testid="onboarding-flow"
      data-step={step}
    >
      <div className="mb-8 flex justify-center">
        <StepIndicator current={step} total={3} labels={STEP_LABELS} />
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-6 shadow-[0_0_40px_rgba(0,0,0,0.5)] backdrop-blur sm:p-8">
        {step === 1 && (
          <Field
            label="What should we call you?"
            hint="This is just for personalising the plan."
          >
            <input
              autoFocus
              data-testid="input-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && isStepValid) goNext();
              }}
              placeholder="e.g. Alex"
              className={inputClass}
              maxLength={80}
              autoComplete="given-name"
            />
            <FieldError message={fieldErrors.name} />
          </Field>
        )}

        {step === 2 && (
          <Field
            label="What do you want to learn?"
            hint="A topic, skill, or area of focus."
          >
            <input
              autoFocus
              data-testid="input-topic"
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && isStepValid) goNext();
              }}
              placeholder="e.g. distributed systems, classical guitar"
              className={inputClass}
              maxLength={120}
              autoComplete="off"
            />
            <FieldError message={fieldErrors.topic} />
          </Field>
        )}

        {step === 3 && (
          <Field
            label="How would you rate your current level?"
            hint="We'll calibrate the plan to match."
          >
            <fieldset
              data-testid="input-skill"
              className="space-y-3"
              aria-label="Skill level"
            >
              {SKILLS.map((option) => {
                const selected = skill === option.value;
                return (
                  <label
                    key={option.value}
                    className={`flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 transition ${
                      selected
                        ? "border-emerald-400/70 bg-emerald-400/10 shadow-[0_0_18px_rgba(52,211,153,0.18)]"
                        : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-600"
                    }`}
                  >
                    <input
                      type="radio"
                      name="skill"
                      value={option.value}
                      checked={selected}
                      onChange={() => setSkill(option.value)}
                      className="mt-1 h-4 w-4 accent-emerald-400"
                    />
                    <span>
                      <span className="block text-sm font-medium text-zinc-100">
                        {option.title}
                      </span>
                      <span className="block text-xs text-zinc-400">
                        {option.blurb}
                      </span>
                    </span>
                  </label>
                );
              })}
            </fieldset>
            <FieldError message={fieldErrors.skill} />
          </Field>
        )}

        {submitError && (
          <p
            role="alert"
            className="mt-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300"
          >
            {submitError}
          </p>
        )}

        <div className="mt-8 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={goBack}
            disabled={step === 1 || submitting}
            data-testid="btn-back"
            className="rounded-lg border border-zinc-800 bg-transparent px-4 py-2 text-sm text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-zinc-800 disabled:hover:text-zinc-400"
          >
            Back
          </button>

          {step < 3 ? (
            <button
              type="button"
              onClick={goNext}
              disabled={!isStepValid}
              data-testid="btn-continue"
              className="rounded-lg border border-emerald-400/70 bg-emerald-400/10 px-5 py-2 text-sm font-medium text-emerald-100 transition hover:bg-emerald-400/20 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:bg-transparent disabled:text-zinc-600"
            >
              Continue →
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!isStepValid || submitting}
              data-testid="btn-submit"
              className="rounded-lg border border-emerald-400/70 bg-emerald-400/15 px-5 py-2 text-sm font-medium text-emerald-100 transition hover:bg-emerald-400/25 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:bg-transparent disabled:text-zinc-600"
            >
              {submitting ? "Submitting…" : "Generate plan"}
            </button>
          )}
        </div>
      </div>

      <p className="mt-4 text-center font-mono text-[10px] uppercase tracking-[0.25em] text-zinc-600">
        Step {step} of 3 — press Enter to continue
      </p>
    </div>
  );
}

const inputClass =
  "w-full rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-base text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-400/60 focus:outline-none focus:ring-1 focus:ring-emerald-400/30";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-zinc-100 sm:text-xl">{label}</h2>
        {hint && <p className="text-sm text-zinc-500">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="mt-2 text-xs text-red-400"
      data-testid="field-error"
    >
      {message}
    </p>
  );
}

const DIFFICULTY_TONE: Record<Lesson["difficulty"], string> = {
  beginner: "border-sky-400/40 bg-sky-400/10 text-sky-200",
  intermediate: "border-amber-400/40 bg-amber-400/10 text-amber-200",
  advanced: "border-fuchsia-400/40 bg-fuchsia-400/10 text-fuchsia-200",
};

function LessonCard({
  index,
  lesson,
  turns = 0,
  progress,
  locked = false,
  onSelect,
  onTakeQuiz,
}: {
  index: number;
  lesson: Lesson;
  turns?: number;
  progress?: QuizProgressEntry;
  locked?: boolean;
  onSelect?: () => void;
  onTakeQuiz?: () => void;
}) {
  const passed = !!progress?.passed;
  const InnerTag = onSelect ? "button" : "div";
  const innerProps = onSelect
    ? {
        type: "button" as const,
        onClick: onSelect,
        "data-testid": `lesson-card-${index - 1}`,
      }
    : {};
  const containerTone = locked
    ? "border-zinc-900 bg-zinc-950/40 opacity-60"
    : passed
      ? "border-emerald-500/40 bg-emerald-400/5"
      : "border-zinc-800 bg-zinc-950/60";
  const interactive = !!onSelect && !locked;

  return (
    <li>
      <InnerTag
        {...innerProps}
        aria-disabled={locked || undefined}
        title={
          locked
            ? "Pass the previous lesson's quiz to unlock"
            : undefined
        }
        className={`block w-full rounded-2xl border p-5 text-left backdrop-blur transition sm:p-6 ${containerTone} ${
          interactive
            ? "cursor-pointer hover:border-emerald-400/50 hover:bg-zinc-900/70 focus:border-emerald-400/60 focus:outline-none focus:ring-1 focus:ring-emerald-400/30"
            : locked
              ? "cursor-not-allowed"
              : ""
        }`}
      >
      <div className="flex items-start gap-4">
        <span
          className={`flex h-8 w-8 flex-none items-center justify-center rounded-full border font-mono text-xs font-semibold ${
            passed
              ? "border-emerald-400/70 bg-emerald-400/20 text-emerald-100"
              : locked
                ? "border-zinc-800 bg-zinc-900 text-zinc-600"
                : "border-emerald-400/40 bg-emerald-400/10 text-emerald-200"
          }`}
        >
          {locked ? "🔒" : passed ? "✓" : index}
        </span>
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-zinc-100 sm:text-lg">
              {lesson.title}
            </h3>
            <span
              className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.2em] ${
                DIFFICULTY_TONE[lesson.difficulty]
              }`}
            >
              {lesson.difficulty}
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
              {lesson.estimated_minutes} min
            </span>
            {turns > 0 && (
              <span className="rounded-full border border-emerald-400/40 bg-emerald-400/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-emerald-200">
                {turns} turn{turns === 1 ? "" : "s"}
              </span>
            )}
            {progress && (
              <span
                className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.2em] ${
                  passed
                    ? "border-emerald-400/60 bg-emerald-400/15 text-emerald-100"
                    : "border-amber-400/40 bg-amber-400/10 text-amber-200"
                }`}
              >
                {passed ? `passed · ${progress.best_score_pct}%` : `best ${progress.best_score_pct}%`}
              </span>
            )}
          </div>
          <p className="mt-2 text-sm leading-relaxed text-zinc-300">
            {lesson.summary}
          </p>

          <div className="mt-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-zinc-500">
              Objectives
            </p>
            <ul className="mt-2 space-y-1.5">
              {lesson.objectives.map((obj, i) => (
                <li
                  key={i}
                  className="flex gap-2 text-sm text-zinc-300"
                >
                  <span className="select-none text-emerald-400/70">›</span>
                  <span className="flex-1">{obj}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-emerald-300/80">
              Practice
            </p>
            <p className="mt-1 text-sm leading-relaxed text-zinc-300">
              {lesson.practice_idea}
            </p>
          </div>
        </div>
      </div>
      </InnerTag>

      {/* Quiz CTA lives OUTSIDE the InnerTag so we never nest <button> in
          <button>. Only rendered when the lesson is unlocked AND the parent
          provided an onTakeQuiz handler. */}
      {onTakeQuiz && !locked && (
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={onTakeQuiz}
            data-testid={`lesson-card-${index - 1}-quiz`}
            className={`rounded-lg border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.25em] transition ${
              passed
                ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/15"
                : "border-zinc-700 bg-zinc-900/60 text-zinc-300 hover:border-emerald-400/60 hover:text-emerald-200"
            }`}
          >
            {progress ? "retake quiz" : "take quiz"}
          </button>
        </div>
      )}
    </li>
  );
}
