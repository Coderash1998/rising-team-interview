"""Custom middleware for request/error logging."""
from __future__ import annotations

import logging
import time
from typing import Callable

from django.http import HttpRequest, HttpResponse

logger = logging.getLogger(__name__)


class RequestLoggingMiddleware:
    """Logs every request method/path/status/duration. Logs exceptions with stacktrace."""

    def __init__(self, get_response: Callable[[HttpRequest], HttpResponse]) -> None:
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        start = time.perf_counter()
        response = self.get_response(request)
        duration_ms = (time.perf_counter() - start) * 1000.0
        logger.info(
            "%s %s -> %s (%.1fms)",
            request.method,
            request.get_full_path(),
            response.status_code,
            duration_ms,
        )
        return response

    def process_exception(self, request: HttpRequest, exception: Exception) -> None:
        # logger.exception captures the active stacktrace.
        logger.exception(
            "Unhandled exception during %s %s: %s",
            request.method,
            request.get_full_path(),
            exception,
        )
        return None
