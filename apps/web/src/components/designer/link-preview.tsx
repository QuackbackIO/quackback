import { useMemo } from 'react'
import { useBaseUrl, useWorkspaceSettings } from '@/lib/client/hooks/use-root-context'
import { designAssetUrl } from '@/lib/shared/design/design-view'
import { fontStack } from '@/lib/shared/design/fonts'
import { resolveDesignCached } from '@/lib/shared/design/resolve'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { shareCardFacts } from '@/lib/shared/design/share-card'
import { portalHeadWords } from '@/lib/shared/portal-head'
import { cn } from '@/lib/shared/utils'

/**
 * A link to the portal as a chat or social post shows it, drawn from the
 * draft: the share image, or the card the portal draws from the brand (the
 * page colour, the icon and the title, as /brand.png draws it), then the
 * address, the title and the description in the workspace's main language.
 */
export function LinkPreview({
  design,
  className,
  image,
}: {
  design: PortalDesign
  className?: string
  /** The image the server draws for the link, as visitors will get it; in place of the sketch. */
  image?: string
}) {
  const settings = useWorkspaceSettings()
  const baseUrl = useBaseUrl()
  const facts = useMemo(() => shareCardFacts(design, resolveDesignCached(design)), [design])
  const title = design.brand.logo.name?.trim() || settings?.name || ''
  const description = portalHeadWords(settings).portal(title)
  const host = hostOf(baseUrl)
  const shareImage = design.brand.shareImage
  const icon = facts.iconKey ? designAssetUrl(facts.iconKey) : null

  return (
    <figure
      aria-label="Link preview"
      className={cn('m-0 overflow-hidden rounded-md border border-border bg-card', className)}
    >
      {image || shareImage ? (
        <img
          src={image ?? designAssetUrl(shareImage!.key)}
          alt=""
          className="aspect-[1200/630] w-full object-cover"
        />
      ) : (
        <div
          data-testid="link-preview-card"
          className="relative flex aspect-[1200/630] w-full flex-col justify-center gap-[6%] px-[8%]"
          style={{ background: facts.background, color: facts.ink }}
        >
          {icon ? (
            <img src={icon} alt="" className="size-[22%] max-h-8 max-w-8 object-contain" />
          ) : (
            <span
              aria-hidden="true"
              className="flex size-7 items-center justify-center rounded-md text-xs font-semibold"
              style={{ background: facts.accent, color: facts.accentInk }}
            >
              {[...title][0]?.toUpperCase()}
            </span>
          )}
          <span
            className="truncate text-sm leading-tight"
            style={{
              fontFamily: fontStack(design.brand.fonts.heading),
              fontWeight: design.brand.fonts.headingWeight,
            }}
          >
            {title}
          </span>
          <span
            aria-hidden="true"
            className="absolute inset-x-0 bottom-0 h-[2%] min-h-0.5"
            style={{ background: facts.accent }}
          />
        </div>
      )}
      <figcaption className="space-y-0.5 px-2 py-1.5 text-xs">
        {host && <span className="block truncate text-muted-foreground">{host}</span>}
        <span className="block truncate font-medium text-foreground">{title}</span>
        <span className="line-clamp-2 text-muted-foreground">{description}</span>
      </figcaption>
    </figure>
  )
}

function hostOf(baseUrl: string | null | undefined): string {
  if (!baseUrl) return ''
  try {
    return new URL(baseUrl).host
  } catch {
    return ''
  }
}
