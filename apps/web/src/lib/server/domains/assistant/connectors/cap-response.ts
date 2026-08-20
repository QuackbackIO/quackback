/** Serialize a value and hard-cap it before it reaches the model. */
export function capSerializedResponse(
  projection: Record<string, unknown>,
  charLimit: number
): { data: string; truncated: boolean } {
  const serialized = JSON.stringify(projection)
  if (serialized.length <= charLimit) return { data: serialized, truncated: false }
  return { data: serialized.slice(0, charLimit), truncated: true }
}
