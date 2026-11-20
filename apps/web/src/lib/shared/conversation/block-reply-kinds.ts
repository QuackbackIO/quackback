import type { BlockReplyMetadata } from '@/lib/shared/db-types'

/** The kind of conversation block a visitor reply can answer. */
export type BlockReplyKind = BlockReplyMetadata['kind']

/** Every block reply kind, for schemas. The check below fails to compile when
 *  the union gains a kind this list lacks. */
export const BLOCK_REPLY_KINDS = [
  'buttons',
  'collect',
  'collectReply',
  'csat',
] as const satisfies readonly BlockReplyKind[]

type MissingKind = Exclude<BlockReplyKind, (typeof BLOCK_REPLY_KINDS)[number]>
const kindsAreComplete: [MissingKind] extends [never] ? true : never = true
void kindsAreComplete
