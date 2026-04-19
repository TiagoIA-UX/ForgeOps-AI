# ForgeOps AI — Adoption Checklist

Use this checklist per flow/API route.

- [ ] Flow uses createOperationTracker at entry point
- [ ] operationId exists for every relevant execution
- [ ] correlationId is accepted/propagated when present
- [ ] Status transitions follow allowed matrix only
- [ ] Success response includes operationId
- [ ] Error response includes operationId
- [ ] Errors are normalized (errorCode/errorMessage/statusCode)
- [ ] No silent fallback for invalid business input
- [ ] Idempotency strategy exists for repeated events/actions
- [ ] Retry policy is explicit for external dependencies
- [ ] Dead letter exists for exhausted retries
- [ ] Structured events emitted for start/processing/completed/failed
- [ ] Flow names follow naming convention
- [ ] Tests include ugly scenarios (invalid input, external failure, repeated event)
