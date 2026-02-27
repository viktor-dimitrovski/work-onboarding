# Billing Overview

Billing is subscription-based and aligned to tenant modules.

## Plans and modules

- A plan is a bundle of modules.
- Modules drive feature gating across frontend and backend.
- Each tenant has a current plan and a set of enabled modules.

## Subscription lifecycle

Subscriptions are created and updated through the billing provider.
Plan changes update the tenant's enabled modules and should be recorded for auditing.

## Usage tracking

Usage events are emitted by the backend for billable actions.
Typical usage data includes:

- tenant ID
- user ID
- event type
- quantity
- timestamp

## Reporting

The API aggregates usage per tenant and per billing period.
The admin app uses this data for invoices and analytics.
