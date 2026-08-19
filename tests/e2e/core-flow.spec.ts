import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => window.localStorage.clear())
})

test('loads the production artifact with privacy headers and no external requests', async ({
  page,
}) => {
  const externalRequests: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.origin !== 'http://127.0.0.1:4399') externalRequests.push(request.url())
  })

  const response = await page.goto('/')
  await expect(page).toHaveTitle('记忆清理台')
  await expect(page.getByRole('heading', { name: '检查报告' })).toBeVisible()
  await expect(page.getByRole('button', { name: '导入记忆' })).toBeEnabled()
  expect(response?.headers()['content-security-policy']).toContain("connect-src 'none'")
  expect(response?.headers()['x-content-type-options']).toBe('nosniff')
  await page.waitForLoadState('networkidle')
  expect(externalRequests).toEqual([])

  const accessibility = await new AxeBuilder({ page }).analyze()
  expect(accessibility.violations, 'axe found accessibility violations').toEqual([])
})

test('imports locally, redacts plaintext, persists safely, and exports a safe package', async ({
  page,
}) => {
  const plaintext = 'super-secret-password-1234'
  await page.goto('/')
  await page.getByRole('button', { name: '导入记忆' }).click()
  const dialog = page.getByRole('dialog', { name: '导入记忆快照' })
  await dialog
    .getByPlaceholder('粘贴可见的记忆摘要、规则或聊天摘要…')
    .fill(`虚构测试密码: ${plaintext}\n\n- 回答保持简洁`)
  await dialog.getByRole('button', { name: '检查粘贴内容' }).click()

  await expect(page.getByText('2 条规范化记录 · 1 个待核查问题')).toBeVisible()
  await expect(page.locator('body')).not.toContainText(plaintext)
  await expect(page.getByText('[已脱敏]', { exact: false })).toBeVisible()
  await page.reload()
  await expect(page.locator('body')).not.toContainText(plaintext)

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出脱敏包' }).click()
  const download = await downloadPromise
  const downloadedPath = await download.path()
  expect(downloadedPath).not.toBeNull()
  const exported = JSON.parse(await readFile(downloadedPath!, 'utf8')) as {
    items: unknown[]
    warnings: string[]
  }
  expect(exported.items).toHaveLength(1)
  expect(exported.warnings.join(' ')).toContain('排除了 1 条')
  expect(JSON.stringify(exported)).not.toContain(plaintext)
})

test('clears all local application data and does not reseed it after reload', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('0 条规范化记录 · 0 个待核查问题')).toBeVisible()
  await page.getByRole('button', { name: '导入记忆' }).click()
  const dialog = page.getByRole('dialog', { name: '导入记忆快照' })
  await dialog.getByPlaceholder('粘贴可见的记忆摘要、规则或聊天摘要…').fill('虚构用户偏好简洁回答')
  await dialog.getByRole('button', { name: '检查粘贴内容' }).click()
  await expect(page.getByText('1 条规范化记录 · 0 个待核查问题')).toBeVisible()

  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: '清除全部本地数据' }).click()
  await expect(page.getByText('0 条规范化记录 · 0 个待核查问题')).toBeVisible()
  await page.reload()
  await expect(page.getByText('0 条规范化记录 · 0 个待核查问题')).toBeVisible()
  await expect(page.getByText('1 条规范化记录', { exact: false })).toHaveCount(0)
})
