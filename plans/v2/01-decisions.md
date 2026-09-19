# Decisions Log

> Owner answers from two rounds (both 2026-09-19): round 1 after the v1 review, round 2 answering the
> 55 outstanding questions. **Status key:** ✅ decided · 🟡 default adopted, owner may override later ·
> ⏳ awaiting owner input. Plans cite decisions by ID (e.g. "per D-T1"). Question numbers (Q1–Q55) refer to
> the round-2 question list.

## Global

| ID  | Decision                                                                                                                                                                                                                                                                                         | Status |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| D1  | **Fork-only.** Features are not contributed upstream. Upstream PRs are decided **case by case**: the custom-roles-on-REST/MCP fix will **not** be offered (Q18); the 2FA-reset / force-sign-out target guard **will** be offered (Q40). Per-app inbound email is fork-only (Q7). | ✅     |
| D2  | Separate fork migration lineage: `packages/db/drizzle-fork/` + `drizzle.__fork_migrations`, applied after upstream (`02-fork-conventions.md` §3).                                                                                                                                                 | ✅     |
| D3  | Enforce custom roles on the REST API and MCP. Carried permanently as a fork patch (seams R-1…R-5).                                                                                                                                                                                               | ✅     |
| D4  | **Seat limits and paid-plan limits do not apply** to any deployment (Q10, Q14). Plans must not rely on or build seat mechanics.                                                                                                                                                                    | ✅     |
| D-X1 | **All fork UI inherits each app's branding** (owner, round 2): hub pages, banners (incl. the external embed) and fork panels use the app's own design tokens (`brandingConfig` + `customCss` via upstream's theme generator), so branding set once in an app applies everywhere in that app (`02-fork-conventions.md` §11). | ✅     |
| D-E1 | **Intranet-only deployment** (owner, round 3): every app, portal, widget, the control tower and all end users live on the company intranet. **All users are authenticated employees**: sign-in is enforced **both** at the network edge (SSO proxy/VPN) **and** by Quackback's own SSO login. | ✅     |
| D-E2 | **No outbound internet connections** from any component (no third-party SaaS, CDNs, public AI APIs, public email services or webhooks to the internet). Only intranet services and AWS services reachable privately (VPC endpoints / PrivateLink) may be used. | ✅     |
| D-E3 | **Portal setting = public visibility, anonymous posting/voting OFF, SSO-only sign-in** (owner chose option (a) over private + domain allow-list). Supersedes D-N5 ("all portals private"). Protection against unauthenticated readers relies on the edge SSO + Quackback SSO (D-E1). | ✅     |
| D-E4 | **All end users are employees**; there are no external requesters. | ✅     |
| D-E5 | **AI features run on AWS Bedrock (via PrivateLink) and/or the company's internal LLM proxy** — never a public AI API. Covers the Quinn assistant, Ask AI, embeddings/search, classification and summaries. | ✅     |
| D-E6 | The internal LLM proxy is **OpenAI-compatible** (`/v1/chat/completions`, `/v1/embeddings`). Default AI path: point Quackback's OpenAI client at the proxy (which may itself front Bedrock); a native Bedrock adapter is only built if the proxy can't serve a required model. | ✅     |

## Control tower (`20-control-tower.md`)

| ID    | Decision                                                                                                                                                                                                                                                                       | Status |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| D-C1  | **Separate app** `apps/control-tower/`.                                                                                                                                                                                                                                        | ✅     |
| D-C2  | **Every action auditable to the human.** The tower acts through each app's MCP endpoint with the admin's own OAuth token; dual audit (tower + app-native).                                                                                                                     | ✅     |
| D-C3  | AWS managed Postgres: **one shared RDS/Aurora cluster**, one database + one login role per app (Q4). Pooled DSN → RDS Proxy; direct DSN → writer endpoint.                                                                                                                  | ✅     |
| D-C4  | One fleet root key in AWS Secrets Manager (KMS); never held by the tower; rotation via `v<gen>`.                                                                                                                                                                               | ✅     |
| D-C5  | Fleet role → app role mapping (Q1, default): owner → app **Admin**; agent → **"Fleet Agent"**; observer → **"Fleet Observer"**. Generalised by D-C9.                                                                                                                         | 🟡     |
| D-C6  | Apps on **subdomains of one fleet domain** with an ACM wildcard certificate; custom domains per app later (Q3).                                                                                                                                                                | ✅     |
| D-C7  | **Identity provider:** a standards-compliant **OAuth2/OIDC or SAML** provider, vendor not fixed (Q2). The tower and every app must support **both OIDC and SAML**; group/claim → role mapping is configuration, not code.                                                     | ✅     |
| D-C8  | **Backups at fleet (cluster) level** only; no per-app restore requirement (Q5).                                                                                                                                                                                                | ✅     |
| D-C9  | Teams need **different feature levels per persona** in both the tower and each app dashboard (Q10) ⇒ tower authorization is **configurable role bundles** (observer/agent/owner are only seeds), each mapped to a tenant custom role.                                        | ✅     |
| D-C10 | **One shared S3 bucket** with per-app prefix isolation (Q6).                                                                                                                                                                                                                   | ✅     |
| D-C11 | **Per-app inbound email is required**, built in the fork (Q7): per-app inbound signing secret derived from the fleet root key, like app secrets.                                                                                                                             | ✅     |
| D-C12 | **No per-app consent screens** (Q8, Q9): the tower is a trusted first-party client (`skip_consent`); a "connect all apps" flow obtains each app's token via silent SSO sign-in. Attribution unaffected (the human still authenticates).                                      | ✅     |
| D-C15 | **The tower owns the entire app role set of every tower-managed person** (owner, round 4; resolves second-pass R2-3). At each sync the tower sets their complete role set in every app; roles granted locally by an app admin are removed. There are no locally adopted roles for managed principals. Unmanaged people (not in the tower) are untouched. Supersedes the O-C8 question. | ✅     |
| D-C16 | **The IdP supports SCIM or a directory API** (owner, round 4; R2-4). Revocation is driven by directory sync, not by login-time claims. Disabling a person produces a tenant-level denial on every auth path (sessions, OAuth/MCP tokens, API keys they created), independent of grant bookkeeping. The revocation bound must be stated as target vs hard maximum with polling/queue/retry budget. | ✅     |

## RBAC / personas (`10-rbac-persona-extensions.md`)

| ID   | Decision                                                                                                                                                                          | Status |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| D-R1 | **No seat-exempt / viewer mechanism** — seat limits don't apply (D4). Former Phase 4 dropped.                                                                                      | ✅     |
| D-R2 | Two-part permission keys only.                                                                                                                                                    | ✅     |
| D-R3 | Personas (UX, dev, stakeholders, Tier 1/2/3) each need **different feature levels** in the app dashboard and the tower (Q10). All are dashboard teammates.                      | ✅     |
| D-R4 | **Multi-role ("multiple hats") is in scope** (Q11).                                                                                                                                | ✅     |
| D-R5 | **No board-scoped teammates** (Q12).                                                                                                                                               | ✅     |
| D-R6 | **Strict read-only teammates, including no commenting** (Q13) ⇒ Phase 1b (teammate comment gate + `comment.create` key) in scope on dashboard, REST and MCP paths.              | ✅     |
| D-R7 | Fleet Observer may hold fleet-wide `conversation.view_all` / `ticket.view_all` (Q15).                                                                                             | ✅     |
| D-R8 | API-key permission backfill: dry-run report, then explicit apply (Q16).                                                                                                           | ✅     |
| D-R9 | Team-scoped grants reuse upstream's reserved `principal_role_assignments.team_id`; watch for upstream semantics at each merge (Q17).                                            | ✅     |

## Tiered support (`30-tiered-support.md`)

| ID    | Decision                                                                                                                                                                                                                           | Status |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| D-T1  | SLA **carries** on escalation.                                                                                                                                                                                                     | ✅     |
| D-T2  | **Clear** the previous agent on escalation.                                                                                                                                                                                        | ✅     |
| D-T3  | The **ticket** is the source of truth for tier.                                                                                                                                                                                    | ✅     |
| D-T4  | Team-scoped RBAC (`10-…` Phase 2) ships before tier permissions.                                                                                                                                                                   | ✅     |
| D-T5  | T1 intake via workflows; workspace auto-routing **off** while tiers are on (Q19).                                                                                                                                                 | ✅     |
| D-T6  | Escalator keeps **read access while watching** — seam T-1 approved (Q20).                                                                                                                                                          | ✅     |
| D-T7  | **Managers hold `ticket.escalate`** (Q21), overriding the shared "not Manager" default for this key.                                                                                                                                | ✅     |
| D-T8  | **De-escalation only by agents on the tier currently holding the ticket** (Q22 "agents on receiving tier", read as the tier that received the escalation).                                                                       | 🟡     |
| D-T9  | **No automatic de-escalation** (Q23).                                                                                                                                                                                              | ✅     |
| D-T10 | **Everything starts at Tier 1**; no skills/attribute routing at intake (Q24).                                                                                                                                                     | ✅     |
| D-T11 | End-user hub = **option B**: a new hub landing page (portal) + widget Home section that chains find-an-answer → still need help (chat / submit request) → track → rate, linking into the existing upstream pages. Prototype: https://claude.ai/artifact/XAn1u4GewieesuMGHsua43 | ✅     |
| D-T12 | **Signed-out and email-only requesters get the hub** (Q26), via passwordless access (magic link / email one-time code, already in upstream auth) scoped to their own requests.                                                   | ✅     |
| D-T13 | **No additional channels** (Q27).                                                                                                                                                                                                  | ✅     |
| D-T14 | Balanced distribution ignoring ticket-only load is **accepted** (Q28).                                                                                                                                                            | ✅     |

## Support account actions (`40-support-account-actions.md`)

| ID    | Decision                                                                                                                                                                                                                    | Status |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| D-A1  | Accounts live in the customer's own connected apps, not Quackback.                                                                                                                                                         | ✅     |
| D-A2  | Requester ≠ approver, enforced (Q31).                                                                                                                                                                                       | ✅     |
| D-A3  | Approver must hold `account.execute` **through a team-scoped grant** on the owning tier's team (`canInTeam`); no workspace-wide fallback (staff review A1). Team-scoped RBAC (`10-…` Phase 2) is a prerequisite of account actions. | ✅     |
| D-A4  | Managers do **not** get account-action permissions (Q34).                                                                                                                                                                  | ✅     |
| D-A5  | **No external-account-link table** (Q35). The customer's identity (email + identify-time external user id / attributes) is sent to the app's API, which resolves its own account.                                          | ✅     |
| D-A6  | **Extensible without code per action** (Q29): per-app actions are configuration (and/or advertised by the app's API), each with a **minimum tier**; permission keys are generic, not one per action.                      | ✅     |
| D-A7  | Quinn (AI) may invoke account actions **only if enabled per workspace; off by default** (Q39).                                                                                                                             | ✅     |
| D-A8  | **Tiers roll up** (Q29): Tier N may do everything Tier N−1 may, plus its own actions.                                                                                                                                      | ✅     |
| D-A9  | Backend = **HTTP API endpoints** exposed by each connected app (Q30); MCP connectors are not a v1 backend.                                                                                                                  | ✅     |
| D-A10 | Owner/Admin break-glass approval, audited, never self-approval (Q33).                                                                                                                                                      | ✅     |
| D-A11 | An over-tier request **escalates the ticket** to the tier that can approve it (Q36).                                                                                                                                       | ✅     |
| D-A12 | **No ticketless actions** (Q37): actions only from a ticket; no People-profile entry point.                                                                                                                                | ✅     |
| D-A13 | Requests expire after **72 hours**; requester notified (Q38).                                                                                                                                                              | ✅     |
| D-A14 | Offer upstream a guard so 2FA reset / force sign-out cannot target the owner or higher-ranked roles (Q40).                                                                                                                 | ✅     |

## Prioritization (`50-prioritization-scoring.md`)

| ID   | Decision                                                                                                                                                                                                 | Status |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| D-P1 | "Reach should be impact by votes": Reach = vote count, or Impact derived from votes? (Q42)                                                                                                               | ⏳     |
| D-P2 | BRICE formula, factor scales, weighted vs multiplicative, and whether "B" uses company revenue (Q41).                                                                                                   | ⏳     |
| D-P3 | Reach weighted by voter value vs raw count (Q43).                                                                                                                                                        | ⏳     |
| D-P4 | RICE scales for Confidence and Effort (Q44).                                                                                                                                                             | ⏳     |
| D-P5 | Scoring allowed **only while a post is Under Review** (Q45).                                                                                                                                             | ✅     |
| D-P6 | **Only the UX team scores** (Q46): `prioritization.score` granted to the "UX Team" role only (not Manager/Contributor). `prioritization.manage` (framework config) becomes admin-only + UX Team role.    | ✅     |
| D-P7 | On framework switch, posts **still Open or Under Review need re-scoring**; others keep their old score, labelled with its framework (Q47).                                                             | ✅     |
| D-P8 | Separate `post_prioritization.csv` in the workspace export + read-only fork MCP tool; REST later (Q48).                                                                                                  | ✅     |
| D-P9 | One current score per post + full history (Q49).                                                                                                                                                          | ✅     |

## Announcements (`60-announcements-banner.md`)

| ID   | Decision                                                                                                                                                                                                                  | Status |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| D-N1 | No localised content; banner labels English-only (Q51).                                                                                                                                                                   | ✅     |
| D-N2 | Dismissal stored in the browser only.                                                                                                                                                                                     | ✅     |
| D-N3 | Live status incidents fold into the banner.                                                                                                                                                                               | ✅     |
| D-N4 | **Plain-text body with templated styling**: fixed per-type presets (colour, icon, layout) so authors only type text; optional saved text templates for common notices (Q50).                                             | ✅     |
| D-N5 | ~~All app portals are private~~ — **superseded by D-E3** (public visibility on an SSO-only intranet, anonymous off). | ✅     |
| D-N6 | **Instant push** of publish/update/archive to open portals and embeds (Q53), using upstream's realtime pub/sub + stream infrastructure (`lib/server/realtime/*`).                                                         | ✅     |
| D-N7 | On sites also running the widget, the banner shows **the same announcements** the identified user sees in the portal, including segment-targeted ones (Q54, read together with D-N5).                                    | 🟡     |
| D-N8 | **Fleet owners and Fleet Agents** may create and publish announcements (Q55).                                                                                                                                             | ✅     |
| D-N9 | **Every banner is dismissible by the user**, including incidents; no author-side option to make a banner non-dismissible. Dismissal is per browser (D-N2). | ✅     |

## Resolved while writing the v2 plans (traceability)

| ID   | Item                                                                                                 | Resolution                                                      |
| ---- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| X-R1 | Fork-only releases never reach pooled tenants via the fleet migrator.                                 | `fork-migrate` step after `fleet-migrator run` (`02-…` §3.3).   |
| X-R2 | MCP registration, settings nav, Labs and catalogue edits duplicated per plan.                        | Shared foundation seams F-3/F-4/F-6/F-7 (`02-…` §10).           |
| X-R3 | Fork tables with principal references invisible to upstream's principal-merge completeness test.    | Fork re-point registry + seam F-5 (`02-…` §8).                  |
| X-R4 | `policy/dep-graph/GRAPH.md` missing from the regenerate list.                                         | Added.                                                          |
| X-R5 | Tier bundles contradicted the unlock/create requirement.                                              | Superseded by D-A6/D-A8 (tier roll-up + minimum tier per action). |
| X-R6 | `tower_tenant_clients` not in the shared table list.                                                  | Accepted.                                                       |
| X-R7 | 40 needs a callable escalate function.                                                                | `escalateTicket` contract in `30-…` §11.                       |

## Still open

| ID    | Question                                                                                                                         |
| ----- | -------------------------------------------------------------------------------------------------------------------------------- |
| D-P1  | "Reach should be impact by votes": Reach = the post's vote count, or Impact derived from votes?                                  |
| D-P2  | BRICE formula, factor scales, weighted vs multiplicative, and whether "B" uses company revenue.                                  |
| D-P3  | Reach weighted by voter value (e.g. company revenue), or a raw count?                                                            |
| D-P4  | RICE scales: Confidence fixed (50/80/100 %) or free %; Effort in person-months or T-shirt sizes.                                 |
| D-T8  | Confirm de-escalation is done by the tier currently holding the ticket (not the lower tier receiving it back).                   |
| D-N7  | Confirm embedded banners on widget sites show identified users the same announcements (incl. segment-targeted) as the portal.  |
| D-C5  | Confirm the default fleet role → app role mapping.                                                                               |

## Raised by the round-2 revisions (owner input needed; plans use the stated default meanwhile)

| ID    | Plan | Question                                                                                                                                                                                                                    | Default in plan                                |
| ----- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| O-C1  | 20   | Upstream apps support only OIDC sign-in. Is it acceptable for apps to reach a SAML identity provider through an OIDC broker (e.g. Keycloak, Cognito), with only the tower supporting SAML natively? Native SAML in every app would need several upstream auth seams. | Broker                                         |
| O-P10 | 50   | Old-framework scores are not strictly comparable with current ones. Sort current-framework scores first and frozen old ones after them, or mix them numerically? | Current first, old after |
| O-R3  | 10   | Owner and Admin hold every permission by design, so "only the UX team scores" means UX Team + Owner/Admin. Acceptable, or add a fork-side exclusion so even Admins can't score?                                           | UX Team + Owner/Admin                          |
| O-R4  | 10   | The Dev Team can't be limited to drafting changelog entries: upstream's single `changelog.manage` covers create, edit and publish. Grant full `changelog.manage` to Dev Team, or leave changelog out of Dev Team?        | Grant `changelog.manage`                       |
| O-R5  | 10   | Strict read-only (D-R6) blocks commenting, but voting and emoji reactions by read-only teammates stay ungated. Also block those?                                                                                          | Leave ungated                                  |
| O-T15 | 30   | Should requesters who only have hub access (on a private portal) see "Find an answer" (help-center search and Ask AI)?                                                                                                     | Hidden                                         |
| O-T14 | 30   | When an email-only requester signs in to the hub, merge in earlier requests whose sender failed email authentication (weak DMARC), keeping an "unverified" badge on them?                                                | Yes, with badge                                |
| O-A3  | 40   | Beyond break-glass **approval** (D-A10), may Owner/Admin also **run** any account action directly regardless of tier?                                                                                                     | Yes, audited                                   |
| O-A4  | 40   | Should actions that a connected app newly advertises arrive **disabled** until an admin enables them?                                                                                                                     | Disabled                                       |
| O-A5  | 40   | Which customer attributes (beyond email, name and external user id) may be sent to a connected app? Per-app allow-list.                                                                                                     | None (empty allow-list)                        |


## Raised by the staff review (owner input needed; plans use the stated default meanwhile)

| ID    | Plan | Question | Default in plan |
| ----- | ---- | -------- | --------------- |
| O-R6  | 10 | Should an API key created by a team-restricted agent act only on its creator's teams' tickets and conversations (needs extra upstream seams), or stay workspace-wide with no ticket/conversation access at all? | Workspace-wide, no ticket/conversation access |
| O-R7  | 10 | Upstream lets any teammate with `conversation.view` open any conversation by ID, while ticket reads by ID become team-limited. Keep upstream's conversation behaviour for Tier agents? | Keep upstream behaviour |
| O-C3  | 20 | Accept one shared edge-to-app HMAC secret for inbound mail delivery, while reply-address keys stay per app? | Accept |
| O-C8  | 20 | ~~Local edits vs tower~~ — **answered by D-C15** (tower owns the whole role set). | — |
| O-C9  | 20 | Maximum delay for an IdP disable/group removal to take effect in every app — a target or a hard maximum? (Mechanism is now D-C16.) | 15-minute target |
| O-C10 | 20 | Tier bundles need an explicit per-app team mapping maintained in the tower, and grant nothing in apps without one. Acceptable? | Yes |
| O-T16 | 30 | Are tiers an operational routing convention (any agent with ticket access can still act), or a strict read/write restriction per tier? | Routing convention; escalators become read-only after handoff |
| O-T17 | 30 | Does escalating a ticket count as its first response for SLA purposes? | No |
| O-T18 | 30 | When a blocked email-only lead is claimed by a signed-in requester, how does the block carry over? | Block moves to the user (read-only; can't reply, file or rate); lead kept as a block anchor for future mail |
| O-A9  | 40 | If a ticket moves teams after an account-action request, does approval follow the ticket's current team (re-routing if its tier is too low)? | Yes, follows current team |
| O-A10 | 40 | Which changes invalidate an approval and require re-approval? | Any change to the customer's identifiers or allowed attributes, inputs, app base URL, config or signing-secret version, or action definition version |
| O-A11 | 40 | May a customer known only by email (no account) be an account-action target? | Only after they verify by signing in to the help hub |
| O-A12 | 40 | Reuse the existing `ticket_note_added` notification type for request-expiry notices (no new notification type)? | Yes |
| O-P11 | 50 | After a framework switch, decide "needs re-scoring" once, from each post's status at the switch, or re-check it from the current status every time? | Once, at the switch |
| O-P12 | 50 | Should posts keeping an old-framework score show it frozen as it was at the switch, or keep recalculating it from new votes with the old formula? | Frozen |
| O-N10 | 60 | Is it acceptable for a new, changed or resolved **status incident** to take up to 5 minutes to reach an already-open banner (announcements themselves are instant)? | Yes |
| O-N11 | 60 | On internal apps, should the embedded banner use only the app's theme colours and font, not its custom CSS (custom CSS applies in portal and hub)? | Yes |
| O-N12 | 60 | Do you also want a banner strip inside the support widget panel? | No (reserved, deferred) |

D-N7 default (after D-E3): on internal apps every employee sees "Everyone" announcements without being identified;
segment-targeted items appear only when the host app identifies the user, and then match the portal.
D-T8 default: higher-tier agents outside the owning team, and Managers, may de-escalate.


## Raised by the intranet revisions (owner input needed; plans use the stated default meanwhile)

| ID    | Plan | Question | Default in plan |
| ----- | ---- | -------- | --------------- |
| O-C11 | 20 | Incoming support email: one catch-all fleet mailbox on the internal mail server, read by a fork mail router that routes each message to its app (upstream IMAP can't run per app under pooled tenancy), or one mailbox per app? | One fleet mailbox + router |
| O-C12 | 20 | SSO-only sign-in: is it acceptable that domain SSO **enforcement** switches on after each app's first real SSO sign-in (upstream requires a successful SSO login first), and that fleet ops hold each app's break-glass recovery codes in Secrets Manager? | Yes |
| O-C13 | 20 | May the tower, provisioner and mail router reach apps through a private DNS zone that bypasses the edge SSO proxy (same hostnames; they authenticate with their own tokens)? | Yes |
| O-C14 | 20 | Which internal domain and private certificate authority should the fleet use for app hostnames? | ⏳ needs your values |
| O-T19 | 30 | If the company IdP doesn't send `email_verified`, may Quackback trust an email on the verified company domain that the IdP owns? (Otherwise earlier email requests can't be claimed at sign-in.) | Yes |
| O-T20 | 30 | Is a plain nav link "Help hub" (not translated) enough, avoiding an upstream edit? | Yes |
| O-A12 | 40 | Connected internal apps must use HTTPS with a certificate from the company CA (trusted via `NODE_EXTRA_CA_CERTS`), with no option to skip certificate checks. OK? | Yes |
| O-A13 | 40 | Apps resolve the customer's account in this order: SSO subject → employee ID (if you map it from an IdP claim) → external user ID → verified email. OK? | Yes |
| O-N14 | 60 | Embedded banners on internal apps: "Everyone" announcements show to anyone reaching the app without identifying them; segment-targeted ones only when the host app identifies the user. OK? | Yes |
| O-N15 | 60 | The edge SSO proxy must let six banner embed paths through without Quackback's login cookie (script, "everyone" feed, live-update stream, fonts, and two optional identity endpoints) — or use a shared cookie domain across internal apps. Which? | Proxy exemption for those paths |

**Ask of the mail team:** have the internal mail server stamp an `Authentication-Results` header on inbound mail; without
it Quackback treats every internal email as unverified.

Verification tasks recorded in the plans (not decisions): RDS Proxy pinning (20 V-1); MCP token lifetimes and `skip_consent` behaviour (20 V-4, V-8); AWS S3 through the registry's storage record, which today only accepts `provider: 'r2'` and static keys (20 V-7); whether `/api/widget/kb-ask` respects private-portal/help-center audience rules (30); banner stream limiter sizing (60 N-11).
