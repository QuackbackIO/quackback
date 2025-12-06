import { test as teardown } from '@playwright/test'

/**
 * Global teardown: Clean up after tests
 */
teardown('cleanup', async () => {
  // No-op for now - could clean up test data here if needed
})
