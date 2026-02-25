from __future__ import annotations

import re
from typing import Annotated

from pydantic import BeforeValidator

_EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def _validate_email_loose(value: str) -> str:
    """
    Internal apps often use non-public domains (e.g. *.local) that strict RFC
    validators reject. We enforce a reasonable email shape, normalize to
    lowercase, and avoid deliverability checks.
    """

    if not isinstance(value, str):
        raise TypeError("Email must be a string")

    email = value.strip().lower()
    if len(email) < 3 or len(email) > 255:
        raise ValueError("Enter a valid email address")
    if not _EMAIL_RE.match(email):
        raise ValueError("Enter a valid email address")

    return email


LooseEmail = Annotated[str, BeforeValidator(_validate_email_loose)]

