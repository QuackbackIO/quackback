/** Recheck current source access on every customer citation click, including old messages. */
export function customerCitationUrl(source: { type: string; id: string }): string {
  return `/api/widget/quinn-source?type=${encodeURIComponent(source.type)}&id=${encodeURIComponent(source.id)}`
}
