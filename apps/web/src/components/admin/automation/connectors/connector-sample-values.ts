/**
 * Trims the test panel's draft values down to the connector's declared
 * inputs, dropping blanks so an untouched optional field doesn't send an
 * empty string, a stray NaN, or an undeclared key to the test-call fn.
 */
import type { ConnectorInputField, ConnectorValues } from '@/lib/server/domains/connectors/connector.types'

export function buildSampleValues(
  inputs: ConnectorInputField[],
  draft: Record<string, string | number | boolean | undefined>
): ConnectorValues {
  const values: ConnectorValues = {}
  for (const input of inputs) {
    const value = draft[input.name]
    if (value === undefined) continue
    if (typeof value === 'number' && Number.isNaN(value)) continue
    if (typeof value === 'string' && value.trim() === '') continue
    values[input.name] = value
  }
  return values
}
