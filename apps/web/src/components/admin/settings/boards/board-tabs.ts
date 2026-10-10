import { z } from 'zod'

const BOARD_TABS = ['general', 'access', 'moderation', 'data'] as const
export type BoardTab = (typeof BOARD_TABS)[number]

/**
 * The `?tab=` search value of a board page. Import and export share the Data
 * tab, so links that still name either one land there.
 */
export const boardTabSearch = z
  .enum([...BOARD_TABS, 'import', 'export'])
  .transform((tab): BoardTab => (tab === 'import' || tab === 'export' ? 'data' : tab))
  .optional()
