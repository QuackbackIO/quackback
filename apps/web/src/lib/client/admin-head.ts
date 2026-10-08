/**
 * The document title for an admin page: "<section> · <workspace>". A route
 * sets it with `head: adminPageHead('Feedback')`. The workspace name comes
 * from the root route's context, which every match can see.
 */
interface HeadMatch {
  routeId: string
  context?: unknown
}

export function adminPageHead(section: string) {
  return ({ matches }: { matches: ReadonlyArray<HeadMatch> }) => {
    const root = matches.find((match) => match.routeId === '__root__')
    const settings = (root?.context as { settings?: { name?: string | null } | null } | undefined)
      ?.settings
    const name = settings?.name?.trim()
    return { meta: [{ title: name ? `${section} · ${name}` : section }] }
  }
}
