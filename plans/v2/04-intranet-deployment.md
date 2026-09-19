# Intranet, No-Egress Deployment — Baseline and Required Fork Changes

> **Status:** v2, binding for every plan (decisions D-E1…D-E6 in `01-decisions.md`).
> **Source:** read-only audit of upstream `apps/web` + `packages/*` for outbound network calls and remote loads
> (2026-09-19). Paths are relative to `apps/web/src` unless prefixed `packages/`.

## 1. The environment

- Every app, portal, widget host page, the control tower and all users are on the company intranet (D-E1).
- Every user is an authenticated employee: sign-in is enforced at the network edge (SSO proxy / VPN) **and** by
  Quackback's own SSO login against the company IdP (D-E1, D-E4).
- **No outbound internet connections** from any component (D-E2). Allowed: intranet services and AWS services
  reached privately (VPC endpoints / PrivateLink): RDS, S3, Secrets Manager, KMS, SES (SMTP/API endpoint), Bedrock.
- Portals: **public visibility, anonymous off, SSO-only sign-in** (D-E3).
- AI: the company's **OpenAI-compatible internal LLM proxy** (which may front Bedrock) (D-E5, D-E6).
- Builds run in a network with a package/registry mirror; nothing is downloaded at runtime (no model, tokenizer or
  font downloads; `pgvector`/`pg_trgm` are created by migrations and are supported on RDS).

## 2. Blockers — fork changes required before an offline deployment works

| ID | Problem | Evidence | Fork change | Seam |
| --- | --- | --- | --- | --- |
| E-1 | **The SSRF guard rejects every private (intranet) address with no allow-list.** This blocks saving/testing/enforcing the intranet IdP, internal outbound webhooks, internal "connected apps" (plan 40), workflow `send_webhook`, MCP connectors, self-hosted GitLab/n8n/ntfy, link unfurl and image rehosting. | `lib/server/content/ssrf-guard.ts:101,131-145,162-200`; IdP save `domains/settings/identity-providers.service.ts:388`, `settings.service.ts:318`; SSO test `auth/sso-test-handshake.ts:204,286,378,446`; enforcement requires the test `functions/sso.ts:706-711`; webhook write check `events/integrations/webhook/constants.ts:247-277` | Env allow-list `SSRF_ALLOWED_CIDRS` / `SSRF_ALLOWED_HOSTS` consulted inside `checkUrlSafety` / `isPrivateAddress`. **Loopback (127/8, ::1) and link-local 169.254/16 / fe80::/10 (instance metadata) stay blocked regardless.** Relax the literal-private-IP rejection in the webhook write check only for allow-listed ranges. Allow-list lives in deployment config, not the UI. | **F-12** (shared) |
| E-2 | **S3 and SES accept only static access keys** (no IAM-role / default credential chain). | `lib/server/storage/s3.ts:213-238`; `packages/email/src/ses.ts:488-509` | **Default: config-only** — issue scoped IAM-user keys held in Secrets Manager and injected into task env. Optional fork change (only if IAM roles are mandatory): fall back to the AWS default credential chain when keys are unset. | none by default; **E-2a** (conditional) |
| E-3 | **SES/SNS delivery events can't be pushed into the intranet** (SNS HTTPS push needs a reachable endpoint; the SNS signing-cert fetch would also hit the SSRF guard). | `lib/server/email/sns-signature.ts:142`, `email-delivery-webhook.ts:45` | **Default: disable delivery-event ingestion** (bounces/complaints not tracked in-app; SES account-level suppression still applies). Optional later: a fork SQS poller consuming SES events via the SQS VPC endpoint. | none by default |

## 3. Configuration baseline (no code change)

**AI (D-E5/D-E6)**

- `OPENAI_BASE_URL` = internal proxy, `OPENAI_API_KEY` = proxy credential. AI stays off unless both are set
  (`lib/server/domains/ai/config.ts:29-37`). Both upstream clients (`openai` SDK for embeddings; the
  `@tanstack/ai-openai` compatible adapter for chat) use plain `fetch`, **not** the SSRF guard, so a proxy on a
  private IP works without E-1.
- Upstream uses only `/v1/chat/completions` (streaming, tool calling, `response_format: json_schema`, `max_tokens`)
  and `/v1/embeddings` (with `dimensions: 1536`). No Responses/Assistants/audio/image/moderation APIs. **The proxy
  must support:** strict `json_schema` structured output, tool calling, streaming, and the `dimensions` parameter
  (or ignore it for a native-1536 model).
- Models: `AI_CHAT_MODEL`, `AI_EMBEDDING_MODEL`, and per-feature overrides (`AI_ASSISTANT_MODEL` for Quinn and Ask AI,
  `AI_SUMMARY_MODEL`, `AI_CLASSIFICATION_MODEL`, `AI_MERGE_MODEL`, `AI_HELP_CENTER_MODEL`, …;
  `lib/server/domains/ai/models.ts:54-72`). Leaving a feature's model unset disables that feature. Tune
  `AI_COMBINED_TOOLS_AND_SCHEMA` / `AI_REASONING_EFFORT` to the proxy's models.
- **Embedding dimension is fixed at 1536** (`vector(1536)` in `packages/db/src/schema/assistant.ts:120`,
  `changelog.ts:25`, `conversation-summary.ts:12`; migrations 0015/0170/0171/0203/0235;
  `embedding.service.ts:18`). The proxy must serve a **1536-dimension** embedding model (e.g. Titan Embeddings G1
  or an OpenAI-compatible 1536-d model). A different size means an upstream-schema change — avoid.
- `AI_ASSISTANT_VISION=false` (vision sends image URLs the model would have to fetch; `assistant/vision.ts:79-85`).

**Email**

- Outbound: SMTP to the SES SMTP VPC endpoint or an internal relay — `EMAIL_SMTP_HOST/_PORT/_USER/_PASS`
  (`packages/email/src/index.ts:187`). Leave `EMAIL_RESEND_API_KEY` unset.
- Inbound: **IMAP against the internal mail server** — `IMAP_*` (`domains/conversation/conversation.email-imap.ts:56`).
  The webhook inbound routes (Cloudflare / SES→webhook) are unused. See `20-control-tower.md` for per-app inbound.
- Set a workspace logo; the default email template logo is `https://quackback.io/logo.png`
  (`packages/email/src/templates/shared-styles.ts:8`), which renders broken offline (optional fork default change).

**Storage / AWS**

- `S3_ENDPOINT` / `S3_REGION` to the S3 VPC endpoint; keys per E-2.

**Disable / leave unset**

- `DISABLE_TELEMETRY=true` (hourly ping, `lib/server/telemetry/sender.ts:9`).
- Leave unset: `QUACKBACK_CONTROL_PLANE_URL`, `QUACKBACK_CP_STATUS_URL`, `INTEGRATION_OAUTH_GATEWAY_URL`,
  `EMAIL_RESEND_API_KEY`.
- `REHOST_FETCH_TIMEOUT_MS=1000` so image rehosting fails fast.
- The update check (`functions/version.ts:54`) times out harmlessly (1.5 s, every 5 min; banner hidden). Optional fork no-op.

**Sign-in: anonymous off, SSO only (D-E3)**

- Portal: `portalConfig.access.visibility='public'`, `portalConfig.features.allowAnonymous=false`
  (default `true`, `settings.types.ts:375`), `portalConfig.openSignup=false`.
- Sign-in methods (`lib/shared/signin-methods.ts:7-15`): `oauth.password=false`; leave magic link and social
  providers unset; confirm how email OTP is gated and turn it off (open verification item).
- Generic OIDC to the company IdP (`lib/server/auth/build-oauth-configs.ts:195-260`, flag `customOidcProvider` on by
  default) with JIT provisioning (`autoCreateUsers`, `autoProvisionRole`, `settings.types.ts:44-52`). **Saving and
  testing the intranet IdP requires E-1.**
- Hard SSO enforcement: verify the company domain (DNS TXT via system DNS, `lib/server/auth/dns-verify.ts:26`) and
  mark it `enforced` — blocks password/magic-link/social for that domain (`auth-restrictions.ts:173-188`); depends on
  the SSO test, i.e. on E-1.
- Widget: `widgetConfig.hmacRequired=true` (identified employees only; `settings.widget.ts:319`).
- The anonymous-session endpoint `/sign-in/anonymous` stays registered even with anonymous off
  (`lib/server/auth/index.ts:767`, allow-listed `hooks.ts:411-415`); sessions minted there can't act. **Optional**
  fork gate (E-4) to disable the plugin when `allowAnonymous=false`.

## 4. Optional features to disable or accept

| Feature | Offline effect | Recommendation |
| --- | --- | --- |
| SaaS integrations (Slack, GitHub, Linear, Jira, HubSpot, Notion, Teams, Zendesk, Salesforce, …) | Break | Don't connect them; admins can't complete OAuth anyway. Self-hosted GitLab / n8n / ntfy work after E-1. |
| YouTube embeds in rich text (`components/ui/rich-text-editor.tsx:23`) | Blank frames | Accept, or optional fork change to drop the extension / allow an internal video host. |
| `/api/v1/docs` (Swagger UI from unpkg + Google Fonts, `routes/api/v1/docs.ts:24-27`) | Broken page | Optional: vendor `swagger-ui-dist` in a fork route. |
| Link unfurl, image rehosting, Quinn web-source crawl | Internet URLs fail; intranet URLs work after E-1 | Accept. |
| Social OAuth providers | Inactive | Off. |

Browser side is clean: branding fonts are self-hosted (`@fontsource`, `globals.css:16`,
`lib/shared/theme/font-loader.ts`); no analytics, CDN scripts, map tiles, Gravatar or CAPTCHA. IdP `picture` avatars
load fine if they are intranet URLs. Admin custom CSS could reference remote `url()` — policy, not code. An
egress-restricting CSP can be added at the edge proxy.

## 5. Effects on the plans

| Plan | Change |
| --- | --- |
| 02 conventions | New rule: fork code makes **no internet calls**; every outbound HTTP call goes through the SSRF guard (with the E-1 allow-list) or is to a configured intranet/AWS-private endpoint. Shared seam F-12. |
| 10 RBAC | No change beyond SSO-only sign-in (no anonymous principals in practice). |
| 20 control tower | IdP is intranet (needs E-1). Provisioning applies the §3 sign-in baseline instead of "private portal". Per-app inbound email via IMAP (no SES→Lambda mail edge). S3/SES keys per E-2. No internet anywhere in tower or provisioner. |
| 30 tiered support | Hub users sign in with SSO (no magic link / email code). Email-only claim happens on SSO sign-in with a verified email. Private-portal-specific pieces become unnecessary. |
| 40 account actions | Connected apps are intranet hosts → require E-1 allow-list entries; configuration UI validates hosts against it. |
| 50 prioritization | No change (optional AI score suggestions use the proxy). |
| 60 announcements | Fonts already self-hosted. Embeds run on intranet apps; revisit identity/audience in light of D-E3 (portal public inside the intranet). |
