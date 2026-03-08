# Sheets Loader Agent Guide

Role: Integration agent for Google Sheets data ingestion.

This document describes the purpose, usage, and development notes for the `@workspace/sheets-loader` package when used by agents or automated skills.

Goals
- Provide a small, testable client to fetch values from Google Sheets.
- Support both service-account (JWT) and OAuth2 flows.
- Be easy to mock and safe to use in agent workflows.

Quick usage

1. Server-to-server (service account):

```ts
import { SheetsLoader } from '@workspace/sheets-loader';

const loader = new SheetsLoader({ auth: { credentials: { client_email: '...', private_key: '...' } } });
const rows = await loader.load(sheetId, range);
```

2. Pre-built client (preferred for agents that already have an auth client):

```ts
import { SheetsLoader } from '@workspace/sheets-loader';
// pass an OAuth2Client or JWT instance
const loader = new SheetsLoader({ authClient: myAuthClient });
```

Testing & Mocks
- The package exports `getAuthClient`, `fetchValues`, and `SimpleCache` to make mocking straightforward.
- Tests should mock `getAuthClient` or `fetchValues` to avoid network calls.

Security
- Never commit credentials. Provide them at runtime via environment variables or secret stores.

Skill integration
- See `.agent/skills/sheets-loader` for a sample skill scaffold and example scripts.

Agent integration checklist

- Ensure the agent has a secure secret store configured (do not pass raw secrets in prompts).
- Prefer passing an `authClient` (an instance of `OAuth2Client` or `JWT`) when possible.
- If using OAuth tokens, persist `refresh_token` securely for long-lived access.
- Validate spreadsheet IDs and ranges before calling the loader to avoid accidental data exposure.

Security note

- Treat `client_secret`, `private_key`, and `refresh_token` as sensitive secrets. Use environment variables or secret managers and never check them into source control.

Agent example (calling the skill)

```ts
import {SheetsLoader} from '@workspace/sheets-loader';
// If your agent has an OAuth2Client instance:
const loader = new SheetsLoader({ authClient: agentAuthClient });
// Or if you have tokens you can pass credentials with access_token (short-lived):
const loaderWithToken = new SheetsLoader({ auth: { credentials: { access_token: process.env.SHEETS_LOADER_ACCESS_TOKEN } } });
const rows = await loader.load(process.env.SHEET_ID!, process.env.RANGE!);
```

Notes
- When invoking from automated agents, prefer non-interactive service accounts or pre-authorized `authClient` instances.
