# Dependency graph (generated, do not edit by hand)

Regenerate with `bunx vitest run apps/web/src/lib/server/policy/dep-graph -u`.
A diff here means a dependency edge or cycle was added or removed. Review it as an architecture change, then commit the regenerated file.

Edges come from static analysis of import / export-from / string-literal dynamic-import specifiers. Type-only imports count. Self-edges are omitted.

## 1. Workspace packages

Nodes (6): apps/web, packages/db, packages/email, packages/ids, packages/logger, packages/widget

| From | To | Evidence |
| --- | --- | --- |
| apps/web | packages/db | declared + imported |
| apps/web | packages/email | declared + imported |
| apps/web | packages/ids | declared + imported |
| apps/web | packages/logger | declared + imported |
| packages/db | packages/ids | declared + imported |
| packages/email | packages/logger | declared + imported |

Hard rule (test-enforced, not just snapshotted): no package imports app code.

## 2. apps/web/src buckets

Top-level directories of src, with lib split one level deeper; root-level files form `(root)`. The components -> lib/server edge is the TanStack Start server-function pattern, recorded as reality.

Nodes (9): (root), components, lib/client, lib/server, lib/shared, locales, routes, test, types
Edges (17):

- (root) -> components
- (root) -> lib/server
- (root) -> routes
- components -> lib/client
- components -> lib/server
- components -> lib/shared
- components -> routes
- lib/client -> lib/server
- lib/client -> lib/shared
- lib/server -> lib/shared
- lib/shared -> lib/server
- lib/shared -> locales
- routes -> (root)
- routes -> components
- routes -> lib/client
- routes -> lib/server
- routes -> lib/shared

## 3. Server domains (lib/server/domains)

Nodes (42): activity, ai, analytics, api, api-keys, assistant, boards, changelog, channel-accounts, comments, companies, company-attributes, conversation, conversation-attributes, conversation-views, embeddings, feedback, help-center, import, macros, merge-suggestions, notifications, office-hours, platform-credentials, post-tags, posts, principals, push-devices, roadmaps, segments, sentiment, settings, sla, statuses, subscriptions, summary, teams, tickets, user-attributes, users, webhooks, workflows
Edges (74):

- analytics -> api
- analytics -> settings
- api -> api-keys
- api -> settings
- api -> webhooks
- api-keys -> principals
- assistant -> ai
- assistant -> conversation
- assistant -> conversation-attributes
- assistant -> help-center
- assistant -> principals
- assistant -> settings
- assistant -> tickets
- boards -> settings
- changelog -> settings
- comments -> activity
- comments -> posts
- comments -> settings
- comments -> subscriptions
- conversation -> assistant
- conversation -> changelog
- conversation -> channel-accounts
- conversation -> comments
- conversation -> notifications
- conversation -> posts
- conversation -> principals
- conversation -> settings
- conversation -> sla
- conversation -> teams
- embeddings -> ai
- embeddings -> merge-suggestions
- feedback -> activity
- feedback -> ai
- feedback -> embeddings
- feedback -> merge-suggestions
- feedback -> posts
- feedback -> principals
- feedback -> settings
- feedback -> subscriptions
- help-center -> ai
- help-center -> settings
- import -> principals
- macros -> workflows
- merge-suggestions -> ai
- merge-suggestions -> posts
- merge-suggestions -> settings
- posts -> activity
- posts -> embeddings
- posts -> platform-credentials
- posts -> settings
- posts -> subscriptions
- principals -> settings
- principals -> teams
- roadmaps -> activity
- sentiment -> ai
- sentiment -> settings
- settings -> ai
- settings -> platform-credentials
- sla -> office-hours
- subscriptions -> changelog
- summary -> ai
- summary -> settings
- tickets -> notifications
- tickets -> principals
- tickets -> settings
- tickets -> teams
- users -> principals
- users -> user-attributes
- webhooks -> settings
- workflows -> conversation
- workflows -> conversation-attributes
- workflows -> office-hours
- workflows -> segments
- workflows -> sla

### Cycles

Strongly connected components with more than one domain. A new entry here is a new cycle and needs an explicit decision.

- assistant <-> conversation
- embeddings <-> merge-suggestions <-> posts
