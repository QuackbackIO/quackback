# PASS — Track 6 boundary scan

2026-08-15. No deploy. Live pair unchanged (`371883f5` / `1931dc38`).
Instances not touched.

| Check                                                           | Result                                                          |
| --------------------------------------------------------------- | --------------------------------------------------------------- |
| `domain-multi-fn` / `org-billing-fn` / `members-fn` imports     | none on CP `saas`                                               |
| workspace `billing/provider/`                                   | gone; only `plan-usage.ts` + projection overview                |
| `BILLING_API_KEY` / `BILLING_PRICES` / `BILLING_WEBHOOK_SECRET` | **absent** on web, worker, hourly, daily, migrator (names only) |
| CP `BILLING_PROJECTION_PRIVATE_KEY`                             | kept (required)                                                 |
| walk3 webhook                                                   | already disabled (do not reattach)                              |

Parked leftovers (columns, dashboard redirects, plan-fanout) stay until
no replica SELECTs them / 2026-11-14. Self-host path not inverted.
