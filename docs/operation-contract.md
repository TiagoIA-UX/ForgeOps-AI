# ForgeOps AI — Operation Contract (Global)

Status: Active
Version: v1.0.0
Scope: Mandatory for all relevant flows (onboarding, payment, affiliates, dashboard, editor, automations, external integrations)

## 1) Mandatory Operation Contract

Every relevant execution MUST:

- Generate operationId (unique)
- Accept/propagate correlationId when present
- Emit structured lifecycle events
- Use only allowed statuses

Allowed statuses:

- pending
- processing
- completed
- failed

Any transition outside the explicit transition matrix MUST be blocked.

## 2) Transition Matrix

- pending -> processing, failed
- processing -> completed, failed
- completed -> (none)
- failed -> (none)

## 3) Structured Event Pattern

Every operation MUST emit:

- <flow>.start
- <flow>.processing
- <flow>.completed
- <flow>.failed

Minimum event payload:

- operationId
- correlationId
- flow
- status
- timestamp
- context (user/template/order/etc.)

## 4) Mandatory Error Shape

Errors must be normalized and explicit:

- errorCode
- errorMessage (sanitized)
- statusCode

All non-success outcomes MUST end in failed (no silent fallback).

## 5) Idempotency and Reprocessing

- Re-execution must be safe
- Duplicate side effects are forbidden
- External events must be deduplicated using unique identifiers
- Failed operations must remain reprocessable

## 6) Dead Letter Requirement

When retry is exhausted:

- Persist failed operation into dead letter queue
- Keep enough context for investigation/replay
- Support manual and automatic replay

## 7) Naming Convention

Flow/event names must be explicit and stable:

- onboarding.submit
- onboarding.status
- onboarding.semente
- payment.approved
- affiliate.commission.generated
- editor.template.updated

## 8) Non-Optional Adoption Rule

No execution outside ForgeOps wrapper for relevant flows.

A PR is not compliant if it does not:

- Use operation tracker lifecycle
- Return operationId in API responses
- Emit structured events
- Use explicit status transitions

## 9) Objective

Move the platform from implicit and fragile execution to explicit, predictable, auditable, and reprocessable execution.

ForgeOps AI is not a magic detector. It is the operating layer that makes failures visible, traceable, reproducible, and fixable.
