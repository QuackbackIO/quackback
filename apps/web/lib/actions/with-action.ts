import { z } from 'zod'
import { validateApiTenantAccess } from '@/lib/tenant'
import { checkFeatureAccess } from '@/lib/features/server'
import { buildServiceContext, type ServiceContext } from '@quackback/domain'
import { isValidTypeId, type WorkspaceId } from '@quackback/ids'
import type { ActionResult, ActionContext, ActionOptions, Role } from './types'
import { actionErr } from './types'

// Re-export mapDomainError from types for backwards compatibility
export { mapDomainError } from './types'

/**
 * Check if user role is in the allowed roles array.
 */
function isAllowedRole(userRole: string, allowedRoles: Role[]): boolean {
  return allowedRoles.includes(userRole as Role)
}

/**
 * Type for the action handler function.
 */
type ActionHandler<TInput, TOutput> = (
  input: TInput,
  ctx: ActionContext,
  serviceContext: ServiceContext
) => Promise<ActionResult<TOutput>>

/**
 * Server action wrapper with authentication, authorization, and standardized error handling.
 *
 * This wrapper mirrors the behavior of `withApiHandler` but for server actions.
 * It provides:
 * - Input validation with Zod schemas
 * - Authentication via Better-auth session
 * - Role-based access control
 * - Feature gate checking (for paid features)
 * - ServiceContext building for domain services
 * - Standardized error handling with ActionResult
 *
 * @example
 * export const createTagAction = withAction(
 *   createTagSchema,
 *   async (input, ctx, serviceCtx) => {
 *     const result = await getTagService().createTag(input, serviceCtx)
 *     if (!result.success) return actionErr(mapDomainError(result.error))
 *     return actionOk(result.value)
 *   },
 *   { roles: ['owner', 'admin', 'member'] }
 * )
 */
export function withAction<TSchema extends z.ZodType<{ workspaceId: unknown }>, TOutput>(
  schema: TSchema,
  handler: ActionHandler<z.infer<TSchema>, TOutput>,
  options: ActionOptions = {}
): (input: z.input<TSchema>) => Promise<ActionResult<TOutput>> {
  type TInput = z.infer<TSchema>
  return async (rawInput: z.input<TSchema>): Promise<ActionResult<TOutput>> => {
    try {
      // 1. Validate input schema
      const parseResult = schema.safeParse(rawInput)
      if (!parseResult.success) {
        const fieldErrors: Record<string, string[]> = {}
        for (const issue of parseResult.error.issues) {
          const path = issue.path.join('.')
          if (!fieldErrors[path]) fieldErrors[path] = []
          fieldErrors[path].push(issue.message)
        }
        return actionErr({
          code: 'VALIDATION_ERROR',
          message: parseResult.error.issues[0]?.message || 'Invalid input',
          status: 400,
          fieldErrors,
        })
      }

      const input = parseResult.data as TInput

      // 2. Validate workspaceId format
      if (!isValidTypeId(input.workspaceId as string, 'workspace')) {
        return actionErr({
          code: 'VALIDATION_ERROR',
          message: 'Invalid workspace ID format',
          status: 400,
        })
      }

      // 3. Validate tenant access (auth + member check)
      const validation = await validateApiTenantAccess(input.workspaceId as WorkspaceId)
      if (!validation.success) {
        return actionErr({
          code: validation.status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN',
          message: validation.error,
          status: validation.status,
        })
      }

      // 4. Check role if required
      if (options.roles && options.roles.length > 0) {
        if (!isAllowedRole(validation.member.role, options.roles)) {
          return actionErr({
            code: 'FORBIDDEN',
            message: 'Insufficient permissions',
            status: 403,
          })
        }
      }

      // 5. Check feature access if required
      if (options.feature) {
        const featureCheck = await checkFeatureAccess(validation.workspace.id, options.feature)
        if (!featureCheck.allowed) {
          return actionErr({
            code: 'PAYMENT_REQUIRED',
            message: featureCheck.error || 'Feature not available',
            status: 402,
            requiredTier: featureCheck.requiredTier,
            upgradeUrl: featureCheck.upgradeUrl,
          })
        }
      }

      // 6. Build contexts
      const ctx: ActionContext = {
        workspace: {
          id: validation.workspace.id,
          slug: validation.workspace.slug,
          name: validation.workspace.name,
        },
        user: {
          id: validation.user.id,
          email: validation.user.email,
          // Name is always present - database enforces NOT NULL
          name: validation.user.name!,
        },
        member: {
          id: validation.member.id,
          role: validation.member.role as Role,
        },
      }

      const serviceContext = buildServiceContext(validation)

      // 7. Execute handler
      return await handler(input, ctx, serviceContext)
    } catch (error) {
      console.error('Action error:', error)
      return actionErr({
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        status: 500,
      })
    }
  }
}

/**
 * Lightweight action wrapper for actions that don't require workspaceId.
 * Use this for user-scoped actions like profile updates.
 *
 * @example
 * export const getProfileAction = withAuthAction(
 *   z.object({}),
 *   async (input, session) => {
 *     const user = await getUser(session.user.id)
 *     return actionOk(user)
 *   }
 * )
 */
export function withAuthAction<TInput, TOutput>(
  schema: z.ZodType<TInput>,
  handler: (
    input: TInput,
    session: { user: { id: string; email: string; name: string | null } }
  ) => Promise<ActionResult<TOutput>>
): (input: TInput) => Promise<ActionResult<TOutput>> {
  return async (rawInput: TInput): Promise<ActionResult<TOutput>> => {
    try {
      // 1. Validate input schema
      const parseResult = schema.safeParse(rawInput)
      if (!parseResult.success) {
        const fieldErrors: Record<string, string[]> = {}
        for (const issue of parseResult.error.issues) {
          const path = issue.path.join('.')
          if (!fieldErrors[path]) fieldErrors[path] = []
          fieldErrors[path].push(issue.message)
        }
        return actionErr({
          code: 'VALIDATION_ERROR',
          message: parseResult.error.issues[0]?.message || 'Invalid input',
          status: 400,
          fieldErrors,
        })
      }

      const input = parseResult.data

      // 2. Validate session (no workspace required)
      const { getSession } = await import('@/lib/auth/server')
      const session = await getSession()
      if (!session?.user) {
        return actionErr({
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
          status: 401,
        })
      }

      // 3. Execute handler
      return await handler(input, session)
    } catch (error) {
      console.error('Action error:', error)
      return actionErr({
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        status: 500,
      })
    }
  }
}
