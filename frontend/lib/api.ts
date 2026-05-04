import { logger } from "./logger";

export type HealthStatus = "loading" | "healthy" | "down";

export interface HealthResponse {
  status: string;
  message: string;
}

export type SkillLevel = "beginner" | "intermediate" | "advanced";

export interface GeneratePlanInput {
  name: string;
  topic: string;
  skill: SkillLevel;
}

export interface Lesson {
  title: string;
  summary: string;
  objectives: string[];
  estimated_minutes: number;
  difficulty: SkillLevel;
  practice_idea: string;
}

export interface Plan {
  overview: string;
  total_estimated_hours: number;
  lessons: Lesson[];
  next_steps: string;
}

export interface GeneratePlanResponse {
  status: "ok" | "invalid" | "error";
  plan: Plan | null;
  session_id?: string;
  input?: GeneratePlanInput;
  errors?: Partial<Record<keyof GeneratePlanInput, string>>;
  message?: string;
}

export type ChatRole = "user" | "assistant";

export interface ChatTurn {
  role: ChatRole;
  content: string;
}

/** Per-lesson chat transcripts keyed by stringified lesson index ("0","1",…). */
export type ChatHistory = Record<string, ChatTurn[]>;

export interface QuizProgressEntry {
  passed: boolean;
  best_score_pct: number;
  attempts: number;
}

/** Per-lesson quiz progress keyed by stringified lesson index. */
export type QuizProgress = Record<string, QuizProgressEntry>;

export interface SessionDetail {
  session_id: string;
  input: GeneratePlanInput;
  plan: Plan;
  chat_history?: ChatHistory;
  quiz_progress?: QuizProgress;
  created_at: string;
  updated_at: string;
}

/** Public-facing quiz question — answers stripped server-side. */
export interface QuizQuestion {
  question: string;
  options: string[];
}

export interface QuizPublic {
  questions: QuizQuestion[];
}

export interface QuizGenerateResponse {
  status: "ok" | "invalid" | "error";
  lesson_index?: number;
  quiz?: QuizPublic;
  errors?: Partial<Record<"lesson_index" | "quiz", string>>;
  message?: string;
}

export interface QuizQuestionResult {
  correct_index: number;
  explanation: string;
  selected: number;
  was_correct: boolean;
}

export interface QuizScoreResponse {
  status: "ok" | "invalid" | "error";
  lesson_index?: number;
  score_pct?: number;
  correct_count?: number;
  total?: number;
  passed?: boolean;
  results?: QuizQuestionResult[];
  progress?: QuizProgressEntry;
  errors?: Partial<Record<"lesson_index" | "answers" | "quiz", string>>;
  message?: string;
}

export interface LessonChatResponse {
  status: "ok" | "invalid" | "error";
  lesson_index?: number;
  history?: ChatTurn[];
  errors?: Partial<Record<"lesson_index" | "message", string>>;
  message?: string;
}

/**
 * Fetches the backend health status via the same-origin Next proxy. The
 * caller passes an AbortSignal so rapid input changes can cancel stale
 * requests (see TypingInput / page.tsx).
 */
export async function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  logger.info("api: fetchHealth start");
  const response = await fetch("/api/health", {
    method: "GET",
    headers: { Accept: "application/json" },
    signal,
    cache: "no-store",
  });
  if (!response.ok) {
    logger.error("api: fetchHealth non-2xx", { status: response.status });
    throw new Error(`Health check failed: ${response.status}`);
  }
  const data = (await response.json()) as HealthResponse;
  logger.info("api: fetchHealth ok", data);
  return data;
}

/**
 * Submits the onboarding form. Trims values before sending so the server
 * receives the canonical form. The server also re-validates and may return a
 * 400 with field-level errors which the caller can surface in the UI.
 */
export async function generatePlan(
  input: GeneratePlanInput,
  signal?: AbortSignal,
): Promise<GeneratePlanResponse> {
  const payload: GeneratePlanInput = {
    name: input.name.trim(),
    topic: input.topic.trim(),
    skill: input.skill,
  };
  logger.info("api: generatePlan start", { skill: payload.skill });
  const response = await fetch("/api/generate-plan", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
    signal,
    cache: "no-store",
  });

  // 200 (ok), 400 (invalid), and 502 (upstream error) all carry a JSON body
  // with a `status` discriminator and a `message` or `errors` payload — return
  // them as-is so the UI can render field-level or upstream error states.
  // Anything else (network failure, 5xx without body) falls through to throw.
  if (
    response.status === 200 ||
    response.status === 400 ||
    response.status === 502
  ) {
    const data = (await response.json()) as GeneratePlanResponse;
    logger.info("api: generatePlan response", {
      status: response.status,
      shape: data.status,
    });
    return data;
  }

  logger.error("api: generatePlan unexpected status", {
    status: response.status,
  });
  throw new Error(`generatePlan failed: ${response.status}`);
}

/**
 * Fetch a saved session by ID. Returns null on 404 (session missing or
 * deleted) so callers can fall through to the onboarding flow.
 */
export async function fetchSession(
  sessionId: string,
  signal?: AbortSignal,
): Promise<SessionDetail | null> {
  logger.info("api: fetchSession", { sessionId });
  const response = await fetch(`/api/sessions/${sessionId}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal,
    cache: "no-store",
  });
  if (response.status === 404) {
    logger.warn("api: fetchSession 404 — stale session_id");
    return null;
  }
  if (!response.ok) {
    logger.error("api: fetchSession failed", { status: response.status });
    throw new Error(`fetchSession failed: ${response.status}`);
  }
  return (await response.json()) as SessionDetail;
}

/**
 * Delete a saved session. Used by the "Start over" flow. 404 is treated as
 * success — the session is already gone, which is the desired end state.
 */
export async function deleteSession(
  sessionId: string,
  signal?: AbortSignal,
): Promise<void> {
  logger.info("api: deleteSession", { sessionId });
  const response = await fetch(`/api/sessions/${sessionId}`, {
    method: "DELETE",
    signal,
  });
  if (!response.ok && response.status !== 404) {
    logger.error("api: deleteSession failed", { status: response.status });
    throw new Error(`deleteSession failed: ${response.status}`);
  }
}

/**
 * Send a message to the lesson tutor. Returns the full updated chat history
 * (server is the source of truth so older clients can't accidentally diverge).
 * 200 / 400 / 502 are returned as data; other status codes throw.
 */
export async function sendLessonMessage(
  sessionId: string,
  lessonIndex: number,
  message: string,
  signal?: AbortSignal,
): Promise<LessonChatResponse> {
  logger.info("api: sendLessonMessage", { sessionId, lessonIndex });
  const response = await fetch(
    `/api/sessions/${sessionId}/lesson-chat`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ lesson_index: lessonIndex, message }),
      signal,
      cache: "no-store",
    },
  );

  if (
    response.status === 200 ||
    response.status === 400 ||
    response.status === 502
  ) {
    const data = (await response.json()) as LessonChatResponse;
    logger.info("api: sendLessonMessage response", {
      status: response.status,
      shape: data.status,
    });
    return data;
  }

  logger.error("api: sendLessonMessage unexpected status", {
    status: response.status,
  });
  throw new Error(`sendLessonMessage failed: ${response.status}`);
}

/**
 * Generate (or regenerate) a fresh quiz for the given lesson. Each call
 * replaces any active quiz on the server. Returns 200/400/502 as data; other
 * codes throw.
 */
export async function generateLessonQuiz(
  sessionId: string,
  lessonIndex: number,
  signal?: AbortSignal,
): Promise<QuizGenerateResponse> {
  logger.info("api: generateLessonQuiz", { sessionId, lessonIndex });
  const response = await fetch(
    `/api/sessions/${sessionId}/lesson-quiz/generate`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ lesson_index: lessonIndex }),
      signal,
      cache: "no-store",
    },
  );
  if (
    response.status === 200 ||
    response.status === 400 ||
    response.status === 502
  ) {
    const data = (await response.json()) as QuizGenerateResponse;
    logger.info("api: generateLessonQuiz response", {
      status: response.status,
      shape: data.status,
    });
    return data;
  }
  logger.error("api: generateLessonQuiz unexpected status", {
    status: response.status,
  });
  throw new Error(`generateLessonQuiz failed: ${response.status}`);
}

/**
 * Submit answers for the lesson's active quiz. Returns score, per-question
 * results, and updated progress. 200/400/502 are returned as data; others throw.
 */
export async function submitLessonQuiz(
  sessionId: string,
  lessonIndex: number,
  answers: number[],
  signal?: AbortSignal,
): Promise<QuizScoreResponse> {
  logger.info("api: submitLessonQuiz", {
    sessionId,
    lessonIndex,
    answerCount: answers.length,
  });
  const response = await fetch(
    `/api/sessions/${sessionId}/lesson-quiz/score`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ lesson_index: lessonIndex, answers }),
      signal,
      cache: "no-store",
    },
  );
  if (
    response.status === 200 ||
    response.status === 400 ||
    response.status === 502
  ) {
    const data = (await response.json()) as QuizScoreResponse;
    logger.info("api: submitLessonQuiz response", {
      status: response.status,
      shape: data.status,
      score: data.score_pct,
      passed: data.passed,
    });
    return data;
  }
  logger.error("api: submitLessonQuiz unexpected status", {
    status: response.status,
  });
  throw new Error(`submitLessonQuiz failed: ${response.status}`);
}
