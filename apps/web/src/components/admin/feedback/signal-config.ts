import { SparklesIcon, ExclamationTriangleIcon } from '@heroicons/react/24/solid'
import type { AiSignalType } from '@/lib/server/domains/signals'

export interface SignalDisplayConfig {
  singularLabel: string
  pluralLabel: string
  badgeLabel: (count: number) => string
  icon: typeof SparklesIcon
  className: string
  color: string
}

export const SIGNAL_DISPLAY: Record<AiSignalType, SignalDisplayConfig> = {
  duplicate: {
    singularLabel: 'duplicate',
    pluralLabel: 'duplicates',
    badgeLabel: (n) => (n === 1 ? '1 duplicate' : `${n} duplicates`),
    icon: SparklesIcon,
    className: 'text-amber-400 bg-amber-400/10 border-amber-400/20',
    color: 'text-amber-400',
  },
  sentiment: {
    singularLabel: 'urgent',
    pluralLabel: 'urgent',
    badgeLabel: () => 'Urgent',
    icon: ExclamationTriangleIcon,
    className: 'text-red-400 bg-red-400/10 border-red-400/20',
    color: 'text-red-400',
  },
  categorize: {
    singularLabel: 'uncategorized',
    pluralLabel: 'uncategorized',
    badgeLabel: () => 'Uncategorized',
    icon: SparklesIcon,
    className: 'text-blue-400 bg-blue-400/10 border-blue-400/20',
    color: 'text-blue-400',
  },
  trend: {
    singularLabel: 'trending',
    pluralLabel: 'trending',
    badgeLabel: () => 'Trending',
    icon: SparklesIcon,
    className: 'text-green-400 bg-green-400/10 border-green-400/20',
    color: 'text-green-400',
  },
  response_draft: {
    singularLabel: 'needs response',
    pluralLabel: 'need response',
    badgeLabel: () => 'Draft ready',
    icon: SparklesIcon,
    className: 'text-purple-400 bg-purple-400/10 border-purple-400/20',
    color: 'text-purple-400',
  },
}
