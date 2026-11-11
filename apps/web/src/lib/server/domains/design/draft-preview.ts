/**
 * The portal drawn with the saved draft, for the publish review's After
 * frame. The frame draws the draft from its first paint rather than the
 * published design until its code has loaded and the draft is posted in.
 * The caller checks that the viewer may edit the portal's branding.
 */
import { DRAFT_DRAWN_ATTRIBUTE } from '@/lib/shared/design/canvas-src'
import type { PortalDesignView } from '@/lib/shared/design/view'
import { getDesignState } from './design.service'
import { portalDesignView } from './engine'

/** The saved draft's view, marked as the draft; null with no draft. */
export async function draftPreviewView(): Promise<PortalDesignView | null> {
  const state = await getDesignState()
  if (!state?.draft) return null
  const view = portalDesignView({ engine: 'v2', doc: state.draft, revision: null })
  if (view.engine !== 'v2') return null
  return { ...view, attributes: { ...view.attributes, [DRAFT_DRAWN_ATTRIBUTE]: '' } }
}
