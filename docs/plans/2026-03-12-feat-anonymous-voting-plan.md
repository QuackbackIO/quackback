# Anonymous Voting - Architecture Plan

**Date:** 2026-03-12
**Approach:** Better Auth anonymous plugin + anonymous principals
**Model:** Aligned with Featurebase - workspace-level toggle, both portal + widget

---

## 1. Design Decisions

### 1.1 Better Auth anonymous plugin (replaces custom cookie approach)

Use Better Auth's built-in `anonymous()` plugin to create real user + session records for anonymous voters. This gives us:

- **Full session management** — anonymous users get standard `better-auth.session_token` cookies
- **Existing auth flow works** — `hasSessionCookie()`, `requireAuth()`, `getOptionalAuth()` all work for anonymous users with zero changes
- **Built-in account linking** — `onLinkAccount` callback fires when anonymous user signs up, merges their data automatically
- **No custom cookie management** — no `quackback_anon` cookie, no `Set-Cookie` headers in server functions
- **No custom lookup table** — no `anonymous_vote_identities` table needed
- **Widget support** — same-origin session cookie works in widget iframe

**How it works:**

1. User clicks vote, no session exists
2. Client calls `authClient.signIn.anonymous()` — creates user (`isAnonymous: true`) + session
3. `databaseHooks.user.create.after` creates principal with `type: 'anonymous'`
4. Client calls `toggleVoteFn` — `requireAuth()` succeeds, `voteOnPost()` works unchanged
5. If user later signs up, `onLinkAccount` fires and we update the principal

### 1.2 Anonymous principals (votes in the same `votes` table)

Anonymous voters still get real `principal` records with `type: 'anonymous'`. Their votes go into the regular `votes` table. The only difference from the previous plan is HOW the principal is created (Better Auth vs custom cookie resolution).

All the same benefits apply:

- `voteOnPost()`, `removeVote()`, `getPostVoters()` — all unchanged
- Dedup via existing unique index `(post_id, principal_id)`
- Admin can remove anonymous votes with existing `removeVote(postId, principalId)`
- VotersModal already renders anonymous voters correctly (`displayName: null` → "Anonymous")

**Future upgrade path:** When `onLinkAccount` fires:

```ts
// Update principal from anonymous → real user
await db
  .update(principal)
  .set({ type: 'user', displayName: newUser.name })
  .where(eq(principal.userId, anonymousUser.id))
```

All votes, subscriptions, and activity are already correctly attributed.

### 1.3 Workspace-level toggle (not per-board)

- New `anonymousVoting: boolean` field on `PortalFeatures`, default `true` (Featurebase-aligned).
- The existing `voting: boolean` toggle governs whether voting exists at all; `anonymousVoting` governs whether auth is required.
- Per-board override deferred.

---

## 2. Schema Changes

### 2.1 Add `isAnonymous` to user table

**File:** `packages/db/src/schema/auth.ts`

Better Auth's anonymous plugin requires an `isAnonymous` boolean on the user table:

```ts
isAnonymous: boolean('is_anonymous').default(false).notNull()
```

### 2.2 Principal type expansion

Same as before — just start inserting rows with `type: 'anonymous'`. No schema change needed.

Anonymous principals are created by the `databaseHooks.user.create.after` hook when it detects `user.isAnonymous === true`:

- `type: 'anonymous'`
- `role: 'user'`
- `displayName: null`

### 2.3 Settings type change

**File:** `apps/web/src/lib/server/domains/settings/settings.types.ts`

Add to `PortalFeatures`: `anonymousVoting: boolean`
Add to `DEFAULT_PORTAL_CONFIG.features`: `anonymousVoting: true`

No migration needed — `deepMerge` fills in missing keys.

---

## 3. Auth Configuration Changes

### 3.1 Server auth config

**File:** `apps/web/src/lib/server/auth/index.ts`

```ts
import { anonymous } from 'better-auth/plugins'

// Add to plugins array (before tanstackStartCookies):
anonymous({
  emailDomainName: 'anon.quackback.io',
  disableDeleteAnonymousUser: true, // we handle cleanup ourselves
  onLinkAccount: async ({ anonymousUser, newUser }) => {
    // Update principal from anonymous → real user
    const { db, principal, eq } = await import('@/lib/server/db')
    await db.update(principal)
      .set({ type: 'user' })
      .where(eq(principal.userId, anonymousUser.id))
  },
}),
```

Modify `databaseHooks.user.create.after` to detect anonymous users:

```ts
after: async (user) => {
  const isAnonymous = (user as Record<string, unknown>).isAnonymous === true
  // ...
  await db.insert(principalTable).values({
    id: generateId('principal'),
    userId,
    role: 'user',
    type: isAnonymous ? 'anonymous' : 'user',
    displayName: isAnonymous ? null : user.name,
    avatarUrl: isAnonymous ? null : (user.image ?? null),
    avatarKey: isAnonymous ? null : ((user as Record<string, unknown>).imageKey as string | null),
    createdAt: new Date(),
  })
}
```

### 3.2 Client auth config

**File:** `apps/web/src/lib/server/auth/client.ts`

```ts
import { anonymousClient } from 'better-auth/client/plugins'

export const authClient = createAuthClient({
  plugins: [emailOTPClient(), genericOAuthClient(), anonymousClient()],
})
```

---

## 4. Auth Helper Changes

### 4.1 Expose principal type in AuthContext

**File:** `apps/web/src/lib/server/functions/auth-helpers.ts`

Add `type` to the `AuthContext.principal` interface:

```ts
principal: {
  id: PrincipalId
  role: Role
  type: string // 'user' | 'service' | 'anonymous'
}
```

Both `requireAuth()` and `getOptionalAuth()` already query the full principal record — just include `type` in the return.

---

## 5. Modified Files

### 5.1 `apps/web/src/lib/server/functions/public-posts.ts`

**`toggleVoteFn`:** Add anonymous rate limiting after `requireAuth()`:

```ts
const ctx = await requireAuth()

// Rate limit anonymous voters
if (ctx.principal.type === 'anonymous') {
  const ip = getClientIpFromHeaders(getRequestHeaders())
  if (!(await checkAnonVoteRateLimit(ip))) {
    throw new Error('Too many votes, please try again later')
  }
}

return voteOnPost(data.postId, ctx.principal.id)
```

**`getVotedPostsFn`:** No changes needed. Anonymous users have sessions and principals, so the existing auth flow returns their voted posts.

**`getVoteSidebarDataFn`:** Return `canVote` field. When no session but anonymous voting enabled, return `canVote: true` so the frontend knows to enable the vote button (and trigger anonymous sign-in on click):

```ts
if (!hasSessionCookie()) {
  const settings = await getSettings()
  const anonEnabled = settings?.portalConfig?.features?.anonymousVoting ?? true
  return {
    isMember: false,
    canVote: anonEnabled,  // frontend will trigger signIn.anonymous() on click
    hasVoted: false,
    subscriptionStatus: { subscribed: false, level: 'none', reason: null },
  }
}

// Authenticated path (includes anonymous sessions)
const ctx = await getOptionalAuth()
if (!ctx) {
  return { isMember: false, canVote: false, hasVoted: false, ... }
}

const isAnonymous = ctx.principal.type === 'anonymous'
const { hasVoted, subscription } = await getVoteAndSubscriptionStatus(postId, ctx.principal.id)

return {
  isMember: !isAnonymous,
  canVote: true,
  hasVoted,
  subscriptionStatus: isAnonymous
    ? { subscribed: false, level: 'none', reason: null }
    : { subscribed: subscription.subscribed, level: subscription.level, reason: subscription.reason },
}
```

### 5.2 Widget endpoints

**`/api/widget/vote.ts`:** When `getWidgetSession()` returns null, fall back to Better Auth session (which covers anonymous users):

```ts
const auth = await getWidgetSession()
if (!auth) {
  // Fall back to Better Auth session (anonymous or regular)
  const session = await betterAuth.api.getSession({ headers: request.headers })
  if (session?.user) {
    /* resolve principal, vote */
  }
}
```

**`/api/widget/voted-posts.ts`:** Same pattern — fall back to Better Auth session.

### 5.3 `apps/web/src/components/public/post-detail/vote-sidebar.tsx`

Use new `canVote` field:

```tsx
disabled={!sidebarData.canVote && !sidebarData.isMember}
```

### 5.4 `apps/web/src/components/public/post-card.tsx`

Add `canVote` prop. When vote clicked and no session, trigger anonymous sign-in:

```tsx
async function handleVoteClick(e: React.MouseEvent) {
  e.stopPropagation()
  if (!isAuthenticated && !canVote) {
    openAuthPopover({ mode: 'login' })
    return
  }
  if (!isAuthenticated && canVote) {
    // Anonymous voting: sign in anonymously first
    await authClient.signIn.anonymous()
    // Then proceed with vote
  }
  handleVote(e)
}
```

### 5.5 `apps/web/src/components/public/feedback/feedback-container.tsx`

Pass `canVote` prop to PostCard based on anonymous voting setting:

```tsx
const anonymousVotingEnabled = routeContext.settings?.publicPortalConfig?.features?.anonymousVoting ?? true
<PostCard
  isAuthenticated={isAuthenticated}
  canVote={isAuthenticated || anonymousVotingEnabled}
/>
```

### 5.6 `apps/web/src/components/widget/widget-home.tsx`

When `!isIdentified && anonymousVotingEnabled`, allow voting by calling anonymous sign-in first.

### 5.7 `apps/web/src/lib/server/domains/principals/principal.service.ts`

Filter `type != 'anonymous'` from `countMembers()`. Already done.

### 5.8 Admin portal settings UI

Add toggle for `anonymousVoting` under the existing `voting` toggle.

---

## 6. Rate Limiting

Anonymous vote rate limiting queries the session table's `ipAddress`:

```sql
SELECT COUNT(*) FROM votes v
JOIN principal p ON v.principal_id = p.id
WHERE p.type = 'anonymous'
  AND v.created_at > NOW() - INTERVAL '1 hour'
  AND p.user_id IN (
    SELECT DISTINCT user_id FROM session WHERE ip_address = $clientIp
  )
```

- **Threshold:** 50 anonymous votes per IP per hour
- **Enforcement:** In `toggleVoteFn` after `requireAuth()`, only for `principal.type === 'anonymous'`
- **No Redis needed:** Single indexed query

---

## 7. Data Flows

### 7.1 First Anonymous Vote (portal)

```
1. User visits portal (no session)
2. getVoteSidebarDataFn returns { canVote: true, isMember: false }
3. Vote button is enabled
4. User clicks vote
5. [Client] No session detected → authClient.signIn.anonymous()
   → Better Auth creates user (isAnonymous=true) + session
   → databaseHooks creates principal (type='anonymous')
   → Session cookie set automatically
6. [Client] toggleVoteFn({ postId })
7. [Server] requireAuth() succeeds (anonymous session)
   → Rate limit check (principal.type === 'anonymous')
   → voteOnPost(postId, principalId)  ← EXISTING FUNCTION, NO CHANGES
8. [Client] Optimistic update synced
```

### 7.2 Anonymous User Signs Up Later

```
1. User clicks "Sign up" or signs in with OAuth
2. Better Auth's onLinkAccount fires:
   → We update principal: type='anonymous' → type='user'
   → All votes remain attributed to the same principal
3. Anonymous user record is kept (disableDeleteAnonymousUser=true)
   OR cleaned up by our cron later
```

### 7.3 Widget Anonymous Vote

```
1. Widget loads (no identify() call)
2. User clicks vote
3. [Client] No auth → authClient.signIn.anonymous()
4. [Client] POST /api/widget/vote (session cookie auto-sent, same-origin)
5. [Server] getWidgetSession() → null (no Bearer token)
   → Fall back to Better Auth session → anonymous user found
   → voteOnPost(postId, principalId)
```

---

## 8. Files Summary

### New files (1)

| File                                            | Purpose                                                                 |
| ----------------------------------------------- | ----------------------------------------------------------------------- |
| `packages/db/drizzle/XXXX_anonymous_voting.sql` | Migration: add `is_anonymous` to user, drop `anonymous_vote_identities` |

### Modified files (~14)

| File                                                              | Change                                                              |
| ----------------------------------------------------------------- | ------------------------------------------------------------------- |
| `packages/db/src/schema/auth.ts`                                  | Add `isAnonymous` to user table, remove `anonymousVoteIdentities`   |
| `apps/web/src/lib/server/auth/index.ts`                           | Add `anonymous()` plugin, modify databaseHooks, add `onLinkAccount` |
| `apps/web/src/lib/server/auth/client.ts`                          | Add `anonymousClient()` plugin                                      |
| `apps/web/src/lib/server/functions/auth-helpers.ts`               | Add `type` to AuthContext                                           |
| `apps/web/src/lib/server/domains/settings/settings.types.ts`      | Add `anonymousVoting` to PortalFeatures + default                   |
| `apps/web/src/lib/server/functions/settings.ts`                   | Add `anonymousVoting` to Zod schema                                 |
| `apps/web/src/lib/server/functions/public-posts.ts`               | `toggleVoteFn` rate limit, `getVoteSidebarDataFn` canVote field     |
| `apps/web/src/routes/api/widget/vote.ts`                          | Fall back to Better Auth session                                    |
| `apps/web/src/routes/api/widget/voted-posts.ts`                   | Fall back to Better Auth session                                    |
| `apps/web/src/routes/_portal.tsx`                                 | Expose `portalFeatures` in loader                                   |
| `apps/web/src/components/public/post-card.tsx`                    | Add `canVote` prop, anonymous sign-in on click                      |
| `apps/web/src/components/public/feedback/feedback-container.tsx`  | Pass `canVote` to PostCard                                          |
| `apps/web/src/components/public/post-detail/vote-sidebar.tsx`     | Use `canVote` from sidebar data                                     |
| `apps/web/src/components/widget/widget-home.tsx`                  | Support anonymous voting                                            |
| `apps/web/src/lib/server/domains/principals/principal.service.ts` | Filter anonymous from `countMembers`                                |
| Admin settings UI                                                 | Add anonymous voting toggle                                         |

### Removed files (2)

| File                                                         | Reason                                     |
| ------------------------------------------------------------ | ------------------------------------------ |
| `apps/web/src/lib/server/utils/anon-token.ts`                | Replaced by Better Auth session management |
| `apps/web/src/lib/server/domains/posts/anon-vote.service.ts` | Replaced by Better Auth anonymous plugin   |

### Unchanged files (the win)

| File                                                   | Why unchanged                                             |
| ------------------------------------------------------ | --------------------------------------------------------- |
| `apps/web/src/lib/server/domains/posts/post.voting.ts` | All voting functions work with anonymous principals as-is |
| `apps/web/src/components/public/vote-button.tsx`       | Props unchanged                                           |
| `apps/web/src/components/public/auth-vote-button.tsx`  | Props unchanged                                           |
| `apps/web/src/lib/client/hooks/use-post-vote.ts`       | Works with any principal-backed votes                     |

---

## 9. Build Sequence

### Phase A: Schema + Auth Config

1. Add `isAnonymous` boolean to user table in `auth.ts`
2. Remove `anonymousVoteIdentities` table from `auth.ts`
3. Generate migration, run it
4. Add `anonymous()` plugin to server auth config with `onLinkAccount`
5. Modify `databaseHooks.user.create.after` to detect anonymous users
6. Add `anonymousClient()` to client auth config
7. Add `type` to AuthContext in auth-helpers
8. `bun run typecheck`

### Phase B: Server Entry Points

9. Modify `toggleVoteFn` — add rate limiting for anonymous principals
10. Modify `getVoteSidebarDataFn` — return `canVote` field
11. Modify widget endpoints — fall back to Better Auth session
12. Verify `countMembers` filters anonymous principals
13. `bun run typecheck`

### Phase C: Frontend

14. Update `post-card.tsx` — add `canVote` prop, anonymous sign-in on click
15. Update `feedback-container.tsx` — pass `canVote` to PostCard
16. Update `vote-sidebar.tsx` — use `canVote` from sidebar data
17. Update `widget-home.tsx` — support anonymous voting
18. Add admin settings toggle
19. `bun run typecheck && bun run lint`

### Phase D: Testing

20. E2E: unauthenticated user can vote when anonymous voting enabled
21. E2E: unauthenticated user sees auth dialog when anonymous voting disabled
22. E2E: same session cannot double-vote same post
23. E2E: vote toggle works (vote, unvote, revote)
24. E2E: admin can see and remove anonymous votes in VotersModal
25. `bun run test && bun run test:e2e`

---

## 10. Known Trade-offs

| Trade-off                                                                  | Why accepted                                                                                                |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Anonymous sign-in creates full user + session records                      | Cleaned up via cron. Better Auth manages session lifecycle. Trade-off for massively simpler implementation. |
| Brief delay on first anonymous vote (sign-in round-trip)                   | One-time cost per browser session. Subsequent votes are instant.                                            |
| Clearing cookies allows re-voting (new anonymous user)                     | Matches Featurebase behavior. Per-IP rate limiting mitigates bulk abuse.                                    |
| Safari ITP may block cookies in cross-domain widget embeds                 | Same-origin embeds (majority case) unaffected. Accepted for MVP.                                            |
| `onLinkAccount` keeps anonymous user record (`disableDeleteAnonymousUser`) | Needed to preserve the principal→votes foreign key chain. Cleanup via cron.                                 |
