# 上下文编排设计：分层组装 + 自动压缩

> 日期：2026-07-25
> 状态：设计阶段（待实现）
> 关联：实体生成触发设计、UI面板数据绑定

---

## 问题诊断

当前 `buildSystemPrompt()`（`agent-loop.ts:244`）是一个简单的字符串拼接器：

| 当前包含 | 当前缺失 |
|---------|---------|
| 玩家属性（HP/MP/境界/灵根...） | 当前位置有哪些NPC |
| 背包物品列表 | 当前位置的图鉴描述 |
| 功法/特质 | 活跃剧情事件摘要 |
| 计划进度（Plan-and-Execute） | **上一轮的叙事内容（前情提要）** |
| | **长期对话历史的压缩摘要** |

**根因**：LLM在上一轮叙事中描述了NPC和场景细节，但下一轮的system prompt完全没有这些信息。`turnHistory`只保留最近2轮迭代的工具调用/结果——叙事文本本身被丢弃了。

**后果**：
- 上下文断裂：LLM第一轮说"沈溪云是筑基期散修"，第二轮到村口就"无人无物无险"
- 没有压缩机制，长对话必然爆token
- RAG检索结果进入了上下文但没有被结构化利用

---

## 设计方案：三层上下文架构

参考 Claude Code 的分层系统提示词 + 四级压缩系统，适配游戏场景：

```
┌────────────────────────────────────────────┐
│  Layer 1: 静态层（永久缓存，不重复计算）       │
│  - GM角色定义、叙事规则                       │
│  - 修仙世界基本规则（境界体系、门派关系等）      │
│  - 工具使用规范                               │
│  → 写成独立模板文件，会话初始化时加载一次        │
├────────────────────────────────────────────┤
│  Layer 2: 动态层（每回合重新组装）              │
│  - 玩家状态快照（HP/MP/境界/位置/背包摘要）     │
│  - 当前位置NPC列表（从state.npcs按location过滤）│
│  - 当前位置图鉴描述（从state.codex取）          │
│  - 活跃剧情事件（status !== 'ended'）          │
│  - 前情提要（压缩后的对话历史摘要）              │
│  - 计划进度（planSteps + completedSteps）     │
├────────────────────────────────────────────┤
│  Layer 3: 临时层（回合结束即丢弃）              │
│  - 本轮工具调用结果（SearchArea、ExamineObject）│
│  - 本轮LLM中间推理                            │
│  → ephemeral数据，下回合过期                   │
└────────────────────────────────────────────┘
```

### 自动压缩触发机制

```
触发条件：上下文token数超过模型上限的 85%

压缩流程：
1. 保留最近 3 轮对话原文（不压缩）
2. 更早的对话 → 调用廉价模型（DeepSeek）生成摘要
   摘要格式：
   {
     玩家行动: "去了青云坊市后山采药",
     关键事件: "遇到了NPC王老四，购买了3颗回灵丹",
     当前目标: "准备突破到筑基期",
     重要NPC: ["王老四（好感+5）", "沈溪云（已结识）"]
   }
3. 摘要注入到 Layer 2 的"前情提要"字段
4. 旧对话原文从消息列表中移除
5. 压缩后的摘要累积：第2次压缩时，把第1次的摘要也纳入压缩范围
```

### 函数签名变更

```typescript
// 旧：简单字符串拼接
function buildSystemPrompt(player, ragContext, iteration, softLimit, planContext): string

// 新：结构化上下文组装
interface AssembledContext {
  staticBlock: string        // Layer 1 — 从模板文件加载，缓存
  dynamicBlock: string       // Layer 2 — 每回合重新构建
  ephemeralBlock: string     // Layer 3 — 本轮临时，回合结束清空
  estimatedTokens: number    // 估算token数，用于触发压缩判断
}

function assembleContext(state: AgentState, player: PlayerSnapshot): AssembledContext
```

### 动态层（Layer 2）的具体内容

```typescript
function buildDynamicBlock(state: AgentState, player: PlayerSnapshot): string {
  // NPC在场信息
  const npcsHere = (state.npcs ?? []).filter(
    n => n.currentLocation === state.currentLocation
  )
  const npcBlock = npcsHere.length > 0
    ? npcsHere.map(n => `- ${n.name}（${n.realm}，${n.sect}，${n.personality}）：${n.description}`).join('\n')
    : '当前位置没有其他人。'

  // 位置图鉴
  const locationCodex = state.codex.find(
    e => e.entry_type === 'location' && e.name === state.currentLocation
  )
  const locationBlock = locationCodex
    ? `${locationCodex.name}：${locationCodex.description}`
    : state.currentLocation

  // 活跃事件
  const activeSituations = state.situations.filter(s => s.status !== 'ended')
  const situationBlock = activeSituations.length > 0
    ? activeSituations.map(s => `- [${s.type}] ${s.title}：${s.trigger}`).join('\n')
    : '暂无特殊事件。'

  // 前情提要（压缩后的历史摘要）
  const summaryBlock = state.narrativeSummary ?? '（游戏刚开始）'

  return [
    `【当前位置】${locationBlock}`,
    `【在场人物】\n${npcBlock}`,
    `【活跃事件】\n${situationBlock}`,
    `【前情提要】${summaryBlock}`,
  ].join('\n\n')
}
```

### 文件变更清单

| 文件 | 改动 |
|------|------|
| `src/server/application/agent-loop.ts` | `buildSystemPrompt()` → `assembleContext()`；新增压缩触发逻辑 |
| `src/server/application/context-assembly.ts` | **新建** — 上下文组装纯函数 |
| `src/server/application/context-compression.ts` | **新建** — 压缩逻辑（触发判断+摘要生成） |
| `src/server/observability/token-estimator.ts` | **新建** — 简单token估算（1中文≈1.5 token） |
| `tests/unit/context-assembly.test.ts` | 上下文组装的单元测试 |
| `tests/unit/context-compression.test.ts` | 压缩逻辑的单元测试 |

### 验证方式

1. 单元测试：NPC在场信息正确注入、位置图鉴正确注入、压缩触发判断正确
2. 集成测试：模拟10轮对话后触发压缩，验证摘要质量
3. 浏览器测试：连续对话5轮以上，确认上下文不丢失
