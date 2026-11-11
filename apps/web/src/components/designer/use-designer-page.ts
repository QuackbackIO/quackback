import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouteContext } from '@tanstack/react-router'
import { listDesignerPostsFn } from '@/lib/server/functions/portal-designer'
import {
  designerPages,
  locationOfPath,
  type CanvasLocation,
  type DesignerPage,
} from '@/lib/shared/design/outline'
import type { CanvasVisitor } from '@/lib/shared/design/designer-frame'
import { portalPageGates } from '@/lib/shared/design/paths'
import { isPageSample, type SamplePage } from '@/lib/shared/design/sample-pages'
import type { PortalDesign } from '@/lib/shared/design/schema'

/** Where the builder remembers the website a design is matched to. */

/** What the designer's item picker lists for the post page. */
export interface PickablePost {
  id: string
  title: string
  path: string
}

/**
 * The page the builder shows: the one someone came from, else the first,
 * giving way when the draft turns it off. A page keeps the item it shows,
 * such as a post or an entry; the post page shows the post someone came
 * from, else the top one a signed-out visitor can open. A page can be drawn
 * from sample content, and for a visitor signed out (the default) or in.
 */
export function useDesignerPage(returnPath: string, design: PortalDesign) {
  const workspace = useRouteContext({ from: '__root__', select: (context) => context.settings })
  const gates = useMemo(() => portalPageGates(workspace, true), [workspace])
  // The same list while the menu says the same: a change elsewhere leaves it be.
  const { nav } = design
  const pages = useMemo(() => designerPages({ nav }, gates), [nav, gates])
  const [start] = useState(() => locationOfPath(returnPath, design.nav.home.on))
  const [chosen, setChosen] = useState<DesignerPage>(() => start?.page ?? pages[0] ?? 'feedback')
  const [items, setItems] = useState<Partial<Record<DesignerPage, string>>>(() =>
    start?.item ? { [start.page]: start.item } : {}
  )
  const [sample, setSample] = useState<SamplePage | null>(null)
  // The widget, drawn in the design, shown in place of the page.
  const [widget, setWidget] = useState(false)
  const [visitor, setVisitor] = useState<CanvasVisitor>('out')
  const realPage = pages.includes(chosen) ? chosen : (pages[0] ?? 'feedback')
  // The not-found sample is no page of the menu: the panels stay on the page underneath.
  const pageSample = sample && isPageSample(sample) ? sample : null
  const page = pageSample ?? realPage

  /** Shows a page, at an item of it or at the item it last showed; a sample gives way. */
  const setPage = useCallback((next: DesignerPage, item?: string | null) => {
    setSample(null)
    setWidget(false)
    setChosen(next)
    if (item !== undefined)
      setItems((before) => {
        const after = { ...before }
        if (item) after[next] = item
        else delete after[next]
        return after
      })
  }, [])
  const showSample = useCallback((next: SamplePage | null) => {
    setWidget(false)
    setSample(next)
  }, [])
  const showWidget = useCallback(() => {
    setSample(null)
    setWidget(true)
  }, [])

  const [posts, setPosts] = useState<PickablePost[] | null>(null)
  useEffect(() => {
    if (page !== 'post' || posts) return
    let current = true
    void listDesignerPostsFn()
      .then((answer) => current && setPosts(answer.ok ? answer.posts : []))
      .catch(() => current && setPosts([]))
    return () => {
      current = false
    }
  }, [page, posts])

  const postPath = items.post ?? posts?.[0]?.path ?? null
  const item = sample ? null : page === 'post' ? postPath : (items[page] ?? null)
  const here: CanvasLocation = useMemo(() => ({ page, item }), [page, item])
  return {
    gates,
    /** What the page gates read, for where a part that is off is turned on. */
    settings: workspace ?? {},
    /** The portal's own pages, never a sample's: what Review compares and Find goes to. */
    pages,
    /** The pages the page picker lists: a sample's too while it is shown, so it can name it. */
    shownPages: pageSample && !pages.includes(pageSample) ? [...pages, pageSample] : pages,
    page,
    /** The page shown, or under a sample the real page the builder was on. */
    realPage,
    setPage,
    /** The post page's post. */
    postPath,
    noPost: page === 'post' && !postPath && posts !== null,
    here,
    posts: posts ?? [],
    sample,
    showSample,
    /** Whether the widget's sample is shown in place of the page. */
    widget,
    showWidget,
    visitor,
    setVisitor,
  }
}
