from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.modules.billing.models import Invoice, LedgerEntry, Meter, MeterRate, Plan, PlanPrice, Subscription


class BillingQueries:
    @staticmethod
    def current_subscription(db: Session, *, tenant_id: UUID) -> Subscription | None:
        return db.scalar(
            select(Subscription)
            .where(Subscription.tenant_id == tenant_id)
            .order_by(Subscription.starts_at.desc())
        )

    @staticmethod
    def current_plan(db: Session, *, subscription: Subscription | None) -> Plan | None:
        if not subscription:
            return None
        return db.scalar(select(Plan).where(Plan.id == subscription.plan_id))

    @staticmethod
    def current_period(db: Session, *, subscription: Subscription | None) -> tuple[datetime, datetime]:
        now = datetime.now(timezone.utc)
        if subscription and subscription.current_period_start and subscription.current_period_end:
            return subscription.current_period_start, subscription.current_period_end
        period_start = datetime(now.year, now.month, 1, tzinfo=timezone.utc)
        if now.month == 12:
            period_end = datetime(now.year + 1, 1, 1, tzinfo=timezone.utc)
        else:
            period_end = datetime(now.year, now.month + 1, 1, tzinfo=timezone.utc)
        return period_start, period_end

    @staticmethod
    def current_spend(
        db: Session, *, tenant_id: UUID, period_start: datetime, period_end: datetime
    ) -> Decimal:
        total = db.scalar(
            select(func.coalesce(func.sum(LedgerEntry.amount), 0))
            .where(
                LedgerEntry.tenant_id == tenant_id,
                LedgerEntry.occurred_at >= period_start,
                LedgerEntry.occurred_at < period_end,
            )
        )
        return Decimal(str(total or 0))

    @staticmethod
    def list_usage_breakdown(
        db: Session,
        *,
        tenant_id: UUID,
        from_date: datetime | None = None,
        to_date: datetime | None = None,
    ) -> list[dict]:
        now = datetime.now(timezone.utc)
        from_date = from_date or datetime(now.year, now.month, 1, tzinfo=timezone.utc)
        to_date = to_date or now

        rows = db.execute(
            select(
                Meter.event_key,
                Meter.name,
                func.coalesce(func.sum(LedgerEntry.units), 0),
                func.coalesce(func.sum(LedgerEntry.amount), 0),
                LedgerEntry.currency,
            )
            .join(Meter, Meter.id == LedgerEntry.meter_id, isouter=True)
            .where(
                LedgerEntry.tenant_id == tenant_id,
                LedgerEntry.occurred_at >= from_date,
                LedgerEntry.occurred_at <= to_date,
            )
            .group_by(Meter.event_key, Meter.name, LedgerEntry.currency)
            .order_by(Meter.event_key.asc().nulls_last())
        ).all()

        results = []
        for row in rows:
            results.append(
                {
                    'event_key': row[0] or 'unknown',
                    'meter_name': row[1] or row[0] or 'Usage',
                    'units': Decimal(str(row[2] or 0)),
                    'amount': Decimal(str(row[3] or 0)),
                    'currency': row[4] or 'usd',
                }
            )
        return results

    @staticmethod
    def list_invoices(db: Session, *, tenant_id: UUID) -> list[Invoice]:
        return db.scalars(
            select(Invoice)
            .where(Invoice.tenant_id == tenant_id)
            .order_by(Invoice.issued_at.desc().nulls_last(), Invoice.created_at.desc())
        ).all()


class BillingAdminService:
    @staticmethod
    def list_meters(db: Session) -> list[Meter]:
        return db.scalars(select(Meter).order_by(Meter.event_key.asc())).all()

    @staticmethod
    def create_meter(db: Session, *, payload: dict) -> Meter:
        meter = Meter(**payload)
        db.add(meter)
        db.flush()
        return meter

    @staticmethod
    def list_rates(db: Session, *, meter_id: UUID) -> list[MeterRate]:
        return db.scalars(
            select(MeterRate).where(MeterRate.meter_id == meter_id).order_by(MeterRate.effective_from.desc())
        ).all()

    @staticmethod
    def create_rate(db: Session, *, payload: dict) -> MeterRate:
        rate = MeterRate(**payload)
        db.add(rate)
        db.flush()
        return rate

    @staticmethod
    def list_plan_prices(db: Session) -> list[PlanPrice]:
        return db.scalars(select(PlanPrice).order_by(PlanPrice.created_at.desc())).all()

    @staticmethod
    def create_plan_price(db: Session, *, payload: dict) -> PlanPrice:
        price = PlanPrice(**payload)
        db.add(price)
        db.flush()
        return price
