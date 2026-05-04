"""URL routes for the core app."""
from django.urls import path

from . import views

app_name = "core"

urlpatterns = [
    path("health", views.health, name="health"),
    path("generate-plan", views.generate_plan_view, name="generate_plan"),
    path("sessions/<str:session_id>", views.session_detail, name="session_detail"),
    path(
        "sessions/<str:session_id>/lesson-chat",
        views.lesson_chat,
        name="lesson_chat",
    ),
    path(
        "sessions/<str:session_id>/lesson-quiz/generate",
        views.lesson_quiz_generate,
        name="lesson_quiz_generate",
    ),
    path(
        "sessions/<str:session_id>/lesson-quiz/score",
        views.lesson_quiz_score,
        name="lesson_quiz_score",
    ),
]
