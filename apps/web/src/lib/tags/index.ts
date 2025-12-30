/**
 * Tag domain module
 *
 * Exports all tag-related domain types, errors, and service functions
 */

export {
  createTag,
  updateTag,
  deleteTag,
  getTagById,
  listTags,
  getTagsByBoard,
  listPublicTags,
} from './tag.service'
export { TagError, type TagErrorCode } from './tag.errors'
export type { CreateTagInput, UpdateTagInput } from './tag.types'
