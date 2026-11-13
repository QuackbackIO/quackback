/**
 * How a typed server error crosses to the browser (registered in start.ts).
 *
 * The framework serializes any thrown `Error` as its message alone. A typed
 * error below 500 is a planned refusal (not found, forbidden, a conflict), so
 * it also carries its `code` and `statusCode`: the client acts on the code,
 * never on the message. Nothing else on it crosses (no cause, no stack, no
 * extra fields). A typed error of 500 or above and a plain throw keep the
 * framework's message-only shape; in production the server-function logging
 * middleware has already replaced a technical one with a plain sentence.
 *
 * In the browser the error arrives as a plain `Error` with those fields as its
 * own properties and its class name as `name`; `instanceof` a domain class
 * does not hold there, so readers check `code` or `statusCode`.
 */
import { createSerializationAdapter } from '@tanstack/react-router'
import { DomainException } from './errors'

interface TypedErrorWire {
  name: string
  code: string
  statusCode: number
  message: string
}

/** A typed error the browser may see in full: a planned refusal below 500. */
export function isPlannedTypedError(value: unknown): value is DomainException {
  return value instanceof DomainException && value.statusCode < 500
}

/** The error the browser receives for a planned typed error. */
export function reviveTypedError(wire: TypedErrorWire): DomainException {
  const error = new Error(wire.message)
  error.name = wire.name
  return Object.assign(error, {
    code: wire.code,
    statusCode: wire.statusCode,
  }) as unknown as DomainException
}

export const typedErrorSerializationAdapter = createSerializationAdapter({
  key: 'quackback-typed-error',
  test: isPlannedTypedError,
  toSerializable: (error: DomainException): TypedErrorWire => ({
    name: error.name,
    code: error.code,
    statusCode: error.statusCode,
    message: error.message,
  }),
  fromSerializable: reviveTypedError,
})
