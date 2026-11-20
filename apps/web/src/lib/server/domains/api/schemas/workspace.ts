/**
 * Workspace helper endpoints: @-mention lookups (signed-in session) and the
 * usage report (operator token).
 *
 * The mention endpoints answer with a bare JSON body rather than the `data`
 * envelope the key-authenticated endpoints use.
 */
import 'zod-openapi'
import { z } from 'zod'
import { registerPath, TypeIdSchema } from '../openapi'
import { TimestampSchema } from './common'

// Either cookie name, depending on whether the deployment serves HTTPS.
const sessionSecurity: Array<Record<string, string[]>> = [
  { sessionCookie: [] },
  { sessionCookieHttp: [] },
]

const MentionSuggestionSchema = z.object({
  principalId: TypeIdSchema,
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  role: z.enum(['admin', 'member', 'user']),
})

const PrincipalCardSchema = z.object({
  principalId: TypeIdSchema,
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  role: z.string(),
  joinedAt: TimestampSchema,
})

const UsageSchema = z.object({
  aiTokensThisMonth: z.number().int(),
  postCount: z.number().int().meta({ description: 'Posts that are not deleted' }),
  boardCount: z.number().int().meta({ description: 'Boards that are not deleted' }),
  teamSeatCount: z.number().int(),
  pendingInviteCount: z.number().int(),
})

const sessionForbidden = {
  description: 'No signed-in session, or the session belongs to an anonymous or service principal',
  content: {
    'application/json': { schema: z.object({ error: z.literal('Forbidden') }) },
  },
}

registerPath('/mentions/suggest', {
  get: {
    tags: ['Workspace'],
    summary: 'Suggest people to @-mention',
    description:
      'Typeahead for mentions, matching the start of the display name. An empty query returns the first page of people. Returns at most 10 results and never exposes email addresses. Authenticated by the signed-in session cookie, not an API key. Limited to 60 requests per minute per session.',
    security: sessionSecurity,
    parameters: [
      {
        name: 'q',
        in: 'query',
        required: false,
        schema: { type: 'string' },
        description: 'Start of the display name',
      },
      {
        name: 'scope',
        in: 'query',
        required: false,
        schema: { type: 'string', enum: ['team'] },
        description: 'Set to team to return teammates only',
      },
    ],
    responses: {
      200: {
        description: 'Matching people',
        content: { 'application/json': { schema: z.array(MentionSuggestionSchema) } },
      },
      403: sessionForbidden,
      429: {
        description: 'More than 60 requests in a minute',
        content: {
          'application/json': { schema: z.object({ error: z.literal('Too Many Requests') }) },
        },
      },
    },
  },
})

registerPath('/users/{principalId}/card', {
  get: {
    tags: ['Workspace'],
    summary: 'Get a mention hover card',
    description:
      'Small profile payload for an @-mention chip: name, avatar, role and join date, with no email. Authenticated by the signed-in session cookie, not an API key.',
    security: sessionSecurity,
    parameters: [
      {
        name: 'principalId',
        in: 'path',
        required: true,
        schema: { type: 'string' },
        description: 'Principal ID',
      },
    ],
    responses: {
      200: {
        description: 'Profile card',
        content: { 'application/json': { schema: PrincipalCardSchema } },
      },
      403: sessionForbidden,
      404: {
        description: 'Principal not found',
        content: {
          'application/json': { schema: z.object({ error: z.literal('Not Found') }) },
        },
      },
    },
  },
})

registerPath('/admin/usage', {
  get: {
    tags: ['Workspace'],
    summary: 'Get workspace usage counters',
    description:
      'Usage counters for external billing meters. Authenticated with the operator token set in the ADMIN_API_TOKEN environment variable, sent as a bearer token; API keys are not accepted. Responds 404 when that variable is not set.',
    security: [{ adminToken: [] }],
    responses: {
      200: {
        description: 'Usage counters',
        content: { 'application/json': { schema: UsageSchema } },
      },
      401: {
        description: 'Missing or wrong operator token',
        content: {
          'application/json': { schema: z.object({ error: z.literal('unauthenticated') }) },
        },
      },
      404: { description: 'Operator token is not configured' },
    },
  },
})

const SetupRequestSchema = z.object({
  workspaceName: z.string().min(2).max(100).meta({ description: 'Name of the workspace' }),
  adminEmail: z.string().email().meta({ description: 'Email address of the first admin' }),
  adminName: z.string().min(2).max(100).meta({ description: 'Display name of the first admin' }),
})

const SetupResponseSchema = z.object({
  data: z.object({
    workspace: z.object({ id: TypeIdSchema, name: z.string(), slug: z.string() }),
    admin: z.object({
      userId: TypeIdSchema,
      principalId: TypeIdSchema,
      email: z.string(),
      name: z.string(),
    }),
    apiKey: z.object({
      id: TypeIdSchema,
      name: z.string(),
      key: z.string().meta({
        description:
          'A workspace API key with the Owner role and every scope. Shown only in this response; store it now.',
      }),
    }),
    reusedExistingAccount: z.boolean().meta({
      description:
        'True when adminEmail already had a verified account, which was promoted and signed out everywhere.',
    }),
  }),
})

const setupError = (description: string, code: string) => ({
  description,
  content: {
    'application/json': {
      schema: z.object({
        error: z.object({ code: z.literal(code), message: z.string() }),
      }),
    },
  },
})

registerPath('/setup', {
  post: {
    tags: ['Workspace'],
    summary: 'Set up a new workspace without the browser',
    description:
      "Creates the workspace and its first admin, and returns the workspace's first API key, once: a workspace key with the Owner role and every scope, so replies sent with it count as automated, never as the admin's own. The key outlives the first admin, so rotate or revoke it under Settings → Developers → Keys once setup is done. Authenticated with the setup token, sent as a bearer token: the SETUP_TOKEN environment variable, or the token the server writes to its log once on first boot. It exists only while the workspace has no admin; at any other time, and on hosted workspaces, it answers 404 without a trace. An existing account with that email is reused only if its address is verified (409 otherwise). API keys are not accepted. Limited to 10 requests per minute per address.",
    security: [{ setupToken: [] }],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: SetupRequestSchema } },
    },
    responses: {
      201: {
        description: 'Workspace and first admin created',
        content: { 'application/json': { schema: SetupResponseSchema } },
      },
      400: setupError('Invalid request body', 'VALIDATION_ERROR'),
      401: setupError('Missing or wrong setup token', 'UNAUTHORIZED'),
      404: setupError(
        'No setup token exists, or the workspace is not awaiting its first admin',
        'NOT_FOUND'
      ),
      409: setupError(
        'Another request set the workspace up first, or an unverified account already uses adminEmail',
        'SETUP_ALREADY_COMPLETE'
      ),
      429: setupError('Too many requests', 'RATE_LIMITED'),
    },
  },
})
