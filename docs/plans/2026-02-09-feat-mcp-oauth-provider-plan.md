# MCP OAuth 2.1 Provider — Implementation Plan

**Date**: 2026-02-09
**Type**: Feature
**Status**: Draft

## Goal

Replace the manual API key setup for MCP authentication with OAuth 2.1 so users can:

1. Install the Quackback plugin in Claude Code
2. Claude Code auto-discovers OAuth via well-known endpoints
3. Browser opens → user logs in → authorizes scopes → done
4. All MCP requests are made as the authenticated user, with their own permissions

API key auth remains as a parallel option for CI/programmatic use.

---

## Design Decisions

These were resolved before implementation:

| #   | Question          | Decision                                                                                                                                                                                               |
| --- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Scope enforcement | Adopt the user's own permissions via standard role checks. OAuth user = same access as if they were logged into the UI.                                                                                |
| 2   | Portal users      | Portal users (`role: user`) CAN use MCP, acting as themselves with their natural role permissions (same as UI). Admins can toggle this via a setting.                                                  |
| 3   | Well-known paths  | Set `authorization_servers` to `["${baseUrl}/api/auth"]` in protected resource metadata. MCP SDK uses fallback sequence and finds Better Auth's metadata. Add origin-root proxy for max compatibility. |
| 4   | `disabledPaths`   | Safe to add `disabledPaths: ['/token']`. Only disables the JWT plugin's `/token` endpoint. Does NOT affect emailOTP, magicLink, or session management.                                                 |
| 5   | Consent screen    | Always require consent for all users, including first-party. No `skipConsent`.                                                                                                                         |

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│ Claude Code (OAuth Client)                                       │
│ 1. POST /api/mcp → gets 401 + WWW-Authenticate header           │
│ 2. GET /.well-known/oauth-protected-resource                     │
│ 3. GET /api/auth/.well-known/oauth-authorization-server          │
│ 4. POST /api/auth/oauth2/register  (dynamic client registration) │
│ 5. Browser → /api/auth/oauth2/authorize (user logs in + consent) │
│ 6. POST /api/auth/oauth2/token     (code → access token)        │
│ 7. POST /api/mcp with Bearer <jwt>  ← MCP works!                │
└──────────────────────────────────────────────────────────────────┘
```

**Roles:**

- **Authorization Server**: Better Auth with `oauthProvider` plugin (at `/api/auth/oauth2/*`)
- **Resource Server**: MCP endpoint at `/api/mcp` (validates JWTs)
- **Client**: Claude Code (handles the full OAuth flow automatically)

### Access Model

```
┌──────────────┬───────────────────────────────────────────────────┐
│ Role         │ MCP Access                                        │
├──────────────┼───────────────────────────────────────────────────┤
│ admin        │ All tools, all content (same as UI)               │
│ member       │ All tools, all content (same as UI)               │
│ user (portal)│ Acts as themselves with natural role permissions.  │
│              │ Same access as if they were using the portal UI.   │
│              │ Gated behind "Portal MCP Access" admin setting.   │
└──────────────┴───────────────────────────────────────────────────┘
```

---

## Prerequisites

- Better Auth `^1.4.17` ✅ (already at this version)
- `@better-auth/oauth-provider` — new dependency
- `jose` `^6.1.3` ✅ (already installed)

---

## Phase 1: Install & Configure OAuth Provider Plugin

### 1.1 Install the package

```bash
cd apps/web && bun add @better-auth/oauth-provider
```

### 1.2 Update Better Auth config

**File**: `apps/web/src/lib/server/auth/index.ts`

Add `disabledPaths` to the top-level config, and add `jwt()` + `oauthProvider()` to the plugins array:

```typescript
import { jwt } from 'better-auth/plugins'
import { oauthProvider } from '@better-auth/oauth-provider'

return betterAuth({
  // Disable the JWT plugin's /token endpoint — conflicts with OAuth's /oauth2/token
  // This does NOT affect emailOTP, magicLink, or session management
  disabledPaths: ['/token'],

  // ... existing config (secret, database, socialProviders, session, advanced, databaseHooks) ...

  plugins: [
    // ... existing plugins (emailOTP, magicLink, oneTimeToken) ...

    // JWT plugin — signs access tokens, exposes /api/auth/jwks for verification
    jwt(),

    // OAuth 2.1 Provider — turns Better Auth into an authorization server
    oauthProvider({
      // Redirect unauthenticated OAuth users to portal login
      loginPage: '/auth/login',

      // Consent page — always shown, never skipped
      consentPage: '/oauth/consent',

      // Allow Claude Code (and other MCP clients) to self-register
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,

      // Quackback-specific scopes
      scopes: [
        'openid', // Required for OIDC — returns user ID
        'profile', // User name + avatar
        'offline_access', // Enables refresh tokens
        'read:feedback', // Read posts, comments, boards, statuses
        'write:feedback', // Create/triage posts, add comments
        'write:changelog', // Create changelog entries
      ],

      // Default scopes for dynamically registered clients
      clientRegistrationDefaultScopes: ['openid', 'profile', 'read:feedback'],

      // Additional scopes allowed for dynamically registered clients
      clientRegistrationAllowedScopes: ['offline_access', 'write:feedback', 'write:changelog'],

      // MCP endpoint is a valid token audience
      validAudiences: [
        // Set at runtime from config.baseUrl + '/api/mcp'
        // See note below about dynamic audiences
      ],

      // Embed principal info in the JWT so MCP handler can skip DB lookups
      customAccessTokenClaims: async ({ user }) => {
        const { db, principal, eq } = await import('@/lib/server/db')
        const p = await db.query.principal.findFirst({
          where: eq(principal.userId, user.id as any),
          columns: { id: true, role: true },
        })
        return {
          principalId: p?.id,
          role: p?.role ?? 'user',
        }
      },
    }),

    // TanStack Start cookie management (MUST be last)
    tanstackStartCookies(),
  ],
})
```

**Note on `validAudiences`**: Since `config.baseUrl` is not available at import time (lazy getter), we'll need to either:

- Set it inside `createAuth()` where `config` is accessible: `validAudiences: [`${config.baseUrl}/api/mcp`]`
- Or handle audience validation in the MCP handler's `verifyAccessToken` call (preferred — keeps auth config simple)

### 1.3 Generate & run database migrations

The OAuth Provider plugin creates 4 tables:

- `oauth_client` — registered OAuth applications
- `oauth_access_token` — opaque access token storage (JWT mode uses this minimally)
- `oauth_refresh_token` — refresh token storage
- `oauth_consent` — user consent records

```bash
bunx @better-auth/cli generate  # generates Drizzle schema
bun run db:migrate               # applies the migration
```

Review the generated SQL before applying. Tables will be created in the existing `packages/db/drizzle/` migration directory.

---

## Phase 2: Well-Known Discovery Endpoints

### How MCP OAuth discovery works

1. Claude Code sends `POST /api/mcp` with no auth
2. Server returns `401` with `WWW-Authenticate: Bearer resource_metadata="https://example.com/.well-known/oauth-protected-resource"`
3. Claude Code fetches protected resource metadata → gets `authorization_servers: ["https://example.com/api/auth"]`
4. Claude Code applies RFC 8414 with fallback: tries `${authServerUrl}/.well-known/oauth-authorization-server` first
5. Better Auth serves metadata at `/api/auth/.well-known/oauth-authorization-server` — match!

### 2.1 Protected Resource Metadata endpoint

**New file**: `apps/web/src/routes/.well-known/oauth-protected-resource.ts`

```typescript
import { createFileRoute } from '@tanstack/react-router'
import { config } from '@/lib/server/config'

export const Route = createFileRoute('/.well-known/oauth-protected-resource')({
  server: {
    handlers: {
      GET: async () => {
        const baseUrl = config.baseUrl

        return new Response(
          JSON.stringify({
            resource: `${baseUrl}/api/mcp`,
            // Point to /api/auth so MCP SDK finds metadata at
            // /api/auth/.well-known/oauth-authorization-server
            authorization_servers: [`${baseUrl}/api/auth`],
            bearer_methods_supported: ['header'],
            scopes_supported: [
              'openid',
              'profile',
              'offline_access',
              'read:feedback',
              'write:feedback',
              'write:changelog',
            ],
          }),
          {
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': 'public, max-age=3600',
            },
          }
        )
      },
    },
  },
})
```

### 2.2 Origin-root proxy for max compatibility

The MCP TypeScript SDK tries multiple paths as a fallback. For maximum compatibility
(especially with clients that only try the origin root), add a proxy:

**New file**: `apps/web/src/routes/.well-known/oauth-authorization-server.ts`

```typescript
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/.well-known/oauth-authorization-server')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // Proxy to Better Auth's auto-generated metadata endpoint
        const { auth } = await import('@/lib/server/auth/index')
        const url = new URL(request.url)
        const rewrittenUrl = new URL('/api/auth/.well-known/oauth-authorization-server', url.origin)
        return auth.handler(new Request(rewrittenUrl.toString(), request))
      },
    },
  },
})
```

### 2.3 Better Auth auto-created endpoints (no code needed)

These are all handled by the existing catch-all at `apps/web/src/routes/api/auth/$.ts`:

- `GET /api/auth/.well-known/oauth-authorization-server` — RFC 8414 metadata
- `GET /api/auth/.well-known/openid-configuration` — OIDC discovery
- `GET /api/auth/jwks` — JWKS for JWT verification
- `POST /api/auth/oauth2/authorize` — authorization endpoint
- `POST /api/auth/oauth2/token` — token endpoint
- `POST /api/auth/oauth2/register` — dynamic client registration
- `POST /api/auth/oauth2/introspect` — token introspection
- `POST /api/auth/oauth2/revoke` — token revocation
- `GET /api/auth/oauth2/userinfo` — OIDC UserInfo

---

## Phase 3: MCP Handler — Dual Auth + Portal User Scoping

### 3.1 Update McpAuthContext type

**File**: `apps/web/src/lib/server/mcp/types.ts`

Expand the type to support all three roles and track auth method:

```typescript
import type { PrincipalId, UserId } from '@quackback/ids'

export interface McpAuthContext {
  principalId: PrincipalId
  userId: UserId
  name: string
  email: string
  role: 'admin' | 'member' | 'user'
  authMethod: 'oauth' | 'api-key'
}
```

### 3.2 Update the auth resolver for dual auth

**File**: `apps/web/src/lib/server/mcp/handler.ts`

```typescript
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import { getDeveloperConfig } from '@/lib/server/domains/settings/settings.service'
import { db, principal, eq } from '@/lib/server/db'
import { createMcpServer } from './server'
import { config } from '@/lib/server/config'
import type { McpAuthContext } from './types'

const API_KEY_PREFIX = 'qb_'

/**
 * Resolve auth from OAuth JWT token.
 * Returns McpAuthContext if valid, null if not an OAuth token.
 */
async function resolveOAuthContext(request: Request): Promise<McpAuthContext | null> {
  const authHeader = request.headers.get('authorization')
  if (!authHeader) return null

  const match = authHeader.match(/^Bearer\s+(.+)$/i)
  if (!match) return null

  const token = match[1]

  // If it starts with qb_, it's an API key — skip OAuth
  if (token.startsWith(API_KEY_PREFIX)) return null

  try {
    const { verifyAccessToken } = await import('better-auth/oauth2')

    const payload = await verifyAccessToken(token, {
      verifyOptions: {
        issuer: config.baseUrl,
        audience: `${config.baseUrl}/api/mcp`,
      },
    })

    if (!payload?.sub) return null

    // JWT claims contain principalId + role from customAccessTokenClaims
    const principalId = payload.principalId as string
    const role = payload.role as string

    if (!principalId || !role) return null

    const principalRecord = await db.query.principal.findFirst({
      where: eq(principal.id, principalId as any),
      with: { user: true },
    })

    if (!principalRecord?.user) return null

    return {
      principalId: principalRecord.id,
      userId: principalRecord.user.id,
      name: principalRecord.user.name,
      email: principalRecord.user.email,
      role: principalRecord.role as 'admin' | 'member' | 'user',
      authMethod: 'oauth',
    }
  } catch {
    return null
  }
}

/**
 * Resolve auth context: try OAuth JWT first, then API key.
 * Returns 401 with WWW-Authenticate header if both fail (triggers OAuth discovery).
 */
export async function resolveAuthContext(request: Request): Promise<McpAuthContext | Response> {
  // 1. Try OAuth JWT
  const oauthContext = await resolveOAuthContext(request)
  if (oauthContext) return oauthContext

  // 2. Try API key
  const authHeader = request.headers.get('authorization')
  const token = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1]

  if (token?.startsWith(API_KEY_PREFIX)) {
    const authResult = await withApiKeyAuth(request, { role: 'team' })
    if (authResult instanceof Response) return authResult

    const principalRecord = await db.query.principal.findFirst({
      where: eq(principal.id, authResult.principalId),
      with: { user: true },
    })

    if (!principalRecord?.user) {
      return new Response(JSON.stringify({ error: 'Member not found' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return {
      principalId: authResult.principalId,
      userId: principalRecord.user.id,
      name: principalRecord.user.name,
      email: principalRecord.user.email,
      role: authResult.role as 'admin' | 'member' | 'user',
      authMethod: 'api-key',
    }
  }

  // 3. No valid auth — return 401 with OAuth discovery hint
  return new Response(JSON.stringify({ error: 'Authentication required' }), {
    status: 401,
    headers: {
      'Content-Type': 'application/json',
      'WWW-Authenticate': `Bearer resource_metadata="${config.baseUrl}/.well-known/oauth-protected-resource"`,
    },
  })
}

/** Create a stateless transport + server, handle the request, clean up */
export async function handleMcpRequest(request: Request): Promise<Response> {
  const devConfig = await getDeveloperConfig()
  if (!devConfig.mcpEnabled) {
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32001,
          message: 'MCP server is disabled. Enable it in Settings > Developers > MCP Server.',
        },
        id: null,
      }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const auth = await resolveAuthContext(request)
  if (auth instanceof Response) return auth

  // Portal user access check
  if (auth.role === 'user') {
    if (!devConfig.mcpPortalAccessEnabled) {
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          error: {
            code: -32001,
            message: 'Portal user MCP access is disabled by the administrator.',
          },
          id: null,
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      )
    }
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })

  const server = createMcpServer(auth)
  await server.connect(transport)

  try {
    return await transport.handleRequest(request)
  } finally {
    await transport.close()
    await server.close()
  }
}
```

### 3.3 Add portal MCP access setting

**File**: `apps/web/src/lib/server/domains/settings/settings.service.ts`

Add `mcpPortalAccessEnabled` to the developer config (alongside existing `mcpEnabled`):

```typescript
// In the developer config type/schema:
interface DeveloperConfig {
  mcpEnabled: boolean
  mcpPortalAccessEnabled: boolean // NEW — toggle portal user MCP access
}
```

**File**: Admin settings UI (wherever MCP toggle lives)

Add a sub-toggle under the MCP Server section:

```
[x] Enable MCP Server
  [x] Allow portal users to access MCP
      Portal users can search and submit their own feedback via MCP clients.
```

This setting is only visible when MCP is enabled.

### 3.4 No tool/resource scoping needed

Portal users act as themselves with their natural role permissions — the same access they'd have in the portal UI. The existing domain services already enforce permissions based on role, so no additional filtering or guards are needed in the MCP layer.

Tools and resources remain unchanged from the current implementation. The `auth.role` field in `McpAuthContext` is available if any service needs to check it downstream.

---

## Phase 4: OAuth Consent Page

### 4.1 Create the consent route

**New file**: `apps/web/src/routes/oauth/consent.tsx`

```typescript
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

const searchSchema = z.object({
  client_id: z.string(),
  scope: z.string().optional(),
  consent_code: z.string().optional(),
})

export const Route = createFileRoute('/oauth/consent')({
  validateSearch: searchSchema,
  component: ConsentPage,
})

function ConsentPage() {
  const { client_id, scope, consent_code } = Route.useSearch()
  const scopes = scope?.split(' ') ?? []

  const scopeLabels: Record<string, string> = {
    'openid': 'Access your user ID',
    'profile': 'View your name and avatar',
    'read:feedback': 'Read feedback posts, comments, and boards',
    'write:feedback': 'Create and triage feedback posts, add comments',
    'write:changelog': 'Create changelog entries',
    'offline_access': 'Stay connected when you\'re not using it',
  }

  async function handleConsent(accept: boolean) {
    const response = await fetch('/api/auth/oauth2/consent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ accept, scope }),
    })

    if (response.redirected) {
      window.location.href = response.url
    } else {
      const data = await response.json()
      if (data.redirectUrl) {
        window.location.href = data.redirectUrl
      }
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-md space-y-6 px-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Authorize Access</h1>
          <p className="mt-2 text-muted-foreground">
            An application wants to access your Quackback account
          </p>
        </div>

        <div className="rounded-lg border p-4 space-y-3">
          <p className="text-sm font-medium">This will allow the application to:</p>
          <ul className="space-y-2">
            {scopes.map((s) => (
              <li key={s} className="flex items-center gap-2 text-sm">
                <span className="text-green-500">✓</span>
                {scopeLabels[s] ?? s}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => handleConsent(false)}
            className="flex-1 rounded-md border px-4 py-2 text-sm"
          >
            Deny
          </button>
          <button
            onClick={() => handleConsent(true)}
            className="flex-1 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
          >
            Authorize
          </button>
        </div>
      </div>
    </div>
  )
}
```

### 4.2 Add oauth route layout

**New file**: `apps/web/src/routes/oauth.tsx`

```typescript
import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/oauth')({
  component: () => <Outlet />,
})
```

### 4.3 Exempt OAuth + well-known routes from onboarding redirect

**File**: `apps/web/src/routes/__root.tsx`

Add to the exempt paths list:

```typescript
const exemptPaths = [
  '/onboarding',
  '/auth/',
  '/admin/login',
  '/admin/signup',
  '/api/',
  '/accept-invitation/',
  '/oauth/', // NEW — consent page
  '/.well-known/', // NEW — discovery endpoints
]
```

---

## Phase 5: Plugin Configuration Update

### 5.1 Update .mcp.json for OAuth

**File**: `/home/james/claude-code-plugins/plugins/quackback/.mcp.json`

```json
{
  "mcpServers": {
    "quackback": {
      "type": "http",
      "url": "${QUACKBACK_MCP_URL}"
    }
  }
}
```

No `Authorization` header → Claude Code auto-discovers OAuth → browser opens → user logs in → done.

### 5.2 Backwards compatibility for API key users

Users who prefer API keys can override in their project-level `.claude/settings.json`:

```json
{
  "mcpServers": {
    "quackback": {
      "headers": {
        "Authorization": "Bearer qb_their_key_here"
      }
    }
  }
}
```

### 5.3 Update SKILL.md

**File**: `plugins/quackback/skills/quackback/SKILL.md`

Add authentication section:

```markdown
## Authentication

The Quackback MCP server supports two authentication methods:

1. **OAuth (recommended)** — On first use, a browser window opens for you to log in
   to your Quackback instance. No manual setup required. You'll be asked to authorize
   the requested permissions.

2. **API Key** — Set `QUACKBACK_API_KEY` environment variable with a `qb_` prefixed
   key from Settings > Developers > API Keys. Useful for CI/automation.

### Portal Users

If the administrator has enabled portal MCP access, portal users can authenticate via
OAuth to interact with Quackback programmatically — with the same permissions they
have in the portal UI.
```

---

## Phase 6: Testing

### 6.1 Unit tests for dual auth resolver

**File**: `apps/web/src/lib/server/mcp/__tests__/handler.test.ts`

Test cases:

- OAuth JWT → resolves to McpAuthContext with `authMethod: 'oauth'`
- API key (`qb_*`) → resolves to McpAuthContext with `authMethod: 'api-key'`
- No auth header → returns 401 with `WWW-Authenticate` header containing resource_metadata URL
- Expired JWT → returns 401
- Valid JWT, role=admin → full access
- Valid JWT, role=member → full access
- Valid JWT, role=user, portal access enabled → McpAuthContext with role='user'
- Valid JWT, role=user, portal access disabled → 403
- Invalid JWT signature → returns 401
- API key with wrong prefix → returns 401

### 6.2 Integration test: OAuth discovery flow

Test the full discovery chain with curl:

1. `POST /api/mcp` with no auth → 401 + `WWW-Authenticate`
2. `GET /.well-known/oauth-protected-resource` → valid metadata with `authorization_servers`
3. `GET /api/auth/.well-known/oauth-authorization-server` → RFC 8414 metadata
4. `GET /.well-known/oauth-authorization-server` → proxy works (same response)
5. `POST /api/auth/oauth2/register` → returns `client_id`

### 6.3 E2E test: Full OAuth flow

Playwright:

1. Navigate to authorization URL with PKCE params
2. Login page appears → enter OTP
3. Consent page appears → approve scopes
4. Redirect to callback with authorization code
5. Exchange code for token
6. Use token to call MCP endpoint successfully

---

## Phase 7: Documentation

### 7.1 Update docs

In `/home/james/quackback-docs/`:

- **MCP Setup Guide**: OAuth as primary method, API key as alternative
- **Plugin Installation**: Just install + set `QUACKBACK_MCP_URL`
- **Admin Settings**: Document the "Portal MCP Access" toggle
- **Portal Users**: Document that portal users can use MCP with their natural permissions

### 7.2 No new env vars needed

OAuth uses existing `SECRET_KEY` and `BASE_URL`. No changes to `.env.example`.

---

## Files Changed Summary

| File                                                            | Change                                               |
| --------------------------------------------------------------- | ---------------------------------------------------- |
| `apps/web/package.json`                                         | Add `@better-auth/oauth-provider`                    |
| `apps/web/src/lib/server/auth/index.ts`                         | Add `disabledPaths`, `jwt()`, `oauthProvider()`      |
| `apps/web/src/lib/server/mcp/handler.ts`                        | Dual auth + portal user gating                       |
| `apps/web/src/lib/server/mcp/types.ts`                          | Add `role: 'user'`, `authMethod`                     |
| `apps/web/src/lib/server/mcp/tools.ts`                          | No changes needed (role enforced by domain services) |
| `apps/web/src/lib/server/mcp/server.ts`                         | No changes needed                                    |
| `apps/web/src/lib/server/domains/settings/settings.service.ts`  | Add `mcpPortalAccessEnabled`                         |
| `apps/web/src/routes/__root.tsx`                                | Add `/oauth/`, `/.well-known/` to exempt paths       |
| `apps/web/src/routes/.well-known/oauth-protected-resource.ts`   | **NEW**                                              |
| `apps/web/src/routes/.well-known/oauth-authorization-server.ts` | **NEW**                                              |
| `apps/web/src/routes/oauth/consent.tsx`                         | **NEW**                                              |
| `apps/web/src/routes/oauth.tsx`                                 | **NEW**                                              |
| `plugins/quackback/.mcp.json`                                   | Remove hardcoded API key header                      |
| `plugins/quackback/skills/quackback/SKILL.md`                   | Document OAuth + portal access                       |
| `packages/db/drizzle/`                                          | Auto-generated migration for 4 OAuth tables          |
| Admin settings UI                                               | Add "Portal MCP Access" toggle                       |

**New files**: 4
**Modified files**: ~10
**Database tables added**: 4 (auto-generated by Better Auth)

---

## Risk Assessment

| Risk                                         | Impact | Mitigation                                                             |
| -------------------------------------------- | ------ | ---------------------------------------------------------------------- |
| Better Auth OAuth Provider is relatively new | Medium | Pin version, test thoroughly                                           |
| Well-known path mismatch with Claude Code    | Medium | Proxy at origin root + `authorization_servers` pointing to `/api/auth` |
| `disabledPaths: ['/token']` breaks something | Low    | Confirmed safe — only affects JWT plugin's `/token`, not sessions/OTP  |
| Portal user access via MCP                   | Low    | Same permissions as portal UI, enforced by existing domain services    |
| Breaking existing API key users              | High   | API key path completely separate, tested independently                 |
| Database migration on production             | Medium | Review generated SQL, test on staging                                  |

---

## Implementation Order

1. **Phase 1** — Plugin setup + migrations
2. **Phase 2** — Discovery endpoints (test with curl immediately)
3. **Phase 3** — Dual auth handler + portal scoping (the core work)
4. **Phase 4** — Consent page UI
5. **Phase 5** — Plugin config update
6. **Phase 6** — Tests (parallel with 2-4)
7. **Phase 7** — Docs (after e2e works)

Estimated effort: **2-3 days** for a working implementation, plus testing and polish.
