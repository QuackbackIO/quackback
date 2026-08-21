import { useRouteContext } from '@tanstack/react-router'
import { MagnifyingGlassIcon, DocumentIcon, SparklesIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/shared/empty-state'
import { useActivationAction } from '@/lib/client/hooks/use-activation-action'
import { ActivationActionButton } from '@/components/admin/activation-action-button'

interface InboxEmptyStateProps {
  type: 'no-posts' | 'no-results' | 'no-selection'
  onClearFilters?: () => void
}

export function InboxEmptyState({ type, onClearFilters }: InboxEmptyStateProps) {
  const { userRole } = useRouteContext({ from: '__root__' })
  const activationAction = useActivationAction('feedback_empty')
  const isAdmin = userRole === 'admin'

  if (type === 'no-results') {
    return (
      <EmptyState
        icon={MagnifyingGlassIcon}
        title="No results for these filters"
        description="Try adjusting your search or filter criteria."
        action={
          onClearFilters && (
            <Button variant="outline" onClick={onClearFilters}>
              Clear all filters
            </Button>
          )
        }
      />
    )
  }

  if (type === 'no-posts') {
    return (
      <EmptyState
        icon={SparklesIcon}
        title="No feedback yet"
        description="Share your public board to start collecting customer ideas and votes."
        action={
          isAdmin &&
          activationAction && (
            <ActivationActionButton
              action={activationAction}
              surface="feedback_empty"
              className="h-11 sm:h-9"
            />
          )
        }
      />
    )
  }

  // no-selection
  return (
    <EmptyState
      icon={DocumentIcon}
      title="Select a post"
      description="Choose a post from the list to view its details."
      className="h-full"
    />
  )
}
