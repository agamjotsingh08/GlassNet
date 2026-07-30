# ADR-002: SQLite for local mode

## Decision

Use Node's built-in SQLite for local data.

## Reason

It provides transactions and relational tables without requiring a separate
database service. A hosted multi-user version should migrate to PostgreSQL.
