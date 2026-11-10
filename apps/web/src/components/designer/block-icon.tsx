import {
  BookOpenIcon,
  ChatBubbleLeftRightIcon,
  HandRaisedIcon,
  LightBulbIcon,
  LinkIcon,
  MagnifyingGlassIcon,
  MapIcon,
  MegaphoneIcon,
  PencilSquareIcon,
  SignalIcon,
  Squares2X2Icon,
} from '@heroicons/react/16/solid'
import type { HomeBlockType } from '@/lib/shared/design/home'
import { cn } from '@/lib/shared/utils'

const ICONS: Record<HomeBlockType, typeof LinkIcon> = {
  welcome: HandRaisedIcon,
  composer: PencilSquareIcon,
  ideas: LightBulbIcon,
  roadmap: MapIcon,
  updates: MegaphoneIcon,
  help_search: MagnifyingGlassIcon,
  help_topics: BookOpenIcon,
  status: SignalIcon,
  contact: ChatBubbleLeftRightIcon,
  links: LinkIcon,
  boards: Squares2X2Icon,
}

/** A Home block's type as a small icon, beside its name. */
export function BlockIcon({ type, className }: { type: HomeBlockType; className?: string }) {
  const Icon = ICONS[type]
  return (
    <Icon
      data-block-icon={type}
      aria-hidden="true"
      className={cn('size-3.5 shrink-0 text-muted-foreground', className)}
    />
  )
}
