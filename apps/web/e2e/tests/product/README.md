# Product e2e suite

End-to-end tests for everything outside the support module: feedback, roadmap,
changelog, the status page, the help center, people, and the platform around
them (REST API, MCP, webhooks, integrations, settings). Config:
`apps/web/playwright.product.config.ts`.

The suite runs on the support suite's harness: the same **production build**,
the same environment (`e2e/support/support.env`), the same stand-ins (Mailpit,
fake AI, https webhook sink, object storage, sweep runner) and the same people.
Read `e2e/tests/support/README.md` first; everything there applies here. This
file only lists what differs.

## Where tests go

| Folder                   | What it covers                                                            |
| ------------------------ | ------------------------------------------------------------------------- |
| `e2e/tests/status/`      | Status page: services, incidents, maintenance, subscribers, feed          |
| `e2e/tests/feedback/`    | Portal boards, posts, votes, comments; the team's feedback inbox          |
| `e2e/tests/roadmap/`     | Admin and portal roadmap                                                  |
| `e2e/tests/changelog/`   | Authoring, publishing, the portal changelog, feeds, subscriber emails     |
| `e2e/tests/help-center/` | Articles, collections, the public help center, search and Ask AI          |
| `e2e/tests/people/`      | Users, companies, segments, portal sign-in and account pages, team access |
| `e2e/tests/platform/`    | REST, MCP, webhooks, integrations, settings, analytics, onboarding        |
| `e2e/tests/product/`     | The suite's own wiring                                                    |

Helpers for one module go in `e2e/product/<module>.ts`. Import the test from
the support harness:

```ts
import { test, expect } from '../../support/fixtures'
```

Each journey has an id from the inventory (`STA-`, `FBP-`, `FBA-`, `RMP-`,
`CHG-`, `HC-`, `PPL-`, `API-`, `INT-`); put it at the start of the test title
and list a file's journeys in its header comment.

## Run it locally

Same steps as the support suite, with this config. A separate database keeps
the two suites' data apart:

```sh
psql -h localhost -U postgres -c 'create database quackback_product_e2e'
export E2E_SUPPORT_DATABASE_URL=postgresql://postgres:password@localhost:5432/quackback_product_e2e
DATABASE_URL=$E2E_SUPPORT_DATABASE_URL bun run db:migrate
DATABASE_URL=$E2E_SUPPORT_DATABASE_URL bun run db:seed

bun run --filter @quackback/widget build
cd apps/web && bun run build

bun run test:e2e:product --project product          # everything but the serial specs
bun run test:e2e:product --project product-serial   # then those, one at a time
bun run test:e2e:product --project product --grep @smoke
```

## What differs from the support suite

- **Products on.** The setup project (`e2e/product/setup.product.ts`) turns on
  Feedback, Changelog, Help center and Status before any test, as a workspace
  using all of them would run.
- **Workspace-wide switches are the norm here.** A private portal, anonymous
  posting off, moderation on, a sign-in method off or a private board changes
  what every other test sees. Such a test is tagged `@isolated` (it runs in the
  `product-isolated` job, one worker, its own database) and flips the setting
  with `withSettings` (`e2e/support/isolated-settings.ts`), or lives in a
  `*.serial.spec.ts` file when it needs no other test running at all. Prefer a
  setting that belongs to your own row (a board, a service, a segment you
  created) over a workspace-wide one.
- **The seed is not data.** Never rely on the random seed's boards, posts or
  users. Create what you need with the `marker` fixture in its name and find it
  by that name.

## CI

- `product-smoke` (every PR, main, nightly): one runner, `--grep @smoke`.
- `product-core` (PRs that touch product paths or carry the `run-product-e2e`
  label, main, nightly, manual): four shards, two workers each, own database
  per shard. PRs and main run `@smoke` and `@core`; nightly and manual runs run
  everything but `@quarantine`.
- `product-isolated`: the `@isolated` tests, one worker, own database.
- `product-core-report` merges the shard reports and fails if no test ran.
