import { Page, expect } from '@playwright/test'

/**
 * Wait for a toast notification with specific text
 */
export async function waitForToast(page: Page, text: string | RegExp) {
  const toast = page.locator('[data-sonner-toast]').filter({ hasText: text })
  await expect(toast).toBeVisible({ timeout: 5000 })
  return toast
}

/**
 * Wait for toast to disappear
 */
export async function waitForToastToDisappear(page: Page) {
  await expect(page.locator('[data-sonner-toast]')).toBeHidden({ timeout: 10000 })
}

/**
 * Select an item from a shadcn/radix Select component
 */
export async function selectOption(page: Page, triggerLabel: string, optionText: string) {
  // Click the select trigger
  await page.getByRole('combobox', { name: triggerLabel }).click()

  // Wait for dropdown and select option
  await page.getByRole('option', { name: optionText }).click()
}

/**
 * Select an item from a shadcn/radix Combobox (searchable select)
 */
export async function selectComboboxItem(
  page: Page,
  placeholder: string,
  searchText: string,
  optionText?: string
) {
  // Click the combobox trigger
  await page.getByRole('combobox').filter({ hasText: placeholder }).click()

  // Type to search
  await page.getByRole('combobox').filter({ hasText: placeholder }).fill(searchText)

  // Select the option (defaults to searchText if optionText not provided)
  await page.getByRole('option', { name: optionText || searchText }).click()
}

/**
 * Fill a TipTap rich text editor
 */
export async function fillRichTextEditor(page: Page, content: string) {
  // TipTap editor has contenteditable div with ProseMirror class
  const editor = page.locator('.ProseMirror[contenteditable="true"]')
  await editor.click()
  await editor.fill(content)
}

/**
 * Get the value from a TipTap editor
 */
export async function getRichTextContent(page: Page): Promise<string> {
  const editor = page.locator('.ProseMirror[contenteditable="true"]')
  return editor.textContent() || ''
}

/**
 * Wait for navigation to complete
 */
export async function waitForNavigation(page: Page, urlPattern: string | RegExp) {
  await expect(page).toHaveURL(urlPattern, { timeout: 10000 })
}

/**
 * Click a button and wait for response
 */
export async function clickAndWaitForResponse(
  page: Page,
  buttonSelector: string | { name: string | RegExp },
  urlPattern: string | RegExp
) {
  const [response] = await Promise.all([
    page.waitForResponse((resp) =>
      typeof urlPattern === 'string' ? resp.url().includes(urlPattern) : urlPattern.test(resp.url())
    ),
    typeof buttonSelector === 'string'
      ? page.click(buttonSelector)
      : page.getByRole('button', buttonSelector).click(),
  ])
  return response
}

/**
 * Open a dialog by clicking a trigger button
 */
export async function openDialog(page: Page, triggerText: string | RegExp) {
  await page.getByRole('button', { name: triggerText }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
}

/**
 * Close a dialog
 */
export async function closeDialog(page: Page) {
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeHidden()
}

/**
 * Scroll to load more items (for infinite scroll)
 */
export async function scrollToLoadMore(page: Page, containerSelector: string) {
  const container = page.locator(containerSelector)
  await container.evaluate((el) => {
    el.scrollTop = el.scrollHeight
  })
  // Wait a bit for new items to load
  await page.waitForTimeout(500)
}
