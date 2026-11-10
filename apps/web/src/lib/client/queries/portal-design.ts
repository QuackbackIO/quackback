import { queryOptions } from '@tanstack/react-query'
import {
  getPortalDesignFn,
  getPortalDesignDraftWaitingFn,
  getPortalDesignSwitchFn,
  listPortalDesignVersionsFn,
} from '@/lib/server/functions/portal-design'
import { getPortalDesignAiStatusFn } from '@/lib/server/functions/portal-design-ai'
import { listPortalDesignPreviewLinksFn } from '@/lib/server/functions/portal-design-preview'
import { listPortalDesignSavedFn } from '@/lib/server/functions/portal-design-saved'

export const portalDesignQueries = {
  /** The design being edited, what visitors see now, and the contrast report. */
  editor: () =>
    queryOptions({
      queryKey: ['settings', 'portal-design'],
      queryFn: () => getPortalDesignFn(),
    }),
  /** Whether Quackback AI is set up for this workspace. */
  aiStatus: () =>
    queryOptions({
      queryKey: ['settings', 'portal-design', 'ai'],
      queryFn: () => getPortalDesignAiStatusFn(),
      staleTime: 5 * 60_000,
    }),
  /** Whether a portal with its own CSS can switch to the design, or back, and its CSS report. */
  switch: () =>
    queryOptions({
      queryKey: ['settings', 'portal-design', 'switch'],
      queryFn: () => getPortalDesignSwitchFn(),
    }),
  /** Whether a draft is waiting to be published. */
  draftWaiting: () =>
    queryOptions({
      queryKey: ['settings', 'portal-design', 'draft-waiting'],
      queryFn: () => getPortalDesignDraftWaitingFn(),
      staleTime: 60_000,
    }),
  /** Published versions, newest first. */
  versions: () =>
    queryOptions({
      queryKey: ['settings', 'portal-design', 'versions'],
      queryFn: () => listPortalDesignVersionsFn(),
    }),
  /** The live preview links, newest first. */
  previewLinks: () =>
    queryOptions({
      queryKey: ['settings', 'portal-design', 'preview-links'],
      queryFn: () => listPortalDesignPreviewLinksFn(),
    }),
  /** The checkpoints and looks the workspace keeps, newest first. */
  saved: () =>
    queryOptions({
      queryKey: ['settings', 'portal-design', 'saved'],
      queryFn: () => listPortalDesignSavedFn(),
    }),
}
