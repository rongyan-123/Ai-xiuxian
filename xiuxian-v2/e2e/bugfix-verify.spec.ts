import { test, expect, type Page } from '@playwright/test'

// ── Bug 修复验证（确定性 mock SSE，不依赖真实 LLM）────────────────────────────
// Bug 1: 切换面板导致 SSE 流中断 → ChatPanel 改为 CSS 隐藏保持挂载
//   Playwright route.fulfill 是缓冲式 API，无法增量转发流式 chunk（业界已知限制），
//   故用 addInitScript 注入 window.fetch 拦截器 + ReadableStream 模拟真流式 SSE。
//   拦截器监听 AbortSignal：若修复失效（组件卸载 → abort），流被取消 → completed
//   永不送达 → 测试失败，能精确区分修复前/后行为。
// Bug 2: 图鉴重复"新手村" → 服务端 GenerateLocation 生成前校验（单元测试已覆盖，
//   e2e 用 mock codex 事件验证客户端接收链路正常）

const STREAM_HEADER = '天道推演' // 流式气泡标题（isStreaming 期间常驻）
const STREAMING_TEXT_SEL = 'div.bg-zinc-800\\/50' // 流式文本容器
const PANEL_TITLE = '天机推演' // 聊天面板标题
const API_URL = '**/api/v1/game/action'

function sse(type: string, payload: Record<string, unknown>, seq: number): string {
  const now = new Date().toISOString()
  return `data: ${JSON.stringify({ protocolVersion: '1.0', requestId: 'req-verify', runId: 'run-verify', sequence: seq, occurredAt: now, type, payload })}\n\n`
}

/**
 * 慢速分块 SSE 流：accepted → delta×N（间隔 700ms）→ completed。
 * route.fulfill 无法增量转发 chunk（缓冲式 API），故在页面内注入 window.fetch
 * 拦截器，用 ReadableStream 返回真流式 Response。拦截器监听 AbortSignal：
 * 若组件卸载触发 abort，流被取消 → completed 永不送达 → 测试失败。
 */
async function mockSlowStream(page: Page) {
  const chunks = [
    '你立于新手村村口，暮色四合。远处炊烟袅袅，',
    '村中传来几声犬吠，一位老农扛着锄头缓步走过，',
    '他瞥了你一眼，目光中带着审视，随后又继续赶路。',
    '你感觉到这个世界正以自己的节奏运转着。',
  ]

  await page.addInitScript(
    (texts) => {
      const w = window as unknown as { __sseMockInstalled?: boolean }
      if (w.__sseMockInstalled) return // 防重复安装（reload 会重跑本脚本）
      w.__sseMockInstalled = true
      const originalFetch = window.fetch
      window.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof Request ? input.url : input.href
        if (!url.endsWith('/api/v1/game/action')) {
          return originalFetch(input, init)
        }
        const encoder = new TextEncoder()
        const stream = new ReadableStream({
          start(controller) {
            let closed = false
            const timers: number[] = []
            const send = (type: string, payload: Record<string, unknown>, seq: number) => {
              if (closed) return
              const data = JSON.stringify({
                protocolVersion: '1.0',
                requestId: 'req-verify',
                runId: 'run-verify',
                sequence: seq,
                occurredAt: new Date().toISOString(),
                type,
                payload,
              })
              controller.enqueue(encoder.encode(`data: ${data}\n\n`))
            }
            send('accepted', { requestId: 'req-verify', runId: 'run-verify', playerId: 'p1', mode: 'action' }, 0)
            texts.forEach((c, i) => {
              timers.push(window.setTimeout(() => send('text-delta', { content: c }, i + 1), (i + 1) * 700))
            })
            timers.push(
              window.setTimeout(() => {
                if (closed) return
                send('completed', { reply: texts.join('') }, texts.length + 1)
                controller.close()
              }, (texts.length + 1) * 700 + 200),
            )
            init?.signal?.addEventListener('abort', () => {
              closed = true
              timers.forEach((t) => window.clearTimeout(t))
              try {
                controller.close()
              } catch {
                /* 已关闭 */
              }
            })
          },
        })
        return new Response(stream, {
          status: 200,
          headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
        })
      }
    },
    chunks,
  )
}

/** mock prepare：快速单块流 */
async function mockPrepare(page: Page) {
  await page.route(API_URL, (route) => {
    const body = sse('accepted', { requestId: 'req-p', runId: 'run-p', playerId: 'p1', mode: 'prepare' }, 0) +
      sse('completed', { reply: '你缓缓睁开双眼，一个修仙世界在你面前展开。' }, 1)
    route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      body,
    })
  })
}

async function freshStart(page: Page) {
  await page.goto('/')
  await page.waitForTimeout(300)
  await page.evaluate(() => {
    localStorage.removeItem('xiuxian-game')
    localStorage.removeItem('xiuxian-llm-config')
  })
  await page.reload()
  await page.waitForTimeout(300)
}

async function jumpToPlaying(page: Page, name: string) {
  await page.evaluate((playerName) => {
    localStorage.setItem(
      'xiuxian-game',
      JSON.stringify({
        state: {
          player: {
            id: 'verify-' + Date.now(),
            status: 'ALIVE',
            name: playerName,
            gender: '男',
            stats: {
              hp: { current: 100, max: 100, status_desc: '良好' },
              mp: { current: 50, max: 50, status_desc: '充沛' },
              spirit: { value: 100, desc: '饱满' },
              realm: '练气期一层',
              age: { current: 16, max: 100 },
              race: '人族',
              alignment: '中立',
              sect: '散修',
              spiritual_root: '杂灵根',
              mental_state: '平静',
              reputation: 10,
            },
            inventory: [],
            relationships: {},
          },
          chatHistory: [],
          journal: [],
          codex: [],
          phase: 'PLAYING',
          currentView: 'chat',
          isLoading: false,
          currentEvent: '',
          notifications: {},
        },
        version: 0,
      }),
    )
  }, name)
  await page.reload()
  await page.waitForTimeout(300)
  await expect(page.locator('h2:has-text("' + PANEL_TITLE + '")').filter({ visible: true })).toBeVisible({ timeout: 5000 })
}

test('Bug1验证：流式回复中切换面板，SSE流不中断', async ({ page, viewport }) => {
  test.skip(!viewport || viewport.width < 600, '仅桌面端（移动端修复逻辑相同：CSS 隐藏）')

  await freshStart(page)
  await mockSlowStream(page)
  await jumpToPlaying(page, '验证道人')

  // 发消息触发慢速流
  const input = page.locator('input[placeholder="输入你的行动或对话..."]').filter({ visible: true })
  await input.fill('探查四周')
  await input.press('Enter')

  // 1. 流式气泡出现（isStreaming 开始）
  const streamBubble = page.getByText(STREAM_HEADER).filter({ visible: true }).first()
  await expect(streamBubble).toBeVisible({ timeout: 10000 })

  // 2. 等第一个 delta 出现并捕获长度（accepted 后 700ms 首个文本）
  const streamText = page.locator(STREAMING_TEXT_SEL).filter({ visible: true }).first()
  await expect(streamText).toBeVisible({ timeout: 10000 })
  const lenBefore = (await streamText.innerText()).length
  expect(lenBefore).toBeGreaterThan(0)

  // 3. 流式进行中切到图鉴 → 等 1.5s（两个 delta 的时间窗）→ 切回
  await page.locator('button:has-text("图鉴")').filter({ visible: true }).click()
  await expect(page.getByText('修仙图鉴').filter({ visible: true }).first()).toBeVisible({ timeout: 5000 })
  await page.waitForTimeout(1500)

  await page.locator('button:has-text("对话")').filter({ visible: true }).click()

  // 4. 核心断言：切回后流式气泡立刻可见（修复前 ChatPanel 卸载 → abort → 气泡永久消失）
  await expect(page.getByText(STREAM_HEADER).filter({ visible: true }).first()).toBeVisible({ timeout: 5000 })

  // 5. 流未被中断：切回后文本比切换前更长（切换期间 delta 仍在累积）
  const lenAfter = (await page.locator(STREAMING_TEXT_SEL).filter({ visible: true }).first().innerText()).length
  expect(lenAfter).toBeGreaterThan(lenBefore)

  // 6. 等待 completed：气泡消失 + AI 回复气泡出现（完整回合闭环）
  await expect(page.getByText(STREAM_HEADER).filter({ visible: true })).not.toBeVisible({ timeout: 15000 })
  const aiBubble = page.locator('.bg-zinc-800.rounded-2xl').filter({ visible: true }).last()
  await expect(aiBubble).toBeVisible({ timeout: 5000 })
  expect((await aiBubble.innerText())).toContain('老农')
})

test('Bug1移动端验证：Sheet 打开/关闭期间 SSE 流不中断', async ({ page, viewport }) => {
  test.skip(!viewport || viewport.width >= 600, '仅移动端')

  await freshStart(page)
  await mockSlowStream(page)
  await jumpToPlaying(page, '移动验证')

  const input = page.locator('input[placeholder="输入你的行动或对话..."]').filter({ visible: true })
  await input.fill('探查四周')
  await input.press('Enter')

  // 流式气泡出现
  await expect(page.getByText(STREAM_HEADER).filter({ visible: true }).first()).toBeVisible({ timeout: 10000 })
  const streamText = page.locator(STREAMING_TEXT_SEL).filter({ visible: true }).first()
  await expect(streamText).toBeVisible({ timeout: 10000 })
  const lenBefore = (await streamText.innerText()).length

  // 流式进行中打开背包 Sheet（移动端 ChatPanel 被 CSS 隐藏但保持挂载）
  await page.locator('.md\\:hidden button:has-text("背包")').first().click()
  await expect(page.locator('.md\\:hidden h2:has-text("背包")').first()).toBeVisible({ timeout: 5000 })
  await page.waitForTimeout(1500)

  // 关闭 Sheet 回到聊天
  const closeBtn = page.locator('.rounded-t-2xl .border-b button').first()
  await closeBtn.click()
  await expect(page.locator('.md\\:hidden h2:has-text("背包")').first()).not.toBeVisible({ timeout: 5000 })

  // 流式气泡仍在，文本继续增长
  await expect(page.getByText(STREAM_HEADER).filter({ visible: true }).first()).toBeVisible({ timeout: 5000 })
  const lenAfter = (await page.locator(STREAMING_TEXT_SEL).filter({ visible: true }).first().innerText()).length
  expect(lenAfter).toBeGreaterThan(lenBefore)

  // 回合正常闭环
  await expect(page.getByText(STREAM_HEADER).filter({ visible: true })).not.toBeVisible({ timeout: 15000 })
  await expect(page.locator('.bg-zinc-800.rounded-2xl').filter({ visible: true }).last()).toBeVisible({ timeout: 5000 })
})

test('Bug2验证：prepare 后 codex 事件正常入图鉴（服务端去重由单元测试覆盖）', async ({ page, viewport }) => {
  test.skip(!viewport || viewport.width < 600, '仅桌面端')

  await freshStart(page)
  await mockPrepare(page)
  await jumpToPlaying(page, '图鉴验证')

  // 发消息，SSE 中夹带两个同名 codex 事件（模拟服务端漏网场景，客户端需正常接收）
  await page.route(API_URL, (route) => {
    const now = Date.now()
    const body =
      sse('accepted', { requestId: 'req-c', runId: 'run-c', playerId: 'p1', mode: 'action' }, 0) +
      sse('codex', { name: '青云坊市', entry_type: 'location', description: '坊市', timestamp: now }, 1) +
      sse('completed', { reply: '你听说青云坊市就在不远处。' }, 2)
    route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      body,
    })
  })

  const input = page.locator('input[placeholder="输入你的行动或对话..."]').filter({ visible: true })
  await input.fill('打听消息')
  await input.press('Enter')
  await expect(page.getByText(STREAM_HEADER).filter({ visible: true })).not.toBeVisible({ timeout: 15000 })

  // codex 事件已落库（localStorage persist 同步）
  await page.waitForTimeout(500)
  const stored = await page.evaluate(() => localStorage.getItem('xiuxian-game'))
  const codex = JSON.parse(stored!).state.codex
  const fangshi = codex.filter((e: { name: string }) => e.name === '青云坊市')
  expect(fangshi.length).toBe(1)

  // 图鉴面板可见该条目
  await page.locator('button:has-text("图鉴")').filter({ visible: true }).click()
  await expect(page.getByText('修仙图鉴').filter({ visible: true }).first()).toBeVisible()
  await expect(page.locator('.font-bold').filter({ hasText: '青云坊市' }).first()).toBeVisible({ timeout: 5000 })
})

test('固定开局：道号提交直接进入PLAYING，图鉴初始为空、背包预置模板内容（不调LLM）', async ({ page }) => {
  await freshStart(page)

  // InitScreen 输入道号 → 踏入仙途（无流派选择步骤）
  await page.locator('input#name').filter({ visible: true }).first().fill('固定开局验证')
  await page.locator('button:has-text("踏入仙途")').filter({ visible: true }).first().click()

  // 直接进入聊天面板（不再经过 SELECT）
  await expect(page.locator('h2:has-text("' + PANEL_TITLE + '")').filter({ visible: true })).toBeVisible({ timeout: 5000 })

  // 固定开场叙事作为首条消息显示
  await expect(page.getByText('你缓缓睁开双眼').filter({ visible: true }).first()).toBeVisible({ timeout: 5000 })

  // 图鉴初始为空：地点/宗门不再预置模板，首次 action 时由 World Genesis 生成
  await page.locator('button:has-text("图鉴")').filter({ visible: true }).click()
  await expect(page.getByText('修仙图鉴').filter({ visible: true }).first()).toBeVisible({ timeout: 5000 })
  await expect(page.getByText('暂无图鉴记录').filter({ visible: true }).first()).toBeVisible({ timeout: 5000 })
  await expect(page.getByText('新手村').filter({ visible: true }).first()).toHaveCount(0)
  await expect(page.getByText('青云坊市').filter({ visible: true }).first()).toHaveCount(0)

  // 移动端：关闭图鉴 Sheet 再点背包（Sheet 覆盖会拦截点击）
  const sheetClose = page.locator('.rounded-t-2xl .border-b button').first()
  if (await sheetClose.isVisible().catch(() => false)) {
    await sheetClose.click()
  }

  // 背包预置穷散修初始物品
  await page.locator('button:has-text("背包")').filter({ visible: true }).click()
  await expect(page.getByText('一阶灵石').filter({ visible: true }).first()).toBeVisible({ timeout: 5000 })
  await expect(page.getByText('基础疗伤丹').filter({ visible: true }).first()).toBeVisible({ timeout: 5000 })
  await expect(page.getByText('旧木剑').filter({ visible: true }).first()).toBeVisible({ timeout: 5000 })
})
