/**
 * Type declarations for Cloudflare Workers
 * These are needed for TypeScript to understand Cloudflare-specific APIs
 */

// Global Cloudflare Workers types
declare interface Hyperdrive {
  connectionString: string
}

declare interface DurableObjectNamespace<T = unknown> {
  newUniqueId(): DurableObjectId
  idFromName(name: string): DurableObjectId
  idFromString(id: string): DurableObjectId
  get(id: DurableObjectId): DurableObjectStub<T>
}

declare interface DurableObjectStub<_T = unknown> {
  readonly id: DurableObjectId
  readonly name?: string
  fetch(request: Request): Promise<Response>
  fetch(url: string | URL, init?: RequestInit): Promise<Response>
}

declare interface DurableObjectId {
  toString(): string
  equals(other: DurableObjectId): boolean
}

declare interface DurableObjectState {
  storage: DurableObjectStorage
  id: DurableObjectId
  waitUntil(promise: Promise<unknown>): void
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>
}

declare interface DurableObjectStorage {
  get<T = unknown>(key: string): Promise<T | undefined>
  get<T = unknown>(keys: string[]): Promise<Map<string, T>>
  put<T>(key: string, value: T): Promise<void>
  put<T>(entries: Record<string, T>): Promise<void>
  delete(key: string): Promise<boolean>
  delete(keys: string[]): Promise<number>
  list<T = unknown>(options?: { prefix?: string; limit?: number }): Promise<Map<string, T>>
}

declare interface Workflow<Params = unknown> {
  create(options?: { id?: string; params?: Params }): Promise<WorkflowInstance>
  get(id: string): Promise<WorkflowInstance>
}

declare interface WorkflowInstance {
  id: string
  status(): Promise<WorkflowInstanceStatus>
  pause(): Promise<void>
  resume(): Promise<void>
  terminate(): Promise<void>
  restart(): Promise<void>
}

declare interface WorkflowInstanceStatus {
  status: 'queued' | 'running' | 'paused' | 'complete' | 'errored' | 'terminated' | 'unknown'
  error?: string
  output?: unknown
}

declare interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void
  passThroughOnException(): void
}

declare interface WorkflowEvent<Params = unknown> {
  payload: Params
  timestamp: Date
  instanceId: string
}

declare interface WorkflowStep {
  do<T>(name: string, callback: () => Promise<T>): Promise<T>
  do<T>(
    name: string,
    config: {
      retries?: { limit: number; delay?: string; backoff?: 'exponential' | 'linear' | 'constant' }
      timeout?: string
    },
    callback: () => Promise<T>
  ): Promise<T>
  sleep(name: string, duration: string): Promise<void>
  sleepUntil(name: string, timestamp: Date | number): Promise<void>
}

// cloudflare:workers module
declare module 'cloudflare:workers' {
  export abstract class DurableObject<Env = unknown> {
    protected ctx: DurableObjectState
    protected env: Env
    constructor(ctx: DurableObjectState, env: Env)
  }

  export abstract class WorkflowEntrypoint<Env = unknown, Params = unknown> {
    protected ctx: ExecutionContext
    protected env: Env
    abstract run(event: WorkflowEvent<Params>, step: WorkflowStep): Promise<unknown>
  }

  export type {
    DurableObjectState,
    DurableObjectStorage,
    DurableObjectId,
    ExecutionContext,
    WorkflowEvent,
    WorkflowStep,
  }
}
