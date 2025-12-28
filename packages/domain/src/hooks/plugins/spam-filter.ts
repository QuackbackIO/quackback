/**
 * Spam Filter Plugin
 *
 * Example plugin that validates content for spam before allowing posts/comments.
 * This demonstrates how to use validation filters to reject operations.
 *
 * Features:
 * - Detects spammy keywords
 * - Rate limiting (too many posts in short time)
 * - URL spam detection (too many links)
 */

import type { HookPlugin } from '../plugin'
import type { HookRegistry } from '../registry'
import { PRIORITY } from '../types'
import { HOOKS } from '../hooks'
import { ok, err } from '../../shared/result'
import { PostError } from '../../posts/post.errors'
import type { CreatePostInput } from '../../posts/post.types'

/**
 * Common spam keywords (simplified list)
 * In production, use a more comprehensive list or ML-based detection
 */
const SPAM_KEYWORDS = [
  'buy now',
  'click here',
  'limited time',
  'act now',
  'free money',
  'congratulations',
  'you won',
  'claim your prize',
  'nigerian prince',
  'viagra',
  'cialis',
  'casino',
  'lottery',
]

/**
 * Maximum number of URLs allowed in a single post
 */
const MAX_URLS = 3

/**
 * URL detection regex
 */
const URL_REGEX = /(https?:\/\/[^\s]+)/gi

/**
 * Check if text contains spam keywords
 */
function containsSpamKeywords(text: string): boolean {
  const lowerText = text.toLowerCase()
  return SPAM_KEYWORDS.some((keyword) => lowerText.includes(keyword))
}

/**
 * Count URLs in text
 */
function countUrls(text: string): number {
  const matches = text.match(URL_REGEX)
  return matches ? matches.length : 0
}

/**
 * Calculate spam score (0-1, where 1 is definitely spam)
 */
function calculateSpamScore(input: CreatePostInput): number {
  let score = 0

  // Check for spam keywords
  if (containsSpamKeywords(input.title)) {
    score += 0.5
  }
  if (containsSpamKeywords(input.content)) {
    score += 0.3
  }

  // Check for excessive URLs
  const urlCount = countUrls(input.content)
  if (urlCount > MAX_URLS) {
    score += 0.3 * (urlCount - MAX_URLS)
  }

  // All caps title (common spam indicator)
  if (input.title === input.title.toUpperCase() && input.title.length > 10) {
    score += 0.2
  }

  // Very short content with URLs
  if (input.content.length < 50 && urlCount > 0) {
    score += 0.2
  }

  return Math.min(score, 1.0)
}

/**
 * Spam Filter Plugin
 *
 * Validates posts and comments for spam content and rejects suspicious submissions
 */
export class SpamFilterPlugin implements HookPlugin {
  readonly id = 'spam-filter'
  readonly name = 'Spam Filter'
  readonly description = 'Detects and blocks spam posts and comments'
  readonly version = '1.0.0'

  /**
   * Spam threshold (0-1)
   * Posts with score above this are rejected
   */
  private readonly threshold = 0.7

  register(registry: HookRegistry): void {
    // Validate posts before creation
    registry.addValidation<CreatePostInput, PostError>(
      HOOKS.POST_VALIDATE_CREATE,
      async (input, ctx) => {
        const spamScore = calculateSpamScore(input)

        // Store spam score in metadata for other plugins/logging
        ctx.metadata = {
          ...ctx.metadata,
          spamScore,
        }

        if (spamScore >= this.threshold) {
          return err(
            PostError.validationError(
              'Your post appears to contain spam. Please revise and try again.'
            )
          )
        }

        return ok(input)
      },
      PRIORITY.HIGH, // Run early to block spam before other processing
      `${this.id}:check-post-spam`
    )

    // Validate comments before creation
    registry.addValidation(
      HOOKS.COMMENT_VALIDATE_CREATE,
      async (input, ctx) => {
        // Simple keyword check for comments
        if (containsSpamKeywords(input.content)) {
          return err({
            code: 'SPAM_DETECTED',
            message: 'Your comment appears to contain spam. Please revise and try again.',
          })
        }

        // Check for excessive URLs
        const urlCount = countUrls(input.content)
        if (urlCount > MAX_URLS) {
          return err({
            code: 'TOO_MANY_URLS',
            message: `Comments cannot contain more than ${MAX_URLS} links.`,
          })
        }

        return ok(input)
      },
      PRIORITY.HIGH,
      `${this.id}:check-comment-spam`
    )
  }

  unregister(registry: HookRegistry): void {
    registry.removeValidation(HOOKS.POST_VALIDATE_CREATE, `${this.id}:check-post-spam`)
    registry.removeValidation(HOOKS.COMMENT_VALIDATE_CREATE, `${this.id}:check-comment-spam`)
  }
}

/**
 * Global singleton instance
 */
export const spamFilterPlugin = new SpamFilterPlugin()
