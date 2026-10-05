# Telemetry

Quackback sends one anonymous snapshot a day so the project can see which versions, setups and features are in use. Set `DISABLE_TELEMETRY=true` to turn it off.

## What it never contains

Names, emails, URLs, hostnames, workspace names, content of any kind, or exact counts. The server's IP address is not stored and is not turned into a location. Every payload passes a fail-closed check before it is sent: a field that looks like an email or a URL, or a key such as `email`, `url`, `hostname` or `token`, stops the send.

Counts are reported in bands: `0`, `1-10`, `11-50`, `51-200`, `201-1000`, `1001-10000`, `10000+`.

## What it contains

| Field                                                                | Example                                                                                                                 | Why                                                                                  |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `instanceId`                                                         | random UUID                                                                                                             | Counts installs without identifying them                                             |
| `version`, `runtime`, `runtimeVersion`, `os`, `arch`, `deployMethod` | `0.14.0`, `bun`, `docker`                                                                                               | Which platforms to support and test                                                  |
| `platform`                                                           | Postgres major version, single or pooled, process role, config file in use                                              | Which database versions and topologies matter                                        |
| `installAge`                                                         | `31-90d`                                                                                                                | Whether installs stick                                                               |
| `products`, `experimentalFeatures`                                   | feedback on, status off                                                                                                 | Which modules are switched on                                                        |
| `features`                                                           | SMTP, S3, AI, widget, MCP configured                                                                                    | Which capabilities are set up                                                        |
| `emailProvider`, `aiProvider`                                        | `smtp`, `openrouter`                                                                                                    | A fixed label; the endpoint itself is never sent                                     |
| `auth`                                                               | `password`, `google`, `oidc`; open signup                                                                               | Which sign-in methods to prioritise. Custom identity providers report only as `oidc` |
| `integrations`                                                       | `slack`, `linear`                                                                                                       | Connected integrations, from the built-in catalogue only                             |
| `locales`                                                            | `de`, `pt-BR`                                                                                                           | Which translations people use                                                        |
| `activation`, `firstWin`, `widgetInstalled`                          | setup goal, first value reached                                                                                         | Where onboarding works and where it stalls                                           |
| `seats7d`, `activeUsers30d`                                          | team and portal users signed in, banded                                                                                 | Real use, not just installs                                                          |
| `scale`                                                              | banded totals per module                                                                                                | Size of installs                                                                     |
| `activity30d`                                                        | banded posts, votes, comments, conversations, replies, tickets, articles, changelog, searches, incidents, workflow runs | Which features are used, not just enabled                                            |
| `channels30d`                                                        | banded new conversations per channel                                                                                    | Which channels matter                                                                |
| `ai30d`                                                              | banded AI calls per feature                                                                                             | Which AI features earn their cost                                                    |
| `health.failedJobs24h`                                               | banded                                                                                                                  | Whether a release breaks background work                                             |

The snapshot is built in `apps/web/src/lib/server/telemetry/payload.ts`.
