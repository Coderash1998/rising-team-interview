"""Plan generation service.

Calls the Anthropic API (Claude Haiku 4.5 by default) with a Pydantic-validated
JSON-schema response so the caller receives a strongly-typed `Plan` object
that has already been schema-checked by both the model and the SDK.
"""
from __future__ import annotations

import logging
import os
from typing import List, Literal

from anthropic import Anthropic, APIError, APIStatusError
from pydantic import BaseModel, Field, ValidationError

logger = logging.getLogger(__name__)


SkillLevel = Literal["beginner", "intermediate", "advanced"]
DEFAULT_MODEL = "claude-haiku-4-5"
# Generous ceiling so Claude never gets truncated mid-JSON. The prompt
# enforces field-level length caps so typical plans land at ~2K output
# tokens; this is the safety net for verbose advanced topics.
MAX_TOKENS = 12000


class Lesson(BaseModel):
    """One sequenced step in the user's learning plan."""

    title: str = Field(
        ...,
        description="Short, punchy lesson title (≤ 100 chars).",
    )
    summary: str = Field(
        ...,
        description="2-3 sentences (≤ 400 chars) describing what this lesson covers and why it matters here.",
    )
    objectives: List[str] = Field(
        ...,
        min_length=3,
        max_length=5,
        description="3-4 concrete, observable learning outcomes (each ≤ 150 chars).",
    )
    estimated_minutes: int = Field(
        ...,
        ge=15,
        le=240,
        description="Realistic time to complete the lesson, between 15 and 240 minutes.",
    )
    difficulty: SkillLevel = Field(
        ...,
        description="Difficulty of this lesson relative to the user's stated skill.",
    )
    practice_idea: str = Field(
        ...,
        description="One concrete hands-on exercise (≤ 350 chars). One short paragraph, no lists.",
    )


class Plan(BaseModel):
    """Personalized learning plan returned to the frontend."""

    overview: str = Field(
        ...,
        description="2-3 sentence personalized summary (≤ 500 chars). Address the user by name. Explain the arc.",
    )
    total_estimated_hours: float = Field(
        ...,
        gt=0,
        description="Total estimated time across all lessons, in hours, rounded to 1 decimal place.",
    )
    lessons: List[Lesson] = Field(
        ...,
        # Prompt asks for 4. Cap generously at 8 so a verbose model run never
        # fails schema validation — service layer trims to 4. Floor at 3 so we
        # still reject genuinely-broken responses.
        min_length=3,
        max_length=8,
        description="4 lessons ordered from foundational to advanced. Each lesson must build on the previous.",
    )
    next_steps: str = Field(
        ...,
        description="2-3 sentences (≤ 400 chars) on what to do after the plan: communities, advanced resources, or follow-ups.",
    )


SYSTEM_PROMPT = """You are an expert curriculum designer who has built personalized learning plans for thousands of self-directed learners.

Your job: design a focused, sequenced learning plan for a single user, calibrated precisely to their stated skill level and topic.

Plan-design principles you must follow:

1. SHAPE
   - EXACTLY 4 lessons. Not 3, not 5 — always 4.
   - Order strictly from foundational to advanced. Each lesson must build on the previous.
   - Total time should land between 3 and 8 hours of focused work.

2. CALIBRATION TO SKILL LEVEL
   - "beginner": assume no prior exposure. Start with vocabulary, mental models, and the simplest end-to-end example. Avoid jargon without defining it.
   - "intermediate": skip introductory material the learner already knows. Focus on common pitfalls, intermediate patterns, and the gap between "I can do this" and "I can do this well."
   - "advanced": go deep on edge cases, performance, internals, and current state-of-the-art. Reference specific techniques, papers, or tools by name when appropriate. Do not waste their time on basics.

3. CONCRETENESS
   - Every lesson includes 3 to 4 OBSERVABLE objectives ("Build X", "Explain Y", "Profile Z" — not "Understand Y"). Each objective is ONE short clause, ≤ 150 chars.
   - Every lesson includes ONE specific hands-on practice idea — one short paragraph, ≤ 350 chars. No bullets, no nested lists.
   - Lesson summary is 2-3 sentences, ≤ 400 chars total.
   - Time estimates must be realistic for focused work; 30-90 minutes is typical per lesson.

4. CONCISION (HARD LIMITS — exceeding these produces a malformed response)
   - title: ≤ 100 chars
   - summary: ≤ 400 chars
   - objectives: 3-4 items, each ≤ 150 chars
   - practice_idea: ≤ 350 chars
   - overview: ≤ 500 chars
   - next_steps: ≤ 400 chars
   Be tight, not flowery. Production prose, not marketing copy.

5. PERSONALIZATION
   - Address the user by name in the `overview` and `next_steps` to add warmth.
   - Tailor examples and practice ideas to the topic — generic "do exercises" is forbidden.

6. OUTPUT
   - Return strictly valid JSON conforming to the provided schema.
   - No commentary, prose, or markdown outside the schema.
   - `total_estimated_hours` must equal the sum of `lessons[].estimated_minutes` divided by 60, rounded to 1 decimal."""


class PlanGenerationError(RuntimeError):
    """Raised when the plan cannot be generated (config or upstream API failure)."""


def generate_plan(name: str, topic: str, skill: SkillLevel) -> Plan:
    """Generate a personalized learning plan via Claude.

    Raises:
        PlanGenerationError: missing API key, upstream API error, or schema-violating
            response that the SDK couldn't coerce into a `Plan` instance.
    """
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        logger.error("ANTHROPIC_API_KEY is not set; cannot call Claude")
        raise PlanGenerationError(
            "Server misconfigured: ANTHROPIC_API_KEY environment variable is required."
        )

    model = os.environ.get("ANTHROPIC_MODEL", DEFAULT_MODEL)
    client = Anthropic(api_key=api_key)

    user_message = (
        f"Create a personalized learning plan.\n\n"
        f"Learner name: {name}\n"
        f"Topic to learn: {topic}\n"
        f"Self-assessed skill level: {skill}\n\n"
        f"Address {name} by name in the overview and next_steps. "
        f"Tailor every lesson and practice idea specifically to {topic} at the {skill} level."
    )

    logger.info(
        "calling Claude for plan generation: model=%s topic=%r skill=%s",
        model, topic, skill,
    )

    try:
        response = client.messages.parse(
            model=model,
            max_tokens=MAX_TOKENS,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_message}],
            output_format=Plan,
        )
    except APIStatusError as exc:
        logger.exception("Anthropic API returned %s: %s", exc.status_code, exc.message)
        raise PlanGenerationError(
            f"Claude API error ({exc.status_code}): {exc.message}"
        ) from exc
    except APIError as exc:
        logger.exception("Anthropic API failure: %s", exc)
        raise PlanGenerationError("Could not reach Claude API.") from exc
    except ValidationError as exc:
        # Claude returned JSON that doesn't fit even our relaxed schema (e.g.,
        # missing required fields, wrong types, lesson count outside 3-6).
        # Surface as a recoverable upstream error rather than crashing the view.
        logger.exception("Claude response failed schema validation: %s", exc)
        raise PlanGenerationError(
            "Claude returned a malformed plan. Please try again."
        ) from exc

    plan = response.parsed_output
    if plan is None:
        logger.error(
            "Claude returned no parsable plan; stop_reason=%s content=%r",
            response.stop_reason, response.content,
        )
        raise PlanGenerationError("Claude returned a response that did not match the plan schema.")

    # Force exactly 4 lessons. We've already accepted 3-6 from the model to
    # avoid 500s; here we trim or fail to enforce the product spec.
    target = 4
    if len(plan.lessons) > target:
        logger.info(
            "trimming plan from %d lessons to %d", len(plan.lessons), target,
        )
        plan = plan.model_copy(update={
            "lessons": plan.lessons[:target],
            "total_estimated_hours": round(
                sum(l.estimated_minutes for l in plan.lessons[:target]) / 60, 1,
            ),
        })
    elif len(plan.lessons) < target:
        logger.error("plan has %d lessons, expected %d", len(plan.lessons), target)
        raise PlanGenerationError(
            f"Claude returned only {len(plan.lessons)} lessons. Please try again."
        )

    usage = response.usage
    logger.info(
        "plan generated: lessons=%d total_hours=%.1f tokens(input=%s output=%s cache_read=%s cache_write=%s)",
        len(plan.lessons),
        plan.total_estimated_hours,
        usage.input_tokens,
        usage.output_tokens,
        usage.cache_read_input_tokens,
        usage.cache_creation_input_tokens,
    )

    return plan
