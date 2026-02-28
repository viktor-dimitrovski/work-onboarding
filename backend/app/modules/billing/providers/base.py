from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Protocol
from uuid import UUID

from app.modules.billing.models import PlanPrice


class PaymentProviderAdapter(Protocol):
    def create_checkout_session(self, *, tenant_id: UUID, plan_price: PlanPrice) -> str:
        ...

    def create_portal_session(self, *, tenant_id: UUID) -> str:
        ...

    def handle_webhook(self, *, payload: bytes, signature: str | None) -> dict:
        ...

    def record_metered_usage(
        self,
        *,
        subscription_id: str,
        subscription_item_id: str,
        units: Decimal,
        occurred_at: datetime,
        currency: str,
    ) -> None:
        ...
