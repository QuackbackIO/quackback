import { queryOptions } from '@tanstack/react-query'
import {
  getPortalDesignFn,
  getPortalDesignSwitchFn,
  listPortalDesignVersionsFn,
} from '@/lib/server/functions/portal-design'
import { getPortalDesignAiStatusFn } from '@/lib/server/functions/portal-design-ai'

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
  /** Published versions, newest first. */
  versions: () =>
    queryOptions({
      queryKey: ['settings', 'portal-design', 'versions'],
      queryFn: () => listPortalDesignVersionsFn(),
    }),
}
