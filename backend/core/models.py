"""Database models for the core app."""
from __future__ import annotations

import uuid

from django.db import models


class LearningSession(models.Model):
    """A user's onboarding answers + generated plan, persisted across visits.

    Identified by a UUID stored client-side in localStorage. Anonymous —
    there is no user account; the client's possession of the UUID is the
    only authentication. That is acceptable for this single-tenant
    learning app and lets the user resume on the same browser without auth.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    name = models.CharField(max_length=80)
    topic = models.CharField(max_length=120)
    skill = models.CharField(
        max_length=16,
        choices=[
            ("beginner", "Beginner"),
            ("intermediate", "Intermediate"),
            ("advanced", "Advanced"),
        ],
    )

    plan = models.JSONField()

    # Per-lesson chat transcripts. Keys are stringified lesson indices
    # ("0", "1", ...); values are lists of {role, content} dicts. The frontend
    # treats absent keys as "no chat yet for this lesson".
    chat_history = models.JSONField(default=dict, blank=True)

    # Server-side quiz state, kept private from the client.
    # Keys are stringified lesson indices; values are full Quiz dicts including
    # correct_index and explanation. Replaced on each regenerate.
    active_quizzes = models.JSONField(default=dict, blank=True)

    # Public-facing quiz progress used by the frontend to render lock/unlock,
    # check marks, and score badges. Keys are stringified lesson indices;
    # values are {passed: bool, best_score_pct: int, attempts: int}.
    quiz_progress = models.JSONField(default=dict, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.name} → {self.topic} ({self.skill})"
