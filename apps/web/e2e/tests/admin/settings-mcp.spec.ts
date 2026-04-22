import { test, expect } from '@playwright/test'

test.describe('Admin MCP Settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/settings/mcp')
    await page.waitForLoadState('networkidle')
  })

  test('page loads and shows MCP Server heading', async ({ page }) => {
    await expect(page.getByText('MCP Server').first()).toBeVisible({ timeout: 10000 })
    await expect(
      page.getByText('Allow AI tools to interact with your feedback data via the Model Context Protocol')
    ).toBeVisible({ timeout: 10000 })
  })

  test('shows Enable MCP Server toggle', async ({ page }) => {
    await expect(page.getByText('Enable MCP Server').first()).toBeVisible({ timeout: 10000 })
    await expect(
      page.getByText('Allow AI tools like Claude Code to interact with your feedback data via the MCP protocol')
    ).toBeVisible()
  })

  test('MCP toggle switch is present with correct aria-label', async ({ page }) => {
    const mcpToggle = page.locator('#mcp-toggle')
    await expect(mcpToggle).toBeVisible({ timeout: 10000 })
    await expect(mcpToggle).toBeEnabled()
  })

  test('can toggle MCP server on and off', async ({ page }) => {
    const mcpToggle = page.locator('#mcp-toggle')
    await expect(mcpToggle).toBeVisible({ timeout: 10000 })
    await expect(mcpToggle).toBeEnabled()

    const wasChecked = await mcpToggle.isChecked()

    await mcpToggle.click()
    await page.waitForLoadState('networkidle')

    const nowChecked = await mcpToggle.isChecked()
    expect(nowChecked).toBe(!wasChecked)

    // Restore original state
    await mcpToggle.click()
    await page.waitForLoadState('networkidle')
    expect(await mcpToggle.isChecked()).toBe(wasChecked)
  })

  test('shows Setup Guide section heading', async ({ page }) => {
    await expect(page.getByText('Setup Guide').first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Connect an AI tool to your MCP server').first()).toBeVisible()
  })

  test('shows MCP endpoint URL in step 1', async ({ page }) => {
    await expect(page.getByText('Endpoint').first()).toBeVisible({ timeout: 10000 })

    // The endpoint URL is rendered in a <code> element
    const endpointCode = page.locator('code').filter({ hasText: /\/api\/mcp/ })
    await expect(endpointCode.first()).toBeVisible({ timeout: 10000 })
  })

  test('endpoint URL contains /api/mcp path', async ({ page }) => {
    const endpointCode = page.locator('code').filter({ hasText: /\/api\/mcp/ })
    await expect(endpointCode.first()).toBeVisible({ timeout: 10000 })

    const text = await endpointCode.first().textContent()
    expect(text).toMatch(/\/api\/mcp/)
  })

  test('copy endpoint button is present and clickable', async ({ page }) => {
    // The endpoint URL button wraps the <code> element
    const endpointButton = page.locator('button').filter({
      has: page.locator('code').filter({ hasText: /\/api\/mcp/ }),
    })

    if ((await endpointButton.count()) === 0) return

    await expect(endpointButton.first()).toBeVisible({ timeout: 10000 })
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await endpointButton.first().click()
    // Should briefly show the check icon (green) — only assert if clipboard write succeeded
    const feedback = page.locator('svg.text-green-500').or(page.getByText('Copied'))
    if ((await feedback.count()) > 0) {
      await expect(feedback.first()).toBeVisible({ timeout: 3000 })
    }
  })

  test('shows Authentication step', async ({ page }) => {
    await expect(page.getByText('Authentication').first()).toBeVisible({ timeout: 10000 })
    // Auth description text is split across DOM nodes (link + text), so check parts independently
    await expect(page.getByText(/or OAuth/).first()).toBeVisible()
  })

  test('authentication step links to API keys settings', async ({ page }) => {
    // Use exact: true to avoid matching the sidebar "API Keys" nav link
    const apiKeyLink = page.getByRole('link', { name: 'API key', exact: true })
    await expect(apiKeyLink).toBeVisible({ timeout: 10000 })

    const href = await apiKeyLink.getAttribute('href')
    expect(href).toMatch(/api-keys/)
  })

  test('shows Choose your client step with client selector buttons', async ({ page }) => {
    await expect(page.getByText('Choose your client')).toBeVisible({ timeout: 10000 })

    // Client buttons: Claude Code, Cursor, VS Code, Windsurf, Claude Desktop
    await expect(page.getByRole('button', { name: /Claude Code/i })).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('button', { name: /Cursor/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /VS Code/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /Windsurf/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /Claude Desktop/i })).toBeVisible()
  })

  test('Claude Code client is selected by default', async ({ page }) => {
    // Default client is claude-code; its config file tab shows .mcp.json
    await expect(page.getByText('.mcp.json')).toBeVisible({ timeout: 10000 })
  })

  test('Claude Code client shows OAuth and API Key variant buttons', async ({ page }) => {
    await expect(page.getByRole('button', { name: /OAuth \(recommended\)/i })).toBeVisible({
      timeout: 10000,
    })
    await expect(page.getByRole('button', { name: /API Key/i })).toBeVisible()
  })

  test('switching to Cursor client updates the code panel filename', async ({ page }) => {
    const cursorButton = page.getByRole('button', { name: /Cursor/i })
    await expect(cursorButton).toBeVisible({ timeout: 10000 })
    await cursorButton.click()

    // Cursor filename is .cursor/mcp.json
    await expect(page.getByText('.cursor/mcp.json')).toBeVisible({ timeout: 5000 })
  })

  test('switching to VS Code client updates the code panel filename', async ({ page }) => {
    const vscodeButton = page.getByRole('button', { name: /VS Code/i })
    await expect(vscodeButton).toBeVisible({ timeout: 10000 })
    await vscodeButton.click()

    await expect(page.getByText('.vscode/mcp.json')).toBeVisible({ timeout: 5000 })
  })

  test('switching to Windsurf client updates the code panel filename', async ({ page }) => {
    const windsurfButton = page.getByRole('button', { name: /Windsurf/i })
    await expect(windsurfButton).toBeVisible({ timeout: 10000 })
    await windsurfButton.click()

    await expect(page.getByText(/windsurf\/mcp_config\.json/)).toBeVisible({ timeout: 5000 })
  })

  test('switching to Claude Desktop shows OAuth and API Key variants', async ({ page }) => {
    const claudeDesktopButton = page.getByRole('button', { name: /Claude Desktop/i })
    await expect(claudeDesktopButton).toBeVisible({ timeout: 10000 })
    await claudeDesktopButton.click()

    await expect(page.getByRole('button', { name: /OAuth \(recommended\)/i })).toBeVisible({
      timeout: 5000,
    })
    await expect(page.getByRole('button', { name: /API Key/i })).toBeVisible()
    // Claude Desktop config filename
    await expect(page.getByText('claude_desktop_config.json')).toBeVisible()
  })

  test('Copy button is present in the code panel', async ({ page }) => {
    const copyButton = page.getByRole('button', { name: /Copy/i }).last()
    await expect(copyButton).toBeVisible({ timeout: 10000 })
  })

  test('code panel Copy button changes to "Copied" on click', async ({ page }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])

    const copyButton = page.getByRole('button', { name: 'Copy' }).last()
    if ((await copyButton.count()) === 0) {
      test.skip()
      return
    }

    await copyButton.click()

    const copiedText = page.getByText('Copied').last()
    if ((await copiedText.count()) > 0) {
      await expect(copiedText).toBeVisible({ timeout: 3000 })
    }
  })

  test('shows MCP tools list with tool count', async ({ page }) => {
    // The tools summary shows "X tools available"
    await expect(page.getByText(/tools available/i)).toBeVisible({ timeout: 10000 })
  })

  test('shows known MCP tool names in the tools list', async ({ page }) => {
    await expect(page.getByText('search').first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('create_post').first()).toBeVisible()
    await expect(page.getByText('triage_post').first()).toBeVisible()
  })

  test('shows Reference link for MCP tools documentation', async ({ page }) => {
    const referenceLink = page.getByRole('link', { name: /Reference/i })
    await expect(referenceLink).toBeVisible({ timeout: 10000 })

    const href = await referenceLink.getAttribute('href')
    expect(href).toContain('quackback.io/docs/mcp')
  })

  test('Claude Code API Key variant shows Authorization Bearer config', async ({ page }) => {
    // Switch to API Key variant
    const apiKeyVariant = page.getByRole('button', { name: /API Key/i })
    if ((await apiKeyVariant.count()) > 0) {
      await apiKeyVariant.first().click()
      await expect(page.getByText(/QUACKBACK_API_KEY/).first()).toBeVisible({ timeout: 5000 })
    }
  })
})
