import { designerFrameOf } from '@/lib/shared/design/designer-frame'

/**
 * What this document is as a designer frame, read as the app first loads,
 * before the router rewrites the address: its first address is the one that
 * says. Null for any other page, and on the server.
 */
const frame = typeof window === 'undefined' ? null : designerFrameOf(window)

/** This document as a designer frame, or null for any other page and on the server. */
export function thisDesignerFrame(): ReturnType<typeof designerFrameOf> {
  return frame
}
