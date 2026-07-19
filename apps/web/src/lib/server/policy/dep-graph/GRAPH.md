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
Edges (18):

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
- test -> lib/client

## 3. Server domains (lib/server/domains)

Nodes (47): activity, ai, analytics, api, api-keys, assistant, boards, changelog, channel-accounts, comments, companies, company-attributes, conversation, conversation-attributes, conversation-views, embeddings, export, feedback, help-center, import, inbox, macros, merge-suggestions, moderation, notifications, office-hours, platform-credentials, post-tags, posts, principals, push-devices, roadmaps, roles, segments, sentiment, settings, sla, status, statuses, subscriptions, summary, teams, tickets, user-attributes, users, webhooks, workflows
Edges (107):

- analytics -> api
- analytics -> assistant
- analytics -> principals
- analytics -> settings
- api -> api-keys
- api -> settings
- api -> webhooks
- api-keys -> principals
- assistant -> ai
- assistant -> api
- assistant -> boards
- assistant -> conversation
- assistant -> conversation-attributes
- assistant -> embeddings
- assistant -> help-center
- assistant -> principals
- assistant -> settings
- assistant -> status
- assistant -> tickets
- assistant -> workflows
- boards -> settings
- changelog -> ai
- changelog -> embeddings
- changelog -> settings
- comments -> activity
- comments -> posts
- comments -> settings
- comments -> subscriptions
- conversation -> ai
- conversation -> assistant
- conversation -> changelog
- conversation -> channel-accounts
- conversation -> comments
- conversation -> conversation-attributes
- conversation -> posts
- conversation -> principals
- conversation -> settings
- conversation -> sla
- conversation -> teams
- conversation -> tickets
- conversation-attributes -> ai
- conversation-attributes -> assistant
- conversation-attributes -> conversation
- conversation-attributes -> settings
- embeddings -> ai
- embeddings -> merge-suggestions
- export -> companies
- export -> conversation
- export -> users
- feedback -> activity
- feedback -> ai
- feedback -> assistant
- feedback -> conversation
- feedback -> embeddings
- feedback -> merge-suggestions
- feedback -> posts
- feedback -> principals
- feedback -> settings
- feedback -> subscriptions
- help-center -> ai
- help-center -> settings
- import -> principals
- inbox -> conversation
- inbox -> tickets
- macros -> workflows
- merge-suggestions -> ai
- merge-suggestions -> posts
- merge-suggestions -> settings
- moderation -> comments
- moderation -> posts
- posts -> activity
- posts -> embeddings
- posts -> platform-credentials
- posts -> settings
- posts -> subscriptions
- principals -> roles
- principals -> settings
- principals -> teams
- roles -> settings
- sentiment -> ai
- sentiment -> settings
- settings -> ai
- settings -> platform-credentials
- sla -> office-hours
- sla -> settings
- subscriptions -> changelog
- subscriptions -> status
- summary -> ai
- summary -> settings
- tickets -> conversation
- tickets -> principals
- tickets -> settings
- tickets -> sla
- tickets -> teams
- users -> principals
- users -> user-attributes
- webhooks -> settings
- workflows -> assistant
- workflows -> conversation
- workflows -> conversation-attributes
- workflows -> inbox
- workflows -> office-hours
- workflows -> segments
- workflows -> settings
- workflows -> sla
- workflows -> tickets
- workflows -> users

### Cycles

Strongly connected components with more than one domain. A new entry here is a new cycle and needs an explicit decision.

- assistant <-> conversation <-> conversation-attributes <-> inbox <-> tickets <-> workflows
- changelog <-> embeddings <-> merge-suggestions <-> posts <-> subscriptions
