/** USD sticker used by Plan & billing and the upgrade offer. */
export function formatUsd(cents: number, fractionDigits: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(cents / 100)
}
