"""Core API views."""
from __future__ import annotations

import logging

from rest_framework.decorators import api_view
from rest_framework.request import Request
from rest_framework.response import Response

logger = logging.getLogger(__name__)


@api_view(["GET"])
def health(request: Request) -> Response:
    """Liveness/readiness probe.

    Returns 200 when the Django process can serve requests. Kept intentionally
    cheap — no DB hit — so it can be polled aggressively without side effects.
    """
    logger.info("health check requested from %s", request.META.get("REMOTE_ADDR"))
    payload = {"status": "ok", "message": "Backend is healthy"}
    return Response(payload, status=200)
