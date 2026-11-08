import { GRID_COLUMNS } from '@/lib/shared/design/home-grid'
import type { HomeBlock } from '@/lib/shared/design/home'
import type { OutlineNode } from '@/lib/shared/design/outline'
import { cn } from '@/lib/shared/utils'

/** One shape of the skeleton: the header, the hero, a Home block at its grid size, or a part. */
export type SkeletonPart =
  | { key: string; kind: 'header' | 'hero' | 'part' }
  | { key: string; kind: 'block'; span: number; rows: number }

/** The shapes for a page's outline, in the order a visitor meets its parts. */
export function skeletonOf(
  nodes: readonly OutlineNode[],
  blocks: readonly Pick<HomeBlock, 'grid'>[] = []
): SkeletonPart[] {
  return nodes.flatMap((node): SkeletonPart[] => {
    if (node.key === 'site') return []
    if (node.key === 'header' || node.key === 'hero') return [{ key: node.key, kind: node.key }]
    if (node.key === 'home')
      return (node.children ?? []).map((child, at) => ({
        key: child.key,
        kind: 'block',
        span: Math.min(GRID_COLUMNS, blocks[at]?.grid.w ?? GRID_COLUMNS),
        rows: blocks[at]?.grid.h ?? 3,
      }))
    return [{ key: node.key, kind: 'part' }]
  })
}

const shape = 'rounded-md bg-muted motion-safe:animate-pulse'

/**
 * The page's parts as grey shapes, drawn while the page itself loads, so the
 * canvas is never blank. Fluid, so it fills whatever width it is given.
 */
export function CanvasSkeleton({ parts }: { parts: readonly SkeletonPart[] }) {
  const blocks = parts.filter((part) => part.kind === 'block')
  const header = parts.find((part) => part.kind === 'header')
  const hero = parts.find((part) => part.kind === 'hero')
  const rest = parts.filter((part) => part.kind === 'part')
  return (
    <div data-canvas-skeleton="" aria-hidden="true" className="flex flex-col bg-background">
      {header && (
        <div
          data-skeleton-part=""
          className="flex h-14 items-center gap-3 border-b border-border px-[6%]"
        >
          <div className={cn(shape, 'h-6 w-24')} />
          <div className={cn(shape, 'h-3 w-14')} />
          <div className={cn(shape, 'h-3 w-14')} />
          <div className={cn(shape, 'h-3 w-14')} />
          <div className={cn(shape, 'ms-auto h-7 w-20')} />
        </div>
      )}
      {hero && (
        <div data-skeleton-part="" className="flex flex-col items-center gap-3 px-[6%] py-12">
          <div className={cn(shape, 'h-8 w-1/2')} />
          <div className={cn(shape, 'h-4 w-1/3')} />
        </div>
      )}
      <div className="mx-auto flex w-full max-w-[88%] flex-col gap-4 pb-8">
        {blocks.length > 0 && (
          <div
            className="grid gap-4"
            style={{ gridTemplateColumns: `repeat(${GRID_COLUMNS}, minmax(0, 1fr))` }}
          >
            {blocks.map((part) => (
              <div
                key={part.key}
                data-skeleton-part=""
                className={shape}
                style={{
                  gridColumn: `span ${part.kind === 'block' ? part.span : GRID_COLUMNS}`,
                  height: `${(part.kind === 'block' ? part.rows : 3) * 40}px`,
                }}
              />
            ))}
          </div>
        )}
        {rest.map((part) => (
          <div key={part.key} data-skeleton-part="" className={cn(shape, 'h-28')} />
        ))}
      </div>
    </div>
  )
}
