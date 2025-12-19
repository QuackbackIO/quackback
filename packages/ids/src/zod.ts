/**
 * Zod schemas for TypeID validation
 *
 * Provides both strict schemas (TypeID only) and flexible schemas
 * (accepts TypeID or UUID for backward compatibility during migration).
 */

import { z } from 'zod'
import { TypeID } from 'typeid-js'
import { ID_PREFIXES, type IdPrefix } from './prefixes'
import type { TypeId } from './types'

/**
 * UUID format regex
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ============================================
// Strict TypeID Schemas
// ============================================

/**
 * Create a strict Zod schema that only accepts TypeID format
 *
 * @param prefix - The expected prefix for the TypeID
 * @returns A Zod schema that validates TypeID strings with the given prefix
 *
 * @example
 * const schema = typeIdSchema('post')
 * schema.parse('post_01h455vb4pex5vsknk084sn02q') // OK
 * schema.parse('board_01h455vb4pex5vsknk084sn02q') // Error: wrong prefix
 * schema.parse('550e8400-e29b-41d4-a716-446655440000') // Error: not TypeID format
 */
export function typeIdSchema<P extends IdPrefix>(prefix: P) {
  // Validate TypeID format and return as branded TypeId<P> type
  // The transform ensures proper type inference in z.infer<>
  return z.custom<TypeId<P>>(
    (val): val is TypeId<P> => {
      if (typeof val !== 'string') return false
      try {
        const tid = TypeID.fromString(val)
        return tid.getType() === prefix
      } catch {
        return false
      }
    },
    { message: `Invalid ${prefix} ID format. Expected: ${prefix}_<base32>` }
  )
}

// ============================================
// Flexible ID Schemas (for migration period)
// ============================================

/**
 * Create a flexible Zod schema that accepts TypeID or UUID
 * Normalizes the output to UUID for database storage
 *
 * @param prefix - The expected prefix for TypeID inputs
 * @returns A Zod schema that accepts TypeID or UUID, outputs UUID
 *
 * @example
 * const schema = flexibleIdSchema('post')
 * schema.parse('post_01h455vb4pex5vsknk084sn02q') // => UUID string
 * schema.parse('550e8400-e29b-41d4-a716-446655440000') // => same UUID string
 */
export function flexibleIdSchema<P extends IdPrefix>(prefix: P) {
  return z.string().transform((val, ctx) => {
    // Raw UUID - pass through as-is
    if (UUID_REGEX.test(val)) {
      return val
    }

    // Try to parse as TypeID
    try {
      const tid = TypeID.fromString(val)

      // Validate prefix matches
      if (tid.getType() !== prefix) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Expected ${prefix} ID, got ${tid.getType()} ID`,
        })
        return z.NEVER
      }

      // Return the underlying UUID
      return tid.toUUID()
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Invalid ID format. Expected ${prefix}_<base32> or UUID`,
      })
      return z.NEVER
    }
  })
}

/**
 * Create a flexible Zod schema that accepts TypeID or UUID
 * Normalizes the output to TypeID for API responses
 *
 * @param prefix - The prefix to use for the output TypeID
 * @returns A Zod schema that accepts TypeID or UUID, outputs TypeID
 *
 * @example
 * const schema = flexibleToTypeIdSchema('post')
 * schema.parse('550e8400-e29b-41d4-a716-446655440000') // => 'post_xxx'
 * schema.parse('post_01h455vb4pex5vsknk084sn02q') // => same TypeID
 */
export function flexibleToTypeIdSchema<P extends IdPrefix>(prefix: P) {
  return z.string().transform((val, ctx): TypeId<P> => {
    // If it's already a TypeID, validate and return
    if (val.includes('_')) {
      try {
        const tid = TypeID.fromString(val)
        if (tid.getType() !== prefix) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Expected ${prefix} ID, got ${tid.getType()} ID`,
          })
          return z.NEVER
        }
        return val as TypeId<P>
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Invalid TypeID format`,
        })
        return z.NEVER
      }
    }

    // Raw UUID - convert to TypeID
    if (UUID_REGEX.test(val)) {
      return TypeID.fromUUID(prefix, val).toString() as TypeId<P>
    }

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Invalid ID format. Expected ${prefix}_<base32> or UUID`,
    })
    return z.NEVER
  })
}

/**
 * Schema for validating any TypeID (any prefix)
 */
export const anyTypeIdSchema = z.string().refine(
  (val) => {
    try {
      TypeID.fromString(val)
      return true
    } catch {
      return false
    }
  },
  { message: 'Invalid TypeID format' }
)

/**
 * Schema that accepts UUID format only
 */
export const uuidSchema = z.string().regex(UUID_REGEX, 'Invalid UUID format')

// ============================================
// Pre-built Schemas for Common Entities
// ============================================

// Strict TypeID schemas (only accept TypeID format)
export const postIdSchema = typeIdSchema(ID_PREFIXES.post)
export const boardIdSchema = typeIdSchema(ID_PREFIXES.board)
export const commentIdSchema = typeIdSchema(ID_PREFIXES.comment)
export const voteIdSchema = typeIdSchema(ID_PREFIXES.vote)
export const tagIdSchema = typeIdSchema(ID_PREFIXES.tag)
export const statusIdSchema = typeIdSchema(ID_PREFIXES.status)
export const reactionIdSchema = typeIdSchema(ID_PREFIXES.reaction)
export const roadmapIdSchema = typeIdSchema(ID_PREFIXES.roadmap)
export const changelogIdSchema = typeIdSchema(ID_PREFIXES.changelog)
export const integrationIdSchema = typeIdSchema(ID_PREFIXES.integration)
export const workspaceIdSchema = typeIdSchema(ID_PREFIXES.workspace)
export const userIdSchema = typeIdSchema(ID_PREFIXES.user)
export const memberIdSchema = typeIdSchema(ID_PREFIXES.member)
export const sessionIdSchema = typeIdSchema(ID_PREFIXES.session)
export const inviteIdSchema = typeIdSchema(ID_PREFIXES.invite)
export const subscriptionIdSchema = typeIdSchema(ID_PREFIXES.subscription)
export const domainIdSchema = typeIdSchema(ID_PREFIXES.domain)

// Flexible schemas (accept TypeID or UUID, normalize to UUID)
export const flexiblePostIdSchema = flexibleIdSchema(ID_PREFIXES.post)
export const flexibleBoardIdSchema = flexibleIdSchema(ID_PREFIXES.board)
export const flexibleCommentIdSchema = flexibleIdSchema(ID_PREFIXES.comment)
export const flexibleVoteIdSchema = flexibleIdSchema(ID_PREFIXES.vote)
export const flexibleTagIdSchema = flexibleIdSchema(ID_PREFIXES.tag)
export const flexibleStatusIdSchema = flexibleIdSchema(ID_PREFIXES.status)
export const flexibleReactionIdSchema = flexibleIdSchema(ID_PREFIXES.reaction)
export const flexibleRoadmapIdSchema = flexibleIdSchema(ID_PREFIXES.roadmap)
export const flexibleChangelogIdSchema = flexibleIdSchema(ID_PREFIXES.changelog)
export const flexibleIntegrationIdSchema = flexibleIdSchema(ID_PREFIXES.integration)
export const flexibleWorkspaceIdSchema = flexibleIdSchema(ID_PREFIXES.workspace)
export const flexibleUserIdSchema = flexibleIdSchema(ID_PREFIXES.user)
export const flexibleMemberIdSchema = flexibleIdSchema(ID_PREFIXES.member)
export const flexibleSessionIdSchema = flexibleIdSchema(ID_PREFIXES.session)
export const flexibleInviteIdSchema = flexibleIdSchema(ID_PREFIXES.invite)
export const flexibleSubscriptionIdSchema = flexibleIdSchema(ID_PREFIXES.subscription)
export const flexibleDomainIdSchema = flexibleIdSchema(ID_PREFIXES.domain)

// ============================================
// Array Schemas
// ============================================

/**
 * Create a schema for an array of TypeIDs
 */
export function typeIdArraySchema<P extends IdPrefix>(prefix: P) {
  return z.array(typeIdSchema(prefix))
}

/**
 * Create a schema for an array of flexible IDs (accepts TypeID or UUID)
 */
export function flexibleIdArraySchema<P extends IdPrefix>(prefix: P) {
  return z.array(flexibleIdSchema(prefix))
}

// Pre-built array schemas (strict TypeID only)
export const tagIdsSchema = typeIdArraySchema(ID_PREFIXES.tag)
export const postIdsSchema = typeIdArraySchema(ID_PREFIXES.post)
