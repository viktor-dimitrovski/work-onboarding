from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Literal

from pydantic import BaseModel, Field, field_validator


class SimpleCountRule(BaseModel):
    type: Literal['simple_count'] = 'simple_count'


class SumMetaFieldRule(BaseModel):
    type: Literal['sum_meta_field'] = 'sum_meta_field'
    field: str = Field(min_length=1)
    multiplier: Decimal = Decimal('1')


class TokenBasedRule(BaseModel):
    type: Literal['token_based'] = 'token_based'
    prompt_field: str = 'prompt_tokens'
    completion_field: str = 'completion_tokens'


class ComplexityWeightedRule(BaseModel):
    type: Literal['complexity_weighted'] = 'complexity_weighted'
    weight_field: str = 'complexity'
    min_weight: Decimal = Decimal('0')
    max_weight: Decimal = Decimal('10')

    @field_validator('max_weight')
    @classmethod
    def validate_bounds(cls, value: Decimal, info) -> Decimal:
        min_weight = info.data.get('min_weight', Decimal('0'))
        if value < min_weight:
            raise ValueError('max_weight must be >= min_weight')
        return value


RatingRule = SimpleCountRule | SumMetaFieldRule | TokenBasedRule | ComplexityWeightedRule


def _to_decimal(value: object) -> Decimal:
    try:
        if value is None:
            return Decimal('0')
        return Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return Decimal('0')


def load_rule(rule_json: dict | None) -> RatingRule:
    payload = rule_json or {'type': 'simple_count'}
    rule_type = (payload.get('type') or 'simple_count').strip().lower()
    if rule_type == 'sum_meta_field':
        return SumMetaFieldRule.model_validate(payload)
    if rule_type == 'token_based':
        return TokenBasedRule.model_validate(payload)
    if rule_type == 'complexity_weighted':
        return ComplexityWeightedRule.model_validate(payload)
    return SimpleCountRule.model_validate(payload)


def compute_units(quantity: float, meta: dict | None, rule: RatingRule) -> Decimal:
    meta = meta or {}
    base = _to_decimal(quantity)

    if isinstance(rule, SimpleCountRule):
        return base
    if isinstance(rule, SumMetaFieldRule):
        return _to_decimal(meta.get(rule.field)) * _to_decimal(rule.multiplier)
    if isinstance(rule, TokenBasedRule):
        tokens = _to_decimal(meta.get(rule.prompt_field)) + _to_decimal(meta.get(rule.completion_field))
        return tokens
    if isinstance(rule, ComplexityWeightedRule):
        weight = _to_decimal(meta.get(rule.weight_field) or Decimal('1'))
        if weight < rule.min_weight:
            weight = rule.min_weight
        if weight > rule.max_weight:
            weight = rule.max_weight
        return base * weight
    return base
