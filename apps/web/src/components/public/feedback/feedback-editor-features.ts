import type { EditorFeatures } from '@/components/ui/rich-text-editor'

/**
 * Formatting available to people submitting feedback from the public portal.
 * Keep this preset explicit so the public composer does not silently lose
 * controls that remain available in the admin post editor.
 */
export const PUBLIC_FEEDBACK_EDITOR_FEATURES: EditorFeatures = {
  headings: true,
  quackbackEmbeds: true,
}
