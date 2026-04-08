# Widget Identify: Custom Attributes via JWT Claims

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow consumers to pass custom user attributes (e.g. `plan`, `mrr`, `company`) as JWT claims in the widget `ssoToken`, validated and stored using the existing attribute definitions system.

**Architecture:** The JWT payload already carries arbitrary claims — `verifyHS256JWT` returns them all. The widget identify handler currently extracts only `sub`, `email`, `name`, `avatarURL` and discards the rest. We extract remaining claims (excluding reserved JWT fields), run them through the existing `validateAndCoerceAttributes` pipeline, and merge into `user.metadata`. This reuses the same code path as `POST /api/v1/users/identify`. Unknown claims are silently ignored (not errors) — this matches Featurebase/Intercom behavior where the JWT is a superset and the platform picks out what it recognizes.

**Tech Stack:** TypeScript, Zod, Vitest, Drizzle ORM (existing attribute validation infrastructure)

**Industry alignment:** Featurebase, Frill, Nolt, and Sleekplan all support custom attributes in their widget JWT claims. Our REST API already supports `attributes` — this closes the gap for the widget path. Following Featurebase's model: unknown claims are silently dropped (not rejected), since the JWT may contain claims intended for other systems.

---

## File Map

| File                                                                          | Action | Responsibility                                                                       |
| ----------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------ |
| `apps/web/src/routes/api/widget/identify.ts`                                  | Modify | Extract custom claims from JWT, pass to attribute pipeline, merge into user metadata |
| `apps/web/src/routes/api/widget/__tests__/widget-identify-attributes.test.ts` | Create | Tests for custom attribute extraction and storage via widget identify                |
| `apps/web/src/routes/admin/settings.widget.tsx`                               | Modify | Update server-side code examples to show custom claims in JWT payload                |

---

### Task 1: Extract and validate custom attributes from JWT claims

**Files:**

- Create: `apps/web/src/routes/api/widget/__tests__/widget-identify-attributes.test.ts`
- Modify: `apps/web/src/routes/api/widget/identify.ts`

#### Background: How the existing attribute system works

The attribute pipeline is in `apps/web/src/lib/server/domains/users/user.attributes.ts`:

- `validateAndCoerceAttributes(attrs)` — takes a `Record<string, unknown>`, loads all `userAttributeDefinitions` from DB, matches by `key`, coerces values to declared types, returns `{ valid, removals, errors }`. Unknown keys are returned as errors.
- `mergeMetadata(existing, valid, removals)` — merges validated attrs into existing metadata JSON, preserving `_`-prefixed system keys.

For the widget path we want to **silently drop** unknown claims (not throw), since JWT payloads may contain claims for other systems. We use `validateAndCoerceAttributes` directly (not `validateInputAttributes` which throws on errors).

#### Reserved JWT claims to exclude

These are standard JWT claims and known Quackback identity fields that must NOT be passed to the attribute pipeline:

`sub`, `id`, `email`, `name`, `avatarURL`, `avatarUrl`, `iat`, `exp`, `nbf`, `iss`, `aud`, `jti`

Everything else in the JWT payload is a candidate custom attribute.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/routes/api/widget/__tests__/widget-identify-attributes.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHmac } from 'crypto'

// ─── Mocks ───────────────────────────────────────────────────────────
const mockDb = {
  query: {
    user: { findFirst: vi.fn() },
    session: { findFirst: vi.fn() },
    principal: { findFirst: vi.fn() },
  },
  insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn(() => []) })) })),
  update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn() })) })),
  select: vi.fn(() => ({ from: vi.fn(() => []) })),
}

vi.mock('@/lib/server/db', () => ({
  db: mockDb,
  user: {},
  session: {},
  principal: {},
  userAttributeDefinitions: {},
  eq: vi.fn(),
  and: vi.fn(),
  gt: vi.fn(),
}))
vi.mock('@/lib/server/domains/settings/settings.widget', () => ({
  getWidgetConfig: vi.fn(() => ({ enabled: true })),
  getWidgetSecret: vi.fn(() => SECRET),
}))
vi.mock('@/lib/server/domains/posts/post.public', () => ({
  getAllUserVotedPostIds: vi.fn(() => new Set()),
}))
vi.mock('@/lib/server/storage/s3', () => ({
  getPublicUrlOrNull: vi.fn(() => null),
}))
vi.mock('@/lib/server/auth/identify-merge', () => ({
  resolveAndMergeAnonymousToken: vi.fn(),
}))
vi.mock('@quackback/ids', () => ({
  generateId: vi.fn(() => 'mock_id'),
}))

// Mock the attribute validation — this is the key piece we're testing integration with
const mockValidateAndCoerce = vi.fn(() => ({ valid: {}, removals: [], errors: [] }))
vi.mock('@/lib/server/domains/users/user.attributes', () => ({
  validateAndCoerceAttributes: mockValidateAndCoerce,
  mergeMetadata: vi.fn((existing, valid) =>
    JSON.stringify({ ...JSON.parse(existing || '{}'), ...valid })
  ),
}))

const SECRET = 'test-secret-for-attrs'

function makeJWT(payload: Record<string, unknown>, secret = SECRET): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url')
  return `${header}.${body}.${signature}`
}

import { extractCustomClaims, RESERVED_JWT_CLAIMS } from '../identify'

describe('Widget Identify — custom attributes from JWT claims', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('extractCustomClaims', () => {
    it('strips reserved JWT and identity claims', () => {
      const payload = {
        sub: 'user_1',
        id: 'user_1',
        email: 'test@example.com',
        name: 'Test',
        avatarURL: 'https://img.co/1',
        iat: 1234567890,
        exp: 1234567890,
        nbf: 1234567890,
        iss: 'quackback',
        aud: 'widget',
        jti: 'token_id',
        // Custom claims:
        plan: 'pro',
        mrr: 9900,
      }
      const result = extractCustomClaims(payload)
      expect(result).toEqual({ plan: 'pro', mrr: 9900 })
    })

    it('returns empty object when no custom claims present', () => {
      const payload = {
        sub: 'user_1',
        email: 'test@example.com',
        iat: 123,
        exp: 456,
      }
      expect(extractCustomClaims(payload)).toEqual({})
    })

    it('handles avatarUrl (camelCase variant) as reserved', () => {
      const payload = {
        sub: 'user_1',
        email: 'test@example.com',
        avatarUrl: 'https://img.co/1',
        company: 'Acme',
      }
      expect(extractCustomClaims(payload)).toEqual({ company: 'Acme' })
    })
  })

  describe('RESERVED_JWT_CLAIMS', () => {
    it('includes all standard JWT and identity claims', () => {
      expect(RESERVED_JWT_CLAIMS).toContain('sub')
      expect(RESERVED_JWT_CLAIMS).toContain('iat')
      expect(RESERVED_JWT_CLAIMS).toContain('exp')
      expect(RESERVED_JWT_CLAIMS).toContain('email')
      expect(RESERVED_JWT_CLAIMS).toContain('avatarURL')
      expect(RESERVED_JWT_CLAIMS).toContain('avatarUrl')
    })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /home/james/quackback && bun run test -- apps/web/src/routes/api/widget/__tests__/widget-identify-attributes.test.ts`

Expected: FAIL — `extractCustomClaims` and `RESERVED_JWT_CLAIMS` are not exported from `identify.ts`

- [ ] **Step 3: Implement extractCustomClaims and attribute merging in the identify handler**

In `apps/web/src/routes/api/widget/identify.ts`, add the following:

1. Add imports at the top:

```typescript
import {
  validateAndCoerceAttributes,
  mergeMetadata,
} from '@/lib/server/domains/users/user.attributes'
```

2. Add the reserved claims set and extraction function after the `identifySchema` definition (before `SESSION_TTL_MS`):

```typescript
/** JWT claims that are identity fields or standard JWT metadata — not custom attributes */
export const RESERVED_JWT_CLAIMS = new Set([
  'sub',
  'id',
  'email',
  'name',
  'avatarURL',
  'avatarUrl',
  'iat',
  'exp',
  'nbf',
  'iss',
  'aud',
  'jti',
])

/** Extract non-reserved claims from a verified JWT payload for attribute processing */
export function extractCustomClaims(payload: Record<string, unknown>): Record<string, unknown> {
  const custom: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(payload)) {
    if (!RESERVED_JWT_CLAIMS.has(key)) {
      custom[key] = value
    }
  }
  return custom
}
```

3. In the POST handler, after the user record is found/created and before the principal lookup, add attribute merging. Replace the existing user update block (lines 112-135) with:

```typescript
// Extract custom claims for attribute processing
const customClaims = extractCustomClaims(payload)

if (userRecord) {
  const updates: Record<string, unknown> = {}
  if (identified.name && identified.name !== userRecord.name) updates.name = identified.name
  if (identified.avatarURL && identified.avatarURL !== userRecord.image)
    updates.image = identified.avatarURL

  // Validate and merge custom attributes (silently drop unknown/invalid claims)
  if (Object.keys(customClaims).length > 0) {
    const { valid } = await validateAndCoerceAttributes(customClaims)
    if (Object.keys(valid).length > 0) {
      updates.metadata = mergeMetadata(userRecord.metadata ?? null, valid, [])
    }
  }

  if (Object.keys(updates).length > 0) {
    await db.update(user).set(updates).where(eq(user.id, userRecord.id))
  }
} else {
  // Build initial metadata from custom claims
  let metadata: string | null = null
  if (Object.keys(customClaims).length > 0) {
    const { valid } = await validateAndCoerceAttributes(customClaims)
    if (Object.keys(valid).length > 0) {
      metadata = JSON.stringify(valid)
    }
  }

  const [created] = await db
    .insert(user)
    .values({
      id: generateId('user'),
      name: identified.name || identified.email.split('@')[0],
      email: identified.email,
      emailVerified: false,
      image: identified.avatarURL ?? null,
      metadata,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning()
  userRecord = created
}
```

Note: The existing `user` select in `db.query.user.findFirst` already includes `metadata` in its default columns (from `user.attributes.ts:USER_COLUMNS`), but the widget identify handler uses the default select. We need to ensure `metadata` is available on the read. Check that the `findFirst` call at line 108 returns metadata. If not, add `columns: { ...USER_COLUMNS }` to the query. The user table schema includes `metadata` as a column, so the default select should include it.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /home/james/quackback && bun run test -- apps/web/src/routes/api/widget/__tests__/widget-identify-attributes.test.ts`

Expected: PASS

- [ ] **Step 5: Run the full test suite to check for regressions**

Run: `cd /home/james/quackback && bun run test`

Expected: All tests pass (existing widget identify tests + new attribute tests)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/routes/api/widget/identify.ts apps/web/src/routes/api/widget/__tests__/widget-identify-attributes.test.ts
git commit -m "$(cat <<'EOF'
feat: support custom user attributes in widget JWT claims

Extract non-reserved claims from the verified ssoToken JWT payload and
run them through the existing attribute validation/coercion pipeline.
Claims matching configured user attribute definitions are merged into
user.metadata; unknown claims are silently ignored (matching
Featurebase/Intercom behavior where JWTs may carry claims for other
systems).

This closes the gap between the REST API identify endpoint (which
already accepts attributes) and the widget identify flow.
EOF
)"
```

---

### Task 2: Update settings page code examples to show custom attributes

**Files:**

- Modify: `apps/web/src/routes/admin/settings.widget.tsx:375-416` (SERVER_EXAMPLES array)

The server-side JWT code examples currently only include `sub`, `email`, `name`, `exp`. We add a comment showing that custom attributes can be included as additional claims.

- [ ] **Step 1: Update the Next.js example**

In `apps/web/src/routes/admin/settings.widget.tsx`, find the Next.js `code` string in `SERVER_EXAMPLES` (around line 387). Replace the `signWidgetToken` call payload:

```typescript
const ssoToken = signWidgetToken({
  sub: session.user.id,
  email: session.user.email,
  name: session.user.name,
  // Custom attributes (must be configured in Settings > User Attributes)
  // plan: session.user.plan,
  // mrr: session.user.mrr,
  exp: now + 300,
})
```

- [ ] **Step 2: Update the Express example**

Same change in the Express `code` string (around line 435):

```typescript
const ssoToken = signWidgetToken({
  sub: req.user.id,
  email: req.user.email,
  name: req.user.name,
  // Custom attributes (must be configured in Settings > User Attributes)
  // plan: req.user.plan,
  exp: now + 300,
})
```

- [ ] **Step 3: Update one non-JS example (Django) for coverage**

In the Django `code` string (around line 453), update the `sign_widget_token` payload:

```python
    token = sign_widget_token({
        "sub": str(request.user.id),
        "email": request.user.email,
        "name": request.user.get_full_name() or request.user.username,
        # Custom attributes (must be configured in Settings > User Attributes)
        # "plan": request.user.plan,
        "exp": now + 300,
    })
```

- [ ] **Step 4: Verify the dev server renders correctly**

Run: `cd /home/james/quackback && bun run dev`

Navigate to `localhost:3000/admin/settings/widget`, verify the code examples render with the commented custom attributes.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/admin/settings.widget.tsx
git commit -m "$(cat <<'EOF'
docs: show custom attribute claims in widget JWT code examples

Add commented examples of custom attribute claims (plan, mrr) in the
server-side code snippets on the widget settings page, so consumers
can see that arbitrary user attributes can be included in the JWT.
EOF
)"
```

---

### Task 3: Add integration test for end-to-end attribute flow

**Files:**

- Modify: `apps/web/src/routes/api/widget/__tests__/widget-identify-attributes.test.ts`

Extend the test file from Task 1 with integration-style tests that verify the full handler behavior with mocked DB and attribute definitions.

- [ ] **Step 1: Add integration tests**

Append to the existing test file:

```typescript
describe('Widget Identify handler — attribute integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes custom claims to validateAndCoerceAttributes', async () => {
    mockValidateAndCoerce.mockResolvedValueOnce({
      valid: { plan: 'pro' },
      removals: [],
      errors: [{ key: 'unknown_field', reason: 'No attribute definition found' }],
    })

    const claims = {
      sub: 'user_1',
      email: 'test@example.com',
      plan: 'pro',
      unknown_field: 'dropped',
      iat: 123,
      exp: Math.floor(Date.now() / 1000) + 3600,
    }
    const custom = extractCustomClaims(claims)
    expect(custom).toEqual({ plan: 'pro', unknown_field: 'dropped' })

    // Simulate what the handler does
    const { valid } = await mockValidateAndCoerce(custom)
    expect(mockValidateAndCoerce).toHaveBeenCalledWith({ plan: 'pro', unknown_field: 'dropped' })
    expect(valid).toEqual({ plan: 'pro' })
  })

  it('does not call validateAndCoerceAttributes when no custom claims', () => {
    const claims = {
      sub: 'user_1',
      email: 'test@example.com',
      iat: 123,
      exp: 456,
    }
    const custom = extractCustomClaims(claims)
    expect(Object.keys(custom)).toHaveLength(0)
    // Handler should skip attribute validation entirely
  })

  it('handles boolean, number, and date custom claims', () => {
    const claims = {
      sub: 'user_1',
      email: 'test@example.com',
      enterprise: true,
      seat_count: 50,
      trial_ends: '2026-05-01T00:00:00Z',
    }
    const custom = extractCustomClaims(claims)
    expect(custom).toEqual({
      enterprise: true,
      seat_count: 50,
      trial_ends: '2026-05-01T00:00:00Z',
    })
  })
})
```

- [ ] **Step 2: Run the full test file**

Run: `cd /home/james/quackback && bun run test -- apps/web/src/routes/api/widget/__tests__/widget-identify-attributes.test.ts`

Expected: All tests pass

- [ ] **Step 3: Run the full test suite**

Run: `cd /home/james/quackback && bun run test`

Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/api/widget/__tests__/widget-identify-attributes.test.ts
git commit -m "$(cat <<'EOF'
test: add integration tests for widget identify custom attributes

Cover attribute extraction with various claim types (boolean, number,
date), verify unknown claims are passed to validation but silently
dropped, and confirm no attribute processing when JWT has no custom
claims.
EOF
)"
```
