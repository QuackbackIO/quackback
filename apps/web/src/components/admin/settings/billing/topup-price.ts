/** Catalogue pack price that is safe to quote. Missing or non-finite is not $10. */
export function hasTopUpPackPrice(cents: unknown): cents is number {
  return typeof cents === 'number' && Number.isFinite(cents)
}
