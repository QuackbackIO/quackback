# Settings Simplification: Implementation Spec

You are implementing a decided, fully-designed overhaul of Quackback's admin settings: product enable toggles, AI feature GA promotion, and settings relocations. Every decision below is final (made by the maintainer on 2026-08-22 after a full audit); do not re-litigate them. Your job is faithful implementation, including migrations, copy, tests, and cleanup.

## 1. Design references (authoritative for target UI)

The target designs exist as pixel-accurate static HTML mockups built from this codebase's real tokens and component anatomy. Open them in a browser to see exactly what to build:

Directory: `/tmp/claude-1000/-home-james-quackback/a7783f0e-3cff-42b2-9251-9589d5a82b75/scratchpad/settings-design/`

| File                                                 | Shows                                                                                                                                                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Main.dc.html`                                       | **Settings → General (target)**: Workspace card with logo left of the name input; Products card only (no AI card); Feedback row with "Always on" badge                                     |
| `GeneralCurrent.dc.html`                             | General as it is today (for diffing)                                                                                                                                                       |
| `LabsCurrent.dc.html`                                | The Labs page being deleted                                                                                                                                                                |
| `PortalPage.dc.html`                                 | **The renamed Portal page (target)**: Appearance + Navigation + Welcome message only; Feedback nav row with "Always on" badge; Changelog nav row normal; Help row with "Product off" badge |
| `StatusSettings.dc.html`                             | **Status settings (target)**: no publish switch; description input + Visibility card                                                                                                       |
| `MessengerSettings.dc.html`                          | **Messenger (target)**: Surfaces card with two switches (Widget, Portal chats); Messaging card with team name, welcome/offline messages, and a Translations locale section                 |
| `WidgetModules.dc.html`                              | **Widget Modules card (target)**: rows only for enabled products; no Messages row (moved to Messenger)                                                                                     |
| `SettingsNav.dc.html` / `SettingsNavCurrent.dc.html` | Target vs current settings sidebar                                                                                                                                                         |
| `PortalAccess.dc.html`                               | **Access & Security → Portal access (target)**: gains "Allow anonymous interaction"                                                                                                        |
| `ModerationProposed.dc.html`                         | **Moderation (target)**: Approval rules + Content review only, no row sublines                                                                                                             |
| `MovesSheet.dc.html`                                 | The full list of moves/renames/removals with rationale                                                                                                                                     |
| `canvas.json`, `gen.mjs`                             | Layout manifest and the generator that produced the mockups (contains exact copy strings)                                                                                                  |

The published canvas (same content, panable): https://claude.ai/code/artifact/1c4ee16a-cc65-411f-bd45-6ac45993b455

The example workspace in all mockups: Support ON, Changelog ON, Help Center OFF, Status ON, Feedback always on. "Product off" examples always use Help Center (Changelog is part of the core Feedback & Roadmaps offering and defaults on; never depict it off in UI states or fixtures).

## 2. Ground rules

- Work on a branch off `main`. Line numbers cited below are from `main` @ `c70a8c907`; re-verify each before editing.
- **No SQL migrations are needed** — every stored shape touched here lives in JSON/TEXT columns (`settings.portal_config`, `settings.metadata`, `settings.widget_config`, feature flags in `metadata`). All migrations are **read-time repair** (the `resolveFeatureFlags` pattern in `apps/web/src/lib/server/domains/settings/settings.types.ts:1122-1137`): resolve stored legacy shapes to the new shape on read; the next write persists clean. NEVER run `db:generate` (permanently broken in this repo). If you believe you need a schema change, stop and reconsider — you don't.
- Server code logs via `makeLogger` (pino), `(msg, ctx)` signature. Never `console.*`.
- Never name competitor products anywhere (code, comments, commits, fixtures).
- Copy rules: less is more. No redundant helper lines; a card description carries the meaning, rows stay quiet. Match the existing register (see the mockups' exact strings — use them verbatim unless a cited real-source string exists). Menus/chrome follow the density tokens in CLAUDE.md (`MENU_ROW`, `Badge size` rules; the "Always on" badge is `<Badge variant="outline">` at default 12px size).
- Tests: run the app suite with vitest (NOT `bun test`). The app suite has NO pre-existing failures — if you see a "baseline" of failures, your `quackback_test` DB is behind on migrations; fix that first. E2e uses port 3100 conventions; do not trust `reuseExistingServer` against a stale server.
- Locale files under `apps/web/src/locales/*.json` are hand-maintained (9 files) and guarded by `locale-parity.test.ts`. Any message id you add/rename/remove must be updated in ALL locales.
- Commits: conventional style matching the repo's history; never add co-author trailers.

## 3. Workstream A — Promote Inbox AI, Connectors, Skills to GA (delete the flags)

Delete the feature flags `inboxAi`, `assistantConnectors`, `assistantSkills` outright. The features become always-available; their only remaining gate is what already exists functionally (a configured AI model, per-capability controls under AI & Automation). No toggle replaces them anywhere.

In `apps/web/src/lib/server/domains/settings/settings.types.ts`:

- Remove the three keys from `FeatureFlags` and `DEFAULT_FEATURE_FLAGS` (~:1153-1163). `resolveFeatureFlags` already drops unknown stored keys, so stored values are self-cleaning.
- Delete `LEGACY_FLAG_MAP` (:1109-1113) and its OR-in loop — its only purpose was coalescing legacy keys into `inboxAi`.
- Delete `GA_FEATURE_SECTIONS` (:1343-1353), `LAB_SECTIONS` (:1367-1378), `LabSectionRow` + the never-used `subFlags` (:1362-1365).
- Trim `FEATURE_FLAG_REGISTRY` (:1200-1246): after this workstream its only consumers are gone — see whether anything still imports it; if not, delete it entirely (6 of its 9 entries were already unrendered dead copy).

UI/routes:

- Delete `apps/web/src/routes/admin/settings.labs.tsx`, `apps/web/src/components/admin/settings/experimental-settings.tsx`, and `apps/web/src/components/admin/settings/feature-flag-sections.tsx`.
- Remove the Labs nav row (`apps/web/src/components/admin/settings/settings-nav.tsx:173`).
- `apps/web/src/routes/admin/settings.general.tsx:225-230`: remove the `FeatureFlagSections` render + import.
- Flip every flag gate to always-on (remove the check, don't hardcode `true` where dead code can be deleted instead):
  - `apps/web/src/components/admin/automation/automation-nav.tsx:47-48,67,78-88` (Connectors/Skills rows always shown)
  - `apps/web/src/routes/admin/automation.connectors.tsx:52` and `automation.skills.tsx:128-130` (delete the flag-off `<Navigate>` redirects)
  - `apps/web/src/lib/server/domains/settings/settings.assistant.ts:119-120` (`connectorsEnabled`/`skillsEnabled` — remove or hardwire, then chase consumers)
  - `apps/web/src/routes/admin/automation.copilot.tsx:143` (`CopilotDeploymentCard available={...}` — availability now derives from model configuration only; adjust `copilot-deployment-card.tsx:91-94` so the unavailable state talks about configuring a model, not enabling a flag)
  - `apps/web/src/routes/admin/automation.performance.tsx:49` and any inbox surfaces gating on `flags.inboxAi` (grep `-a` for `inboxAi` across `apps/web/src` — grep NOTE: some files contain NUL bytes and plain grep silently skips them; always use `grep -a`)
- `apps/web/src/lib/server/functions/feature-flags.ts`: schema is derived from `DEFAULT_FEATURE_FLAGS`, so it shrinks automatically; fix its stale comment about "Labs toggles" (:9-11).

Tests:

- `apps/web/src/lib/server/domains/settings/__tests__/lab-sections.test.ts`: rewrite as a products-only coverage test (every remaining flag belongs to exactly one product definition) or delete if trivial.
- `apps/web/e2e/tests/admin/settings-experimental.spec.ts`: delete.
- `apps/web/e2e/tests/admin/settings-general.spec.ts:16`: currently asserts 5 switches and is ALREADY wrong (page renders 6 today). After this spec the General page has **3 product switches** (Support, Help Center, Changelog, Status = 4 switches; Feedback has a badge, not a switch) — count carefully against the final page and scope the locator to the Products card.

## 4. Workstream B — Settings → General (target: `Main.dc.html`)

1. **Feedback row: badge, not a dead switch.** `settings.general.tsx:188-221`: for `product.id === 'feedback'` render `<Badge variant="outline">Always on</Badge>` in place of the Switch; delete the disabled-switch branch and the "Feedback & Roadmaps is always enabled" extra line. Also enforce the invariant server-side: `updateFeatureFlags` (`apps/web/src/lib/server/domains/settings/settings.service.ts:1036-1047`) must refuse/overwrite `feedback:false` on write (today only `resolveFeatureFlags` repairs it on read).
2. **Logo moves to General.** The Workspace card (`LocalWorkspaceNameCard`, `settings.general.tsx:237+`, and the cloud `CloudWorkspaceDetails` variant) gains the logo uploader to the LEFT of the workspace-name input, same row, 56px square (see `Main.dc.html`). Card description becomes "Your logo and name, shown across the portal, widget, and emails". Reuse/move the `LogoUploader` component from `apps/web/src/routes/admin/settings.branding.tsx:678-793` (crop dialog and mutations included). No helper text under the row.
3. **Favicon uploader is removed.** Delete `FaviconUploader` (`settings.branding.tsx:906-983`) and its mutations/queries. The favicon is **generated from the logo** at logo-upload time: when a logo is uploaded, also produce a small square derivative (the crop output is already square, 512px max — downscale to a sensible favicon size, e.g. 64px) and write it under the existing `favicon_key` storage so `routes/_portal.tsx:285,305` keeps working unchanged. Legacy behavior: a workspace with an existing stored favicon keeps it until the next logo upload overwrites it; deleting the logo clears both.
4. **Social share image is fully removed.** Delete `OgImageUploader` (`settings.branding.tsx:796-904`), its mutations/queries/server functions, and stop reading `portal_og_image_key`: `apps/web/src/lib/shared/portal-og-image.ts:9-13` should resolve to the logo (then `/logo.png`) unconditionally. Leave the DB column alone (no schema change); it just becomes unread.
5. **Status toggle publishes.** The General "Status" product switch becomes the single publish switch (see Workstream F for the Status settings page side). Row description becomes: "Publish a status page with live service status, incidents, maintenance, and uptime history." Semantics: the effective published state = `flags.statusPage && statusSettings.enabled !== false` resolved in ONE shared helper (see F); the General toggle ON writes `statusPage: true` AND `statusSettings.enabled: true` (clearing legacy false), OFF writes `statusPage: false`. This keeps workspaces that today have the flag on but the page unpublished from going live on upgrade.
6. **Quackback URL moves to Domains** (cloud only). Move the "Quackback URL" field + origin-transfer flow (`settings.general.tsx:112-118, 309-332`) out of `CloudWorkspaceDetails` into `apps/web/src/routes/admin/settings.domains.tsx`. General keeps only the workspace name (+ logo). The Domains page is already cloud-gated in the nav (`settings-nav.tsx:156-158`), matching this field's availability.
7. No AI card (Workstream A).

## 5. Workstream C — Branding becomes Portal (target: `PortalPage.dc.html`)

1. **Route + nav rename.** `/admin/settings/portal` (today a redirect stub, `apps/web/src/routes/admin/settings.portal.tsx`) becomes the real page; `/admin/settings/branding` becomes the redirect to it (bookmarks keep working — this inverts the current arrangement). Nav row label "Portal", icon `GlobeAltIcon` (`settings-nav.tsx:160`). Page header: icon `GlobeAltIcon`, title "Portal", description "Everything visitors see on your portal — theme, navigation, and content". Permission stays `SETTINGS_BRANDING`.
2. **Page contents shrink to three cards** (Identity and Social share leave per Workstream B): **Appearance** (unchanged controls; description gains "— also applied to the embedded widget", see mockup), **Navigation** (unchanged editor, plus item 4 below), **Welcome message** (item 3). The live portal preview pane stays.
3. **Welcome card → single "Welcome message" field.** Card title "Welcome message", description "Shown above the post list on your portal home. Leave empty to show nothing." Body: only the rich-text editor. Delete the enable switch and the Title input (`settings.branding.tsx:482-525` and related state/save wiring).
   - **Storage stays `portalConfig.welcomeCard`** but the resolved shape becomes `{ body }`. Read-time repair where welcomeCard is resolved (settings service / `getPublicPortalConfig`, `apps/web/src/lib/server/domains/settings/settings.service.ts:818-840`):
     - stored `enabled: true` and a non-empty `title` → prepend a heading node to `body.content`: `{ "type": "heading", "attrs": { "level": 2 }, "content": [{ "type": "text", "text": title }] }`, then drop `title` and `enabled`.
     - stored `enabled: false` (or absent) → resolve to empty body (the card is hidden). This intentionally discards stored drafts in the disabled state — almost always the untouched defaults; accepted.
   - Shown iff the body is non-empty: implement/reuse a proper Tiptap "empty doc" check (whitespace-only = empty), used both by the renderer (`apps/web/src/components/public/feedback/portal-welcome-card.tsx:12-30` — render body only, return null when empty) and anywhere `enabled` was read (`routes/_portal/index.tsx:134,139`).
   - `DEFAULT_PORTAL_CONFIG.welcomeCard` default body becomes EMPTY (today's stock title/body defaults would otherwise go live on every fresh workspace under presence-equals-shown).
   - Update the update schema/server fn to accept `{ welcomeCard: { body } }` and drop `enabled`/`title` from the write path.
4. **Navigation editor: Feedback row is always on.** In `apps/web/src/components/admin/settings/branding/portal-nav-editor.tsx`, the `feedback` row renders `<Badge variant="outline">Always on</Badge>` instead of its visibility Switch (drag-reorder and rename still work; see `PortalPage.dc.html`). Enforce at read time in `components/public/portal-header-nav.ts` (`resolvePortalNavItems`): a stored `enabled: false` on the built-in `feedback` item is ignored. Roadmap and every other row keep their switches.
5. **Copy sweep for the rename**: every string pointing at "Branding → Navigation" or "Branding" as a settings destination updates to "Portal → Navigation" / "Portal": `components/admin/settings/changelog/visibility-card.tsx:22`, `components/admin/settings/status/status-general-card.tsx` (see F), widget page "set it under Branding" hint (`routes/admin/settings.widget.tsx:1002-1008` area — that hint also becomes "set it under General" since the logo moved), and any others (`grep -a -rn 'Branding' apps/web/src --include='*.tsx'`).

## 6. Workstream D — Access & Moderation split (targets: `PortalAccess.dc.html`, `ModerationProposed.dc.html`)

1. Move the **"Allow anonymous interaction"** switch (key `portalConfig.features.allowAnonymous`, unchanged) from `apps/web/src/routes/admin/settings.moderation.tsx:160-176` to the Portal access tab (`apps/web/src/components/admin/settings/security/portal-auth-tab.tsx`), positioned after the visibility control and before Account signup (see mockup). Keep the label and its description ("When off, all boards require sign-in for voting, commenting, and submitting posts.").
2. Moderation page keeps two cards: Approval rules (2 switches) and Content review (2 switches). Rows carry labels only — no per-row sublines; the card descriptions carry the meaning (match `ModerationProposed.dc.html` exactly).
3. Repoint the board Access form's deep links and tooltips that today send admins to Moderation for this setting: `apps/web/src/components/admin/settings/boards/board-access-form.tsx:418-436` (banner link) and `:685` (tooltip) → the Portal access tab URL (`/admin/settings/security/authentication` + its `?tab=` param; verify the exact param value in `settings.security.authentication.tsx:25-28`).

## 7. Workstream E — Messenger & Widget consolidation (targets: `MessengerSettings.dc.html`, `WidgetModules.dc.html`)

1. **Surfaces card owns both messenger switches** (`apps/web/src/routes/admin/settings.channels_.messenger.tsx:86-124`):
   - Row "Widget" becomes a real Switch writing `widgetConfig.tabs.messenger` (today it's a link-out to Widget settings). Description: "Show the Messages tab in the widget."
   - "Portal Support" renamed **"Portal chats"**, description "Let signed-in customers start new conversations from the portal's Support tab." (same key `portalConfig.support.enabled`).
   - While here: extract ONE shared helper for the portal Support gate — today `supportTickets || (supportInbox && portal.support.enabled)` is duplicated with drift across `components/public/portal-header.tsx:71-72`, `routes/admin/settings.branding.tsx:277-279`, `routes/_portal/index.tsx:67-69`, `_portal/support.index.tsx:68-71`, and `settings.support.ts:13-17` uses a DIFFERENT formula. Put it next to `isPortalSupportEnabled` and use it everywhere, including the Channels hub badge (`settings.channels.tsx:60`, which must also account for `widget.enabled` so it matches `isMessengerEnabled`, `settings.widget.ts:393-397`).
2. **Widget Modules card** (`routes/admin/settings.widget.tsx:370-441`):
   - Remove the Messages TabRow (ownership moved to Messenger; the key is shared so no data change).
   - Gate the Feedback and Changelog TabRows on their product flags, exactly like Help (`:417`) — a row renders only while its product is on. Scope the "at least one of Feedback or Changelog stays on" lock (`:403-415`, `:429-441`) to rows whose products are BOTH on; with one product off the other row is freely toggleable (subject to the widget needing ≥1 section).
3. **Messenger translations move.** Per-locale `welcomeMessage`/`offlineMessage` editing moves from the Widget page's Translations card (`settings.widget.tsx:1220-1314` area) to the Messenger page's Messaging card as a Translations section (locale chips, see mockup). The Widget Translations card keeps only widget-Home strings (`greeting`, `subtitle`). Storage key (`widgetConfig.translations[locale].*`) is unchanged; this is a UI move.
4. **Widget install page copy** (`routes/admin/settings.widget.install.tsx:120-140`): the CTA "Enable Messenger" becomes "Turn on the Messages tab"; retitle the card so nothing reads like the deleted master switch (the description "Turns on the widget and the Messages tab together." is accurate — keep it).
5. **Fix the drifted duplicate projection (required for #3 to actually work in the iframe):** `settings.service.ts:944-972` hand-copies `getPublicWidgetConfig` (`settings.widget.ts:325-368`) and has drifted — it omits `translations`/`launcherGreeting`/`launcherLabel` (so the widget iframe never sees translations today; `routes/widget/index.tsx:259`), computes `tabs.tickets` differently, and computes `enabled` differently. Replace the hand-copy with a single shared projection used by both. Retire `WidgetConfig.tabs.tickets` while there (nothing writes it; `settings.widget.ts:341` documents the flag alone as the gate; remove from `settings.types.ts:681-689, 756-763` and consumers).

## 8. Workstream F — Status settings page (target: `StatusSettings.dc.html`)

- Remove the "Publish status page" switch from `apps/web/src/components/admin/settings/status/status-general-card.tsx:29-41`. The General card keeps the Page description input; card description becomes: "The status page publishes from the Status toggle on Settings → General. Hide or rename the portal tab in Portal → Navigation."
- Implement the shared publish resolver from Workstream B item 5 (`flags.statusPage && statusSettings.enabled !== false`) and use it in ALL current gate sites: `lib/server/functions/status.ts:746-777` (`resolveStatusPageGate`), `components/public/portal-header.tsx:78-83` (which also folds audience — keep that), `routes/_portal/index.tsx:76`, `routes/status/feed.ts:26`, and the Portal page preview gates (`settings.branding.tsx:270-285` — while there, add the missing audience clause so the preview matches `portal-header.tsx:80-83`).
- Do NOT change uptime recording — it is already unconditional (`lib/server/domains/status/status.components.ts:265-283`); the old switch's "starts recording uptime history" claim was false and dies with the switch.
- **Remove the "Auto-subscribe portal members" switch** (`status-notifications-cards.tsx:43-55`): it writes `statusSettings.autoSubscribe` which NOTHING reads (verified repo-wide). Either delete the switch and the key from the schema (preferred) or wire it up like changelog's (`changelog-subscription.service.ts:50-51`) — deleting is the decided default; flag in the PR description if you wire it instead.

## 9. Workstream G — Settings nav cleanup (target: `SettingsNav.dc.html`)

In `apps/web/src/components/admin/settings/settings-nav.tsx`:

- Help Center, Changelog, and Status stop being one-child accordions (:126-148): render each as a direct `NavItem` linking straight to its settings page (keep their product-flag gating).
- Remove the Labs row (:173) — Workstream A.
- "Branding" → "Portal" with `GlobeAltIcon` (:160) — Workstream C.
- Delete the dead `feedback` gate branch (:79 — `resolveFeatureFlags` forces the flag true) and the redundant `&& supportKids.length > 0` (:122), plus the test pinning the impossible state (`components/admin/settings/__tests__/settings-nav.test.ts:61-63`).
- Update `settings-nav.test.ts` expectations (Labs gone, flat product rows, Portal label).

## 10. Workstream H — Companion cleanup (SHOULD; do after A–G, same branch or follow-up PR)

1. **Deprecated-but-writable keys**: remove from the zod update schemas so the API can no longer write them: `changelogSettings.portalTabEnabled` (`lib/shared/changelog-settings.ts:38`), `statusSettings.portalTabEnabled` (`lib/shared/status-settings.ts:48`), `changelogSettings.collaborationDisabled` (fully orphaned), `HelpCenterConfig.enabled` (`lib/shared/schemas/help-center.ts:180`), `helpCenterConfig.seo.sitemapEnabled`. Keep read-side tolerance (unknown keys ignored).
2. **Dead projection blob**: drop `WorkspaceSettings.changelogConfig` (`settings.types.ts:1038`, `settings.service.ts:885,923`) — zero readers; it ships in every SSR payload.
3. **Redaction leak**: `statusConfig` (including `allowedSegmentIds`) reaches anonymous portal visitors unredacted (`settings.service.ts:924` vs `lib/shared/redact-portal-config.ts`). Redact segment ids (and anything else non-public) from the client payload.
4. **Stale copy/refs**: MCP error "Enable it in Settings > Features" → "Settings → General" (`lib/server/mcp/server.ts:147`, `lib/server/mcp/tools/helpers.ts:110`); rename the i18n id `automation.agent.deployment.openLabs` (all 9 locales + `assistant-deployment-card.tsx:138`); fix the stale Labs comment in `components/admin/analytics/analytics-page.tsx:151-152`; point `settings.sla.tsx:618` office-hours copy at the actual page; name Settings → General in `lib/shared/launch-checklist.ts:211-213, 225-227`; drop `messenger.enabled` write from `apps/web/e2e/scripts/set-support-surfaces.ts:41`; drop dead `LaunchTaskHref` members and unread `LaunchStatus` fields (`launch-checklist.ts:29-60`); rename the misleading test "portal tab on" (`__tests__/changelog-settings.test.ts:6`).
5. **Stale e2e**: delete `apps/web/e2e/tests/admin/settings-portal-widget.spec.ts` (targets a nonexistent route); fix `settings-widget.spec.ts:10-20` (asserts removed copy).
6. **Route guards**: add `assertRoutePermission` where missing (`settings.notifications.tsx` is deliberately ungated — personal prefs; but `settings.members.tsx`, `settings.people.tsx`, `settings.companies.tsx`, `settings.integrations.index.tsx`, `settings.boards.index.tsx`, `settings.statuses.tsx`, `settings.tags.tsx` should assert their permissions), and normalize product-off guards on the `beforeLoad` + `throw redirect({ to: '/admin/settings/general' })` pattern (replacing the component-level `<Navigate to="/admin/settings">` variants in channels/messenger/email/macros/office-hours/sla/ticket-types/ticket-statuses/conversation-data, which flash a frame and land somewhere else).
7. **Tickets-only workspaces** (`supportTickets` on, `supportInbox` off) are locked out of Email, SLA, Office Hours, Macros, and Conversation data settings (all gate on `supportInbox`); re-gate those on `isProductEnabled(flags, 'support')` in both the route guards and `settings-nav.tsx:91-110, 181-189`.

## 11. Read-time migration summary (all in resolve/read paths, persisted on next write)

| Stored legacy shape                                                       | Resolves to                                                                           |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `featureFlags.{inboxAi,assistantConnectors,assistantSkills}` (any value)  | dropped (features are GA)                                                             |
| `featureFlags.feedback: false`                                            | `true` (now also enforced on write)                                                   |
| `welcomeCard.enabled:true` + `title`                                      | `title` folded into `body` as a leading level-2 heading; `enabled`/`title` dropped    |
| `welcomeCard.enabled:false` (or unset)                                    | empty body (card hidden)                                                              |
| `statusSettings.enabled:false` with `statusPage:true`                     | status page stays unpublished until the General toggle is flipped (which writes both) |
| nav item `feedback.enabled:false`                                         | ignored (row always on)                                                               |
| `portalTabEnabled`, `MessengerConfig.enabled`, `HelpCenterConfig.enabled` | already ignored today; now also rejected on write (H1)                                |

## 12. Acceptance checklist

- General shows: Workspace (logo + name, one row, no favicon control, no helper text), Products (Feedback = "Always on" badge; Support/Help Center/Changelog/Status switches), Danger zone. Nothing else. Cloud installs: no Quackback URL here (it's on Domains).
- Labs route 404s/redirects; no Labs nav row; Connectors/Skills/Copilot reachable with no flag anywhere in the codebase (`grep -a` clean for the three flag names).
- `/admin/settings/portal` renders the Portal page (Appearance, Navigation, Welcome message); `/admin/settings/branding` redirects to it; nav says "Portal".
- Welcome message: empty editor ⇒ no card on portal home; text ⇒ card shows; a legacy workspace with enabled+title shows title as heading inside the message; a legacy disabled card shows nothing.
- Status: one publish control (General); Status settings page has description + visibility + notifications + danger only; a legacy flag-on/unpublished workspace stays unpublished.
- Messenger Surfaces has two working switches; Widget Modules has no Messages row and only rows for enabled products; messenger translations edit on the Messenger page and actually reach the widget iframe (projection unified).
- Moderation has no anonymous-access card; Portal access tab has it; board Access banner links there.
- `bun run build`, typecheck, lint, app suite (vitest), locale-parity, and the touched e2e specs all pass. `check:server-fn-manifest` passes (you are deleting server fns — client-referenced manifest rules apply).
- Run the app (`bun run dev`, demo@example.com / password) and click through: General, Portal, Status settings, Messenger, Widget, Moderation, Access & Security, portal home (welcome card states), widget iframe.

## 13. Suggested PR sequencing

1. **PR 1**: Workstream A (flag deletion + Labs removal) + the e2e/test updates it forces. Pure deletion, no UX judgment.
2. **PR 2**: Workstream B + F (General page, status publish fold, logo/favicon/OG).
3. **PR 3**: Workstream C (Portal rename + welcome message + nav-row lock) + Workstream G (nav cleanup).
4. **PR 4**: Workstream D + E (access split, messenger/widget consolidation, projection unification).
5. **PR 5**: Workstream H (companion cleanup).

Each PR: standalone description (no session/internal references), screenshots of changed pages, and the migration behavior called out where applicable. When everything lands, add this spec to `SPEC-STATUS.md` as DONE.
