# ForgeOps AI — Integration Guide

This guide describes how to integrate an API route or job with ForgeOps operation tracking.

## Quick Steps

1. Create tracker at entry point
2. Transition to processing when work starts
3. Finish with completed on success
4. Finish with failed on every error path
5. Return operationId in response body

## Example Pattern

- Create operation context with flowName and entityType
- Read optional headers: x-operation-id, x-correlation-id, x-request-id
- Call toProcessing when user/payload checks are done
- Call toCompleted before success response
- Call fail(error) for every failure branch and catch block

## Required Request/Response Behavior

- Accept x-operation-id if caller already has one
- Accept x-correlation-id and propagate through downstream calls
- Return operationId in both success and error responses

## Minimal Response Contract

Success:

- success: true
- operationId: string

Error:

- error: string
- operationId: string

## Integration Examples (Cardapio-Digital rollout)

- app/api/onboarding/submit/route.ts
- app/api/onboarding/status/route.ts
- app/api/onboarding/semente/route.ts

## Common Mistakes (do not do)

- Silent fallback replacing invalid input with default value
- Throwing generic errors without normalized code/message
- Returning error response without operationId
- Transitioning completed directly from pending

## Rollout Guidance

1. Non-critical flows first
2. Medium-critical flows next
3. Payment/webhook only after full validation and compatibility checks

Keep backward compatibility and avoid mixing two operation patterns in the same flow.
