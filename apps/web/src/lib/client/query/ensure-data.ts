/**
 * Guard against TanStack Start server function RPC resolving without a payload
 * after a server-side failure. React Query needs a thrown error here so retries
 * and route error boundaries see the original query failure shape.
 */
export function ensureData<T>(data: T, label: string): NonNullable<T> {
  if (data === undefined || data === null) {
    throw new Error(`Server returned no data for ${label}`)
  }
  return data as NonNullable<T>
}
