/**
 * Tag domain module
 *
 * Exports all tag-related domain types, errors, and services
 */

export { TagService, tagService } from './tag.service'
export { TagError, type TagErrorCode } from './tag.errors'
export type { CreateTagInput, UpdateTagInput } from './tag.types'
