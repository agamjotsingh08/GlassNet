# Obsidian Archive rebuild

## Identity replacement

This rebuild replaces the previous Network Observatory identity. Obsidian
Archive uses charcoal and aubergine surfaces, plum structure, burgundy concern
states, copper and amber highlights, sand evidence sheets, ivory text, and
muted coral warnings. Its composition is an archive workspace: case-file
headers, evidence sheets, version seals, narrow tabs, status symbols, records,
ledgers, and provenance labels.

The application shell has six primary destinations: Home, Scan, Cases, Govern,
Improve, and Test. Consent, Research, Integrations, and Settings live in
secondary workspaces so the main navigation stays readable.

## Existing systems retained

The scanner, isolated Playwright context, URL safety rules, SQLite case history,
dependency graph, replay data, comparisons, reviews, CI checks, issues,
portfolios, research exports, accounts, and safe evidence exports remain
available. The rebuild reorganizes them instead of duplicating them.

## New feature map

| Requested system | Working location | Evidence behavior |
| --- | --- | --- |
| Necessity Analyzer | Case Actions and Improve | Classifies services from observed purpose and governance records |
| Feature-to-Tracker Attribution | Case Journeys | Connects first-party initiators, services, and observed requests |
| Data Exposure Scenarios | Case Journeys | Builds scenarios only from observed service categories |
| Privacy Architecture Blueprint | Case Actions and Improve | Generates evidence-backed reduction steps |
| Consent Interface Quality | Consent | Stores explicit human evaluations separately from scans |
| Configuration Drift | Test | Compares current and prior case evidence |
| Tag Manager Governance | Govern | Filters governed inventory to tag-manager services |
| Privacy Debt | Case Actions and Improve | Tracks owner, priority, state, and linked case |
| Vendor Substitution | Case Actions and Improve | Suggests categories to review; does not claim an unverified replacement |
| Impact Forecast | Test | Stores deterministic, labeled planning estimates |
| Ownership Matrix | Govern | Assigns owner, purpose, necessity, and approval to observed services |
| Change Approvals | Govern | Records proposed changes and decision state |
| Journey Mapper | Case Journeys | Saves safe, descriptive journey steps without executing sensitive actions |
| Evidence Chain | Case Journeys | Shows observation, classification, inference, and recommendation provenance |
| Maturity Model | Case Actions and Improve | Computes a transparent archive maturity level |
| Incident Reconstruction | Case Journeys | Reconstructs the normalized observed event sequence |
| Service Inventory | Govern | Aggregates observed services across completed cases |
| Architecture Comparison | Test | Compares two completed case architectures |
| Requirement Test Suite | Test | Runs passed, failed, or inconclusive evidence rules |
| Architecture Decision Records | Govern | Stores decisions, context, status, and consequences |

## Data model

The rebuild adds relational records for service governance, privacy debt,
change approvals, architecture decisions, privacy requirements, impact
forecasts, user journeys, and consent evaluations. These records do not alter
captured evidence. User-entered confirmations remain visibly separate from
scanner observations.

## Trust boundaries

- Scans use a fresh browser context and never copy a user's browser cookies.
- Cookie names and safe attributes may be stored; cookie values are discarded.
- Passwords, form contents, request bodies, tokens, and response bodies are not
  collected.
- Local and private network targets are blocked.
- Journey records describe analysis steps; they do not submit, purchase, log
  in, pay, or delete anything.
- Missing evidence produces an inconclusive state instead of a fabricated fact.

## Performance and accessibility

Cytoscape loads only when a dependency map is opened. The interface uses native
controls, visible focus states, a skip link, responsive archive layouts, and
reduced-motion support. Server-side analysis uses small deterministic helpers
covered by automated tests.
