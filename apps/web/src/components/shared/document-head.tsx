import { memo } from 'react'
import { Asset, HeadContent, Scripts, useRouter, useTags } from '@tanstack/react-router'

/**
 * One route-managed head tag. It is keyed by its whole content (below), so a
 * tag that keeps its key kept every attribute: it renders when it appears and
 * not again while it stays.
 */
const HeadTag = memo(Asset, (prev, next) => prev.nonce === next.nonce)

/** The router's HeadContent, rendering only the tags a navigation changed. */
export function RouteHeadTags() {
  const tags = useTags()
  const nonce = useRouter().options.ssr?.nonce
  return (
    <>
      {tags.map((tag) => (
        <HeadTag {...tag} key={`tsr-meta-${JSON.stringify(tag)}`} nonce={nonce} />
      ))}
    </>
  )
}

/**
 * The route-managed head tags (title, meta, links, styles). The tags follow
 * the router themselves, so rendering the document again (it does on every
 * navigation, a search-only one included) leaves the ~80 of them alone. In
 * development the router's own HeadContent stays, which also removes its
 * development stylesheet after hydration.
 */
export const DocumentHead = memo(import.meta.env.DEV ? HeadContent : RouteHeadTags)

/** The route-managed body scripts, rendered only when they change. */
export const DocumentScripts = memo(Scripts)
