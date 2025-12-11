/**
 * @quackback/integrations - Built-in integration processors
 *
 * This package contains integration implementations that process domain events
 * and communicate with external services like Slack, Discord, Linear, etc.
 */
import { SlackIntegration } from './slack'
import type { BaseIntegration } from './base'

// Integration registry - maps integration types to their handlers
const integrations = new Map<string, BaseIntegration>()

// Register integrations
integrations.set('slack', new SlackIntegration())
// integrations.set('discord', new DiscordIntegration())
// integrations.set('linear', new LinearIntegration())

export const integrationRegistry = {
  /**
   * Gets an integration handler by type.
   */
  get(type: string): BaseIntegration | undefined {
    return integrations.get(type)
  },

  /**
   * Lists all registered integrations.
   */
  list(): BaseIntegration[] {
    return Array.from(integrations.values())
  },

  /**
   * Checks if an integration type is registered.
   */
  has(type: string): boolean {
    return integrations.has(type)
  },
}

// Re-export base classes and utilities
export {
  BaseIntegration,
  type DomainEvent,
  type DomainEventType,
  type IntegrationContext,
  type ProcessResult,
} from './base'

export { CircuitBreaker, isAlreadyProcessed, markAsProcessed, getProcessedResult } from './base'

// Re-export Slack utilities
export { SlackIntegration, getSlackOAuthUrl, exchangeSlackCode, listSlackChannels } from './slack'
