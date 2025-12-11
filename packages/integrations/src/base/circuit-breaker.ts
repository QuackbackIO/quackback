/**
 * Circuit breaker pattern for integration resilience.
 * Prevents hammering failed external APIs.
 */
import type { Redis } from 'ioredis'

const FAILURE_THRESHOLD = 5
const RESET_TIMEOUT_MS = 60_000 // 1 minute
const STATE_TTL = 3600 // 1 hour

interface CircuitState {
  failures: number
  lastFailure: number
  state: 'closed' | 'open' | 'half-open'
}

export class CircuitBreaker {
  private readonly key: string

  constructor(
    private readonly integrationId: string,
    private readonly redis: Redis
  ) {
    this.key = `circuit:${integrationId}`
  }

  /**
   * Checks if requests can be executed through this circuit.
   * Returns true if closed or half-open, false if open.
   */
  async canExecute(): Promise<boolean> {
    const state = await this.getState()

    if (state.state === 'closed') {
      return true
    }

    if (state.state === 'open') {
      // Check if reset timeout has passed
      if (Date.now() - state.lastFailure > RESET_TIMEOUT_MS) {
        await this.setState({ ...state, state: 'half-open' })
        return true // Allow one request through
      }
      return false
    }

    // half-open: allow request
    return true
  }

  /**
   * Records a successful request. Resets the circuit to closed.
   */
  async recordSuccess(): Promise<void> {
    await this.setState({ failures: 0, lastFailure: 0, state: 'closed' })
  }

  /**
   * Records a failed request. Opens the circuit if threshold exceeded.
   */
  async recordFailure(): Promise<void> {
    const state = await this.getState()
    const newFailures = state.failures + 1

    await this.setState({
      failures: newFailures,
      lastFailure: Date.now(),
      state: newFailures >= FAILURE_THRESHOLD ? 'open' : state.state,
    })
  }

  /**
   * Gets the current circuit state.
   */
  async getState(): Promise<CircuitState> {
    const data = await this.redis.get(this.key)
    if (!data) {
      return { failures: 0, lastFailure: 0, state: 'closed' }
    }
    return JSON.parse(data)
  }

  /**
   * Checks if the circuit is currently open.
   */
  async isOpen(): Promise<boolean> {
    const state = await this.getState()
    return state.state === 'open'
  }

  /**
   * Manually resets the circuit to closed state.
   */
  async reset(): Promise<void> {
    await this.setState({ failures: 0, lastFailure: 0, state: 'closed' })
  }

  private async setState(state: CircuitState): Promise<void> {
    await this.redis.setex(this.key, STATE_TTL, JSON.stringify(state))
  }
}
