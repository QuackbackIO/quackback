import { queryOptions } from '@tanstack/react-query'
import { getPortalDesignFn, listPortalDesignVersionsFn } from '@/lib/server/functions/portal-design'

export const portalDesignQueries = {
  /** The design being edited, what visitors see now, and the contrast report. */
  editor: () =>
    queryOptions({
      queryKey: ['settings', 'portal-design'],
      queryFn: () => getPortalDesignFn(),
    }),
  /** Published versions, newest first. */
  versions: () =>
    queryOptions({
      queryKey: ['settings', 'portal-design', 'versions'],
      queryFn: () => listPortalDesignVersionsFn(),
    }),
}
