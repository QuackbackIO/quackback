import { Search, FileQuestion } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface InboxEmptyStateProps {
  type: 'no-posts' | 'no-results' | 'no-selection'
  onClearFilters?: () => void
}

export function InboxEmptyState({ type, onClearFilters }: InboxEmptyStateProps) {
  if (type === 'no-posts' || type === 'no-results') {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
        <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-4">
          <Search className="h-6 w-6 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-medium text-foreground mb-1">No posts match your filters</h3>
        <p className="text-sm text-muted-foreground max-w-sm mb-4">
          Try adjusting your search or filter criteria.
        </p>
        {onClearFilters && (
          <Button variant="outline" onClick={onClearFilters}>
            Clear all filters
          </Button>
        )}
      </div>
    )
  }

  // no-selection
  return (
    <div className="flex flex-col items-center justify-center h-full py-16 px-4 text-center">
      <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-4">
        <FileQuestion className="h-6 w-6 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-medium text-foreground mb-1">Select a post</h3>
      <p className="text-sm text-muted-foreground max-w-sm">
        Choose a post from the list to view its details.
      </p>
    </div>
  )
}
