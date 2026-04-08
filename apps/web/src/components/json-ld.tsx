/**
 * JsonLd - Renders a <script type="application/ld+json"> tag for structured data.
 * Use inside component bodies since TanStack Router head() doesn't support script injection.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />
  )
}
