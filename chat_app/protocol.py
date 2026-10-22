"""Shared protocol validation and message helpers."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

USERNAME_RE = re.compile(r"^[A-Za-z0-9_]{3,32}$")
MAX_MESSAGE_LENGTH = 2000
MAX_PASSWORD_LENGTH = 128


class ProtocolError(ValueError):
    """Raised when a client request does not match the chat protocol."""


def validate_username(value: Any) -> str:
    if not isinstance(value, str) or not USERNAME_RE.fullmatch(value):
        raise ProtocolError(
            "username must be 3-32 characters using letters, numbers, or underscores"
        )
    return value


def validate_password(value: Any) -> str:
    if not isinstance(value, str) or not 8 <= len(value) <= MAX_PASSWORD_LENGTH:
        raise ProtocolError("password must be between 8 and 128 characters")
    return value


def validate_message(value: Any) -> str:
    if not isinstance(value, str):
        raise ProtocolError("message must be text")
    message = value.strip()
    if not message:
        raise ProtocolError("message cannot be empty")
    if len(message) > MAX_MESSAGE_LENGTH:
        raise ProtocolError(f"message cannot exceed {MAX_MESSAGE_LENGTH} characters")
    return message


def validate_request(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict) or not isinstance(payload.get("op"), str):
        raise ProtocolError("request must be an object with an operation")
    return payload


def timestamp() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def response(ok: bool, **fields: Any) -> dict[str, Any]:
    return {"ok": ok, **fields}
