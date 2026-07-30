# GlassNet architecture

## Current local architecture

```text
Browser UI → Express API → URL safety → isolated Playwright browser
                                  ↓
                    observation + classification + report
                                  ↓
                         local SQLite report repository
```

GlassNet is currently a modular local application with SQLite-backed local
accounts, scans, jobs, audit events, notifications, and watch targets. It does
not include shared teams, cloud workers, email delivery, or hosted operations.

## Safety boundary

- Public HTTP and HTTPS websites only.
- Private, loopback, link-local, and common private-network destinations are blocked.
- Every browser request is checked before it is allowed.
- A fresh browser context is used for every scan.
- Cookie values, storage values, passwords, form content, and response bodies are not stored.
- The scanner does not submit forms, bypass access controls, or reuse personal browser sessions.

## Production path

Before a multi-user launch, move the SQLite data to hosted PostgreSQL, move browser
scans into isolated workers, add rate limits, and configure logging, monitoring,
retention, and incident processes.
