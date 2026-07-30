# Local API

All examples use local-only data. Do not place real credentials in examples.

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/health` | Health and scanner version |
| POST | `/api/scans` | Start and complete a local public scan |
| GET | `/api/scans` | Recent completed reports, capped at 30 |
| GET | `/api/scans/:id` | One completed report |
| GET | `/api/compare?id=1&id=2` | Compare two reports |
| POST | `/api/auth/register` | Create a local account |
| POST | `/api/auth/login` | Start a local session |
| POST | `/api/auth/logout` | End the session |
| GET/POST/DELETE | `/api/watch` | Manage local watch targets |
| POST | `/api/feedback` | Save bounded product feedback |

## Safe use

Only scan public websites you are permitted to inspect. The local app has no
webhook delivery, public reports, or production API keys enabled.
