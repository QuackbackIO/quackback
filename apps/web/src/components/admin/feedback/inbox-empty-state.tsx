import { MagnifyingGlassIcon, DocumentIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/shared/empty-state'

interface InboxEmptyStateProps {
  type: 'no-posts' | 'no-results' | 'no-selection'
  onClearFilters?: () => void
}

export function InboxEmptyState({ type, onClearFilters }: InboxEmptyStateProps) {
  if (type === 'no-posts' || type === 'no-results') {
    return (
      <EmptyState
        icon={MagnifyingGlassIcon}
        title="No posts match your filters"
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
