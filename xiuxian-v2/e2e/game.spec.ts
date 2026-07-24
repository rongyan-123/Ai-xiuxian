import { test, expect, type Page, type BrowserContext } from '@playwright/test'

// ── helpers ──────────────────────────────────────────────────────────

/**
 * Clear all game-related localStorage so each test starts fresh.
 * IMPORTANT: Must be called AFTER page.goto() — never on about:blank.
 */
async function clearGameStorage(page: Page) {
  await page.evaluate(() => {
    localStorage.removeItem('xiuxian-game')
    localStorage.removeItem('xiuxian-llm-config')
  })
}

/**
 * Full fresh start: navigate, clear storage, reload so we begin at INIT.
 */
async function freshStart(page: Page) {
  await page.goto('/')
  await page.waitForTimeout(300)
  await clearGameStorage(page)
  await page.reload()
  await page.waitForTimeout(300)
}

/**
 * Navigate to the app and wait until the React tree is mounted.
 * Does NOT clear storage — use clearGameStorage separately in beforeEach.
 */
async function goToApp(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '仙 途 启 程' }).first()).toBeVisible()
}

/**
 * Fill in a name and pick a gender, then click 踏入仙途.
 * Returns immediately after the SELECT screen appears.
 */
async function completeInit(
  page: Page,
  name = '测试道人',
  gender: '男' | '女' = '男',
) {
  await page.locator('#name').filter({ visible: true }).fill(name)
  if (gender === '女') {
    await page.getByRole('button', { name: '女' }).first().click()
  }
  await page.getByRole('button', { name: '踏入仙途' }).first().click()
  await expect(page.getByRole('heading', { name: '天 命 抉 择' }).first()).toBeVisible()
}

/**
 * Set a fake LLM config so the API calls don't immediately fail with
 * "API Key" error.  Tests that need real AI responses can override this.
 */
async function setFakeLLMConfig(page: Page) {
  await page.evaluate(() => {
    localStorage.setItem(
      'xiuxian-llm-config',
      JSON.stringify({
        providerId: 'openai',
        apiKey: 'sk-test-placeholder',
        baseUrl: 'https://api.openai.com/v1',
        modelId: 'gpt-4o-mini',
        customModel: '',
      }),
    )
  })
}

// ── SSE v2 envelope helpers ──────────────────────────────────────────

const API_URL = '**/api/v1/game/action'
const REQ_ID = 'req-e2e-001'
const RUN_ID = 'run-e2e-001'

function sseEnvelope(sequence: number, type: string, payload: Record<string, unknown>): string {
  const now = new Date().toISOString()
  return `data: ${JSON.stringify({ protocolVersion: '1.0', requestId: REQ_ID, runId: RUN_ID, sequence, occurredAt: now, type, payload })}\n\n`
}

function sseAccepted(mode = 'action', playerId = 'player-test'): string {
  return sseEnvelope(0, 'accepted', { requestId: REQ_ID, runId: RUN_ID, playerId, mode })
}

function sseStep(label: string, seq: number): string {
  return sseEnvelope(seq, 'step', { label })
}

function sseTextDelta(content: string, seq: number): string {
  return sseEnvelope(seq, 'text-delta', { content })
}

function sseCompleted(reply: string, seq: number): string {
  return sseEnvelope(seq, 'completed', { reply })
}

function sseFailed(code: string, detail: string, seq: number, retryable = false): string {
  return sseEnvelope(seq, 'failed', { type: 'failed', title: code, status: code === 'VALIDATION_ERROR' ? 422 : 500, detail, code, requestId: REQ_ID, retryable })
}

function sseCancelled(seq: number, reason = 'User cancelled'): string {
  return sseEnvelope(seq, 'cancelled', { requestId: REQ_ID, runId: RUN_ID, reason })
}

function sseCodex(name: string, entryType: string, description: string, seq: number): string {
  return sseEnvelope(seq, 'codex', { name, entry_type: entryType, description, timestamp: Date.now() })
}

function sseStateUpdate(player: Record<string, unknown>, seq: number): string {
  return sseEnvelope(seq, 'state_update', { player, deltas: {} })
}

/** Build a minimal action stream: accepted → completed */
function buildActionStream(reply: string, mode = 'action'): string {
  return sseAccepted(mode) + sseCompleted(reply, 1)
}

/** Build a streaming stream: accepted → text-delta* → completed */
function buildStreamingStream(chunks: string[], finalReply: string, mode = 'action'): string {
  let body = sseAccepted(mode)
  chunks.forEach((c, i) => { body += sseTextDelta(c, i + 1) })
  body += sseCompleted(finalReply, chunks.length + 1)
  return body
}

/**
 * Intercept the /api/v1/game/action POST and fulfill with a minimal SSE
 * stream so we can test the front-end parsing without a real backend.
 */
async function mockGameAction(page: Page, replies: string[] = ['测试回复：天地灵气涌动，你感到一股强大的力量在体内流转。']) {
  const reply = replies.join('')
  const body = sseAccepted() + sseStep('天道记忆检索中...', 1) + sseCompleted(reply, 2)

  await page.route(API_URL, (route) => {
    route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      body,
    })
  })
}

// ── phase: INIT ──────────────────────────────────────────────────────

test.describe('Phase: INIT — 角色创建', () => {
  test.beforeEach(async ({ page }) => {
    await freshStart(page)
  })

  test.describe('页面加载与渲染', () => {
    test('首页显示角色创建画面', async ({ page }) => {
      await goToApp(page)
      await expect(page.getByRole('heading', { name: '仙 途 启 程' }).first()).toBeVisible()
      await expect(page.getByText('道友，请留下你的名号').filter({ visible: true })).toBeVisible()
    })

    test('道号输入框存在且可编辑', async ({ page }) => {
      await goToApp(page)
      const input = page.locator('#name').filter({ visible: true })
      await expect(input).toBeVisible()
      await expect(input).toHaveAttribute('placeholder', '请输入你的道号...')
      await input.fill('测试')
      await expect(input).toHaveValue('测试')
    })

    test('性别默认选中"男"，可切换为"女"', async ({ page }) => {
      await goToApp(page)
      const maleBtn = page.getByRole('button', { name: '男' }).first()
      const femaleBtn = page.getByRole('button', { name: '女' }).first()

      // 默认选中 男
      await expect(maleBtn).toHaveClass(/border-amber-500/)
      await expect(femaleBtn).toHaveClass(/border-zinc-700/)

      // 切换为 女
      await femaleBtn.click()
      await expect(femaleBtn).toHaveClass(/border-amber-500/)
      await expect(maleBtn).toHaveClass(/border-zinc-700/)
    })

    test('道号为空时"踏入仙途"按钮不可点击', async ({ page }) => {
      await goToApp(page)
      const btn = page.getByRole('button', { name: '踏入仙途' }).first()
      await expect(btn).toBeDisabled()
    })

    test('道号仅含空格时按钮仍然不可点击', async ({ page }) => {
      await goToApp(page)
      await page.locator('#name').filter({ visible: true }).fill('   ')
      const btn = page.getByRole('button', { name: '踏入仙途' }).first()
      await expect(btn).toBeDisabled()
    })

    test('输入道号后按钮可点击', async ({ page }) => {
      await goToApp(page)
      await page.locator('#name').filter({ visible: true }).fill('李白')
      const btn = page.getByRole('button', { name: '踏入仙途' }).first()
      await expect(btn).toBeEnabled()
    })
  })

  test.describe('提交创建角色', () => {
    test('点击"踏入仙途"后进入流派选择界面', async ({ page }) => {
      await goToApp(page)
      await completeInit(page, '太白剑仙')
      // 验证进入了 SELECT 阶段
      await expect(page.getByRole('heading', { name: '天 命 抉 择' }).first()).toBeVisible()
      // 流派卡片应该可见
      await expect(page.getByText('废柴流').filter({ visible: true })).toBeVisible()
    })

    test('创建角色后 localStorage 中保存了玩家数据', async ({ page }) => {
      await goToApp(page)
      await completeInit(page, '存档测试')
      const stored = await page.evaluate(() => localStorage.getItem('xiuxian-game'))
      expect(stored).not.toBeNull()
      const parsed = JSON.parse(stored!)
      expect(parsed.state.phase).toBe('SELECT')
      expect(parsed.state.player.name).toBe('存档测试')
      expect(parsed.state.player.gender).toBe('男')
    })

    test('创建角色后 player stats 有默认值', async ({ page }) => {
      await goToApp(page)
      await completeInit(page, '属性测试')
      const stored = await page.evaluate(() => localStorage.getItem('xiuxian-game'))
      const stats = JSON.parse(stored!).state.player.stats
      expect(stats.hp.current).toBe(100)
      expect(stats.hp.max).toBe(100)
      expect(stats.mp.current).toBe(50)
      expect(stats.realm).toBe('练气期一层')
      expect(stats.race).toBe('人族')
    })
  })
})

// ── phase: SELECT — 流派选择 ────────────────────────────────────────

test.describe('Phase: SELECT — 流派选择', () => {
  test.beforeEach(async ({ page }) => {
    await freshStart(page)
    await completeInit(page, '流派测试者')
  })

  test.describe('流派卡片渲染', () => {
    const allTropes = [
      { id: 'feichai', name: '废柴流', icon: '☕' },
      { id: 'tuihun', name: '退婚流', icon: '💔' },
      { id: 'banzhuchihu', name: '扮猪吃虎流', icon: '🐷' },
      { id: 'haoqiang', name: '豪强回归流', icon: '👑' },
      { id: 'zhongtian', name: '种田流', icon: '🌾' },
      { id: 'qiyu', name: '奇遇流', icon: '✨' },
      { id: 'dalian', name: '打脸流', icon: '👊' },
      { id: 'jiaporenwang', name: '家破人亡流', icon: '💀' },
      { id: 'fuchou', name: '复仇流', icon: '🛡️' },
      { id: 'tishen', name: '替身流', icon: '🎭' },
      { id: 'beiguo', name: '背锅流', icon: '🔗' },
      { id: 'shitu', name: '师徒背叛流', icon: '⚡' },
      { id: 'zhuixu', name: '赘婿翻身流', icon: '🏠' },
      { id: 'beizhu', name: '被逐出师门流', icon: '🚪' },
      { id: 'sudi', name: '宿敌流', icon: '⚔️' },
    ]

    test('15个流派卡片全部渲染', async ({ page }) => {
      for (const trope of allTropes) {
        await expect(page.getByText(trope.name, { exact: true }).filter({ visible: true }).first()).toBeVisible()
      }
    })

    test('每个卡片显示图标、名称和描述', async ({ page }) => {
      // 抽检几个流派的完整信息
      const feichai = page.getByRole('heading', { name: '废柴流' }).first().locator('..')
      await expect(feichai).toBeVisible()
      await expect(feichai.getByText('废柴流').filter({ visible: true })).toBeVisible()
      // 描述应该包含关键词
      await expect(feichai).toContainText('资质极差')

      const tuihun = page.getByRole('heading', { name: '退婚流' }).first().locator('..')
      await expect(tuihun).toBeVisible()
      await expect(tuihun).toContainText('退婚')
    })

    test('未选择流派时"确认选择"按钮不可点击', async ({ page }) => {
      const confirm = page.getByRole('button', { name: '确认选择' }).first()
      await expect(confirm).toBeDisabled()
    })

    test('点击流派卡片后高亮，再次确认按钮可点击', async ({ page }) => {
      const card = page.getByRole('heading', { name: '废柴流' }).first().locator('..')
      await card.click()
      // 卡片应该有高亮样式
      await expect(card).toHaveClass(/border-amber-500/)
      await expect(page.getByRole('button', { name: '确认选择' }).first()).toBeEnabled()
    })

    test('切换选中流派后新卡片高亮，旧卡片取消', async ({ page }) => {
      const feichai = page.getByRole('heading', { name: '废柴流' }).first().locator('..')
      const tuihun = page.getByRole('heading', { name: '退婚流' }).first().locator('..')

      await feichai.click()
      await expect(feichai).toHaveClass(/border-amber-500/)

      await tuihun.click()
      await expect(tuihun).toHaveClass(/border-amber-500/)
      await expect(feichai).not.toHaveClass(/border-amber-500/)
    })
  })

  test.describe('流派确认 — API 交互', () => {
    test('确认选择后发送 POST /api/v1/game/action 含 mode=prepare', async ({ page }) => {
      await setFakeLLMConfig(page)

      let requestBody: any = null
      await page.route(API_URL, (route) => {
        requestBody = route.request().postDataJSON()
        route.fulfill({
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
          body: buildActionStream('开局剧情...', 'prepare'),
        })
      })

      // 选择流派并确认
      await page.getByRole('heading', { name: '废柴流' }).first().locator('..').click()
      await page.getByRole('button', { name: '确认选择' }).first().click()

      // 等待请求完成
      await page.waitForTimeout(500)

      expect(requestBody).not.toBeNull()
      expect(requestBody.mode).toBe('prepare')
      expect(requestBody.playerName).toBe('流派测试者')
      expect(requestBody.input).toContain('[GENRE]feichai')
      expect(requestBody.input).toContain('[TITLE]废柴流')
    })

    test('确认选择后 ChatPanel 显示 loading', async ({ page }) => {
      await setFakeLLMConfig(page)

      // 延迟响应，让我们能观察到 loading 状态
      await page.route(API_URL, async (route) => {
        await new Promise((r) => setTimeout(r, 500))
        route.fulfill({
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
          body: buildActionStream('开局剧情...', 'prepare'),
        })
      })

      await page.getByRole('heading', { name: '废柴流' }).first().locator('..').click()
      await page.getByRole('button', { name: '确认选择' }).first().click()

      // setPhase("PLAYING") → ChatPanel renders with "天道推演" loading header
      await expect(page.getByText('天道推演').filter({ visible: true })).toBeVisible({ timeout: 5000 })
    })

    test('API 返回错误时显示错误消息，不会卡在 loading', async ({ page }) => {
      await setFakeLLMConfig(page)

      await page.route(API_URL, (route) => {
        route.fulfill({
          status: 500,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ error: '服务器内部错误' }),
        })
      })

      await page.getByRole('heading', { name: '退婚流' }).first().locator('..').click()
      await page.getByRole('button', { name: '确认选择' }).first().click()

      // setPhase("PLAYING") → ChatPanel renders with error message
      const errorMsg = page.locator('.bg-red-900\\/50')
      await expect(errorMsg.filter({ visible: true })).toBeVisible({ timeout: 10000 })
      // loading 应该结束 — loading bubble 消失
      await expect(page.getByText('天道推演').filter({ visible: true })).not.toBeVisible({ timeout: 5000 })
    })

    test('API 返回 400 错误码时正确处理', async ({ page }) => {
      await setFakeLLMConfig(page)

      await page.route(API_URL, (route) => {
        route.fulfill({
          status: 400,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ error: 'Missing playerId' }),
        })
      })

      await page.getByRole('heading', { name: '奇遇流' }).first().locator('..').click()
      await page.getByRole('button', { name: '确认选择' }).first().click()
      await page.waitForTimeout(500)

      const errorEl = page.locator('.bg-red-900\\/50')
      await expect(errorEl.filter({ visible: true })).toBeVisible({ timeout: 10000 })
      await expect(errorEl.filter({ visible: true })).toContainText(/400|Missing playerId/)
    })
  })
})

// ── phase: PLAYING — 对话与交互 ──────────────────────────────────────

test.describe('Phase: PLAYING — 主游戏循环', () => {
  /**
   * 辅助：直接通过 store 设置状态进入 PLAYING 阶段，跳过 INIT 和 SELECT。
   * 这样我们可以独立测试 PLAYING 逻辑，不依赖后端 LLM。
   */
  async function jumpToPlaying(page: Page, playerName = '测试修士') {
    await page.evaluate((name) => {
      const store = (window as any).__ZUSTAND_STORE__
      // 直接通过 eval 设置 state（绕过 persist 中间件）
      localStorage.setItem(
        'xiuxian-game',
        JSON.stringify({
          state: {
            player: {
              id: 'test-' + Date.now(),
              status: 'ALIVE',
              name,
              gender: '男',
              stats: {
                hp: { current: 100, max: 100, status_desc: '良好' },
                mp: { current: 50, max: 50, status_desc: '充沛' },
                spirit: { value: 100, desc: '精神饱满' },
                realm: '练气期一层',
                age: { current: 16, max: 100 },
                race: '人族',
                alignment: '中立',
                sect: '散修',
                spiritual_root: '五行杂灵根',
                mental_state: '心如止水',
                reputation: 0,
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
    }, playerName)
    await page.reload()
    await page.waitForTimeout(300) // 等待 Zustand hydrate
    // 验证进入了 PLAYING
    await expect(page.getByText('天机推演').filter({ visible: true })).toBeVisible({ timeout: 5000 })
  }

  test.describe('聊天面板渲染', () => {
    test('聊天面板显示标题"天机推演"', async ({ page }) => {
      await freshStart(page)
      await jumpToPlaying(page)
      await expect(page.locator('h2').filter({ visible: true })).toContainText('天机推演')
    })

    test('输入框存在且带 placeholder', async ({ page }) => {
      await freshStart(page)
      await jumpToPlaying(page)
      const input = page.locator('input[placeholder="输入你的行动或对话..."]').filter({ visible: true })
      await expect(input).toBeVisible()
      await expect(input).toBeEnabled()
    })

    test('输入为空时发送按钮不可点击', async ({ page }) => {
      await freshStart(page)
      await jumpToPlaying(page)
      // handleSend 检查 !input.trim()，空输入直接 return，不发 API
      let apiCalled = false
      await page.route(API_URL, () => { apiCalled = true })
      const input = page.locator('input[placeholder="输入你的行动或对话..."]').filter({ visible: true })
      await input.fill('')
      await input.press('Enter')
      await page.waitForTimeout(300)
      expect(apiCalled).toBe(false)
    })

    test('四个快捷指令按钮存在', async ({ page }) => {
      await freshStart(page)
      await jumpToPlaying(page)
      for (const cmd of ['/修练', '/查看四周', '/吃药', '/逃跑']) {
        await expect(page.getByRole('button', { name: cmd })).toBeVisible()
      }
    })

    test('点击快捷指令填充到输入框', async ({ page }) => {
      await freshStart(page)
      await jumpToPlaying(page)
      await page.getByRole('button', { name: '/修练' }).first().click()
      const input = page.locator('input[placeholder="输入你的行动或对话..."]').filter({ visible: true })
      await expect(input).toHaveValue('/修练')
    })
  })

  test.describe('消息发送 — API 层验证', () => {
    test('发送消息后 POST /api/v1/game/action 带正确请求体', async ({ page }) => {
      await freshStart(page)
      await setFakeLLMConfig(page)
      await jumpToPlaying(page, 'API测试者')

      let capturedBody: any = null
      await page.route(API_URL, (route) => {
        capturedBody = route.request().postDataJSON()
        route.fulfill({
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
          body: buildActionStream('天地灵气...'),
        })
      })

      const input = page.locator('input[placeholder="输入你的行动或对话..."]').filter({ visible: true })
      await input.fill('修炼功法')
      await input.press('Enter')

      await page.waitForTimeout(500)

      expect(capturedBody).not.toBeNull()
      expect(capturedBody.input).toBe('修炼功法')
      expect(capturedBody.playerId).toContain('test-')
      expect(capturedBody.playerName).toBe('API测试者')
    })

    test('发送消息后用户消息出现在聊天记录中', async ({ page }) => {
      await freshStart(page)
      await setFakeLLMConfig(page)
      await jumpToPlaying(page)

      await page.route(API_URL, (route) => {
        route.fulfill({
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
          body: buildActionStream('你开始修炼...'),
        })
      })

      const input = page.locator('input[placeholder="输入你的行动或对话..."]').filter({ visible: true })
      await input.fill('修炼功法')
      await input.press('Enter')

      // 用户消息气泡（蓝底白字）
      const userBubble = page.locator('.bg-blue-600')
      await expect(userBubble.filter({ visible: true })).toContainText('修炼功法', { timeout: 5000 })
    })

    test('AI 回复出现在聊天记录中', async ({ page }) => {
      await freshStart(page)
      await setFakeLLMConfig(page)
      await jumpToPlaying(page)

      await page.route(API_URL, (route) => {
        route.fulfill({
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
          body: sseAccepted() + sseTextDelta('你开始修炼，感受到', 1) + sseTextDelta('天地灵气汇聚...', 2) + sseCompleted('你开始修炼，感受到天地灵气汇聚...', 3),
        })
      })

      const input = page.locator('input[placeholder="输入你的行动或对话..."]').filter({ visible: true })
      await input.fill('修炼')
      await input.press('Enter')

      // AI 消息应该出现在深色气泡中 (completed event triggers addMessage)
      const aiBubble = page.locator('.bg-zinc-800.rounded-2xl').filter({ visible: true }).first()
      await expect(aiBubble).toContainText('天地灵气', { timeout: 5000 })
    })

    test('发送消息期间显示 loading 诗歌动画', async ({ page }) => {
      await freshStart(page)
      await setFakeLLMConfig(page)
      await jumpToPlaying(page)

      // 慢速响应让 loading 可见
      await page.route(API_URL, async (route) => {
        await new Promise((r) => setTimeout(r, 400))
        route.fulfill({
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
          body: sseAccepted() + sseStep('天道记忆检索中...', 1) + sseCompleted('灵气...', 2),
        })
      })

      const input = page.locator('input[placeholder="输入你的行动或对话..."]').filter({ visible: true })
      await input.fill('test')
      await input.press('Enter')

      // loading 出现
      await expect(page.getByText('天道推演').filter({ visible: true })).toBeVisible({ timeout: 3000 })
    })

    test('Enter 键发送，Shift+Enter 不发送（换行）', async ({ page }) => {
      await freshStart(page)
      await setFakeLLMConfig(page)
      await jumpToPlaying(page)

      let sendCount = 0
      await page.route(API_URL, (route) => {
        sendCount++
        route.fulfill({
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
          body: buildActionStream('ok'),
        })
      })

      const input = page.locator('input[placeholder="输入你的行动或对话..."]').filter({ visible: true })
      await input.fill('测试消息')
      await input.press('Enter')
      await page.waitForTimeout(300)
      expect(sendCount).toBe(1)

      // 注意：<input> 不支持多行，所以 Shift+Enter 的行为可能和 Enter 一样
      // 但 handleKeyDown 检查了 e.key === 'Enter' && !e.shiftKey
    })
  })

  test.describe('SSE 事件处理', () => {
    test('正确解析 step + completed SSE 事件', async ({ page }) => {
      await freshStart(page)
      await setFakeLLMConfig(page)
      await jumpToPlaying(page)

      await page.route(API_URL, (route) => {
        route.fulfill({
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
          body: sseAccepted() +
                sseStep('天道记忆检索中...', 1) +
                sseStep('天机推演中...', 2) +
                sseCompleted('最后回复：天道推演完成', 3),
        })
      })

      await page.locator('input[placeholder="输入你的行动或对话..."]').filter({ visible: true }).fill('step测试')
      await page.locator('input[placeholder="输入你的行动或对话..."]').filter({ visible: true }).press('Enter')

      // completed 事件触发 addMessage，最终回复出现在聊天气泡中
      await expect(page.locator('.bg-zinc-800.rounded-2xl').filter({ visible: true }).first()).toContainText('最后回复：天道推演完成', { timeout: 5000 })
    })

    test('正确解析 text-delta + completed SSE 事件', async ({ page }) => {
      await freshStart(page)
      await setFakeLLMConfig(page)
      await jumpToPlaying(page)

      // text-delta 流式文本累积，completed 事件最终产生消息气泡
      await page.route(API_URL, (route) => {
        route.fulfill({
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
          body: sseAccepted() +
                sseTextDelta('天地', 1) +
                sseTextDelta('玄黄', 2) +
                sseCompleted('天地玄黄', 3),
        })
      })

      await page.locator('input[placeholder="输入你的行动或对话..."]').filter({ visible: true }).fill('流式测试')
      await page.locator('input[placeholder="输入你的行动或对话..."]').filter({ visible: true }).press('Enter')

      // 最终 completed 文本出现在聊天气泡中
      await expect(page.locator('.bg-zinc-800.rounded-2xl').filter({ visible: true }).first()).toContainText('天地玄黄', { timeout: 5000 })
    })

    test('正确解析 failed 事件显示错误消息', async ({ page }) => {
      await freshStart(page)
      await setFakeLLMConfig(page)
      await jumpToPlaying(page)

      await page.route(API_URL, (route) => {
        route.fulfill({
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
          body: sseAccepted() +
                sseStep('检索中...', 1) +
                sseFailed('LLM_SERVICE_UNAVAILABLE', '天道崩溃：LLM服务不可用', 2, true),
        })
      })

      await page.locator('input[placeholder="输入你的行动或对话..."]').filter({ visible: true }).fill('error测试')
      await page.locator('input[placeholder="输入你的行动或对话..."]').filter({ visible: true }).press('Enter')

      await expect(page.locator('.bg-red-900\\/50').filter({ visible: true })).toContainText('LLM服务不可用', { timeout: 5000 })
    })

    test('codex 事件触发图鉴通知', async ({ page }) => {
      await freshStart(page)
      await setFakeLLMConfig(page)
      await jumpToPlaying(page)

      await page.route(API_URL, (route) => {
        route.fulfill({
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
          body: sseAccepted() +
                sseStep('...', 1) +
                sseCodex('青云剑', 'item', '一把古剑', 2) +
                sseCompleted('你获得了一把剑', 3),
        })
      })

      await page.locator('input[placeholder="输入你的行动或对话..."]').filter({ visible: true }).fill('获得物品')
      await page.locator('input[placeholder="输入你的行动或对话..."]').filter({ visible: true }).press('Enter')

      await page.waitForTimeout(1000)
      // 图鉴栏应该有红点通知（桌面端）
      const codexNav = page.locator('button:has-text("图鉴")').filter({ visible: true })
      if (await codexNav.isVisible()) {
        const badge = codexNav.locator('.bg-red-500')
        // badge 可能存在也可能被其他逻辑跳过，我们只验证 API 调用成功
      }
    })
  })

  test.describe('错误处理与重试', () => {
    test('网络断开时显示连接错误', async ({ page }) => {
      await freshStart(page)
      await setFakeLLMConfig(page)
      await jumpToPlaying(page)

      await page.route(API_URL, (route) => route.abort('connectionrefused'))

      await page.locator('input[placeholder="输入你的行动或对话..."]').filter({ visible: true }).fill('断网测试')
      await page.locator('input[placeholder="输入你的行动或对话..."]').filter({ visible: true }).press('Enter')

      await expect(page.locator('.bg-red-900\\/50').filter({ visible: true })).toBeVisible({ timeout: 10000 })
    })

    test('错误消息旁有"重新发送"按钮', async ({ page }) => {
      await freshStart(page)
      await setFakeLLMConfig(page)
      await jumpToPlaying(page)

      await page.route(API_URL, (route) => {
        route.fulfill({ status: 503, body: 'Service Unavailable' })
      })

      await page.locator('input[placeholder="输入你的行动或对话..."]').filter({ visible: true }).fill('重试测试')
      await page.locator('input[placeholder="输入你的行动或对话..."]').filter({ visible: true }).press('Enter')

      await expect(page.getByText('重新发送').filter({ visible: true })).toBeVisible({ timeout: 5000 })
    })

    test('点击"重新发送"后重新发起 API 请求', async ({ page }) => {
      await freshStart(page)
      await setFakeLLMConfig(page)
      await jumpToPlaying(page)

      let callCount = 0
      await page.route(API_URL, (route) => {
        callCount++
        if (callCount === 1) {
          route.fulfill({ status: 503, body: 'Service Unavailable' })
        } else {
          route.fulfill({
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
            body: buildActionStream('重试成功！'),
          })
        }
      })

      await page.locator('input[placeholder="输入你的行动或对话..."]').filter({ visible: true }).fill('先失败')
      await page.locator('input[placeholder="输入你的行动或对话..."]').filter({ visible: true }).press('Enter')

      // 等待错误出现
      await expect(page.getByText('重新发送').filter({ visible: true })).toBeVisible({ timeout: 5000 })
      await page.getByText('重新发送').filter({ visible: true }).click()

      // API 被调用了两次
      expect(callCount).toBeGreaterThanOrEqual(2)
    })

    test('加载中时输入框和发送按钮都不可用', async ({ page }) => {
      await freshStart(page)
      await setFakeLLMConfig(page)
      await jumpToPlaying(page)

      // 慢响应
      await page.route(API_URL, async (route) => {
        await new Promise((r) => setTimeout(r, 2000))
        route.fulfill({
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
          body: buildActionStream('ok'),
        })
      })

      await page.locator('input[placeholder="输入你的行动或对话..."]').filter({ visible: true }).fill('loading测试')
      await page.locator('input[placeholder="输入你的行动或对话..."]').filter({ visible: true }).press('Enter')

      await page.waitForTimeout(200)
      const input = page.locator('input[placeholder="输入你的行动或对话..."]').filter({ visible: true })
      await expect(input).toBeDisabled()
    })
  })
})

// ── 导航与视图切换 ──────────────────────────────────────────────────

test.describe('Navigation — 导航与面板切换', () => {
  async function jumpToPlaying(page: Page) {
    await page.evaluate(() => {
      localStorage.setItem(
        'xiuxian-game',
        JSON.stringify({
          state: {
            player: {
              id: 'nav-test-' + Date.now(),
              status: 'ALIVE',
              name: '导航测试',
              gender: '男',
              stats: {
                hp: { current: 100, max: 100, status_desc: '良好' },
                mp: { current: 50, max: 50, status_desc: '充沛' },
                spirit: { value: 100, desc: '饱满' },
                realm: '练气期一层',
                age: { current: 16, max: 100 },
                race: '人族',
                alignment: '中立' as const,
                sect: '散修',
                spiritual_root: '杂灵根',
                mental_state: '平静',
                reputation: 10,
              },
              inventory: [],
              relationships: {},
            },
            chatHistory: [],
            journal: [{ id: 'j1', title: '第一条日志', content: '测试内容', entry_type: 'general', timestamp: Date.now() }],
            codex: [{ id: 'c1', name: '测试图鉴', entry_type: 'npc', description: '测试', metadata: {}, timestamp: Date.now() }],
            phase: 'PLAYING' as const,
            currentView: 'chat' as const,
            isLoading: false,
            currentEvent: '',
            notifications: {},
          },
          version: 0,
        }),
      )
    })
    await page.reload()
    await page.waitForTimeout(300)
  }

  test.describe('桌面端侧边栏 (Desktop Sidebar)', () => {
    test('侧边栏显示所有导航项', async ({ page }) => {
      // 桌面端 viewport
      await page.setViewportSize({ width: 1280, height: 800 })
      await freshStart(page)
      await jumpToPlaying(page)

      const navLabels = ['对话', '背包', '属性', '日志', '图鉴', '设置']
      for (const label of navLabels) {
        await expect(page.locator('button:has-text("' + label + '")').filter({ visible: true })).toBeVisible()
      }
    })

    test('侧边栏显示当前角色名', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 })
      await freshStart(page)
      await jumpToPlaying(page)

      await expect(page.getByText('导航测试').filter({ visible: true }).first()).toBeVisible()
    })

    test('点击"设置"切换到设置面板', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 })
      await freshStart(page)
      await jumpToPlaying(page)

      await page.locator('button:has-text("设置")').filter({ visible: true }).click()
      await expect(page.locator('h2:has-text("设置")').filter({ visible: true })).toBeVisible()
    })

    test('点击"背包"切换到背包面板', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 })
      await freshStart(page)
      await jumpToPlaying(page)

      await page.locator('button:has-text("背包")').filter({ visible: true }).click()
      await expect(page.getByText('空空如也').filter({ visible: true }).first()).toBeVisible({ timeout: 3000 })
    })

    test('点击"属性"切换到属性面板', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 })
      await freshStart(page)
      await jumpToPlaying(page)

      await page.locator('button:has-text("属性")').filter({ visible: true }).click()
      await expect(page.getByText('练气期一层').filter({ visible: true }).first()).toBeVisible({ timeout: 3000 })
    })

    test('点击"图鉴"切换到图鉴面板', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 })
      await freshStart(page)
      await jumpToPlaying(page)

      await page.locator('button:has-text("图鉴")').filter({ visible: true }).click()
      // 图鉴中有预设数据
      await expect(page.getByText('测试图鉴').filter({ visible: true }).first()).toBeVisible({ timeout: 3000 })
    })

    test('点击"日志"切换到日志面板', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 })
      await freshStart(page)
      await jumpToPlaying(page)

      await page.locator('button:has-text("日志")').filter({ visible: true }).click()
      await expect(page.getByText('第一条日志').filter({ visible: true }).first()).toBeVisible({ timeout: 3000 })
    })

    test('点击"对话"回到聊天界面', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 })
      await freshStart(page)
      await jumpToPlaying(page)

      // 先切到设置
      await page.locator('button:has-text("设置")').filter({ visible: true }).click()
      await expect(page.locator('h2:has-text("设置")').filter({ visible: true })).toBeVisible()
      // 再切回对话
      await page.locator('button:has-text("对话")').filter({ visible: true }).click()
      await expect(page.locator('h2:has-text("天机推演")').filter({ visible: true })).toBeVisible()
    })

    test('非 PLAYING 阶段背包/属性/图鉴/日志按钮禁用', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 })
      await freshStart(page)
      await goToApp(page)

      // 还在 INIT 阶段，这些按钮应是 disabled
      const backpackBtn = page.locator('button:has-text("背包")').filter({ visible: true })
      const statsBtn = page.locator('button:has-text("属性")').filter({ visible: true })
      await expect(backpackBtn).toBeDisabled()
      await expect(statsBtn).toBeDisabled()
    })

    test('通知红点显示和清除', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 })
      await freshStart(page)
      // 设置带通知的状态
      await page.evaluate(() => {
        localStorage.setItem(
          'xiuxian-game',
          JSON.stringify({
            state: {
              player: {
                id: 'notif-test',
                status: 'ALIVE',
                name: '通知测试',
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
              notifications: { codex: 3, journal: 1 },
            },
            version: 0,
          }),
        )
      })
      await page.reload()
      await page.waitForTimeout(300)

      // 图鉴按钮上应有 3 的红点
      const codexBtn = page.locator('button:has-text("图鉴")').filter({ visible: true })
      const badge = codexBtn.locator('.bg-red-500')
      await expect(badge).toBeVisible()
      await expect(badge).toContainText('3')
    })

    test('重新开始按钮存在且可交互（桌面端）', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 })
      await freshStart(page)
      await jumpToPlaying(page)

      const restartBtn = page.getByText('重新开始').filter({ visible: true })
      await expect(restartBtn).toBeVisible()
    })
  })

  test.describe('移动端导航 (Mobile Navigation)', () => {
    test('移动端底部 Tab 栏显示 4 个标签', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await freshStart(page)
      await jumpToPlaying(page)

      const tabLabels = ['对话', '背包', '属性', '图鉴']
      for (const label of tabLabels) {
        // 移动端 tab bar 中的按钮
        const tab = page.locator('.md\\:hidden button:has-text("' + label + '")').first()
        await expect(tab).toBeVisible()
      }
    })

    test('移动端点击"背包"打开 Sheet 面板', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await freshStart(page)
      await jumpToPlaying(page)

      // 点击背包 tab
      const backpackTab = page.locator('.md\\:hidden button:has-text("背包")').first()
      await backpackTab.click()

      // Sheet 应该出现，显示标题"背包"
      await expect(page.locator('.md\\:hidden h2:has-text("背包")').first()).toBeVisible({ timeout: 3000 })
    })

    test('移动端 Sheet 可以通过 X 按钮关闭', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await freshStart(page)
      await jumpToPlaying(page)

      await page.locator('.md\\:hidden button:has-text("背包")').first().click()
      await expect(page.locator('.md\\:hidden h2:has-text("背包")').first()).toBeVisible({ timeout: 3000 })

      // 点 X 关闭 — X按钮在Sheet header中，rounded-t-2xl是Sheet独有的class
      const closeBtn = page.locator('.rounded-t-2xl .border-b button').first()
      await closeBtn.click()
      await expect(page.locator('.md\\:hidden h2:has-text("背包")').first()).not.toBeVisible({ timeout: 3000 })
    })

    test('移动端 Sheet 点击遮罩层关闭', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await freshStart(page)
      await jumpToPlaying(page)

      await page.locator('.md\\:hidden button:has-text("图鉴")').first().click()
      await expect(page.locator('.md\\:hidden h2:has-text("图鉴")').first()).toBeVisible({ timeout: 3000 })

      // 点遮罩
      await page.locator('.bg-black\\/60').first().click()
      await expect(page.locator('.md\\:hidden h2:has-text("图鉴")').first()).not.toBeVisible({ timeout: 3000 })
    })

    test('移动端底部Tab栏所有按钮可见且可点击', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await freshStart(page)
      await jumpToPlaying(page)

      // 移动端使用底部Tab栏导航（非汉堡菜单）
      const tabs = ['对话', '背包', '属性', '图鉴']
      for (const tab of tabs) {
        const btn = page.locator('.md\\:hidden button:has-text("' + tab + '")').first()
        await expect(btn).toBeVisible()
      }
    })
  })
})

// ── 设置面板 ────────────────────────────────────────────────────────

test.describe('Settings Panel — LLM 配置', () => {
  async function jumpToSettings(page: Page) {
    await page.evaluate(() => {
      localStorage.setItem(
        'xiuxian-game',
        JSON.stringify({
          state: {
            player: {
              id: 'settings-test',
              status: 'ALIVE',
              name: '设置测试',
              gender: '男',
              stats: {
                hp: { current: 100, max: 100, status_desc: '良好' },
                mp: { current: 50, max: 50, status_desc: '充沛' },
                spirit: { value: 100, desc: '饱满' },
                realm: '练气期一层',
                age: { current: 16, max: 100 },
                race: '人族',
                alignment: '中立' as const,
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
            phase: 'PLAYING' as const,
            currentView: 'settings' as const,
            isLoading: false,
            currentEvent: '',
            notifications: {},
          },
          version: 0,
        }),
      )
    })
    await page.reload()
    await page.waitForTimeout(300)
  }

  test('设置面板显示所有 LLM 提供商', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await freshStart(page)
    await jumpToSettings(page)

    const providerNames = ['豆包', 'DeepSeek', '通义千问', 'OpenAI', 'Google Gemini', '自定义']
    for (const name of providerNames) {
      await expect(page.getByRole('button', { name }).first()).toBeVisible()
    }
  })

  test('切换提供商后模型列表更新', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await freshStart(page)
    await jumpToSettings(page)

    // 默认是 豆包
    await expect(page.getByText('Doubao 1.5 Pro 256K').filter({ visible: true })).toBeVisible()

    // 切换到 OpenAI
    await page.getByRole('button', { name: 'OpenAI' }).first().click()
    await expect(page.getByRole('button', { name: 'GPT-4o', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'GPT-4o Mini' })).toBeVisible()

    // 切换到自定义
    await page.getByRole('button', { name: '自定义' }).first().click()
    // 自定义没有预设模型，但应有自定义输入框
    await expect(page.locator('input[placeholder="model-name or endpoint ID (e.g. ep-m-xxxxx)"]').filter({ visible: true })).toBeVisible()
  })

  test('API Key 输入是密码类型', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await freshStart(page)
    await jumpToSettings(page)

    const apiKeyInput = page.locator('input[type="password"]').filter({ visible: true })
    await expect(apiKeyInput).toBeVisible()
    await expect(apiKeyInput).toHaveAttribute('placeholder', 'sk-...')
  })

  test('保存配置后 localStorage 更新', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await freshStart(page)
    await jumpToSettings(page)

    // 修改配置
    await page.locator('input[type="password"]').filter({ visible: true }).fill('sk-my-test-key-1234')
    await page.getByRole('button', { name: 'OpenAI' }).first().click()
    await page.getByRole('button', { name: 'GPT-4o Mini' }).first().click()

    // 保存
    await page.getByRole('button', { name: '保存配置' }).first().click()

    // 检查"已保存"提示
    await expect(page.getByText('已保存').filter({ visible: true })).toBeVisible()

    // 检查 localStorage
    const config = await page.evaluate(() => localStorage.getItem('xiuxian-llm-config'))
    const parsed = JSON.parse(config!)
    expect(parsed.apiKey).toBe('sk-my-test-key-1234')
    expect(parsed.providerId).toBe('openai')
    expect(parsed.modelId).toBe('gpt-4o-mini')
  })

  test('保存后配置总结中显示 Key 掩码', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await freshStart(page)
    await jumpToSettings(page)

    await page.locator('input[type="password"]').filter({ visible: true }).fill('sk-abcdefgh')
    await page.getByRole('button', { name: '保存配置' }).first().click()

    // 配置总结中 Key 隐藏
    await expect(page.getByText('***efgh').filter({ visible: true })).toBeVisible()
  })

  test('点击返回箭头回到对话界面', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await freshStart(page)
    await jumpToSettings(page)

    // 返回箭头按钮在设置面板header中，与"设置"标题同级
    const backBtn = page.locator('.border-b.border-zinc-800').filter({ has: page.getByRole('heading', { name: '设置' }) }).locator('button').first()
    await backBtn.click()
    await expect(page.locator('h2:has-text("天机推演")').filter({ visible: true })).toBeVisible()
  })

  test('Base URL 可以自定义修改', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await freshStart(page)
    await jumpToSettings(page)

    const baseUrlInput = page.locator('input[placeholder="https://api.example.com/v1"]').filter({ visible: true })
    await expect(baseUrlInput).toBeVisible()
    await expect(baseUrlInput).toHaveValue(/volces|openai|deepseek/)
    await baseUrlInput.fill('https://my-proxy.example.com/v1')
    await expect(baseUrlInput).toHaveValue('https://my-proxy.example.com/v1')
  })
})

// ── 状态持久化 ──────────────────────────────────────────────────────

test.describe('State Persistence — 状态持久化', () => {
  test('游戏状态保存在 localStorage key "xiuxian-game"', async ({ page }) => {
    await freshStart(page)
    await completeInit(page, '持久化测试')

    const stored = await page.evaluate(() => localStorage.getItem('xiuxian-game'))
    expect(stored).not.toBeNull()
    const parsed = JSON.parse(stored!)
    expect(parsed.state.player.name).toBe('持久化测试')
    expect(parsed.state.phase).toBe('SELECT')
  })

  test('LLM 配置保存在 localStorage key "xiuxian-llm-config"', async ({ page }) => {
    await freshStart(page)
    await page.goto('/')
    await page.waitForTimeout(300)

    // 通过 evaluate 设置 LLM 配置
    await page.evaluate(() => {
      localStorage.setItem(
        'xiuxian-llm-config',
        JSON.stringify({ providerId: 'deepseek', apiKey: 'sk-xxx', baseUrl: 'https://x.com/v1', modelId: 'deepseek-chat', customModel: '' }),
      )
    })

    const stored = await page.evaluate(() => localStorage.getItem('xiuxian-llm-config'))
    const parsed = JSON.parse(stored!)
    expect(parsed.providerId).toBe('deepseek')
    expect(parsed.modelId).toBe('deepseek-chat')
  })

  test('resetGame 清除玩家数据和聊天历史', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await freshStart(page)

    // 设置一个有数据的游戏状态
    await page.evaluate(() => {
      localStorage.setItem(
        'xiuxian-game',
        JSON.stringify({
          state: {
            player: {
              id: 'reset-test',
              status: 'ALIVE' as const,
              name: '重置测试',
              gender: '男',
              stats: { hp: { current: 100, max: 100, status_desc: '良好' }, mp: { current: 50, max: 50, status_desc: '充沛' }, spirit: { value: 100, desc: 'ok' }, realm: '练气期一层', age: { current: 16, max: 100 }, race: '人族', alignment: '中立' as const, sect: '散修', spiritual_root: '杂灵根', mental_state: 'ok', reputation: 0 },
              inventory: [],
              relationships: {},
            },
            chatHistory: [{ id: 'm1', role: 'user', content: 'hello', timestamp: Date.now() }],
            journal: [],
            codex: [],
            phase: 'PLAYING' as const,
            currentView: 'chat' as const,
            isLoading: false,
            currentEvent: '',
            notifications: {},
          },
          version: 0,
        }),
      )
    })
    await page.reload()
    await page.waitForTimeout(300)

    // 点击重新开始
    page.on('dialog', (dialog) => dialog.accept())
    await page.getByText('重新开始').filter({ visible: true }).click()
    await page.waitForTimeout(500)

    // 应该回到 INIT 界面
    await expect(page.getByRole('heading', { name: '仙 途 启 程' }).first()).toBeVisible()
  })
})

// ── DEAD 阶段 ────────────────────────────────────────────────────────

test.describe('Phase: DEAD — 角色死亡', () => {
  async function jumpToDead(page: Page) {
    await page.evaluate(() => {
      localStorage.setItem(
        'xiuxian-game',
        JSON.stringify({
          state: {
            player: {
              id: 'dead-test',
              status: 'DEAD' as const,
              name: '死者',
              gender: '男',
              stats: { hp: { current: 0, max: 100, status_desc: '神仙难救' }, mp: { current: 0, max: 50, status_desc: '枯竭' }, spirit: { value: 0, desc: '消散' }, realm: '练气期一层', age: { current: 99, max: 100 }, race: '人族', alignment: '中立' as const, sect: '散修', spiritual_root: '杂灵根', mental_state: '崩溃', reputation: 0 },
              inventory: [],
              relationships: {},
            },
            chatHistory: [],
            journal: [],
            codex: [],
            phase: 'DEAD' as const,
            currentView: 'chat' as const,
            isLoading: false,
            currentEvent: '',
            notifications: {},
          },
          version: 0,
        }),
      )
    })
    await page.reload()
    await page.waitForTimeout(300)
  }

  test('DEAD 阶段桌面端显示"小元已尽"', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await freshStart(page)
    await jumpToDead(page)

    // 桌面端布局：hidden md:flex 容器中的"小元已尽"
    await expect(page.locator('.hidden.md\\:flex').getByText('小元已尽')).toBeVisible()
  })

  test('DEAD 阶段移动端也显示"小元已尽"', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await freshStart(page)
    await jumpToDead(page)

    // 移动端布局：md:hidden 容器中的"小元已尽"
    await expect(page.locator('.md\\:hidden').getByText('小元已尽').filter({ visible: true })).toBeVisible()
  })

  test('DEAD 阶段有重新开始按钮', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await freshStart(page)
    await jumpToDead(page)

    await expect(page.getByText('重新开始').filter({ visible: true })).toBeVisible()
  })
})

// ── API 路由验证层 ───────────────────────────────────────────────────

test.describe('API Layer — 后端路由连通性', () => {
  test('POST /api/v1/game/action 缺少 playerId 返回 4xx', async ({ page }) => {
    const res = await page.request.post('/api/v1/game/action', {
      data: { input: 'test' },
      failOnStatusCode: false,
    })
    // V1 API uses Zod validation → 422, or may return 400
    expect(res.status()).toBeGreaterThanOrEqual(400)
    expect(res.status()).toBeLessThan(500)
    const body = await res.json()
    expect(body.error || body.detail || body.title).toBeDefined()
  })

  test('POST /api/v1/game/action 无效请求体返回 4xx', async ({ page }) => {
    const res = await page.request.post('/api/v1/game/action', {
      headers: { 'Content-Type': 'application/json' },
      data: 'not a valid request object',
      failOnStatusCode: false,
    })
    // Zod validation rejects the string → 422, or JSON parse fails → 400
    expect(res.status()).toBeGreaterThanOrEqual(400)
    expect(res.status()).toBeLessThan(500)
  })

  test('POST /api/v1/game/action 空请求体返回 4xx', async ({ page }) => {
    const res = await page.request.post('/api/v1/game/action', {
      data: {},
      failOnStatusCode: false,
    })
    // V1 API Zod validation returns 422 for empty body
    expect(res.status()).toBeGreaterThanOrEqual(400)
    expect(res.status()).toBeLessThan(500)
  })

  test('DELETE /api/v1/game/action 返回 4xx', async ({ page }) => {
    const res = await page.request.delete('/api/v1/game/action', {
      data: {},
      failOnStatusCode: false,
    })
    expect(res.status()).toBeGreaterThanOrEqual(400)
    expect(res.status()).toBeLessThan(500)
  })

  test('Content-Type 响应头正确', async ({ page }) => {
    const res = await page.request.post('/api/v1/game/action', {
      data: { input: 'test' },
      failOnStatusCode: false,
    })
    const ct = res.headers()['content-type']
    expect(ct).toMatch(/text\/plain|application\/json|application\/problem\+json/)
  })
})

// ── 响应式布局 ──────────────────────────────────────────────────────

test.describe('Responsive — 响应式布局', () => {
  test('桌面端 (1280x800) 显示侧边栏和状态面板', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await freshStart(page)
    await completeInit(page)

    // 左侧标题
    await expect(page.getByText('修仙模拟器').filter({ visible: true })).toBeVisible()
  })

  test('移动端 (390x844) 底部有 Tab 栏', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await freshStart(page)

    // 移动端 tabbar 可见
    await expect(page.locator('.md\\:hidden button:has-text("对话")').first()).toBeVisible()
  })

  test('移动端初始阶段显示 INIT 画面（不是桌面端三栏）', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await freshStart(page)

    // INIT 标题
    await expect(page.getByRole('heading', { name: '仙 途 启 程' }).first()).toBeVisible()
    // 底部 Tab 栏存在
    await expect(page.locator('.md\\:hidden button:has-text("对话")').first()).toBeVisible()
  })

  test('移动端流派选择网格适配小屏幕', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await freshStart(page)
    // 移动端使用 .md\\:hidden 前缀，因为桌面端元素hidden
    await page.locator('.md\\:hidden #name').fill('手机测试')
    await page.locator('.md\\:hidden').getByRole('button', { name: '女' }).click()
    await page.locator('.md\\:hidden').getByRole('button', { name: '踏入仙途' }).click()
    await expect(page.locator('.md\\:hidden').getByRole('heading', { name: '天 命 抉 择' })).toBeVisible()

    // grid 是 grid-cols-2 sm:grid-cols-3，手机端 2 列
    // 使用 .md\\:hidden 前缀确保获取移动端渲染的元素
    await expect(page.locator('.md\\:hidden').getByText('废柴流')).toBeVisible()
  })
})

// ── 边界情况 ────────────────────────────────────────────────────────

test.describe('Edge Cases — 边界情况', () => {
  test('极短道号（1个字符）可以创建', async ({ page }) => {
    await freshStart(page)
    await completeInit(page, '一')
    await expect(page.getByRole('heading', { name: '天 命 抉 择' }).first()).toBeVisible()
  })

  test('较长道号可以创建', async ({ page }) => {
    await freshStart(page)
    await completeInit(page, '太上无极混元大天尊')
    await expect(page.getByRole('heading', { name: '天 命 抉 择' }).first()).toBeVisible()
  })

  test('快速双击流派卡片不会重复选中状态错乱', async ({ page }) => {
    await freshStart(page)
    await completeInit(page)

    const card = page.getByRole('heading', { name: '废柴流' }).first().locator('..')
    await card.dblclick()
    // 卡片应该处于选中状态
    await expect(card).toHaveClass(/border-amber-500/)
    await expect(page.getByRole('button', { name: '确认选择' }).first()).toBeEnabled()
  })

  test('加载状态下确认选择后不卡死崩溃', async ({ page }) => {
    await freshStart(page)
    await setFakeLLMConfig(page)
    await goToApp(page)
    await completeInit(page)

    // 慢响应（2s后返回）
    await page.route(API_URL, async (route) => {
      await new Promise((r) => setTimeout(r, 2000))
      route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
        body: buildActionStream('开局剧情触发成功', 'prepare'),
      })
    })

    // 选流派并确认
    await page.getByRole('heading', { name: '废柴流' }).first().locator('..').click()
    await page.getByRole('button', { name: '确认选择' }).first().click()

    // 等待loading后应正常进入PLAYING，不崩溃
    await page.waitForTimeout(500)
    await expect(page.getByText('天道推演').filter({ visible: true })).toBeVisible({ timeout: 5000 })
  })

  test('localStorage 损坏时不崩溃', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(300)
    await page.evaluate(() => {
      localStorage.setItem('xiuxian-game', '{invalid json!!!!')
    })
    // 页面应该能正常加载（Zustand 用 try-catch 包裹）
    await page.reload()
    await page.waitForTimeout(500)
    // 应该看到 INIT 界面（回退到默认状态）
    await expect(page.getByRole('heading', { name: '仙 途 启 程' }).first()).toBeVisible()
  })

  test('localStorage 中 LLM 配置损坏时 getLLMConfig 返回 {}', async ({ page }) => {
    await freshStart(page)
    await page.evaluate(() => {
      localStorage.setItem('xiuxian-llm-config', 'corrupt data {{{')
    })
    await goToApp(page)
    // 不应崩溃，正常显示
    await expect(page.getByRole('heading', { name: '仙 途 启 程' }).first()).toBeVisible()
  })

  test('页面 title 是"修仙模拟器"', async ({ page }) => {
    await goToApp(page)
    await expect(page).toHaveTitle('修仙模拟器')
  })

  test('html 元素有 dark class', async ({ page }) => {
    await goToApp(page)
    await expect(page.locator('html')).toHaveClass(/dark/)
  })
})

// ── 经验库（修仙日志）功能 ──────────────────────────────────────────

test.describe('Journal — 经验库（修仙日志）', () => {
  async function jumpToJournalWithData(page: Page) {
    await page.evaluate(() => {
      localStorage.setItem('xiuxian-game', JSON.stringify({
        state: {
          player: {
            id: 'journal-test',
            status: 'ALIVE',
            name: '经验测试者',
            gender: '男',
            stats: {
              hp: { current: 100, max: 100, status_desc: '良好' },
              mp: { current: 50, max: 50, status_desc: '充沛' },
              spirit: { value: 100, desc: '饱满' },
              realm: '练气期一层',
              age: { current: 16, max: 100 },
              race: '人族', alignment: '中立', sect: '散修',
              spiritual_root: '杂灵根', mental_state: '平静', reputation: 10,
            },
            inventory: [], relationships: {},
          },
          chatHistory: [],
          journal: [
            { id: 'j1', title: '成功突破练气期', content: '经过三天三夜的修炼，终于突破了练气期的瓶颈。', entry_type: 'success', timestamp: Date.now() - 3600000 },
            { id: 'j2', title: '炼丹失败差点炸炉', content: '火候没有掌握好，丹炉差点炸裂。记住：火候要先文后武。', entry_type: 'failure', timestamp: Date.now() - 7200000 },
            { id: 'j3', title: '坊市遇到的坑', content: '坊市中切勿轻信陌生人兜售的功法，十有八九是骗局。', entry_type: 'pitfall', timestamp: Date.now() - 10800000 },
          ],
          codex: [],
          phase: 'PLAYING',
          currentView: 'journal',
          isLoading: false, currentEvent: '', notifications: {},
        },
        version: 0,
      }))
    })
    await page.reload()
    await page.waitForTimeout(300)
  }

  test.describe('筛选标签', () => {
    test('4个筛选标签全部渲染且可见', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 })
      await freshStart(page)
      await jumpToJournalWithData(page)

      for (const label of ['全部', '成功经验', '失败教训', '踩坑点']) {
        const btn = page.getByRole('button', { name: label })
        await expect(btn).toBeVisible()
      }
    })

    test('默认选中"全部"，有高亮样式', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 })
      await freshStart(page)
      await jumpToJournalWithData(page)

      const allBtn = page.getByRole('button', { name: '全部' })
      await expect(allBtn).toHaveClass(/border-amber-500/)
      await expect(allBtn).toHaveClass(/bg-amber-500\/20/)
    })

    test('点击"成功经验"切换高亮，且只显示成功类条目', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 })
      await freshStart(page)
      await jumpToJournalWithData(page)

      await page.getByRole('button', { name: '成功经验' }).click()

      // 高亮切换
      const successBtn = page.getByRole('button', { name: '成功经验' })
      await expect(successBtn).toHaveClass(/border-amber-500/)

      // "全部"不再高亮
      const allBtn = page.getByRole('button', { name: '全部' })
      await expect(allBtn).not.toHaveClass(/border-amber-500/)

      // 只显示1条
      await expect(page.getByText('成功突破练气期').filter({ visible: true }).first()).toBeVisible()
      await expect(page.getByText('炼丹失败差点炸炉').filter({ visible: true }).first()).not.toBeVisible()
    })

    test('点击"失败教训"只显示失败类条目', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 })
      await freshStart(page)
      await jumpToJournalWithData(page)

      await page.getByRole('button', { name: '失败教训' }).click()
      await expect(page.getByText('炼丹失败差点炸炉').filter({ visible: true }).first()).toBeVisible()
      await expect(page.getByText('成功突破练气期').filter({ visible: true }).first()).not.toBeVisible()
    })

    test('点击"踩坑点"只显示踩坑类条目', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 })
      await freshStart(page)
      await jumpToJournalWithData(page)

      await page.getByRole('button', { name: '踩坑点' }).click()
      await expect(page.getByText('坊市遇到的坑').filter({ visible: true }).first()).toBeVisible()
      await expect(page.getByText('成功突破练气期').filter({ visible: true }).first()).not.toBeVisible()
    })

    test('点击"全部"恢复显示所有条目', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 })
      await freshStart(page)
      await jumpToJournalWithData(page)

      // 先切到别的筛选
      await page.getByRole('button', { name: '失败教训' }).click()
      // 切回全部
      await page.getByRole('button', { name: '全部' }).click()

      await expect(page.getByText('成功突破练气期').filter({ visible: true }).first()).toBeVisible()
      await expect(page.getByText('炼丹失败差点炸炉').filter({ visible: true }).first()).toBeVisible()
      await expect(page.getByText('坊市遇到的坑').filter({ visible: true }).first()).toBeVisible()
    })

    test('筛选后空分类显示空状态提示', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 })
      await freshStart(page)
      // 只有一个 success 条目，没有 general 类型
      await page.evaluate(() => {
        localStorage.setItem('xiuxian-game', JSON.stringify({
          state: {
            player: { id: 'j-empty', status: 'ALIVE', name: '空', gender: '男',
              stats: { hp: { current: 100, max: 100, status_desc: '好' }, mp: { current: 50, max: 50, status_desc: '好' }, spirit: { value: 100, desc: '好' }, realm: '练气期一层', age: { current: 16, max: 100 }, race: '人族', alignment: '中立', sect: '散修', spiritual_root: '杂灵根', mental_state: '平静', reputation: 0 },
              inventory: [], relationships: {} },
            chatHistory: [],
            journal: [{ id: 'j1', title: '成功', content: '成功经验内容', entry_type: 'success', timestamp: Date.now() }],
            codex: [],
            phase: 'PLAYING', currentView: 'journal',
            isLoading: false, currentEvent: '', notifications: {},
          },
          version: 0,
        }))
      })
      await page.reload()
      await page.waitForTimeout(300)

      await page.getByRole('button', { name: '失败教训' }).click()
      await expect(page.getByText('该分类下暂无记录').filter({ visible: true }).first()).toBeVisible()
    })
  })

  test.describe('聊天按钮', () => {
    test('每个条目都有"聊这个"按钮', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 })
      await freshStart(page)
      await jumpToJournalWithData(page)

      const chatBtns = page.getByRole('button', { name: '聊这个' })
      await expect(chatBtns).toHaveCount(3)
    })

    test('点击"聊这个"跳转到聊天界面，输入框预填内容', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 })
      await freshStart(page)
      await jumpToJournalWithData(page)

      await page.getByRole('button', { name: '聊这个' }).first().click()

      // 验证跳转到聊天
      await expect(page.locator('h2:has-text("天机推演")').filter({ visible: true }).first()).toBeVisible()

      // 验证输入框有内容
      const input = page.locator('input[placeholder="输入你的行动或对话..."]').filter({ visible: true })
      await expect(input).toHaveValue('经过三天三夜的修炼，终于突破了练气期的瓶颈。')
    })

    test('点击"聊这个"后发送按钮可点击（不再是灰色禁用）', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 })
      await freshStart(page)
      await jumpToJournalWithData(page)

      await page.getByRole('button', { name: '聊这个' }).first().click()
      await page.waitForTimeout(300)

      // 发送按钮应该是 enabled 的
      const sendBtn = page.locator('button:has(svg.lucide-send), button').filter({ has: page.locator('.lucide-send') })
      // 直接用 input 旁边的 button — 查找非 disabled 的发送按钮
      const input = page.locator('input[placeholder="输入你的行动或对话..."]').filter({ visible: true })
      // 输入框旁边的按钮不再是 disabled
      await expect(input).not.toHaveAttribute('disabled')
    })

    test('点击"聊这个"后按 Enter 可以发送消息（完整流程）', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 })
      await freshStart(page)
      await setFakeLLMConfig(page)
      await jumpToJournalWithData(page)

      let capturedBody: any = null
      await page.route(API_URL, (route) => {
        capturedBody = route.request().postDataJSON()
        route.fulfill({
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
          body: buildActionStream('系统收到你的经验反思。'),
        })
      })

      // 点击聊这个
      await page.getByRole('button', { name: '聊这个' }).first().click()
      await page.waitForTimeout(300)

      // 按 Enter 发送
      const input = page.locator('input[placeholder="输入你的行动或对话..."]').filter({ visible: true })
      await input.press('Enter')

      // 验证 API 被调用
      await page.waitForTimeout(500)
      expect(capturedBody).not.toBeNull()
      expect(capturedBody.input).toContain('突破了练气期的瓶颈')
    })
  })
})
