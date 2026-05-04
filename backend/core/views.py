"""Core API views."""
from __future__ import annotations

import logging
import uuid
from typing import Any

from django.shortcuts import get_object_or_404
from rest_framework.decorators import api_view
from rest_framework.request import Request
from rest_framework.response import Response

from .models import LearningSession
from .services.lesson_tutor import LessonTutorError, reply_to_lesson_chat
from .services.plan_generator import PlanGenerationError, generate_plan
from .services.quiz_generator import (
    OPTIONS_PER_QUESTION,
    QUESTIONS_PER_QUIZ,
    QuizGenerationError,
    generate_quiz,
)

MAX_USER_MESSAGE_CHARS = 4000
MAX_HISTORY_TURNS = 40
PASSING_SCORE_PCT = 80

logger = logging.getLogger(__name__)


SKILL_LEVELS = {"beginner", "intermediate", "advanced"}


def _serialize_session(session: LearningSession) -> dict[str, Any]:
    return {
        "session_id": str(session.id),
        "input": {
            "name": session.name,
            "topic": session.topic,
            "skill": session.skill,
        },
        "plan": session.plan,
        "chat_history": session.chat_history or {},
        # `quiz_progress` is exposed for gating/badges; `active_quizzes` stays
        # server-side so users can't read correct_index from the network tab.
        "quiz_progress": session.quiz_progress or {},
        "created_at": session.created_at.isoformat(),
        "updated_at": session.updated_at.isoformat(),
    }


def _public_quiz(quiz_dict: dict[str, Any]) -> dict[str, Any]:
    """Strip correct_index and explanation from a stored quiz before returning to client."""
    return {
        "questions": [
            {"question": q.get("question"), "options": list(q.get("options", []))}
            for q in quiz_dict.get("questions", [])
        ],
    }


@api_view(["GET"])
def health(request: Request) -> Response:
    """Liveness/readiness probe.

    Returns 200 when the Django process can serve requests. Kept intentionally
    cheap — no DB hit — so it can be polled aggressively without side effects.
    """
    logger.info("health check requested from %s", request.META.get("REMOTE_ADDR"))
    payload = {"status": "ok", "message": "Backend is healthy"}
    return Response(payload, status=200)


def _clean(value: Any) -> str:
    """Coerce to str and trim. Non-strings become empty so validation rejects them."""
    if not isinstance(value, str):
        return ""
    return value.strip()


@api_view(["POST"])
def generate_plan_view(request: Request) -> Response:
    """Generate a personalized learning plan via Claude.

    Validates the onboarding payload (name, topic, skill all non-empty after
    trim, and skill within the supported set), then delegates to the plan
    generator service which calls the Anthropic API. Returns the validated
    Pydantic model serialized to dict.
    """
    body = request.data if isinstance(request.data, dict) else {}
    name = _clean(body.get("name"))
    topic = _clean(body.get("topic"))
    skill = _clean(body.get("skill")).lower()

    errors: dict[str, str] = {}
    if not name:
        errors["name"] = "Name is required."
    if not topic:
        errors["topic"] = "Topic is required."
    if not skill:
        errors["skill"] = "Skill level is required."
    elif skill not in SKILL_LEVELS:
        errors["skill"] = f"Skill must be one of: {', '.join(sorted(SKILL_LEVELS))}."

    if errors:
        logger.warning("generate_plan rejected: %s", errors)
        return Response({"status": "invalid", "errors": errors}, status=400)

    logger.info("generate_plan accepted: name=%r topic=%r skill=%s", name, topic, skill)

    try:
        plan = generate_plan(name=name, topic=topic, skill=skill)  # type: ignore[arg-type]
    except PlanGenerationError as exc:
        # User-facing error — the upstream call failed or config is missing.
        # 502 communicates "I'm fine but my upstream isn't."
        logger.error("plan generation failed: %s", exc)
        return Response(
            {"status": "error", "message": str(exc)},
            status=502,
        )

    # Persist so the user can resume on the same browser. The session_id is
    # stored client-side in localStorage; possession of it == authentication.
    plan_data = plan.model_dump()
    session = LearningSession.objects.create(
        name=name, topic=topic, skill=skill, plan=plan_data,
    )
    logger.info("created LearningSession %s for %s", session.id, name)

    return Response(
        {
            "status": "ok",
            "session_id": str(session.id),
            "plan": plan_data,
            "input": {"name": name, "topic": topic, "skill": skill},
        },
        status=200,
    )


@api_view(["GET", "DELETE"])
def session_detail(request: Request, session_id: str) -> Response:
    """Fetch or delete a saved session by UUID.

    GET returns the same shape as `generate_plan_view` so the frontend can
    reuse its rendering path on hydration. DELETE wipes the session and is
    used by the "Start over" flow.
    """
    try:
        uuid.UUID(session_id)
    except (ValueError, TypeError):
        return Response(
            {"status": "invalid", "message": "Malformed session_id."},
            status=400,
        )

    session = get_object_or_404(LearningSession, pk=session_id)

    if request.method == "DELETE":
        logger.info("deleting LearningSession %s", session.id)
        session.delete()
        return Response(status=204)

    logger.info("hydrating LearningSession %s", session.id)
    return Response(_serialize_session(session), status=200)


@api_view(["POST"])
def lesson_chat(request: Request, session_id: str) -> Response:
    """Append a user message to a lesson's chat and return the tutor's reply.

    Request body:
        {
          "lesson_index": int,            # 0-based, must point at an existing lesson
          "message": str                  # the user's new message (non-empty after trim)
        }

    Response (200):
        {
          "history": [{"role": "user"|"assistant", "content": str}, ...],  # full updated transcript
          "lesson_index": int
        }

    400 — malformed body or empty message
    404 — session_id missing
    502 — upstream Claude error
    """
    try:
        uuid.UUID(session_id)
    except (ValueError, TypeError):
        return Response(
            {"status": "invalid", "message": "Malformed session_id."},
            status=400,
        )

    session = get_object_or_404(LearningSession, pk=session_id)

    body = request.data if isinstance(request.data, dict) else {}
    raw_lesson_index = body.get("lesson_index")
    raw_message = body.get("message")

    # Coerce + validate lesson_index.
    try:
        lesson_index = int(raw_lesson_index)
    except (TypeError, ValueError):
        return Response(
            {"status": "invalid", "errors": {"lesson_index": "Must be an integer."}},
            status=400,
        )

    lessons = (session.plan or {}).get("lessons", [])
    if not (0 <= lesson_index < len(lessons)):
        return Response(
            {"status": "invalid", "errors": {"lesson_index": "Out of range for this plan."}},
            status=400,
        )

    # Validate message — non-empty after trim, bounded length.
    if not isinstance(raw_message, str):
        return Response(
            {"status": "invalid", "errors": {"message": "Must be a string."}},
            status=400,
        )
    message = raw_message.strip()
    if not message:
        return Response(
            {"status": "invalid", "errors": {"message": "Message is required."}},
            status=400,
        )
    if len(message) > MAX_USER_MESSAGE_CHARS:
        return Response(
            {
                "status": "invalid",
                "errors": {
                    "message": f"Message exceeds {MAX_USER_MESSAGE_CHARS} characters.",
                },
            },
            status=400,
        )

    chat_store = dict(session.chat_history or {})
    key = str(lesson_index)
    history: list[dict[str, str]] = list(chat_store.get(key, []))

    # Bound history to keep token cost predictable. Older turns are dropped
    # silently — the tutor system prompt has the lesson context anyway, so the
    # most recent turns matter most.
    if len(history) > MAX_HISTORY_TURNS:
        history = history[-MAX_HISTORY_TURNS:]

    lesson = lessons[lesson_index]
    try:
        reply = reply_to_lesson_chat(
            session_id=str(session.id),
            learner_name=session.name,
            topic=session.topic,
            skill=session.skill,  # type: ignore[arg-type]
            lesson_index=lesson_index,
            total_lessons=len(lessons),
            lesson_title=lesson.get("title", ""),
            lesson_summary=lesson.get("summary", ""),
            lesson_objectives=list(lesson.get("objectives", [])),
            lesson_practice=lesson.get("practice_idea", ""),
            history=history,  # type: ignore[arg-type]
            new_user_message=message,
        )
    except LessonTutorError as exc:
        logger.error("lesson_chat upstream failure: %s", exc)
        return Response(
            {"status": "error", "message": str(exc)},
            status=502,
        )

    history.append({"role": "user", "content": message})
    history.append({"role": "assistant", "content": reply})
    chat_store[key] = history
    session.chat_history = chat_store
    session.save(update_fields=["chat_history", "updated_at"])

    return Response(
        {"status": "ok", "lesson_index": lesson_index, "history": history},
        status=200,
    )


def _resolve_lesson(
    session: LearningSession, raw_lesson_index: Any,
) -> tuple[int | None, dict | None, Response | None]:
    """Validate lesson_index against the session's plan.

    Returns (lesson_index, lesson_dict, error_response). Exactly one of
    lesson_dict or error_response is non-None.
    """
    try:
        lesson_index = int(raw_lesson_index)
    except (TypeError, ValueError):
        return None, None, Response(
            {"status": "invalid", "errors": {"lesson_index": "Must be an integer."}},
            status=400,
        )
    lessons = (session.plan or {}).get("lessons", [])
    if not (0 <= lesson_index < len(lessons)):
        return None, None, Response(
            {"status": "invalid", "errors": {"lesson_index": "Out of range for this plan."}},
            status=400,
        )
    return lesson_index, lessons[lesson_index], None


@api_view(["POST"])
def lesson_quiz_generate(request: Request, session_id: str) -> Response:
    """Generate a fresh 5-question quiz for the given lesson and persist it server-side.

    Request body: { "lesson_index": int }
    Response 200: { "lesson_index": int, "quiz": { "questions": [{question, options}, ...] } }
        — correct_index and explanation are intentionally omitted; they live
        only in active_quizzes on the server. Each call REPLACES the existing
        active quiz for that lesson.
    """
    try:
        uuid.UUID(session_id)
    except (ValueError, TypeError):
        return Response(
            {"status": "invalid", "message": "Malformed session_id."},
            status=400,
        )

    session = get_object_or_404(LearningSession, pk=session_id)
    body = request.data if isinstance(request.data, dict) else {}
    lesson_index, lesson, err = _resolve_lesson(session, body.get("lesson_index"))
    if err is not None:
        return err
    assert lesson is not None and lesson_index is not None  # type narrowing

    try:
        quiz = generate_quiz(
            learner_name=session.name,
            topic=session.topic,
            skill=session.skill,  # type: ignore[arg-type]
            lesson_index=lesson_index,
            total_lessons=len(session.plan.get("lessons", [])),
            lesson_title=lesson.get("title", ""),
            lesson_summary=lesson.get("summary", ""),
            lesson_objectives=list(lesson.get("objectives", [])),
            lesson_practice=lesson.get("practice_idea", ""),
        )
    except QuizGenerationError as exc:
        logger.error("quiz generation failed: %s", exc)
        return Response({"status": "error", "message": str(exc)}, status=502)

    quiz_dict = quiz.model_dump()
    store = dict(session.active_quizzes or {})
    store[str(lesson_index)] = quiz_dict
    session.active_quizzes = store
    session.save(update_fields=["active_quizzes", "updated_at"])

    return Response(
        {
            "status": "ok",
            "lesson_index": lesson_index,
            "quiz": _public_quiz(quiz_dict),
        },
        status=200,
    )


@api_view(["POST"])
def lesson_quiz_score(request: Request, session_id: str) -> Response:
    """Score the user's answers against the persisted quiz for this lesson.

    Request body: { "lesson_index": int, "answers": [int, int, int, int, int] }
        — `answers[i]` is the 0-based option index the user selected for question i.

    Response 200:
    {
      "lesson_index": int,
      "score_pct": int (0-100),
      "correct_count": int,
      "total": int,
      "passed": bool,                # score_pct >= PASSING_SCORE_PCT
      "results": [
          {"correct_index": int, "explanation": str, "selected": int, "was_correct": bool},
          ...
      ],
      "progress": {"passed": bool, "best_score_pct": int, "attempts": int}
    }

    Errors:
      400 — bad lesson_index, no active quiz, malformed answers
    """
    try:
        uuid.UUID(session_id)
    except (ValueError, TypeError):
        return Response(
            {"status": "invalid", "message": "Malformed session_id."},
            status=400,
        )

    session = get_object_or_404(LearningSession, pk=session_id)
    body = request.data if isinstance(request.data, dict) else {}
    lesson_index, _lesson, err = _resolve_lesson(session, body.get("lesson_index"))
    if err is not None:
        return err
    assert lesson_index is not None

    quiz_dict = (session.active_quizzes or {}).get(str(lesson_index))
    if not quiz_dict:
        return Response(
            {
                "status": "invalid",
                "errors": {"quiz": "No active quiz for this lesson. Generate one first."},
            },
            status=400,
        )

    questions = quiz_dict.get("questions", [])
    raw_answers = body.get("answers")
    if not isinstance(raw_answers, list) or len(raw_answers) != len(questions):
        return Response(
            {
                "status": "invalid",
                "errors": {
                    "answers": f"Must be a list of {len(questions)} integers (one per question).",
                },
            },
            status=400,
        )

    # Coerce/validate each answer.
    answers: list[int] = []
    for i, raw in enumerate(raw_answers):
        try:
            idx = int(raw)
        except (TypeError, ValueError):
            return Response(
                {
                    "status": "invalid",
                    "errors": {"answers": f"Answer {i} is not an integer."},
                },
                status=400,
            )
        opts = questions[i].get("options", [])
        if not (0 <= idx < len(opts)):
            return Response(
                {
                    "status": "invalid",
                    "errors": {"answers": f"Answer {i} is out of range for that question."},
                },
                status=400,
            )
        answers.append(idx)

    # Score.
    results: list[dict[str, Any]] = []
    correct_count = 0
    for q, selected in zip(questions, answers):
        correct_index = int(q.get("correct_index", -1))
        was_correct = selected == correct_index
        if was_correct:
            correct_count += 1
        results.append({
            "correct_index": correct_index,
            "explanation": q.get("explanation", ""),
            "selected": selected,
            "was_correct": was_correct,
        })
    total = len(questions)
    score_pct = round((correct_count / total) * 100) if total else 0
    passed = score_pct >= PASSING_SCORE_PCT

    # Persist progress (best score wins; attempts increments per submission).
    progress_store = dict(session.quiz_progress or {})
    key = str(lesson_index)
    prior = progress_store.get(key, {})
    prior_best = int(prior.get("best_score_pct", 0))
    prior_attempts = int(prior.get("attempts", 0))
    progress_store[key] = {
        "passed": bool(prior.get("passed")) or passed,
        "best_score_pct": max(prior_best, score_pct),
        "attempts": prior_attempts + 1,
    }
    session.quiz_progress = progress_store
    session.save(update_fields=["quiz_progress", "updated_at"])

    logger.info(
        "quiz scored: session=%s lesson=%d score=%d%% (%d/%d) passed=%s attempts=%d",
        session.id, lesson_index, score_pct, correct_count, total, passed,
        progress_store[key]["attempts"],
    )

    return Response(
        {
            "status": "ok",
            "lesson_index": lesson_index,
            "score_pct": score_pct,
            "correct_count": correct_count,
            "total": total,
            "passed": passed,
            "results": results,
            "progress": progress_store[key],
        },
        status=200,
    )
