/**
 * Shared domain types and utilities
 */

export type {
  ServiceContext,
  AuthValidation,
  PaginationParams,
  PaginatedResult,
} from './service-context'

export { buildServiceContext } from './service-context'

export type { Result, DomainError } from './result'

export { ok, err, isOk, isErr, unwrap, unwrapOr, map, mapErr, flatMap } from './result'
