import {
  BookOpenIcon,
  ChatBubbleLeftIcon,
  ChatBubbleLeftRightIcon,
  MegaphoneIcon,
} from '@heroicons/react/24/solid'
import type { AdminEntity } from '@/lib/shared/admin-overview'
import { cn } from '@/lib/shared/utils'

/** Same icons as the admin rail, so a row and its product share one mark. */
export const ENTITY_ICONS = {
  conversation: ChatBubbleLeftRightIcon,
  post: ChatBubbleLeftIcon,
  changelog: MegaphoneIcon,
  article: BookOpenIcon,
} as const

export function EntityIcon({ entity, className }: { entity: AdminEntity; className?: string }) {
  const Icon = ENTITY_ICONS[entity]
  return (
    <Icon
      data-entity={entity}
      className={cn('size-4 shrink-0 text-muted-foreground', className)}
      aria-hidden
    />
  )
}
