import { useMemo, useRef, useState } from 'react'
import { ChevronRightIcon } from '@heroicons/react/20/solid'
import { PlusIcon, PencilIcon, TrashIcon, FolderPlusIcon } from '@heroicons/react/16/solid'
import { cn } from '@/lib/shared/utils'
import {
  buildAncestorChain,
  MAX_CATEGORY_DEPTH,
} from '@/lib/server/domains/help-center/category-tree'
import type { HelpCenterCategoryId } from '@quackback/ids'

export interface TreeCategory {
  id: HelpCenterCategoryId
  parentId: HelpCenterCategoryId | null
  name: string
  description: string | null
  icon: string | null
  isPublic: boolean
  articleCount: number
}

/** Handlers for category CRUD, shared between the sidebar tree and the main finder. */
export interface CategoryActions {
  onNew: (parentId: HelpCenterCategoryId | null) => void
  onEdit: (category: TreeCategory) => void
  onDelete: (category: TreeCategory) => void
}

interface HelpCenterCategoryTreeProps {
  categories: TreeCategory[]
  selectedId: string | undefined
  onNavigate: (id: HelpCenterCategoryId | null) => void
  actions: CategoryActions
}

interface TreeNode {
  category: TreeCategory
  depth: number
  children: TreeNode[]
}

function buildTree(categories: TreeCategory[]): TreeNode[] {
  const childrenByParent = new Map<string | null, TreeCategory[]>()
  for (const cat of categories) {
    const key = cat.parentId ?? null
    const existing = childrenByParent.get(key)
    if (existing) existing.push(cat)
    else childrenByParent.set(key, [cat])
  }
  for (const list of childrenByParent.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name))
  }

  function build(cat: TreeCategory, depth: number): TreeNode {
    const children = (childrenByParent.get(cat.id) ?? []).map((c) => build(c, depth + 1))
    return { category: cat, depth, children }
  }

  return (childrenByParent.get(null) ?? []).map((c) => build(c, 0))
}

export function HelpCenterCategoryTree({
  categories,
  selectedId,
  onNavigate,
  actions,
}: HelpCenterCategoryTreeProps) {
  const tree = useMemo(() => buildTree(categories), [categories])

  // Ancestor chain of the selected category — used for auto-expansion.
  const ancestorIds = useMemo(() => {
    if (!selectedId) return new Set<string>()
    const chain = buildAncestorChain(categories, selectedId)
    return new Set(chain.map((c) => c.id))
  }, [categories, selectedId])

  // Ref mirror of ancestorIds so the updater passed to setOverrides can read
  // the current value without capturing a stale closure across renders.
  const ancestorIdsRef = useRef(ancestorIds)
  ancestorIdsRef.current = ancestorIds

  // Transient expansion overrides. Resets on unmount by design — matches how
  // file explorers behave when you navigate across a session.
  const [overrides, setOverrides] = useState<Map<string, boolean>>(() => new Map())

  function isExpanded(id: string): boolean {
    const override = overrides.get(id)
    if (override !== undefined) return override
    return ancestorIds.has(id)
  }

  function toggle(id: string) {
    setOverrides((prev) => {
      const next = new Map(prev)
      const base = prev.get(id) ?? ancestorIdsRef.current.has(id)
      next.set(id, !base)
      return next
    })
  }

  function renderNode(node: TreeNode): React.ReactElement {
    const { category, depth, children } = node
    const expanded = isExpanded(category.id)
    const hasChildren = children.length > 0
    return (
      <div key={category.id}>
        <TreeRow
          category={category}
          depth={depth}
          isSelected={selectedId === category.id}
          isExpanded={expanded}
          hasChildren={hasChildren}
          canAddSub={depth + 1 < MAX_CATEGORY_DEPTH}
          onToggle={() => toggle(category.id)}
          onNavigate={() => onNavigate(category.id)}
          onAddSub={() => actions.onNew(category.id)}
          onEdit={() => actions.onEdit(category)}
          onDelete={() => actions.onDelete(category)}
        />
        {expanded && hasChildren && <div>{children.map(renderNode)}</div>}
      </div>
    )
  }

  return (
    <div className="space-y-0.5">
      <div role="tree" aria-label="Help center categories" className="space-y-0.5">
        {tree.map(renderNode)}
      </div>
      <button
        type="button"
        onClick={() => actions.onNew(null)}
        className="mt-1 w-full flex items-center gap-1.5 px-2 h-7 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
      >
        <PlusIcon className="h-3 w-3 shrink-0" />
        New category
      </button>
    </div>
  )
}

interface TreeRowProps {
  category: TreeCategory
  depth: number
  isSelected: boolean
  isExpanded: boolean
  hasChildren: boolean
  canAddSub: boolean
  onToggle: () => void
  onNavigate: () => void
  onAddSub: () => void
  onEdit: () => void
  onDelete: () => void
}

function TreeRow({
  category,
  depth,
  isSelected,
  isExpanded,
  hasChildren,
  canAddSub,
  onToggle,
  onNavigate,
  onAddSub,
  onEdit,
  onDelete,
}: TreeRowProps) {
  return (
    <div
      role="treeitem"
      aria-level={depth + 1}
      aria-expanded={hasChildren ? isExpanded : undefined}
      aria-selected={isSelected}
      className={cn(
        'group relative flex items-center h-7 rounded-md text-xs transition-colors',
        isSelected
          ? 'bg-muted text-foreground font-medium'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
      )}
      style={{ paddingLeft: 4 + depth * 12 }}
    >
      {hasChildren ? (
        <button
          type="button"
          onClick={onToggle}
          className="shrink-0 flex items-center justify-center h-5 w-5 text-muted-foreground hover:text-foreground"
          aria-label={isExpanded ? 'Collapse' : 'Expand'}
        >
          <ChevronRightIcon
            className={cn('h-3.5 w-3.5 transition-transform', isExpanded && 'rotate-90')}
          />
        </button>
      ) : (
        <span className="shrink-0 w-5" aria-hidden="true" />
      )}
      <button
        type="button"
        onClick={onNavigate}
        className="flex-1 min-w-0 flex items-center gap-1.5 pr-1 text-left h-full"
      >
        <span className="shrink-0 text-sm leading-none">{category.icon || '📁'}</span>
        <span className="truncate">{category.name}</span>
      </button>
      <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground pr-2 group-hover:opacity-0 transition-opacity">
        {category.articleCount}
      </span>
      <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        {canAddSub && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onAddSub()
            }}
            className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted"
            aria-label="New sub-category"
            title="New sub-category"
          >
            <FolderPlusIcon className="h-3 w-3" />
          </button>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onEdit()
          }}
          className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted"
          aria-label="Edit category"
          title="Edit category"
        >
          <PencilIcon className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          aria-label="Delete category"
          title="Delete category"
        >
          <TrashIcon className="h-3 w-3" />
        </button>
      </div>
    </div>
  )
}
