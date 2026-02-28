from __future__ import annotations

from app.core.config import settings
from app.modules.billing.providers.base import PaymentProviderAdapter
from app.modules.billing.providers.stripe_adapter import StripeAdapter


def get_provider_adapter() -> PaymentProviderAdapter | None:
    if settings.BILLING_PROVIDER != 'stripe':
        return None
    if not settings.STRIPE_API_KEY:
        return None
    return StripeAdapter()
