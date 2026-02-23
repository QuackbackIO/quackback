import {
  LightBulbIcon,
  BugAntIcon,
  ChatBubbleOvalLeftEllipsisIcon,
  PuzzlePieceIcon,
  UserGroupIcon,
  BuildingStorefrontIcon,
  WrenchScrewdriverIcon,
  SparklesIcon,
} from '@heroicons/react/24/solid'
import type { ComponentType } from 'react'
import type { UseCaseType } from '@/lib/shared/db-types'

export interface DefaultBoardOption {
  id: string
  name: string
  description: string
  icon: ComponentType<{ className?: string }>
  /** Use cases where this board should be pre-selected */
  useCases: UseCaseType[]
}

/**
 * Default board templates for onboarding.
 * Users can toggle these on/off during setup.
 * Boards are personalized based on the selected use case.
 */
export const DEFAULT_BOARD_OPTIONS: DefaultBoardOption[] = [
  // Common boards (most use cases)
  {
    id: 'feature-requests',
    name: 'Feature Requests',
    description: 'Collect ideas and suggestions for new features',
    icon: LightBulbIcon,
    useCases: ['saas', 'consumer', 'marketplace'],
  },
  {
    id: 'bug-reports',
    name: 'Bug Reports',
    description: 'Track issues and problems reported by users',
    icon: BugAntIcon,
    useCases: ['saas', 'consumer', 'marketplace'],
  },
  // SaaS-specific
  {
    id: 'integrations',
    name: 'Integrations',
    description: 'Requests for new integrations and connections',
    icon: PuzzlePieceIcon,
    useCases: ['saas'],
  },
  // Consumer-specific
  {
    id: 'ux-feedback',
    name: 'UX Feedback',
    description: 'Feedback on usability and user experience',
    icon: SparklesIcon,
    useCases: ['consumer'],
  },
  // Platform-specific
  {
    id: 'seller-feedback',
    name: 'Seller Feedback',
    description: 'Feedback from sellers and vendors',
    icon: BuildingStorefrontIcon,
    useCases: ['marketplace'],
  },
  {
    id: 'buyer-feedback',
    name: 'Buyer Feedback',
    description: 'Feedback from buyers and customers',
    icon: UserGroupIcon,
    useCases: ['marketplace'],
  },
  // Internal-specific
  {
    id: 'product-ideas',
    name: 'Product Ideas',
    description: 'Ideas for new products or features',
    icon: LightBulbIcon,
    useCases: ['internal'],
  },
  {
    id: 'process-improvements',
    name: 'Process Improvements',
    description: 'Suggestions to improve workflows and processes',
    icon: WrenchScrewdriverIcon,
    useCases: ['internal'],
  },
  {
    id: 'general-feedback',
    name: 'General Feedback',
    description: 'Open feedback for any topic',
    icon: ChatBubbleOvalLeftEllipsisIcon,
    useCases: ['internal'],
  },
]

/**
 * Get board IDs that should be pre-selected for a given use case.
 * Falls back to feature requests and bug reports if no use case is specified.
 */
export function getBoardsForUseCase(useCase?: UseCaseType): Set<string> {
  if (!useCase) {
    // Default: select common boards
    return new Set(['feature-requests', 'bug-reports'])
  }

  // Select boards that match the use case
  return new Set(DEFAULT_BOARD_OPTIONS.filter((b) => b.useCases.includes(useCase)).map((b) => b.id))
}

/**
 * Get boards filtered by use case for display.
 */
export function getBoardOptionsForUseCase(useCase?: UseCaseType): DefaultBoardOption[] {
  if (!useCase) {
    return DEFAULT_BOARD_OPTIONS.filter(
      (b) => b.useCases.includes('saas') || b.useCases.includes('consumer')
    )
  }

  return DEFAULT_BOARD_OPTIONS.filter((b) => b.useCases.includes(useCase))
}

/**
 * Get a human-readable label for a use case.
 */
export function getUseCaseLabel(useCase?: UseCaseType): string {
  switch (useCase) {
    case 'saas':
      return 'SaaS products'
    case 'consumer':
      return 'consumer apps'
    case 'marketplace':
      return 'marketplaces'
    case 'internal':
      return 'teams'
    default:
      return 'your product'
  }
}
