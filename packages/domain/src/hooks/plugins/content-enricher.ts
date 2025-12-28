/**
 * Content Enrichment Plugin
 *
 * Example plugin that enriches content before it's saved to the database.
 * This demonstrates how to use filter hooks to transform data in the pipeline.
 *
 * Features:
 * - Auto-linkify URLs in content
 * - Extract hashtags and suggest tags
 * - Detect @mentions
 */

import type { HookPlugin } from '../plugin'
import type { HookRegistry } from '../registry'
import { PRIORITY } from '../types'
import { HOOKS } from '../hooks'
import type { CreatePostInput } from '../../posts/post.types'

/**
 * Simple URL detection regex
 * In production, use a more robust library like linkify-it
 */
const URL_REGEX = /(https?:\/\/[^\s]+)/g

/**
 * Hashtag detection regex
 */
const HASHTAG_REGEX = /#(\w+)/g

/**
 * Mention detection regex
 */
const MENTION_REGEX = /@(\w+)/g

/**
 * Linkify URLs in text
 * Converts plain URLs to markdown links
 */
function linkifyUrls(text: string): string {
  return text.replace(URL_REGEX, '[$1]($1)')
}

/**
 * Extract hashtags from text
 */
function extractHashtags(text: string): string[] {
  const matches = text.matchAll(HASHTAG_REGEX)
  return Array.from(matches).map((match) => match[1].toLowerCase())
}

/**
 * Extract mentions from text
 */
function extractMentions(text: string): string[] {
  const matches = text.matchAll(MENTION_REGEX)
  return Array.from(matches).map((match) => match[1].toLowerCase())
}

/**
 * Content Enrichment Plugin
 *
 * Enriches post content with automatic linkification and metadata extraction
 */
export class ContentEnricherPlugin implements HookPlugin {
  readonly id = 'content-enricher'
  readonly name = 'Content Enricher'
  readonly description = 'Automatically enhances content with links and metadata'
  readonly version = '1.0.0'

  register(registry: HookRegistry): void {
    // Enrich post content before creation
    registry.addFilter<CreatePostInput>(
      HOOKS.POST_BEFORE_CREATE,
      async (input, ctx) => {
        // Extract metadata from content
        const hashtags = extractHashtags(input.content)
        const mentions = extractMentions(input.content)

        // Store extracted metadata in hook context for other plugins
        ctx.metadata = {
          ...ctx.metadata,
          hashtags,
          mentions,
          hasUrls: URL_REGEX.test(input.content),
        }

        // Note: We don't modify the content here to avoid breaking TipTap JSON
        // In production, you'd want to modify contentJson if using rich text editor

        // For plain text content, you could linkify:
        // const enrichedContent = linkifyUrls(input.content)

        // Return the input (potentially modified)
        return {
          ...input,
          // content: enrichedContent, // Uncomment to enable linkification
        }
      },
      PRIORITY.NORMAL, // Run after validation but before save
      `${this.id}:enrich-post-content`
    )

    // You could add similar filters for comments, etc.
    registry.addFilter(
      HOOKS.COMMENT_BEFORE_CREATE,
      async (input, ctx) => {
        // Extract mentions from comments
        const mentions = extractMentions(input.content)

        ctx.metadata = {
          ...ctx.metadata,
          mentions,
        }

        return input
      },
      PRIORITY.NORMAL,
      `${this.id}:enrich-comment-content`
    )
  }

  unregister(registry: HookRegistry): void {
    registry.removeFilter(HOOKS.POST_BEFORE_CREATE, `${this.id}:enrich-post-content`)
    registry.removeFilter(HOOKS.COMMENT_BEFORE_CREATE, `${this.id}:enrich-comment-content`)
  }
}

/**
 * Global singleton instance
 */
export const contentEnricherPlugin = new ContentEnricherPlugin()
