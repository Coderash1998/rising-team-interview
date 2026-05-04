"""Quiz generation service.

Generates a 5-question multiple-choice quiz for a single lesson via Claude,
returning a Pydantic-validated `Quiz` object. The full quiz (with correct
answers and explanations) is intended to be persisted server-side; the public
quiz returned to the frontend strips correct_index and explanation so users
can't read answers from the network tab.
"""
from __future__ import annotations

import logging
import os
from typing import List, Literal

from anthropic import Anthropic, APIError, APIStatusError
from pydantic import BaseModel, Field, ValidationError

logger = logging.getLogger(__name__)


DEFAULT_MODEL = "claude-haiku-4-5"
MAX_TOKENS = 4000
SkillLevel = Literal["beginner", "intermediate", "advanced"]
QUESTIONS_PER_QUIZ = 5
OPTIONS_PER_QUESTION = 4


class QuizQuestion(BaseModel):
    """One multiple-choice question with exactly 4 options."""

    question: str = Field(
        ...,
        description="The question stem. One clear sentence ending in a question mark.",
    )
    options: List[str] = Field(
        ...,
        min_length=OPTIONS_PER_QUESTION,
        max_length=OPTIONS_PER_QUESTION,
        description=(
            "Exactly 4 distinct answer choices. Plausible distractors that someone with "
            "partial understanding might pick. No 'all of the above' or 'none of the above'."
        ),
    )
    correct_index: int = Field(
        ...,
        ge=0,
        le=OPTIONS_PER_QUESTION - 1,
        description="0-based index into `options` of the single correct answer.",
    )
    explanation: str = Field(
        ...,
        description="1-2 sentences explaining WHY the correct answer is correct, briefly addressing why the distractors are wrong.",
    )


class Quiz(BaseModel):
    """A 5-question multiple-choice quiz scoped to a single lesson."""

    questions: List[QuizQuestion] = Field(
        ...,
        # Loose schema cap; service layer trims to exactly 5.
        min_length=4,
        max_length=8,
        description="Exactly 5 multiple-choice questions covering the lesson's objectives.",
    )


SYSTEM_PROMPT = """You are an expert assessment writer who designs short multiple-choice quizzes that genuinely measure mastery.

Your job: write a quiz that tests whether the learner has hit the lesson's objectives — not whether they memorized text.

QUIZ DESIGN RULES

1. SHAPE
   - EXACTLY 5 questions. Not 4, not 6.
   - Each question has EXACTLY 4 options.
   - Single correct answer per question. No "all of the above" or "none of the above".

2. COVERAGE
   - Together, the 5 questions cover the lesson's stated objectives. Don't pile on one objective.
   - Vary the cognitive level: include questions that ask the learner to APPLY a concept (predict an outcome, debug a snippet, choose the right approach), not just RECALL a definition.

3. CALIBRATION
   - Match the learner's stated skill level. Beginners get questions that test foundations; advanced learners get questions that probe edge cases, trade-offs, and subtle distinctions.
   - Don't make any question solvable by guessing or pattern-matching the option lengths.

4. DISTRACTORS
   - Distractors must be plausible — common misconceptions, partial understanding, or near-miss alternatives. Never absurd or obviously wrong.
   - Avoid distractors that are technically correct under a different interpretation; ambiguity makes the quiz unfair.

5. EXPLANATIONS
   - For each question, write a 1-2 sentence explanation of why the correct answer is correct, briefly noting why the strongest distractor is wrong.

6. CONCISION
   - Keep questions and options tight — no fluff, no setup unless necessary. Each question stem should fit in 1-2 sentences.
   - Use concrete, topic-specific phrasing. Generic placeholders like "the function" are weak — name realistic functions, files, or concepts.

7. OUTPUT
   - Strict JSON conforming to the schema. No commentary or markdown outside the schema.
   - `correct_index` is 0-based."""


class QuizGenerationError(RuntimeError):
    """Raised when the quiz cannot be generated (config, upstream, or schema failure)."""


def generate_quiz(
    *,
    learner_name: str,
    topic: str,
    skill: SkillLevel,
    lesson_index: int,
    total_lessons: int,
    lesson_title: str,
    lesson_summary: str,
    lesson_objectives: List[str],
    lesson_practice: str,
) -> Quiz:
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        logger.error("ANTHROPIC_API_KEY is not set; cannot generate quiz")
        raise QuizGenerationError(
            "Server misconfigured: ANTHROPIC_API_KEY environment variable is required."
        )

    model = os.environ.get("ANTHROPIC_MODEL", DEFAULT_MODEL)
    client = Anthropic(api_key=api_key)

    objectives_block = "\n".join(f"- {o}" for o in lesson_objectives)
    user_message = (
        f"Write a 5-question multiple-choice quiz for the following lesson.\n\n"
        f"Learner: {learner_name} ({skill}, learning {topic})\n"
        f"Lesson {lesson_index + 1} of {total_lessons}: {lesson_title}\n\n"
        f"Lesson summary:\n{lesson_summary}\n\n"
        f"Lesson objectives:\n{objectives_block}\n\n"
        f"Hands-on practice for this lesson (for context, not a question source):\n"
        f"{lesson_practice}\n\n"
        f"Generate the quiz now. Calibrate difficulty to a {skill} learner."
    )

    logger.info(
        "calling Claude for quiz generation: model=%s lesson=%d skill=%s",
        model, lesson_index, skill,
    )

    try:
        response = client.messages.parse(
            model=model,
            max_tokens=MAX_TOKENS,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_message}],
            output_format=Quiz,
        )
    except APIStatusError as exc:
        logger.exception(
            "Anthropic API returned %s during quiz generation: %s",
            exc.status_code, exc.message,
        )
        raise QuizGenerationError(
            f"Claude API error ({exc.status_code}): {exc.message}"
        ) from exc
    except APIError as exc:
        logger.exception("Anthropic API failure during quiz generation: %s", exc)
        raise QuizGenerationError("Could not reach Claude API.") from exc
    except ValidationError as exc:
        logger.exception("Quiz response failed schema validation: %s", exc)
        raise QuizGenerationError(
            "Claude returned a malformed quiz. Please try again."
        ) from exc

    quiz = response.parsed_output
    if quiz is None:
        logger.error(
            "Claude returned no parsable quiz; stop_reason=%s content=%r",
            response.stop_reason, response.content,
        )
        raise QuizGenerationError("Claude returned a response that did not match the quiz schema.")

    # Force exactly 5 questions. Trim or fail.
    if len(quiz.questions) > QUESTIONS_PER_QUIZ:
        logger.info(
            "trimming quiz from %d questions to %d",
            len(quiz.questions), QUESTIONS_PER_QUIZ,
        )
        quiz = quiz.model_copy(update={
            "questions": quiz.questions[:QUESTIONS_PER_QUIZ],
        })
    elif len(quiz.questions) < QUESTIONS_PER_QUIZ:
        logger.error(
            "quiz has %d questions, expected %d",
            len(quiz.questions), QUESTIONS_PER_QUIZ,
        )
        raise QuizGenerationError(
            f"Claude returned only {len(quiz.questions)} questions. Please try again."
        )

    usage = response.usage
    logger.info(
        "quiz generated: lesson=%d questions=%d tokens(input=%s output=%s cache_read=%s cache_write=%s)",
        lesson_index, len(quiz.questions),
        usage.input_tokens, usage.output_tokens,
        usage.cache_read_input_tokens, usage.cache_creation_input_tokens,
    )

    return quiz
