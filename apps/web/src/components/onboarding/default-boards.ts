import {
  LightBulbIcon,
  BugAntIcon,
  ChatBubbleOvalLeftEllipsisIcon,
  PuzzlePieceIcon,
} from '@heroicons/react/24/solid'
import type { ComponentType } from 'react'

export interface DefaultBoardOption {
  id: string
  name: string
  description: string
  icon: ComponentType<{ className?: string }>
  isRecommended?: boolean
}

/**
 * Default board templates for onboarding.
 * Users can toggle these on/off during setup.
 */
export const DEFAULT_BOARD_OPTIONS: DefaultBoardOption[] = [
  {
    id: 'feature-requests',
    name: 'Feature Requests',
    description: 'Collect ideas and suggestions for new features',
    icon: LightBulbIcon,
    isRecommended: true,
  },
  {
    id: 'bug-reports',
    name: 'Bug Reports',
    description: 'Track issues and problems reported by users',
    icon: BugAntIcon,
    isRecommended: true,
  },
  {
    id: 'general-feedback',
    name: 'General Feedback',
    description: 'Open feedback for any topic or suggestion',
    icon: ChatBubbleOvalLeftEllipsisIcon,
  },
  {
    id: 'integrations',
    name: 'Integrations',
    description: 'Requests for integrations with other tools',
    icon: PuzzlePieceIcon,
  },
]
