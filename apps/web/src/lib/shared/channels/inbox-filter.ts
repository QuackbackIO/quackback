import './index'
import { z } from 'zod'
import type { Channel } from '@/lib/shared/conversation/types'
import { isChannel } from './registry'

/**
 * Inbox list `channel` filter. Options and accepted values come from the
 * descriptor registry (wire values stay `messenger` / `email` until another
 * descriptor is registered).
 */
export const inboxChannelFilterSchema = z
  .string()
  .refine((value): value is Channel => isChannel(value))
