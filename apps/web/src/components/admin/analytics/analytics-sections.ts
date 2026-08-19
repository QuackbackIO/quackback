import type { ElementType } from 'react'
import {
  ChartBarIcon,
  InboxIcon,
  DocumentTextIcon,
  UsersIcon,
  ChatBubbleLeftRightIcon,
  GlobeAltIcon,
  SparklesIcon,
} from '@heroicons/react/24/solid'

export type Section =
  | 'overview'
  | 'visitors'
  | 'feedback'
  | 'support'
  | 'ai'
  | 'changelog'
  | 'users'

export interface SectionNavItem {
  key: Section
  label: string
  icon: ElementType
}

export const SECTION_NAV_ITEMS: SectionNavItem[] = [
  { key: 'overview', label: 'Overview', icon: ChartBarIcon },
  { key: 'visitors', label: 'Visitors', icon: GlobeAltIcon },
  { key: 'feedback', label: 'Feedback', icon: InboxIcon },
  { key: 'support', label: 'Support', icon: ChatBubbleLeftRightIcon },
  { key: 'ai', label: 'Quinn AI', icon: SparklesIcon },
  { key: 'changelog', label: 'Changelog', icon: DocumentTextIcon },
  { key: 'users', label: 'Users', icon: UsersIcon },
]
