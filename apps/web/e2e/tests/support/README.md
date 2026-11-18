# Support e2e suite

End-to-end tests for the support module (conversations, tickets, inbox,
widget, portal support, email, SLA, presence, workflows). They run against a
**production build** with the suite's own environment and local stand-ins for
everything outside the app. Config: `apps/web/playwright.support.config.ts`.
Harness code: `apps/web/e2e/support/`. Self-tests for the harness:
`harness/*.spec.ts` here.

## Run it locally

You need Postgres, Mailpit and an S3-compatible store. `docker compose up -d`
from the repo root gives you all three (Mailpit on 1025/8025, storage on 9000).

```sh
# 1. A fresh database for the suite
psql -h localhost -U postgres -c 'create database quackback_support_e2e'
export E2E_SUPPORT_DATABASE_URL=postgresql://postgres:password@localhost:5432/quackback_support_e2e
DATABASE_URL=$E2E_SUPPORT_DATABASE_URL bun run db:migrate
DATABASE_URL=$E2E_SUPPORT_DATABASE_URL bun run db:seed

# 2. A production build (rebuild after changing app code)
bun run --filter @quackback/widget build
cd apps/web && bun run build

# 3. Run (starts the app, the fake AI and the webhook sink itself)
bun run test:e2e:support                       # everything
bun run test:e2e:support --grep @smoke          # the every-PR set
```

Any value in `e2e/support/support.env` can be overridden with
`E2E_SUPPORT_<KEY>`, for example when port 3000 is taken:

```sh
E2E_SUPPORT_PORT=3417 E2E_SUPPORT_E2E_FAKE_AI_PORT=4410 \
E2E_SUPPORT_E2E_WEBHOOK_SINK_PORT=4411 E2E_SUPPORT_E2E_WEBHOOK_SINK_CONTROL_PORT=4412 \
E2E_SUPPORT_S3_ENDPOINT=http://localhost:9100 bun run test:e2e:support
```

The app server never reads the repo-root `.env`, so a local run cannot send
real mail or spend AI credit. Its log is `e2e/.auth/support/app.log`. A
running server is never reused unless you set `PLAYWRIGHT_REUSE_SERVER=1`.

## Writing a test

```ts
import { test, expect } from '../../support/fixtures'

test('a teammate answers', { tag: '@core' }, async ({ asPerson, marker }) => {
  const admin = await asPerson('admin') // a signed-in Page
  // ...
})
```

- **Tags.** `@smoke` runs on every PR (keep it small and fast), `@core` on PRs
  that touch support code, on main and nightly, `@nightly` only nightly.
  `@quarantine` follows `e2e/QUARANTINE.md`.
- **Unique data.** Every stand-in is shared by all workers. Use the `marker`
  fixture in subjects, sender addresses, AI rules and sink channels, and find
  your rows by it. Never clear Mailpit and never count all messages.
- **Settings.** Only turn things on. A spec that must turn a workspace setting
  off needs its own project or database.

## The people

Created once per database by the setup project (`e2e/support/people.ts`,
`e2e/scripts/seed-support-people.ts`), signed in by minted sessions, so the
magic-link rate limit never applies. `asPerson(name)` opens a browser as them;
`people` has their ids.

| Name          | Who                                                   |
| ------------- | ----------------------------------------------------- |
| `admin`       | Admin, sees everything, in both suite teams           |
| `agentB`      | Support lead (cross-team view), team E2E Support      |
| `scoped`      | Custom role without cross-team view, team E2E Billing |
| `contributor` | Built-in Contributor, team E2E Billing                |
| `noAccess`    | Teammate with no conversation or ticket permission    |
| `customer`    | Identified customer (portal and widget)               |

Anonymous visitors are made by the widget itself (`/e2e/widget?persona=anon`).

## The stand-ins

| Dependency                      | Stand-in                                                                                                                                                                                                                                                                                                                                                  | Helper                                                                                                                  |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Outbound email                  | Mailpit (SMTP 1025, API 8025). `email_log` is the second oracle.                                                                                                                                                                                                                                                                                          | `support/mailpit.ts`: `waitForMail({ to })`, `getMailHeaders`, `linksIn`, `waitForEmailLog`                             |
| Inbound email                   | Signed JSON posted to `/api/chat/email/inbound` with the suite's `EMAIL_INBOUND_SIGNING_SECRET`; reply addresses minted with the app's own helpers on `EMAIL_INBOUND_DOMAIN=inbound.test`.                                                                                                                                                                | `support/inbound-email.ts`: `sendInboundEmail`, `supportInboxAddress`, `conversationReplyAddress`, `ticketReplyAddress` |
| AI                              | `support/stand-ins/fake-ai.ts`, an OpenAI-compatible server on `OPENAI_BASE_URL`: chat (plain, streaming, structured, tool calls) and embeddings (1536-d unit vectors). Rules are keyed on a marker in the prompt; `[[fake-ai:fail]]` answers 500 and `[[fake-ai:stall]]` waits 120 s. The SDK retries a 500 twice; a rule with `status: 400` fails once. | `support/fake-ai-client.ts`: `fakeAi.script`, `fakeAi.waitForRequests`                                                  |
| File storage                    | The S3-compatible container from `docker-compose.yml` (CI runs the same image). The setup project creates the bucket.                                                                                                                                                                                                                                     | none needed                                                                                                             |
| Outgoing webhooks               | `support/stand-ins/webhook-sink.ts`: https on `webhook-sink.localhost`, with a self-signed certificate the app trusts through `NODE_EXTRA_CA_CERTS`; a plain-http control port for reading deliveries.                                                                                                                                                    | `support/webhook-sink-client.ts`: `sink.url(channel)`, `sink.waitForDeliveries`, `sink.respondWith`                     |
| Timers (SLA, snooze, workflows) | `POST /api/e2e/sweep` runs one sweep now, optionally `asOf` a later time.                                                                                                                                                                                                                                                                                 | `support/sweeps.ts`: `runSweep(request, 'snooze-sweep', { asOf })`                                                      |
| Presence                        | The admin app keeps presence off in automated browsers. `?e2e-presence=1` turns it on for that tab; `holdPresence` holds it from the test process. Note the inbox page's own live stream counts as presence.                                                                                                                                              | `support/presence.ts`: `withPresenceFlag`, `holdPresence`, `waitForPresence`, `setAvailability`                         |

## The test-only seams and their gate

The sweep runner, the webhook sink allowance and the presence switch exist in
the app (`src/lib/server/e2e-harness/`) and are open only when
`E2E_HARNESS=1` **and** `BASE_URL` is a loopback host (`localhost`,
`*.localhost`, `127.x`, `::1`) **and** the install is not the pooled fleet. A
real deployment has a public `BASE_URL`, so a stray flag still finds them
closed: the routes answer 404, the SSRF guard refuses the sink, and the
presence flag does nothing. Unit tests pin each refusal
(`src/lib/server/e2e-harness/__tests__`,
`src/routes/api/__tests__/e2e-harness-routes.test.ts`,
`src/lib/server/content/__tests__/ssrf-guard-e2e-sink.test.ts`,
`src/lib/client/hooks/__tests__/use-admin-presence.test.ts`).

## CI

- `support-smoke` (every PR, main, nightly): one runner, production build,
  `--grep @smoke`.
- `support-core` (PRs that touch support paths or carry the
  `run-support-e2e` label, pushes to main, nightly and manual runs): four
  shards, two workers each, each shard with its own database. PRs and main run
  `@smoke` and `@core`; nightly and manual runs run everything but
  `@quarantine`. To run it on a PR that touches no support path, add the label
  and re-run the CI workflow (the label is read when the job runs).
- `support-core-report` merges the shard reports and fails if no test ran.
