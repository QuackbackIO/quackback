import { ChevronDownIcon } from '@heroicons/react/16/solid'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { PAGE_NAMES, type CanvasLocation, type DesignerPage } from '@/lib/shared/design/outline'
import { ALWAYS_SAMPLED, isPageSample } from '@/lib/shared/design/sample-pages'
import type { PickablePost, useDesignerPage } from './use-designer-page'
import { Tag } from './tag'

const ITEM_NAMES: Partial<Record<DesignerPage, string>> = {
  post: 'a post',
  changelog: 'a changelog entry',
  help: 'a help article',
  status: 'an incident',
  support: 'a conversation',
}

/** What a place in the portal is called: a post by its title, else the page or its item. */
export function locationName(at: CanvasLocation, posts: readonly PickablePost[]): string {
  if (at.page === 'post') return posts.find((post) => post.path === at.item)?.title ?? 'A post'
  const item = at.item ? ITEM_NAMES[at.page] : null
  return item ? `${PAGE_NAMES[at.page]}, ${item}` : PAGE_NAMES[at.page]
}

/**
 * The quiet line over the canvas, shown only when there is something to say:
 * the post the post page shows, with the others a signed-out visitor can
 * open; a sample and how to leave it; and, after Preview went elsewhere,
 * where the builder is and the way back.
 */
export function CanvasBar({
  view: { here, posts, setPage, sample, showSample: onSample, gates, widget },
  note,
  onBack,
}: {
  view: Pick<
    ReturnType<typeof useDesignerPage>,
    'here' | 'posts' | 'setPage' | 'sample' | 'showSample' | 'gates' | 'widget'
  >
  /** Where Preview began, once it left the builder somewhere else. */
  note: { from: CanvasLocation } | null
  onBack: () => void
}) {
  const onPost = (path: string) => setPage('post', path)
  // Whether the page's part is on, so it has a real page to go back to.
  const partOn = here.page in gates && gates[here.page as keyof typeof gates]
  const sampleable = ALWAYS_SAMPLED.find((page) => page === here.page && partOn)
  const picking = here.page === 'post' && posts.length > 0
  if (widget)
    return (
      <div className="mb-2 flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <p className="flex items-center gap-1.5">
          <Tag>Sample</Tag>
          <span>Read only.</span>
          <Button variant="link" size="sm" className="h-auto p-0 text-xs" asChild>
            <a href="/admin/settings/widget">Widget settings</a>
          </Button>
        </p>
      </div>
    )
  if (!sample && !sampleable && !picking && !note) return null
  return (
    <div className="mb-2 flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {sample ? (
        <p className="flex items-center gap-1.5">
          <Tag>Sample</Tag>
          <span>
            {isPageSample(sample)
              ? `Made-up content, to design ${PAGE_NAMES[sample]} before it has its own.`
              : 'What visitors see at an address with nothing at it.'}
          </span>
          {(partOn || !isPageSample(sample)) && (
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs"
              onClick={() => onSample(null)}
            >
              {isPageSample(sample) ? 'Show the real page' : 'Back to the page'}
            </Button>
          )}
        </p>
      ) : (
        sampleable && (
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs text-muted-foreground"
            onClick={() => onSample(sampleable)}
          >
            Show sample content
          </Button>
        )
      )}
      {picking && !sample && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="xs" className="max-w-80 gap-1">
              <span className="truncate" title={locationName(here, posts)}>
                Showing: {locationName(here, posts)}
              </span>
              <ChevronDownIcon className="size-3.5 shrink-0" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            <DropdownMenuLabel>Posts every visitor can see</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              aria-label="Post shown"
              value={here.item ?? ''}
              onValueChange={(path: string) => onPost(path)}
            >
              {posts.map((post) => (
                <DropdownMenuRadioItem key={post.id} value={post.path}>
                  <span className="truncate" title={post.title}>
                    {post.title}
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {note && (
        <p className="ms-auto flex items-center gap-1.5">
          <span>Editing: {locationName(here, posts)}</span>
          <span aria-hidden="true">·</span>
          <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={onBack}>
            Back to {locationName(note.from, posts)}
          </Button>
        </p>
      )}
    </div>
  )
}
