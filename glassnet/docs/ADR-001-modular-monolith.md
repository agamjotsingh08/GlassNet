# ADR-001: Modular monolith

## Decision

Keep one Node/TypeScript application with clear modules instead of microservices.

## Reason

GlassNet is a local student project. Separate deployments would add operational
complexity without current scale benefits. Scanner, database, and API boundaries
are still separated in code so workers can be extracted later.
