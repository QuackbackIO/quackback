# E2E + UX Report — r33 (overnight run)

**Date:** 2026-05-04
**Branch:** `tier-limits-wiring` (CP) / `magic-link-auth` (OSS)
**Build shipped:** `ttl.sh/qcp-20260502124227:24h-r33` (digest `sha256:8c292dd5...`)
**Live at:** https://dev-app.quackback.io
**Test user used:** `e2e-r33-starter-1777924301@example.com` / org `org_01kqt8qsevf20ry50ppaybt74a`

---

## TL;DR

The r33 change (drop forced `/onboard` redirect) works exactly as designed. New-user signup → auto-org-create → dashboard with empty state, no forced funnel. Pricing-CTA `?plan=` still propagates end-to-end. `/onboard/*` returns 404 as expected. 500 tests pass; no regression.

The signup → workspace flow has **no blocking issues**, but several UX friction points worth tightening before public launch. Four are P1 (real conversion-impacting), the rest are polish. Detailed list below.

---

## 1. E2E results

All checks executed against the live `r33` pod on `dev-app.quackback.io`. Each step shows the request and the response that proves the behaviour.

### 1.1 Fresh-user signup creates user + org + member rows

```
POST /api/auth/sign-up/email   →  HTTP 200 + Set-Cookie better-auth.session_token
```

CP DB after the request:

```
org_01kqt8qsevf20ry50ppaybt74a | e2e-starter-user-ybt74a | E2E Starter User | <email> | owner
```

✓ The Better-Auth `databaseHooks.user.create.after` hook fires synchronously and inserts both `cp_organizations` and `cp_org_members` (role=`owner`) for the new user. The org slug is derived as `<name-from-email>-<orgId-suffix>`.

### 1.2 Authed redirect chain (no `/onboard` step)

```
GET /                            →  307  location: /dashboard
GET /dashboard                   →  307  location: /dashboard/org_01kqt8qsevf20ry50ppaybt74a
GET /dashboard/<orgId>           →  200 OK    ← was 307 → /onboard/<orgId> in r32
GET /onboard/<orgId>             →  404       ← route deleted in r33
```

✓ Empty-state HTML contains `No workspaces yet` / `Spin up your first Quackback workspace.` / `Create workspace` button. Loaders return `instances: []` and `plans: [Starter, Pro, Scale]` (verified in the SSR-streamed Tanstack router state).

### 1.3 `?plan=` propagation through the chain

| Path                               | Result                                                             |
| ---------------------------------- | ------------------------------------------------------------------ |
| `GET /signup?plan=pro` (unauthed)  | `200` (renders signup page)                                        |
| `GET /dashboard?plan=pro` (authed) | `307 → /dashboard/<orgId>?plan=pro`                                |
| `GET /dashboard/<orgId>?plan=pro`  | `200 OK`                                                           |
| `GET /dashboard?plan=lol` (junk)   | `307 → /dashboard` (junk silently dropped via `.catch(undefined)`) |

✓ `planSearchSchema` parsing is robust against junk values, no error boundary triggered.

### 1.4 Magic-link auth endpoint (CP)

```
POST /api/auth/sign-in/magic-link  →  HTTP 200
```

Email delivery is wired to Resend (`RESEND_API_KEY` is set in dev). Magic link logged to pod stdout regardless, so server-side debugging works even if Resend bounces.

### 1.5 What I deliberately did NOT exercise programmatically

- **Stripe Checkout completion** — needs a real card form / 3DS flow; cannot drive headlessly. Last verified in tasks #50–#56 (r28); the createInstance / finalize code path has only seen test-coverage changes since (`/simplify` pass in r32). **Recommend a manual click-through on Pro signup before going live.**
- **Tenant pod provisioning** — covered by the same task chain. The provisioning queue + ArgoCD generation logic hasn't changed in r33.
- **OSS magic-link sign-in inside a tenant** — the `magic-link-auth` branch in `~/quackback` is still WIP (commit `c3ceb104`); haven't merged or shipped a tenant build with it.

---

## 2. UX review of the signup → workspace funnel

I read every screen the user sees from "Try Pro free for 14 days" on the marketing site through to "Open workspace ↗" on the instance page. Findings ordered by priority.

### P1 — issues likely to hurt conversion

**P1-1. "No credit card" promise on signup contradicts what happens 90 seconds later**
`signup.tsx:114` — _"30 seconds, no credit card. You'll choose a plan once your account is ready."_
After they sign up, the wizard's `Create workspace` button on a paid plan immediately opens Stripe Checkout, which displays the card form by default. Stripe is configured with `payment_method_collection: 'if_required'`, but most users will see a card field and feel the original promise was a bait-and-switch. **Fix:** either rephrase to _"Try free for 14 days"_, or add a _"Card not charged until day 14"_ line directly in the wizard above the plan picker.

**P1-2. Wizard plan picker doesn't show the 14-day trial**
`plan-card.tsx:18-20` shows `$19/mo` flatly. Pricing-page CTA promises _"Try Pro free for 14 days"_; the wizard then shows pure monthly price with no trial badge. **Fix:** when `priceMonthlyCents > 0`, render _"$19/mo · 14-day trial"_ on the card or as a small tagline under the button.

**P1-3. Wizard plan card features differ from what `/pricing` showed**
The marketing page now sells _"Basic AI: semantic search across feedback"_ + _"Advanced AI: summaries, sentiment, auto-merge"_. The wizard's `PlanCard` (`plan-card.tsx:46-49`) only knows four boolean flags: `customDomainEnabled / aiEnabled / ssoEnabled / prioritySupport`. So a user who clicked "Try Pro" on `/pricing` because of summaries + sentiment + auto-merge sees, in the wizard, a generic _"AI features"_ line — they cannot verify the specific feature that motivated their choice. **Fix options:**

1. Drop the per-feature checklist from the wizard entirely and link out to the matrix (_"Compare full feature list →"_) — the wizard is a confirmation step, not a discovery step.
2. Or extend `PlanCardData` with the same Basic-AI / Advanced-AI split as the marketing matrix (single source of truth in `tiers.ts`).

**P1-4. Email verification not enforced before workspace creation**
`auth.ts:91-114` — the `user.create.after` hook fires before email verification. A throwaway address (`a@b.c`) gets a real org row + can immediately provision a tenant. Two consequences:

- Spam risk: 10 fake signups → 10 orgs in `cp_organizations`. With per-workspace billing the abuser can at least be stopped at the Stripe Checkout step, but the org rows accumulate.
- Real users may type their email wrong and never receive a magic link, leaving an orphan org under the wrong address.

**Fix:** require `emailVerified: true` (or a verified passkey/SSO) before `createInstance` is allowed. Better-Auth supports `requireEmailVerification: true` in the email/password config; combine with a _"verify your email to create a workspace"_ gate on the dashboard's empty state.

### P2 — friction worth fixing this iteration

**P2-1. Empty-state copy is generic.** _"No workspaces yet · Spin up your first Quackback workspace."_ doesn't tell the user **what they get** at the end. Try: _"Create your first feedback board · 14-day free trial · $19/mo afterwards · cancel anytime"_ with a single CTA. The current state asks the user to act with no reinforcement of the value.

**P2-2. Subdomain preview is hidden in the right margin.** `create-wizard.tsx:79-90` puts the `.quackback.io` suffix as a small monospace span next to the input. On narrow viewports the suffix wraps under the input. A real-time _"acme-feedback.quackback.io is yours"_ helper line below the field (the standalone onboard page used to show this) makes the URL choice tangible. The standalone-page flow had this; we lost it when deleting `/onboard`.

**P2-3. Plan-feature line-through is negative framing.** `plan-card.tsx:57-62` line-throughs disabled features (e.g. SSO struck through on Starter). Users read negative emphasis as _"you're missing out"_. Either drop disabled rows entirely, or render them as muted but not struck through.

**P2-4. Marketing column on `/signup` competes with the form.** `signup.tsx:86-107` — six value-prop bullets in a hero panel next to the form on desktop. For users coming from `/pricing` (who already read the matrix) it's noise. Consider conditionally rendering the marketing column only when `?plan=` is **not** set (i.e. cold organic signups).

**P2-5. No password-reset link on `/login`.** If a user signs up with a password and then forgets it, the only recovery path is the Magic-link tab. That works, but it's not signposted. Add a small _"Forgot your password?"_ link under the password field that pre-selects the Magic-link mode.

**P2-6. Wizard error messages are generic.** `dashboard.$orgId.index.tsx:88` shows `Failed to start provisioning` as the catch-all. Subdomain collisions, Stripe errors, and tier-limit rejections all collapse to this string. The server fns already surface meaningful `HTTPError` messages — pipe them through to the modal as-is rather than masking with the generic.

**P2-7. Trial banner missing from instance page after Stripe checkout returns.** `dashboard/$orgId.instance.$instanceId.index.tsx:124` shows `"Plan activated. Charges will appear on your next invoice."` after `?activated=1`. For a 14-day trial, that's misleading — first invoice is in 14 days. Refine to _"Your 14-day free trial has started. First charge: <date>."_ using `currentPeriodEnd` from the billing query.

### P3 — polish, no urgency

- **P3-1.** Headline _"Build the right thing, faster"_ on signup is generic AI-tell. Match the brand voice from `/pricing` (_"Simple, fair pricing"_).
- **P3-2.** Magic-link confirmation has no _"didn't get it? resend"_ CTA. Closing the tab kills the only path.
- **P3-3.** No password-strength meter — just `minLength={8}`. Cheap to add a 4-tier visual.
- **P3-4.** Google button is a hand-rolled inline SVG (4 paths × 4 colors). Either keep it consistent with shadcn icon sizing (currently `h-4 w-4`) or consider `react-google-button` for behavioral correctness on dark mode focus rings.
- **P3-5.** Wizard's _"Spin up a new Quackback feedback board"_ description duplicates _"Create a workspace"_ title — drop the description or use it for value (_"Available in ~30 seconds"_).
- **P3-6.** `/signup` and `/login` use slightly different shells (signup is two-column, login is single max-width=sm). Visual whiplash if a user toggles between them. Not a problem, just inconsistent.
- **P3-7.** Empty state's `Card` uses `text-center` — fine, but the rest of the dashboard is left-aligned. A subtle break in rhythm.

### Strong points worth keeping

- Auto-org-create on signup is correct: no separate "name your team" step.
- `?plan=` propagates cleanly through `signup → dashboard → wizard.defaultPlanId`. The `.catch(undefined)` on the schema is robust against junk values without throwing.
- Subdomain auto-derives from workspace name + sticky on edit (`subdomainTouched`). Good defaults.
- Both magic link AND password are supported on login. Good for power users + first-timers.
- Mobile responsive: marketing column hides, form-first.
- AppShell renders a dunning banner for `subscriptionStatus = 'past_due'` — solid recovery path.
- Cancel-at-period-end is a button, not a hidden settings page. Reduces churn-drama support load.

---

## 3. Suggested follow-up tasks (in priority order)

| #   | Task                                                                                                                                        | Notes                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1   | Re-word "no credit card" promise OR show _"Card collected at trial signup, charged after 14 days"_ in the wizard                            | P1-1, P1-2 — single coordinated change                                                                            |
| 2   | Decide: trim wizard PlanCard features to a single _"Compare plans →"_ link, OR extend `PlanCardData` to mirror Basic AI / Advanced AI split | P1-3                                                                                                              |
| 3   | Gate `createInstance` behind `emailVerified`                                                                                                | P1-4. Use Better-Auth `requireEmailVerification`. Empty state shows _"verify your email to start"_ until verified |
| 4   | Surface server-fn error messages verbatim in wizard                                                                                         | P2-6 — small change in `handleCreate` catch                                                                       |
| 5   | Add subdomain preview helper line under the input in the wizard                                                                             | P2-2 — restore what onboard had                                                                                   |
| 6   | Trial-aware activation banner copy on instance page                                                                                         | P2-7                                                                                                              |
| 7   | Empty-state copy refresh + value reinforcement                                                                                              | P2-1                                                                                                              |
| 8   | Drop strikethrough on disabled plan features                                                                                                | P2-3                                                                                                              |
| 9   | Forgot-password link on `/login`                                                                                                            | P2-5                                                                                                              |
| 10  | Polish pass: P3-1 through P3-7                                                                                                              | Bundle into one /simplify-style sweep                                                                             |

---

## 4. What changed in r33 (for the changelog)

```
refactor(cp): drop forced /onboard redirect, rely on dashboard empty state

- Removed the "first-time user has no workspaces" redirect from
  /dashboard/$orgId loader.
- Deleted /onboard/$orgId route entirely (functionally redundant with
  the dashboard's CreateInstanceWizard modal).
- ?plan= still flows from /pricing → /signup → /dashboard?plan=pro →
  wizard.defaultPlanId. Junk values silently drop via .catch(undefined).

User-visible: signing in with no workspaces lands you on the dashboard's
"No workspaces yet" empty state with a Create workspace button, instead
of an immediate full-screen form that read as a forced funnel.
```

Files changed: 3 (+2 lines, -236 lines). All tests pass: 500 ✓ / 1 skipped.

---

## 5. Open follow-ups not addressed tonight

- Pre-existing implicit-any errors in `dashboard/$orgId.billing.index.tsx`, `dashboard/$orgId.billing.payment.tsx`, `dashboard/$orgId.members.tsx` (4 errors total). Not introduced by r33 — predates this branch. Worth a `/simplify` pass next session.
- CP postgres pg-1 was destroyed during the disk-full incident earlier today; cluster is now `pg-2` (primary) + `pg-3` (replica). HA is restored, but the original pg-1 PVC was deleted to force a clean rebootstrap. Worth confirming backup schedule still runs cleanly tomorrow.
- Master nodes oversubscribed (4 GB RAM, OOM-thrashing under load) — task #44, still pending.

---

_Report generated by overnight autonomous run. Test artefacts in `/tmp/e2e-r33-starter.env`, `/tmp/jar-starter`, `/tmp/dash.html`._
