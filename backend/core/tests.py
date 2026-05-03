"""Tests for the core app."""
from __future__ import annotations

from django.test import Client, TestCase
from django.urls import reverse


class HealthEndpointTests(TestCase):
    """Verify GET /api/health returns the documented contract."""

    def setUp(self) -> None:
        self.client = Client()

    def test_health_returns_200(self) -> None:
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)

    def test_health_payload_shape(self) -> None:
        response = self.client.get("/api/health")
        self.assertEqual(
            response.json(),
            {"status": "ok", "message": "Backend is healthy"},
        )

    def test_health_reverse_url(self) -> None:
        # URL name must remain stable for downstream consumers.
        self.assertEqual(reverse("core:health"), "/api/health")

    def test_health_rejects_post(self) -> None:
        response = self.client.post("/api/health")
        self.assertEqual(response.status_code, 405)
