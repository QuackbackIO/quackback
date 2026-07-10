import {
  LightBulbIcon,
  BugAntIcon,
  ChatBubbleOvalLeftEllipsisIcon,
  PuzzlePieceIcon,
  WrenchScrewdriverIcon,
} from '@heroicons/react/24/solid'
import type { ComponentType } from 'react'
import { normalizeOnboardingOutcome, type UseCaseType } from '@/lib/shared/db-types'

export interface DefaultBoardOption {
  id: string
  name: string
  description: string
  icon: ComponentType<{ className?: string }>
  /** Outcomes where this board is offered / pre-selected */
  useCases: UseCaseType[]
}

/**
 * Board templates for the boards step, keyed by ICP outcome.
 *
 * product_feedback → Featurebase/Canny-style boards
 * customer_support → light feedback capture (ideas that surface from support)
 * help_center      → optional general board (help is the main win)
 * internal         → employee voice
 *
 * Legacy saas/consumer/marketplace normalize to product_feedback templates.
 */
export const DEFAULT_BOARD_OPTIONS: DefaultBoardOption[] = [
  {
    id: 'feature-requests',
    name: 'Feature Requests',
    description: 'Ideas and suggestions for new features',
    icon: LightBulbIcon,
    useCases: ['product_feedback', 'customer_support', 'saas', 'consumer', 'marketplace'],
  },
  {
    id: 'bug-reports',
    name: 'Bug Reports',
    description: 'Issues and problems reported by users',
    icon: BugAntIcon,
    useCases: ['product_feedback', 'saas', 'consumer', 'marketplace'],
  },
  {
    id: 'integrations',
    name: 'Integrations',
    description: 'Requests for tools and connections',
    icon: PuzzlePieceIcon,
    useCases: ['product_feedback', 'saas'],
  },
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
    description: 'Suggestions to improve how the team works',
    icon: WrenchScrewdriverIcon,
    useCases: ['internal'],
  },
  {
    id: 'general-feedback',
    name: 'General Feedback',
    description: 'Open feedback for any topic',
    icon: ChatBubbleOvalLeftEllipsisIcon,
    useCases: ['internal', 'help_center'],
  },
]

/**
 * Board IDs pre-selected for an outcome.
 * Support / help center get a lighter default so Skip stays attractive.
 */
export function getBoardsForUseCase(useCase?: UseCaseType): Set<string> {
  const resolved = normalizeOnboardingOutcome(useCase)
  if (!resolved) {
    return new Set(['feature-requests', 'bug-reports'])
  }

  // Intercom-style support ICP: one capture board is enough; inbox is the win.
  if (resolved === 'customer_support') {
    return new Set(['feature-requests'])
  }
  // Help-center ICP: board is optional background; don't overwhelm.
  if (resolved === 'help_center') {
    return new Set()
  }

  return new Set(
    DEFAULT_BOARD_OPTIONS.filter((b) => b.useCases.includes(resolved)).map((b) => b.id)
  )
}

/**
 * Boards offered in the picker for an outcome.
 */
export function getBoardOptionsForUseCase(useCase?: UseCaseType): DefaultBoardOption[] {
  const resolved = normalizeOnboardingOutcome(useCase)
  if (!resolved) {
    return DEFAULT_BOARD_OPTIONS.filter((b) => b.useCases.includes('product_feedback'))
  }

  return DEFAULT_BOARD_OPTIONS.filter((b) => b.useCases.includes(resolved))
}

/**
 * Phrase for “suggestions for …”
 */
export function getUseCaseLabel(useCase?: UseCaseType): string {
  switch (normalizeOnboardingOutcome(useCase)) {
    case 'product_feedback':
      return 'collecting product feedback'
    case 'customer_support':
      return 'supporting customers'
    case 'help_center':
      return 'building a help center'
    case 'internal':
      return 'your team'
    default:
      return 'your workspace'
  }
}

/**
 * Boards step headline/subcopy varies by outcome so support/help ICPs
 * aren't forced through a Featurebase-shaped wizard.
 */
export function getBoardsStepCopy(useCase?: UseCaseType): {
  title: string
  description: string
  skipHint?: string
} {
  const resolved = normalizeOnboardingOutcome(useCase)
  switch (resolved) {
    case 'customer_support':
      return {
        title: 'Optional: a place for product ideas',
        description:
          'Support is your main surface. A feedback board is useful when chats turn into feature requests; skip if you only want the inbox for now.',
        skipHint: 'Skip for now',
      }
    case 'help_center':
      return {
        title: 'Optional: a feedback board',
        description:
          'Your help center is the priority. Add a board if you also want to collect ideas, or skip and set up articles next.',
        skipHint: 'Skip for now',
      }
    case 'internal':
      return {
        title: 'Create boards for your team',
        description: 'Organize internal ideas and process feedback by topic.',
      }
    case 'product_feedback':
    default:
      return {
        title: 'Create your first boards',
        description: useCase
          ? `Boards organize feedback by topic. Suggestions for ${getUseCaseLabel(useCase)}.`
          : 'Boards organize feedback by topic.',
      }
  }
}
