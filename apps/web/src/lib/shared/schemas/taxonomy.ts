/**
 * Shared taxonomy primitives (client-safe).
 *
 * Post tags, conversation labels, changelog categories, and post statuses all
 * validate the same two things: a short display name and a `#rrggbb` color.
 * The per-domain *messages* intentionally stay at the call site — services
 * and routes phrase them per entity ("PostTag name …" vs "Category name …")
 * and those strings are observable API behaviour. Only the identical rules
 * live here.
 */
import { z } from 'zod'

/** The `#rrggbb` pattern every taxonomy color rule enforces. */
export const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/

/**
 * Hex color with the message used by the tag/category/label entry points
 * (server functions and REST routes). Post-status and ticket entry points
 * use `HexColorFormatSchema` instead (`Invalid color format`).
 */
export const HexColorSchema = z.string().regex(HEX_COLOR_PATTERN, 'Color must be a valid hex color')

/**
 * Same `#rrggbb` rule with the message used by post-status and ticket entry
 * points. Kept separate from `HexColorSchema` so neither failure string changes.
 */
export const HexColorFormatSchema = z.string().regex(HEX_COLOR_PATTERN, 'Invalid color format')

/** Fallback swatch when a create payload omits color. */
export const TAXONOMY_DEFAULT_COLOR = '#6b7280'

/**
 * Optional `#rrggbb` with zod's default regex message (no custom string).
 * Used by conversation-tag and update paths that historically had no message.
 */
export const OptionalHexColorPatternSchema = z.string().regex(HEX_COLOR_PATTERN).optional()

/** Same optional pattern, defaulting to `TAXONOMY_DEFAULT_COLOR`. */
export const OptionalHexColorPatternWithDefaultSchema =
  OptionalHexColorPatternSchema.default(TAXONOMY_DEFAULT_COLOR)

/** `HexColorSchema` (custom message) with the default swatch. */
export const HexColorWithDefaultSchema = HexColorSchema.optional().default(TAXONOMY_DEFAULT_COLOR)

/** `{ id }` used by taxonomy get/delete server functions. */
export const EntityIdSchema = z.object({ id: z.string() })

/** Reorder payload that rejects an empty list at the zod layer. */
export const ReorderIdsSchema = z.object({ ids: z.array(z.string()).min(1) })

/** Reorder payload that allows empty `ids` (the service throws instead). */
export const ReorderIdsOpenSchema = z.object({ ids: z.array(z.string()) })

/** Plain 1–50-char display name shared by the taxonomy create/update shapes. */
export const TaxonomyNameSchema = z.string().min(1).max(50)

/** Optional `limit` query param (`1–100`, `0` rejected) for cursor pages. */
export const PageLimitSchema = z.number().int().positive().max(100).optional()

/**
 * Same bound expressed as `min(1)` for the call sites that historically
 * spelled it that way. Semantically equal to `PageLimitSchema` for integers;
 * kept separate so neither spelling's failure message changes.
 */
export const PageLimitMinOneSchema = z.number().int().min(1).max(100).optional()
