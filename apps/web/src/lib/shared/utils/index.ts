/**
 * Shared utility functions (client-safe)
 */

export { cn } from './cn'
export {
  getInitials,
  stripHtml,
  truncate,
  formatStatus,
  getStatusEmoji,
  stripMarkdownPreview,
  normalizeStrength,
  strengthTier,
  formatBadgeCount,
  slugify,
} from './string'
export {
  escapeHtmlAttr,
  sanitizeUrl,
  sanitizeImageUrl,
  sanitizeImageUrl as sanitizeImageSrc,
  safePositiveInt,
  extractYoutubeId,
} from './sanitize'
export {
  toIsoString,
  toIsoStringOrNull,
  toIsoDateOnly,
  formatMonthYear,
  tomorrowAt,
  startOfUtcMonth,
  inHours,
  nextMondayAt,
} from './date'
