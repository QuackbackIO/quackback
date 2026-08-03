import { cn } from '@/lib/shared/utils'

interface FilterItem {
  id: string
  name: string
  color?: string | null
}

interface ChangelogFiltersPublicProps {
  categories: FilterItem[]
  products: FilterItem[]
  selectedCategoryId?: string
  selectedProductId?: string
  onCategoryChange: (id: string | undefined) => void
  onProductChange: (id: string | undefined) => void
}

function PillButton({
  label,
  selected,
  color,
  onClick,
}: {
  label: string
  selected: boolean
  color?: string | null
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected
          ? 'bg-foreground text-background'
          : 'bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground'
      )}
    >
      {color && (
        <span
          className="h-2 w-2 rounded-full shrink-0"
          style={{ backgroundColor: color }}
          aria-hidden
        />
      )}
      {label}
    </button>
  )
}

/**
 * Horizontal pill/chip filter bar for the portal changelog page.
 * Shows category pills (top row) and product pills (bottom row).
 * Only rendered when there are at least 2 options in a dimension (including "All").
 */
export function ChangelogFiltersPublic({
  categories,
  products,
  selectedCategoryId,
  selectedProductId,
  onCategoryChange,
  onProductChange,
}: ChangelogFiltersPublicProps) {
  const showCategories = categories.length >= 1
  const showProducts = products.length >= 1

  if (!showCategories && !showProducts) return null

  return (
    <div className="flex flex-col gap-2 mb-6">
      {showCategories && (
        <div className="flex flex-wrap gap-2 items-center">
          <PillButton
            label="All"
            selected={!selectedCategoryId}
            onClick={() => onCategoryChange(undefined)}
          />
          {categories.map((cat) => (
            <PillButton
              key={cat.id}
              label={cat.name}
              selected={selectedCategoryId === cat.id}
              color={cat.color}
              onClick={() => onCategoryChange(selectedCategoryId === cat.id ? undefined : cat.id)}
            />
          ))}
        </div>
      )}
      {showProducts && (
        <div className="flex flex-wrap gap-2 items-center">
          <PillButton
            label="All Products"
            selected={!selectedProductId}
            onClick={() => onProductChange(undefined)}
          />
          {products.map((prod) => (
            <PillButton
              key={prod.id}
              label={prod.name}
              selected={selectedProductId === prod.id}
              onClick={() => onProductChange(selectedProductId === prod.id ? undefined : prod.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
