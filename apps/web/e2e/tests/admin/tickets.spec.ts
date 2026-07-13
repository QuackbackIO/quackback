import { test, expect } from '@playwright/test'

const uniqueId = Date.now()

test.describe('Admin Tickets', () => {
  test.describe.configure({ mode: 'serial' })

  let ticketSubject: string

  test('can navigate to tickets section', async ({ page }) => {
    await page.goto('/admin')
    await page.waitForLoadState('networkidle')

    // Sidebar should have a Tickets link
    const ticketsLink = page.getByRole('link', { name: /tickets/i })
    await expect(ticketsLink).toBeVisible({ timeout: 10000 })

    await ticketsLink.click()
    await page.waitForURL('**/admin/tickets**')
    await expect(page).toHaveURL(/\/admin\/tickets/)
  })

  test('can create a new ticket', async ({ page }) => {
    await page.goto('/admin/tickets/new')
    await page.waitForLoadState('networkidle')

    ticketSubject = `E2E Ticket ${uniqueId}`

    // Fill the subject field
    const subjectInput = page.locator('#subject')
    await expect(subjectInput).toBeVisible({ timeout: 10000 })
    await subjectInput.fill(ticketSubject)

    // Fill the description (TipTap rich text editor)
    const editor = page.locator('.tiptap').first()
    await editor.click()
    await page.keyboard.type('This is an automated E2E test ticket description.')

    // Submit the form
    await page.getByRole('button', { name: /create/i }).click()

    // Should navigate to the ticket detail page
    await page.waitForURL('**/admin/tickets/ticket_**', { timeout: 15000 })
    await expect(page).toHaveURL(/\/admin\/tickets\/ticket_/)
  })

  test('can view ticket detail', async ({ page }) => {
    // Navigate to tickets list
    await page.goto('/admin/tickets')
    await page.waitForLoadState('networkidle')

    // Find and click our ticket in the queue
    const ticketRow = page.getByText(ticketSubject)
    await expect(ticketRow).toBeVisible({ timeout: 10000 })
    await ticketRow.click()

    // Should navigate to detail page
    await page.waitForURL('**/admin/tickets/ticket_**')

    // Verify subject is visible in the properties panel
    await expect(page.getByText(ticketSubject)).toBeVisible()

    // Verify the properties panel renders key sections
    await expect(page.getByText('Status')).toBeVisible()
    await expect(page.getByText('Priority')).toBeVisible()
  })

  test('can add a public reply', async ({ page }) => {
    // Navigate to tickets list then open our ticket
    await page.goto('/admin/tickets')
    await page.waitForLoadState('networkidle')
    await page.getByText(ticketSubject).click()
    await page.waitForURL('**/admin/tickets/ticket_**')

    // Find the thread composer (placeholder "Reply to customer…")
    const composer = page.locator('.tiptap').last()
    await expect(composer).toBeVisible({ timeout: 10000 })
    await composer.click()
    await page.keyboard.type('This is a public reply from E2E test.')

    // Click Post button
    await page.getByRole('button', { name: /post/i }).click()

    // The reply should appear in the thread timeline
    await expect(page.getByText('This is a public reply from E2E test.')).toBeVisible({
      timeout: 10000,
    })
  })

  test('can change ticket status', async ({ page }) => {
    await page.goto('/admin/tickets')
    await page.waitForLoadState('networkidle')
    await page.getByText(ticketSubject).click()
    await page.waitForURL('**/admin/tickets/ticket_**')

    // Find Status section and its picker button
    const statusSection = page.locator('text=Status').locator('..')
    const statusButton = statusSection.locator('button').first()
    await expect(statusButton).toBeVisible({ timeout: 10000 })
    await statusButton.click()

    // Select "Solved" from the dropdown
    const solvedOption = page.getByRole('option', { name: /solved/i }).or(page.getByText('Solved'))
    await solvedOption.first().click()

    // Wait for the mutation to complete
    await page.waitForLoadState('networkidle')

    // Verify the status changed (status badge should show "Solved")
    await expect(page.getByText('Solved').first()).toBeVisible({ timeout: 10000 })
  })

  test('can change ticket priority', async ({ page }) => {
    await page.goto('/admin/tickets')
    await page.waitForLoadState('networkidle')
    await page.getByText(ticketSubject).click()
    await page.waitForURL('**/admin/tickets/ticket_**')

    // Find Priority section and its picker
    const prioritySection = page.locator('text=Priority').locator('..')
    const priorityButton = prioritySection.locator('button').first()
    await expect(priorityButton).toBeVisible({ timeout: 10000 })
    await priorityButton.click()

    // Select "High" from the dropdown
    const highOption = page.getByRole('option', { name: /high/i }).or(page.getByText('high'))
    await highOption.first().click()

    await page.waitForLoadState('networkidle')

    // Verify priority changed
    await expect(page.getByText(/high/i).first()).toBeVisible({ timeout: 10000 })
  })

  test('can edit ticket subject', async ({ page }) => {
    await page.goto('/admin/tickets')
    await page.waitForLoadState('networkidle')
    await page.getByText(ticketSubject).click()
    await page.waitForURL('**/admin/tickets/ticket_**')

    // Find the Subject section in properties panel and click it to start editing
    const subjectSection = page.locator('text=Subject').locator('..')
    await subjectSection.click()

    // The input should appear
    const subjectInput = subjectSection.locator('input')
    await expect(subjectInput).toBeVisible({ timeout: 5000 })

    // Clear and type new subject
    const newSubject = `Updated E2E Ticket ${uniqueId}`
    await subjectInput.clear()
    await subjectInput.fill(newSubject)
    await subjectInput.press('Enter')

    // Wait for save
    await page.waitForLoadState('networkidle')

    // Verify subject updated (it should appear in the header)
    await expect(page.getByText(newSubject).first()).toBeVisible({ timeout: 10000 })

    // Update for subsequent tests
    ticketSubject = newSubject
  })
})
