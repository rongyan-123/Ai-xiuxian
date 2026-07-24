# 修仙Agent框架 — 架构头脑风暴日志

> 日期：2026-07-23
> 状态：第1轮头脑风暴完成
> 参与者：ffffyuan（用户）、Claude Opus 4.7

---

## 一、当前项目诊断

### 现状问题
`game-graph.ts` 是4节点线性LangGraph流水线：
- RAG检索 → LLM生成 → 规则引擎 → DB持久化
- 没有Agent循环（不能"LLM→工具→观察→再决策→再调用"）
- 没有决策层
- 没有回合编排
- 本质是"带工具格式的function call"，不是Agent

### 重写目标
- 真正的Agent生命周期
- 工具调用循环（tool-use loop）
- 决策层
- 回合制世界编排
- 区域推进
- 参考 Codex / Claude Code 的架构风格

---

## 二、核心理念：Agent = for循环，复杂度在世界层

### 关键洞察
- **The Bitter Lesson of Agent Frameworks**（Gregor Zunic, 2026）：Agent循环本身要极简——for循环 + 工具调用 + Done Tool + 临时消息。模型的能力远超框架假设。
- **StudyHeaven的教学框架设计**：固定生命周期时机，不固定行为。四种处理器（观察器/上下文贡献器/转换器/闸门），每种声明权限边界。
- **二者交集**：Agent循环极简，游戏世界的复杂度在循环之外——回合管理器、地区状态机、NPC调度器、修为系统。工具是Agent和世界的接口。规则通过能力闸门强制执行，不靠prompt约束LLM。

### 参考来源
- `D:\llm-wiki\wiki\engineering\summaries\bitter-lesson-agent-frameworks.md`
- `D:\StudyHeaven\教学Agent框架-初衷与设计原则.md`
- `D:\StudyHeaven\docs\教学Agent生命周期与前后端契约设计.md`
- `D:\llm-wiki\wiki\engineering\synthesis\teaching-agent-architecture-blueprint.md`

---

## 三、NPC自治分级系统（脑体分离架构）

### 核心原则：LLM是脑，行为树/状态机是身体

参考Aalto大学2026年论文 "The Mind and the Body"：
- LLM做高层决策（每天的计划、重要事件反应、与玩家对话）
- 行为树/状态机做执行（巡逻、炼丹、买卖等机械行为）
- LLM只在"决策点"被唤醒，不持续运行

### NPC自治分级（LOD for LLM）

| 层级 | 什么样的NPC | LLM做什么 | 成本/NPC/天 |
|------|------------|-----------|-------------|
| **T3 完整Agent** | 道侣、师父、宿敌、剧情核心 | 记忆流→每日规划→反思→对话，完整Generative Agents架构 | 30-50次调用 |
| **T2 混合Agent** | 宗门长老、坊市店主、任务NPC | LLM生成日计划 + 行为树执行 + 被搭话时LLM对话 | 5-10次调用 |
| **T1 模板NPC** | 路人修士、杂役弟子 | 纯行为树 + 模板对话。只有世界大事件才触发一次LLM | 0-1次调用 |
| **T0 宏观层** | 远域修士、其他势力 | 不存在独立实体，被聚合为宏观状态变量 | 零 |

### 参考来源
- CASCADE架构 (ACM 2026): 三层协调架构，Action-Dialogue解耦
- Personica AI (Unreal Engine插件): LLM生成Action Plan，行为树执行，Reflex Threshold可中断
- 斯坦福Generative Agents (Smallville): 记忆流→检索→反思→规划 架构

---

## 四、NPC上下文问题：知识气泡 + 世界约束编译

### 用户的痛点（ffffyuan提出）
NPC每次调用LLM要带上"不能冒犯高阶修士"等世界观约束，否则行为不合理。但如果每次发完整世界状态，token爆炸。多Agent修正层也不解决问题——该烧的token还是烧。

### 解法：三层紧凑上下文

NPC的LLM调用只接收：

```
[约束] ← 区域DM编译，同区域所有NPC复用，不变不重新生成
  你是练气三层散修。金丹以上:跪拜。筑基:恭敬。同阶:平等。
  魔教弟子:立刻逃跑。禁地:不可进入。坊市:可交易不可偷窃。

[本地] ← 当前区域动态，几十token
  坊市今日人流稀疏，西边有打斗痕迹。

[个人] ← 自己的记忆和状态
  昨天采到30年灵芝，灵石12块，想买新功法。
```

**关键节省机制：**
1. 约束规则由区域DM每区域每天编译一次，同区域所有NPC共享
2. 区域不变不重新生成
3. NPC只看到他该知道的事（知识气泡），不知道帝都的政治
4. 对话时的即时上下文（跟玩家聊什么）是额外追加的，被当前对话内容填充

### 区域DM模式
- 每区域/每天1次LLM调用 → 生成区域内所有T2+ NPC的日计划 + 编译约束规则
- 替代逐个NPC调用的方案（8个NPC → 1次DM调用）
- T3关键NPC仍独立调用（需要深度记忆和复杂叙事）

---

## 五、回合制与时间推进：横向执行

### 用户决策（ffffyuan）
采用**横向执行**，参考《觅长生》的闭关系统：
- 逐小时推进，每小时更新所有相关NPC
- 每小时完成后打检查点
- 玩家可随时退出 → 回到最近完整小时 → 世界一致性保证
- 最多丢失1小时模拟

### 时间推进策略

```
玩家在"青云坊市"闭关8小时：

  青云坊市（玩家所在）： 逐小时横向执行
    每小时: 所有NPC tick → 行为树更新 → 必要LLM调用 → 检查点保存
  
  玄天宗（本域内）： 跳到8小时后，宏观状态机批量更新
    不逐小时，因为玩家看不到中间状态
  
  西漠（远域）： 不更新
    除非触发跨域大事件
```

### 关键规则
1. 同一区域内，每个小时是原子单位——所有NPC统一推进
2. 检查点保存完整状态快照
3. 玩家中断 = 回到最近检查点
4. 远区域不消耗模拟资源
5. 世界模拟和玩家UI完全解耦——模拟在后台跑，不阻塞界面

---

## 六、待讨论问题

1. Agent循环的具体设计：
   - 一回合内 LLM→工具→观察→再决策 的循环边界和退出条件
   - Done Tool 的具体语义
   - 临时消息(ephemeral messages)在游戏场景中的实现
   
2. 玩家输入层：
   - 玩家输入如何被标准化后进入Agent循环
   - 自由文本输入 vs 结构化行动选择的边界

3. 流式输出策略：
   - SSE/通道设计
   - 工具调用进行中如何通知前端

4. 记忆系统：
   - 热/温/冷三层记忆的持久化方案
   - 跨会话记忆（玩家退出后再回来，NPC还记得他）

5. 多Agent协调：
   - T3 NPC之间如何形成一致叙事
   - 冲突检测（NPC A的LLM行为不能和NPC B的LLM行为矛盾）

---

## 七、参考文献清单

### 必读
- `D:\llm-wiki\wiki\engineering\summaries\bitter-lesson-agent-frameworks.md` — Agent框架的苦涩教训
- `D:\llm-wiki\wiki\engineering\summaries\bitter-lesson-agent-harnesses.md` — Harness设计的苦涩教训
- `D:\StudyHeaven\教学Agent框架-初衷与设计原则.md` — 北极星原则
- `D:\StudyHeaven\docs\教学Agent生命周期与前后端契约设计.md` — 生命周期正式设计

### 架构参考
- CASCADE: A Cascading Architecture for Social Coordination (ACM 2026)
- Generative Agents: Interactive Simulacra of Human Behavior (Stanford, 2023)
- "The Mind and the Body" Hybrid Architecture (Aalto University, 2026)
- Personica AI — Unreal Engine LLM-NPC Plugin
- Emergent Narrative Orchestration (yoo.be, 2026)

### LLM Wiki相关
- `D:\llm-wiki\wiki\engineering\concepts\ephemeral-messages.md`
- `D:\llm-wiki\wiki\engineering\concepts\cross-session-agent-memory.md`
- `D:\llm-wiki\wiki\engineering\concepts\agent-jit-compilation.md`
- `D:\llm-wiki\wiki\engineering\concepts\plan-then-execute-security.md`

---

## 八、约束注入机制：动态bound + 突破规则者

### 用户思考（ffffyuan）

**核心洞察**：如果所有NPC都服从同样的约束规则，世界会很无聊。需要"规则破坏者"——
- 某些店主是黑商，无视"公平交易"规则
- 某些修士傲慢，不向长老行礼
- 某些人不遵守区域潜规则

**关键问题**：约束规则到底放在哪里？怎么注入？这决定了"动态绑定"怎么做。

### 架构决定：约束规则的位置

约束规则不是prompt模板，不是Agent的一部分。它是**区域状态的结构化数据**，由区域DM生成，存在区域状态中，由NPC上下文构建器注入。

```
                    ┌─────────────────────────────┐
                    │  Region DM（每区域每天1次）     │
                    │  输入: 区域的世界状态            │
                    │  输出: constraint_rules[]      │
                    └──────────┬──────────────────┘
                               │
                               ▼
                    ┌─────────────────────────────┐
                    │  Region State（持久化存储）     │
                    │  constraint_rules: [          │
                    │    { id, text, category,      │
                    │      default_bound },         │
                    │    ...                         │
                    │  ]                             │
                    └──────────┬──────────────────┘
                               │
                               ▼
                    ┌─────────────────────────────┐
                    │  NPC Factory（NPC创建/迁入时）  │
                    │  for each rule:               │
                    │    ① 检查NPC trait是否覆盖     │
                    │       "黑商" → trade=始终false │
                    │       "傲慢" → hierarchy=     │
                    │                始终false       │
                    │    ② 无trait覆盖 → 概率决定    │
                    │       REBELLION_RATE: 5-10%   │
                    │    ③ 结果写入                   │
                    │    npc.constraint_bindings     │
                    └──────────┬──────────────────┘
                               │
                               ▼
                    ┌─────────────────────────────┐
                    │  NPC Context Builder         │
                    │  （每次NPC LLM调用时执行）      │
                    │                              │
                    │  输入:                        │
                    │    region.constraint_rules    │
                    │    npc.constraint_bindings    │
                    │    npc.personal_memory        │
                    │    local_events               │
                    │                              │
                    │  输出:                        │
                    │    [约束]                      │
                    │    只注入bound=true的规则       │
                    │    [本地]                      │
                    │    [个人]                      │
                    └─────────────────────────────┘
```

### 具体数据流

**Region DM生成（LLM调用1次）：**
```json
{
  "region": "青云坊市",
  "constraint_rules": [
    {
      "id": "hierarchy_greet",
      "category": "social",
      "text": "金丹以上修士需跪拜行礼，筑基修士需恭敬对待",
      "default_bound": true
    },
    {
      "id": "trade_fair",
      "category": "economic",
      "text": "坊市交易价格浮动不得超过30%，禁止欺诈",
      "default_bound": true
    },
    {
      "id": "forbidden_inner_sect",
      "category": "spatial",
      "text": "未经许可不得进入宗门内门区域",
      "default_bound": true
    },
    {
      "id": "demon_flee",
      "category": "survival",
      "text": "遇到魔教弟子应立即逃跑，不得对抗",
      "default_bound": true
    }
  ]
}
```

**NPC绑定生成（确定性函数，无LLM）：**
```python
def generate_constraint_bindings(npc, region_rules):
    bindings = {}
    for rule in region_rules:
        # 1. Trait覆盖（确定性）
        if npc.has_trait("黑商") and rule.category == "economic":
            bindings[rule.id] = False  # 黑商无视交易规则
        elif npc.has_trait("傲慢") and rule.id == "hierarchy_greet":
            bindings[rule.id] = False  # 傲慢者不行礼
        elif npc.has_trait("魔修") and rule.category == "survival":
            bindings[rule.id] = False  # 魔修不逃魔教
        # 2. 概率反叛
        elif random() < REBELLION_RATE:  # 5-10%
            bindings[rule.id] = False
        # 3. 默认服从
        else:
            bindings[rule.id] = True
    return bindings
```

**NPC Context Builder注入（每次LLM调用，确定性）：**
```
[约束]
  金丹以上修士需跪拜行礼，筑基修士需恭敬对待    ← bound=true
  未经许可不得进入宗门内门区域                  ← bound=true
  遇到魔教弟子应立即逃跑，不得对抗              ← bound=true
  （trade_fair被排除— 此NPC是黑商，bound=false）

[本地]
  坊市今日人流稀疏，西边有打斗痕迹

[个人]
  ...
```

### 关键设计点

1. **约束规则在Region DM层生成** — 和NPC日计划一起，1次LLM调用产出整个区域的约束
2. **绑定在NPC创建时确定** — 无LLM消耗，纯确定性逻辑
3. **注入在上下文构建时执行** — 每次NPC LLM调用前，过滤出bound=true的规则
4. **NPC不知道自己"违反"了规则** — bound=false的规则对其不可见，行为自然偏离
5. **可序列化、可测试** — bindings是普通JSON，可以dump出来检查哪个NPC违了哪条规则
6. **T3 NPC的bindings更复杂** — 可以由LLM在反思时动态修改（"我决定不再向任何人下跪" → hierarchy_greet从true变为false）

### 突破规则者的类型

| 来源 | 机制 | 例子 |
|------|------|------|
| Trait驱动 | NPC trait → 确定性覆盖特定规则 | "黑商"→经济类规则=false |
| 概率反叛 | 5-10%概率随机false | 普通修士偶尔不行礼 |
| 派系驱动 | 所属势力→特定规则反转 | 魔教→正道规则=false |
| T3自我演化 | LLM反思→主动修改自己的bindings | "经历背叛后不再信任任何人"→social类规则=false |
| 事件触发 | 世界大事件→区域规则改写 | "魔教入侵"→安全类约束从"不可私斗"改为"允许自卫" |

### 与之前讨论的一致性

这个设计完全兼容第五节"三层紧凑上下文"——约束规则仍然是同区域所有NPC共享的，只是每个NPC的bindings不同，导致看到的约束子集不同。不是每次重新生成约束，而是复用同一套规则、不同绑定。

---

## 九、游戏模式：模拟器 vs 爽文剧情流

### 用户决策（ffffyuan）

**选择C型世界驱动回合 + 模拟器为主**

- 玩家输入不干扰世界运行，只是输入角色的行为决策
- 世界有自己的时钟，玩家只是世界中的一个实体
- **模拟器模式（默认/硬核）**：世界不偏袒玩家，要死就真死
- **可选的难度系统**：Easy模式才向"爽文剧情流"倾斜（金手指、巧合救场）
- 先做模拟器，这是正儿八经的游戏模式

### 为什么C型（世界驱动回合）

不同于A型（纯聊天地下城）和B型（全Agent持续运行）：
- A型太简陋——每次都是玩家→AI→玩家，没有世界感
- B型太贵——所有NPC持续运行LLM，token爆炸
- **C型是唯一合理的**——世界按时钟推进，玩家是事件源之一

### 架构含义

```
世界时钟（World Clock）
  │
  ├── 刻度: 游戏内分钟/小时/天
  │
  ├── 推进触发:
  │   ① 玩家行动消耗时间 → 世界快进到那个时间点
  │      "修炼8小时" → world.advance(8h)
  │      "御剑飞往玄天宗" → world.advance(2h)
  │   ② 玩家挂机/不操作 → 世界自然流逝
  │      （可选，可能只在特定模式下启用）
  │
  └── 处理:
       ┌─────────────────────────────────┐
       │  Time Slicer（时间切片器）        │
       │  for each hour in advance_by:    │
       │    ① 处理玩家所在区域的NPC tick    │
       │    ② 处理本域其他区域的宏观tick    │
       │    ③ 触发定时事件（天象、任务）    │
       │    ④ 保存检查点                   │
       └─────────────────────────────────┘
```

### 难度滑块：模拟度参数

| 参数 | 硬核（100%模拟） | 中等 | 简单（偏向爽文） |
|------|-----------------|------|-----------------|
| NPC对玩家的初始态度 | 中立/冷漠 | 略友好 | 普遍友善 |
| 致命伤害保护 | 无，死了就是死了 | 1次免死 | 3次免死+强制救场 |
| 巧合引擎 | 关闭 | 关键剧情点触发 | 频繁触发（高人路过、天材地宝刚好出现） |
| NPC信息共享 | NPC之间自由传播玩家的情报 | 略微受限 | 很少传播 |
| 敌人强度 | 区域真实水平 | 略微放水 | 明显弱化 |
| 修炼失败惩罚 | 可能走火入魔、修为倒退 | 轻微惩罚 | 无惩罚 |
| 资源获取倍率 | 1x | 1.5x | 3x |

### 模拟度如何落地到架构

不是两套代码，而是在关键决策点注入 `simulation_fidelity` 参数：

- **Region DM生成事件时**：高模拟度→随机事件均匀分布；低模拟度→偏向有利事件
- **NPC态度计算时**：高模拟度→基于性格+关系；低模拟度→额外友好偏移
- **战斗结算时**：高模拟度→真实伤害计算；低模拟度→隐藏减伤
- **巧合引擎**：只在低模拟度时运行，检测玩家困境→生成救援事件

---

## 十、Agent循环正式设计

### 调研来源

- **Claude Code源码分析**（`src/query.ts` → `queryLoop()`）：
  - 5阶段循环：接收提示→评估响应→执行工具→重复→返回结果
  - 核心：`while(turn < maxTurns) { streaming API → tool execution → termination check → continue/break }`
  - Done条件：模型不返回tool_use，只返回text（隐式Done，不是单独Done Tool）
  - 流式工具执行：工具在模型还在输出时就开始跑
  - 11+终止条件：不只是"无工具"，还包括错误、预算、hook阻止、用户中断
  - 不可变State：每次迭代产生新State
  - 5步上下文预处理管道（每轮LLM调用前）

- **PI-Agent**：
  - 25+ hook事件，7生命周期类别
  - 完整粒度：turn_start→tool_call→tool_execution_start→tool_execution_update→tool_execution_end→tool_result→message_start→message_update→message_end→turn_end→agent_end

- **StudyHeaven生命周期设计**：
  - 23事件，4种处理器（观察器/上下文贡献器/转换器/闸门）
  - 4种时间单位：会话/用户回合/模型步骤/能力动作

- **Anthropic Agent设计指南(2026)**：
  - Harness是消耗性资产
  - 上下文腐烂问题
  - 渐进式Skill加载（Layer1/2/3）
  - 工具限制在4-5个同时暴露

### 游戏 vs 编程Agent的关键差异

| 维度 | Claude Code | 修仙游戏Agent |
|------|------------|-------------|
| 文本输出的意义 | 给用户的解释/总结 | **就是游戏内容本身**（叙述、对话） |
| 工具调用的目的 | 读文件、编辑、搜索代码 | 查世界状态、修改游戏数据、触发事件 |
| 终止条件 | 不再需要工具 | 叙事片段完成 + 不需工具 |
| text+tool同时出现 | 少见（通常先调工具再总结） | **频繁**（边叙述边调工具更新状态） |
| 回合边界 | 任务完成 | 叙事段落完成 或 需要玩家决策 |

### Agent循环状态机

```
State {
  messages: Message[]           // 完整对话历史
  playerState: PlayerSnapshot   // 玩家当前状态
  regionSnapshot: RegionState   // 当前区域快照
  activeNpcs: NpcContext[]      // 当前场景中的NPC上下文
  pendingToolCalls: ToolCall[]  // 等待执行的工具
  toolResults: ToolResult[]     // 本轮工具结果
  turnBudget: number            // 本回合最大工具迭代次数（默认10）
  turnCount: number             // 已执行的迭代次数
  finalResponse: string | null  // 当LLM无tool_use时设置
  executionError: Error | null
  cancelled: boolean            // 玩家中断
}
```

### 主循环伪代码

```typescript
async function gameAgentLoop(input: PlayerInput, state: GameState): Promise<TurnResult> {
  // ── turn.start ──
  const turnState = initializeTurnState(state, input)
  
  // ── 主循环 ──
  while (turnState.turnCount < turnState.turnBudget && 
         !turnState.finalResponse && 
         !turnState.cancelled) {
    
    // ── context.preparing ──
    // 并行获取：RAG检索、NPC知识、区域事件
    const context = await assembleContext({
      systemPrompt: buildSystemPrompt(state),
      constraints: state.region.constraint_rules,  // 玩家也受区域约束
      localEvents: state.region.recent_events,
      playerState: turnState.playerState,
      npcContexts: turnState.activeNpcs,
      conversationHistory: turnState.messages,
      toolResults: turnState.toolResults,
    })
    
    // ── context.ready ──
    validateContextBudget(context)  // token预算校验
    
    // ── model.beforeCall ──
    // 注入游戏参数、校验请求
    const request = prepareModelRequest(context, state.tools)
    
    // ── LLM调用（流式）──
    const stream = await llm.completeStream(request)
    
    let fullText = ''
    let toolUseBlocks: ToolUseBlock[] = []
    
    for await (const chunk of stream) {
      if (chunk.type === 'text_delta') {
        fullText += chunk.text
        // → capability.beforeExecute NOT here
        //   文本直接流到玩家UI
        emitToPlayer(chunk.text)     // model.delta
      }
      if (chunk.type === 'tool_use') {
        toolUseBlocks.push(chunk.tool_use)
      }
    }
    
    // ── model.afterCall ──
    recordModelUsage(stream.usage)
    
    // ── 判断：是否有工具调用 ──
    if (toolUseBlocks.length === 0) {
      // 模型只输出文本 → 回合完成
      turnState.finalResponse = fullText
      break
    }
    
    // ── 工具执行 ──
    for (const tool of toolUseBlocks) {
      // ── capability.beforeExecute（🔒能力闸门）──
      const gateResult = capabilityGate.check(tool, turnState)
      if (!gateResult.allowed) {
        // 闸门拒绝 → 注入错误观察，让LLM知道不能这样做
        turnState.toolResults.push({
          toolName: tool.name,
          status: 'blocked',
          reason: gateResult.reason,
        })
        continue
      }
      
      // ── 执行工具 ──
      const result = await executeTool(tool, turnState)
      
      // ── capability.afterExecute ──
      // 更新游戏状态、记录delta
      applyToolResultToState(result, turnState)
      turnState.toolResults.push(result)
    }
    
    turnState.turnCount++
    // 临时消息处理：大的工具结果标记ephemeral
    pruneEphemeralResults(turnState.toolResults)
  }
  
  // ── response.beforeCommit ──
  validateFinalResponse(turnState.finalResponse)
  
  // ── response.committed ──
  await persistTurn(turnState)
  
  // ── turn.end ──
  if (input.costsTime) {
    await worldClock.advance(input.timeCost)  // → 触发世界推进
  }
  
  return { response: turnState.finalResponse, deltas: turnState.deltas }
}
```

### 具体例子：玩家"去后山采药"（修正版——先查询后描述）

```
Turn开始（turnCount=0, 复杂度=中等→软上限8, 硬上限16）

→ context: [玩家=练气三层, 位置=青云坊市, 后山情况未知, 未探查]
→ LLM流式输出:
    文本: "你推开坊市后门，踏上了通往后山的碎石小径。晨雾未散，
          空气中带着草木的清香。这条山路平日里采药人往来不绝..."
         ↑ 只描述移动+气氛，不描述具体发现物
    工具: Change_Location(to="后山")
    工具: Search_Area(type="灵草", zone="外围")
→ 闸门: Change_Location ✓, Search_Area ✓
→ 执行Search_Area → 查询世界状态 → 
    返回: "外围区域:已被采掘殆尽,仅存1株幼年凝气草(品质低劣)
          原因:坊市附近,采药人频繁光顾,灵草生长赶不上采掘速度"
→ turnCount=1, needsFollowUp=true

→ context补充: [位置=后山外围, 灵草=幼年凝气草×1(品质低劣), 说明采掘过度]
→ LLM流式输出:
    文本: "你沿着山径找了好一阵。外围的灵草早被早起的采药人搜刮干净了。
          正当你准备往深处走时，石缝间一点微弱的光引起了你的注意——"
    工具: Examine_Object(target="发光石缝")
    工具: Search_Area(type="生物", zone="中围")
→ 闸门: ✓
→ 执行Examine: "一株幼年凝气草，尚未长成。药力不足市售品的三成，
               但无人采摘，或许是因为太小被忽略了"
→ 执行Search_Area: "中围区域:探查到2只野狼(练气二层级)在巡逻"
→ turnCount=2

→ LLM输出:
    文本: "那是一株没长开的小凝气草，药力微弱，难怪被其他采药人放过。
          再往深处，你隐约听到了狼嚎——中围有妖兽出没的迹象。
          你可以：[采集这株凝气草] [继续深入中围] [返回坊市]"
    工具: 无 ← Done!
→ turnCount=2, done=true, 回合结束

对比修正前vs修正后:
  修正前: LLM凭空创造了"3株凝气草+1株止血花+受伤赤焰狐"
  修正后: 世界状态告诉LLM"外围已被采尽, 只剩1株劣质灵草, 中围有狼"
  LLM基于事实叙事, 不脑补世界内容
```

### 终止条件（修订版——动态预算+每步超时）

**复杂度估算（入口处，一次性，无额外LLM调用）：**

```typescript
function estimateComplexity(input: string): { softLimit: number; hardLimit: number } {
  // 简单启发式，不调LLM
  if (input.match(/打|战斗|攻击|杀|逃|防御|施法/)) 
    return { softLimit: 15, hardLimit: 25 }  // 复杂
  if (input.match(/去|探索|寻找|前往|调查|潜入/))
    return { softLimit: 8, hardLimit: 16 }   // 中等
  return { softLimit: 3, hardLimit: 6 }       // 简单
}

// 动态升级：LLM触发了战斗工具 → 自动升级到复杂预算
// 动态升级：LLM触发了多NPC互动 → 自动升级到复杂预算
```

**修订后的终止条件：**

| # | 条件 | 行为 |
|---|------|------|
| 1 | **正常完成**: 模型返回text, 无tool_use | done=true, 展示最终回复 |
| 2 | **软上限到达**: turnCount ≥ softLimit 且未done | 注入"请尽快收束当前场景", 不打断 |
| 3 | **硬上限到达**: turnCount ≥ hardLimit | 强制"立即总结当前情况", 用最后一次LLM调用生成文本 |
| 4 | **玩家取消**: cancelled=true | 回滚未提交状态, 返回"已中断" |
| 5 | **LLM错误**: 模型API失败 | 降级回复 或 错误提示 |
| 6 | **token超限**: 上下文超过阈值 | 触发压缩, 压缩失败→强制结束 |
| 7 | **闸门阻断累积**: 连续3次被拒绝 | 注入"行动被世界规则阻止"→让LLM调整 |
| 8 | **工具执行失败**: 工具返回error | 注入错误观察, 让LLM自行处理 |
| 9 | **单次LLM调用超时**: 超过30秒 | 重试1次→降级回复 |
| 10 | **单次工具超时**: 超过15秒 | 返回timeout观察, 继续循环 |
| 11 | **玩家提示**: 回合超过90秒 | 显示"处理中，是否继续？"（不强制结束） |
| 12 | **max_output_tokens**: 模型输出被截断 | 注入"继续"提示, 最多重试3次 |
| 13 | **hook阻止**: response.beforeCommit拒绝 | 修改回复或重新生成 |
| 14 | **世界状态异常**: 玩家死亡/区域不可用 | 立即终止, 进入死亡流程 |

**超时策略（修订版）：**

```
不是"回合总超时", 是"每步各自超时":

  每次LLM调用:    30秒超时 → 超时→重试1次→降级
  每次工具执行:    15秒超时 → 超时→返回{status:"timeout", message:"操作超时"}
  回合总时长:      90秒后 → 玩家感知提醒, 不强制结束
                  （因为流式文本一直在输出, 玩家不觉得在等）

为什么不用固定回合总超时:
  - 玩家看到文本在流式输出 → 在阅读 → 不焦虑
  - 工具在后台执行 → 如果只是"处理中..."太久 → 才需要提醒
  - 真正需要超时的是卡死/网络故障/LLM无响应
```

### Hook事件表（游戏适配版，19事件）

参考PI-Agent 25+事件 + StudyHeaven 23事件，裁剪为游戏需要的最小集：

| # | 事件 | 时机 | 类型 | 游戏专用逻辑 |
|---|------|------|------|-------------|
| 1 | `session.ready` | 会话就绪 | 观察 | 加载玩家状态、区域快照、NPC状态 |
| 2 | `turn.start` | 回合开始 | 观察 | 初始化turn预算、检查前置条件 |
| 3 | `input.received` | 收到玩家输入 | 转换 | 标准化输入、行为信号提取 |
| 4 | `context.preparing` | 组装上下文前 | 贡献 | 并行：RAG检索+NPC知识+区域事件 |
| 5 | `context.ready` | 上下文定稿 | 转换 | token预算校验、去重、记录来源 |
| 6 | `model.beforeCall` | LLM调用前 | 闸门 | 校验请求、注入游戏约束 |
| 7 | `model.delta` | 流式增量 | 观察 | 转发文本到玩家UI |
| 8 | `model.afterCall` | LLM完成 | 观察 | 解析tool_use、记录用量 |
| 9 | `capability.beforeExecute` | 工具执行前 | **闸门** | **🔒 游戏规则强制（最重要）** |
| 10 | `capability.afterExecute` | 工具执行后 | 转换 | 更新状态、生成delta |
| 11 | `response.beforeCommit` | 最终回复前 | 闸门 | 校验无OOC、无剧透、格式正确 |
| 12 | `response.committed` | 回复入会话 | 观察 | 持久化到存储 |
| 13 | `turn.end` | 回合完成 | 观察 | 推进世界时间、释放资源 |
| 14 | `turn.cancelled` | 玩家停止 | 观察 | 回滚未提交状态 |
| 15 | `world.beforeAdvance` | 世界推进前 | 贡献 | 决定推进哪些区域、触发条件 |
| 16 | `world.afterAdvance` | 世界推进后 | 观察 | 触发事件、更新NPC状态 |
| 17 | `npc.beforePlan` | NPC日计划前 | 贡献 | 注入区域约束+个人bindings |
| 18 | `npc.afterPlan` | NPC计划生成后 | 闸门 | 校验计划不越界 |
| 19 | `session.beforeEnd` | 会话结束前 | 观察 | 最后一次持久化 |

### 四种处理器类型（复用StudyHeaven分类）

| 类型 | 能做什么 | 能否阻断 | 游戏例子 |
|------|---------|---------|---------|
| 观察器 | 读取事件+记录，不修改主流程 | 否 | 用量统计、日志 |
| 上下文贡献器 | 提供额外上下文片段 | 通常否 | RAG检索、NPC知识注入、约束注入 |
| 转换器 | 修改输入、上下文或输出 | 按声明 | 输入标准化、工具结果格式化 |
| 闸门 | 确定性允许/拒绝/修改 | **是** | **游戏规则强制、权限控制、防越界** |

### 关键设计原则

1. **Agent循环极简** — for循环+工具调用+隐式Done，不多加抽象
2. **闸门是唯一强制层** — 游戏规则不靠prompt约束，靠`capability.beforeExecute`闸门
3. **文本即游戏内容** — LLM输出直接展示给玩家，不经过"翻译层"
4. **流式=沉浸感** — 文本实时流向玩家，玩家看到的是"写出来的"不是"返回的"
5. **turn预算防无限循环** — 默认10次迭代/回合，足够用但不会跑飞
6. **临时消息防context腐烂** — 大的工具结果（区域描述、搜索结果）标记ephemeral=3
7. **不可变State** — 每次迭代产生新State，便于调试和回滚

### 参考来源
- Claude Code源码分析: `src/query.ts` queryLoop() 实现
- Claude Code官方文档: https://code.claude.com/docs/en/how-claude-code-works
- Claude Code Agent SDK: https://code.claude.com/docs/en/agent-sdk/agent-loop
- PI-Agent Hook系统: https://github.com/disler/pi-vs-claude-code
- Anthropic Agent设计指南2026: `D:\llm-wiki\wiki\engineering\summaries\anthropic-agent-guidelines-2026.md`
- Agent Harness设计: `D:\llm-wiki\wiki\engineering\concepts\agent-harness-design.md`
- Hook生命周期架构: `D:\llm-wiki\wiki\engineering\concepts\hook-lifecycle-architecture.md`
- 临时消息: `D:\llm-wiki\wiki\engineering\concepts\ephemeral-messages.md`
- Plan-Then-Execute安全架构: `D:\llm-wiki\wiki\engineering\concepts\plan-then-execute-security.md`
- StudyHeaven生命周期设计: `D:\StudyHeaven\docs\教学Agent生命周期与前后端契约设计.md`

### 问题修正记录（ffffyuan 2026-07-23）

**问题1: 逻辑一致性 — LLM不能凭空创造世界内容（已修正）**

原例中LLM在Search_Area返回前就描述了"凝气草×3+止血花×1+赤焰狐"。坊市后山是高频区域，不可能有这些东西。LLM在写小说而非查询世界。

修正方案（三层）：
1. **System Prompt约束** — 叙事规则强制"先探查后描述"
   ```
   [叙事规则]
   - 描述具体发现物（物品/生物/NPC/事件）前，必须先调用对应的探查工具
   - 描述移动过程、环境气氛、角色感受 → 不需要工具（这些是角色直接体验的）
   - 工具返回什么就描述什么，不添加工具未返回的内容
   ```
2. **世界状态是唯一真相源** — 工具返回的世界查询结果不可被LLM覆盖
   - Search_Area → 世界模拟层查询该区域的实际状态 → 返回事实
   - LLM只能基于事实叙述，不能编造
3. **流式输出的显示控制** — 在工具结果返回前，只显示气氛/移动类文本
   - `model.delta` 中的文本分两类：安全文本（气氛/移动）直接流到UI；待确认文本（描述发现物）等待对应工具结果返回后再放行

**世界权威原则（World Authority Principle）：**
```
LLM = 叙述者, 不是世界创造者
世界模拟层 = 唯一真相源

正确的叙事流:
  ① LLM描述移动+气氛 → 玩家看到
  ② LLM调用探查工具 → 世界层查询实际状态
  ③ 工具返回事实 → 注入LLM上下文
  ④ LLM基于事实继续叙述 → 玩家看到
  
永远不允许: LLM直接描述"你看到了X" → 然后才调工具查是否真的有X
```

**问题2: Turn预算 — 固定10次改为动态估算+软硬上限（已修正）**

原设计中固定10次预算不合理。简单对话只需要2-3次，复杂战斗可能需要15次。增加了复杂度估算（输入启发式，不调LLM）、软上限（提示收束）、硬上限（强制总结+最后一次LLM调用）。

**问题3: 超时 — 固定60秒改为每步超时+总时长柔性提醒（已修正）**

原设计中固定60秒回合超时不合理。改为：每次LLM调用30秒超时、每次工具15秒超时、回合90秒时给玩家提醒但不强制结束。因为流式文本一直在输出，玩家不觉得在等。

---

## 十一、工具系统：五类工具的严格定义

### 为什么需要分类

"工具"这个词被混用了——游戏操作、LLM函数调用、UI面板、行为树节点…全叫工具。必须先拆开，
才能讨论谁用什么、怎么限制。

### 五类工具

#### 第一类：感知查询（LLM → 世界，只读，临时消息）

LLM问世界"这里有什么"，世界回答。**LLM获取真相的唯一渠道。**
用完即弃——本轮工具结果在回合结束后从上下文中移除。

```
SearchArea(zone, type)         → {区域现状, 物品, 生物, 危险}
ExamineObject(target)          → {详细描述, 品质, 状态}
SenseDanger(radius)            → {附近威胁列表, 强度评估}
CheckNpcState(npc_id)          → {NPC当前状态, 记忆摘要, 态度}
QueryRegion(region)            → {区域宏观: 势力, 事件, 流言}
RecallMemory(query, target)    → {搜索实体记忆, 返回相关片段}
```

**谁用**: 主控Agent ✓ | LLM模式NPC ✓（范围受限于知识气泡） | 状态机NPC ✗ | 玩家 ✗
**闸门**: 不走（只读，无状态修改）
**上下文策略**: **ephemeral=本轮**（回合结束后从消息列表移除，下回合不保留）
**为什么只保留本轮**: 感知查询结果是"工具返回了什么"，不是"对话内容"。下个回合环境变了，旧结果就是垃圾。

#### 第二类：世界行动（LLM → 世界，写入，闸门强制管控）

LLM想改变世界状态。**必须经过capability.beforeExecute闸门。**
这是不可跳过、不可prompt绕过的程序层强制。

```
ChangeLocation(who, to)                  → 移动实体到新位置
ModifyStats(who, changes)                → HP/MP/修为/神识变化  
ModifyInventory(who, additions, removals) → 物品增减
UpdateRelationship(a, b, delta)          → 关系值变化
TriggerCombat(participants, context)     → 进入战斗→战斗系统接管
CreateSituation(title, type, npcs...)    → 创建叙事局面
ResolveSituation(id, outcome)            → 结局局面
CreateForeshadowing(...)                 → 埋设伏笔
AdvanceTime(duration)                    → 消耗时间→世界钟推进
```

**谁用**: 主控Agent ✓ | LLM模式NPC ✗（NPC不可直接写世界） | 状态机NPC ✗ | 玩家 ✗
**闸门**: **必须走**（最重要的闸门拦截点）
**上下文策略**: 保留action记录（做了什么），丢弃具体参数细节

#### 第三类：NPC行为（LLM-NPC → 自己，计划/记忆/对话，不可写世界）

NPC的LLM只能思考和表达，不能直接改世界。行为通过计划→行为树→世界层结算。

```
GenerateDailyPlan()        → {今日计划: [{action, time, location, reason}]}
DecideReaction(event)      → {反应: action, dialogue_hint, emotion}
FormMemory(content, tags)  → {写入记忆流, 标记重要性}
GenerateDialogue(对方信息) → {对话文本}
SelfReflection()           → {反思: 新认知, bindings修改建议, 目标调整}
```

**谁用**: LLM模式NPC ✓ | 主控Agent ✗ | 状态机NPC ✗ | 玩家 ✗
**闸门**: 计划合理性校验（npc.afterPlan钩子）
**上下文策略**: 记忆保留在NPC记忆流（外部存储），不留在对话上下文

#### 第四类：叙事输出（LLM → 玩家，直接文本流）

**这些不是工具调用。** 是LLM直接输出的文本，是游戏内容本身。

```
叙述文本:    "\"晨雾未散，碎石小径蜿蜒入山...\""
NPC对话:     "王老四苦笑：\"道友，这价钱已经很公道了...\""
系统信息:    "[凝气草 ×1 已收入背包]"
选择提示:    "\"你可以：[采集灵草] [救助赤焰狐] [悄悄离开]\""
```

**谁输出**: 主控Agent（核心职责）| LLM模式NPC（对话） | 状态机NPC（模板文本，非LLM输出）
**闸门**: response.beforeCommit（格式校验、OOC检测、剧透检测）
**上下文策略**: 保留在对话历史（这是"说了什么"，需要跨回合记住）

#### 第五类：UI面板（玩家 → 客户端，不走Agent循环）

玩家点击按钮 → 前端直接从state读数据渲染。**不消耗token，不经过Agent。**
这些不是Agent体系的一部分。

```
打开背包      → 前端读 inventory state → 渲染物品列表
查看属性      → 前端读 stats state → 渲染属性面板
翻阅记事本    → 前端读 journal state → 渲染日志列表
查看地图      → 未实现（需要先在UI侧做）
```

**谁用**: 玩家通过UI点击 | 无Agent参与 | 无LLM消耗
**闸门**: 不需要
**上下文策略**: 不影响Agent上下文

### 分类总表

| 类别 | 本质 | 谁调用 | Agent循环 | 闸门 | 上下文策略 |
|------|------|--------|:---:|:---:|------|
| 感知查询 | LLM读世界 | 主控Agent, LLM-NPC | ✓ | 不需要(只读) | **ephemeral=本轮** |
| 世界行动 | LLM写世界 | 仅主控Agent | ✓ | **🔒必须** | 保留动作记录 |
| NPC行为 | NPC思考自己 | 仅LLM-NPC | ✓ | 计划校验 | 存记忆流(外部) |
| 叙事输出 | 游戏内容本身 | 主控Agent, LLM-NPC | ✓ | beforeCommit | 保留在对话史 |
| UI面板 | 前端读state | 玩家点击 | ✗ | ✗ | 不进入Agent |

### 临时消息(Ephemeral)在游戏中的应用

```
一个回合内的Agent上下文:

  [系统提示] ← 永久保留（缓存）
  [约束规则] ← 区域不变则复用
  [对话历史] ← 保留最近N轮（压缩后可折叠旧轮）
  
  ┌─ 本轮工具结果（回合结束后移除）─┐
  │ SearchArea → "外围:灵草已采尽"  │  ← ephemeral=本轮
  │ ExamineObject → "幼年凝气草..." │  ← ephemeral=本轮  
  │ SenseDanger → "中围有野狼"     │  ← ephemeral=本轮
  └────────────────────────────────┘
  
  回合结束 → 工具结果全部清除 → 下回合重新查询世界
```

**为什么这样做**:
- 旧查询结果在上下文中会腐烂——上轮SearchArea的结果在这轮已经过时
- Anthropic研究：移除过期工具结果带来29%的准确率改进
- 世界状态变了（玩家移动了、时间过了、NPC行动了），旧结果就是毒药

### NPC动态升级机制

```
状态机模式（默认，0 token）:
  ┌─────────────────────────────────┐
  │ 行为树循环: 巡逻/站柜/修炼/睡觉   │
  │ 模板对话表: "客官要买什么？"      │
  │ 不调LLM，不使用前三类工具          │
  └─────────────────────────────────┘
           │
           │ 触发条件: 玩家搭话 / 世界事件影响该NPC / T2/T3到了日计划时间
           ▼
  ┌─────────────────────────────────┐
  │ LLM模式（临时激活）               │
  │ 可用: [感知查询] + [NPC行为]     │
  │       + [叙事输出]               │
  │ 不可用: [世界行动]（禁止）        │
  │                                 │
  │ 上下文: [约束规则+bindings]      │
  │        + [本地事件]              │
  │        + [个人记忆流摘要]        │
  │        + [当前对话]              │
  └─────────────────────────────────┘
           │
           │ 交互结束 → 降级回状态机
           │ 但: 记忆保留（FormMemory写入外部存储）
           │     计划保留（行为树接续执行）
           ▼
  回到状态机模式（执行LLM生成的计划）
```

### NPC不能做什么

**硬约束（程序层，不可绕过）：**
1. 不能调用[世界行动]类任何工具——NPC不可直接修改世界状态
2. 不能查询其他区域的实时状态——知识范围=知识气泡
3. 不能访问其他NPC的记忆——除非对方主动告知
4. 不能感知玩家的全部状态——只能观察到公开信息（外貌、修为显露、言行）
5. 不能拒绝世界事件——区域DM下发的指令必须响应

---

## 十二、完整工具目录

> 实现文件：`src/server/contracts/tool-catalog.ts`
> 包含完整的 TypeScript 类型定义、工具注册表、辅助函数

### 工具总览（25个工具）

#### 感知查询（7个）— 只读、临时消息、不经过闸门

| # | 工具名 | 用途 | 谁用 |
|---|--------|------|------|
| 1 | `SearchArea` | 探查区域（物品/生物/NPC/危险） | GM, LLM-NPC |
| 2 | `ExamineObject` | 详细检视目标 | GM, LLM-NPC |
| 3 | `SenseDanger` | 感知附近威胁 | GM, LLM-NPC |
| 4 | `CheckNpcState` | 查NPC当前状态 | GM, LLM-NPC |
| 5 | `QueryRegion` | 查询区域宏观信息（势力/事件/流言） | 仅GM |
| 6 | `RecallMemory` | 搜索实体记忆 | GM, LLM-NPC |
| 7 | `LookAround` | 快速环境快照（最轻量） | GM, LLM-NPC |

#### 世界行动（13个）— 写入、必须过闸门、仅Game Master

| # | 工具名 | 用途 | 闸门规则（示例） |
|---|--------|------|----------------|
| 8 | `ChangeLocation` | 移动实体 | 禁地封锁、境界限制、伤重限制 |
| 9 | `ModifyStats` | 修改HP/MP/修为等 | 伤害≤剩余HP+护盾，治疗≤最大值 |
| 10 | `ModifyInventory` | 物品增减 | 必须持有才能移除，背包容量限制 |
| 11 | `UpdateRelationship` | 关系值变化 | 单次delta≤±30 |
| 12 | `TriggerCombat` | 触发战斗 | 敌方必须存在，和平区域禁止 |
| 13 | `CreateSituation` | 创建叙事局面 | — |
| 14 | `ResolveSituation` | 结局/更新局面 | — |
| 15 | `CreateForeshadowing` | 埋设伏笔 | — |
| 16 | `AdvanceTime` | 推进世界时间 | 修炼时间≤体力上限，不能中断 |
| 17 | `GenerateNpc` | 生成新NPC | 修为不能超出区域范围 |
| 18 | `GenerateLocation` | 生成新地点 | — |
| 19 | `AddJournalEntry` | 写入日志 | — |
| 20 | `AddCodexEntry` | 写入图鉴 | — |

#### NPC行为（5个）— NPC专用、校验闸门、不可写世界

| # | 工具名 | 用途 | 限制 |
|---|--------|------|------|
| 21 | `GenerateDailyPlan` | 生成今日计划 | 不可包含NPC无法执行的行动 |
| 22 | `DecideReaction` | 对事件做出反应决策 | — |
| 23 | `FormMemory` | 形成记忆 | 写入外部记忆流 |
| 24 | `GenerateDialogue` | 生成对话 | 知识气泡约束 |
| 25 | `SelfReflection` | 自我反思 | T3 NPC专用 |

### TypeScript接口设计

```typescript
// 基础接口 — 所有工具的公共字段
interface ToolDefinition {
  name: string                    // 工具名（LLM看到的）
  description: string             // 工具描述（LLM看到的）
  category: ToolCategory          // 五大类之一
  allowedCallers: CallerRole[]    // 谁能调：game_master / llm_npc
  gate: GateLevel                 // 闸门等级：none / validate / enforce
  ephemeral: EphemeralPolicy      // 上下文保留策略
  execution: ExecutionSafety      // 并行安全分类
  metadata?: Record<string, unknown>  // ← 扩展入口
}

// 分类接口 — 每种分类锁定特定字段
interface PerceptionQueryTool extends ToolDefinition {
  category: 'perception_query'
  gate: 'none'                    // 只读，无闸门
  ephemeral: { mode: 'current_turn' }  // 回合结束即抛弃
  execution: 'readonly'           // 可并行
}

interface WorldActionTool extends ToolDefinition {
  category: 'world_action'
  gate: 'enforce'                 // 必须过闸门
  allowedCallers: ['game_master'] // 仅GM
}

interface NpcBehaviorTool extends ToolDefinition {
  category: 'npc_behavior'
  allowedCallers: ['llm_npc']     // 仅NPC
  gate: 'validate'                // 校验但不强制阻止
}
```

### 辅助函数

- `getToolsForCaller(role)` — 按调用者获取可用工具
- `getToolsByCategory(category)` — 按类别获取工具
- `getGatedTools()` — 获取需要闸门的工具
- `toLlmToolDefinitions(tools)` — 转为LLM API格式

### 扩展方式

在 `metadata` 中添加新属性：
```typescript
// 后续给某个工具加新字段，不需要改接口
SEARCH_AREA.metadata!.cooldown = 0  // 工具冷却
SEARCH_AREA.metadata!.cost = { mp: 5 }  // 调用消耗
```

新增工具：在 `TOOL_REGISTRY` 中添加条目，同时在 `tool-schemas.ts` 中添加Zod schema。

---

## 十三、Region DM协议：三款大作的设计提炼

### 调研来源

- **GTA V** — 分区+时段+场景点系统，五级优先级中断，原型化NPC
- **RDR2** — 日周期+性格+记忆，玩家解耦，后果持久化
- **觅长生** — 目标驱动+自主决策+经济循环，性格驱动行为

### 三款游戏的NPC调度对比

| 维度 | GTA V | RDR2 | 觅长生 |
|------|-------|------|--------|
| 人口管理 | 分区PopCycle + 时段概率 | 区域日程表 | 境界/门派分布 |
| 活动分配 | Scenario Points + Chains | 日周期 + 工作路线 | 需求→目标→行动链 |
| 中断机制 | 五级优先级 | 事件驱动 | NPC自身条件触发 |
| 个体差异 | 原型+随机参数 | 性格+气质系统 | 性格+喜好+流派 |
| 记忆系统 | 无（匿名NPC） | NPC记住玩家行为 | 好感度+声望持久化 |
| 玩家解耦 | 完全解耦 | 完全解耦 | 完全解耦 |

### 提炼：Region DM的五条铁律

#### 1. 分层调度，不是一条时间线

```
Layer 1 — 人口层（无LLM，纯数值模型）
  区域人口分布、时间变化、类型比例
  "青云坊市，午时，200人。70%练气散修, 15%筑基修士, 10%凡人, 5%商贩"

Layer 2 — 活动分配（无LLM，场景点+行为模板+原型）
  用原型覆盖大部分NPC
  商人原型: { 行为池: [站柜台, 进货, 讨价还价, 收摊], 时间表: {...} }
  散修原型: { 行为池: [逛街, 摆摊, 接任务, 出城修炼], 时间表: {...} }

Layer 3 — 个体决策（T2+ NPC用LLM产出日计划，T1纯模板）
  T2 NPC每天1次LLM调用生成日计划
  T3 NPC完整Agent（记忆流+反思+规划）
```

#### 2. 五级优先级中断（直接搬GTA）

```
P0 — 生死危机: 被攻击/重伤/濒死 → 放弃一切，立即自保
P1 — 世界大事件: 魔教入侵/天劫/宗门大战 → 中断当前行为
P2 — 区域事件: 坊市打斗/宗门召集/妖兽出没 → 可能中断
P3 — 当前日计划: 今天本来要做的事 → 正常运行
P4 — 默认: 闲逛/发呆 → 最低

纯程序层判断，不需要LLM。
被中断后 → LLM重新生成后续计划。
```

#### 3. NPC模板化，原型+参数=个体

```
商人原型: {
  行为池: [站柜台, 整理货物, 讨价还价, 进货, 收摊]
  默认对话风: "客官要什么？"
  参数范围: { 贪婪: 0.2~0.9, 友善: 0.3~0.8, 胆量: 0.1~0.6 }
}

王老四 = 商人原型({贪婪:0.8, 友善:0.4, 胆量:0.3}) → 黑商
张老实 = 商人原型({贪婪:0.3, 友善:0.7, 胆量:0.2}) → 老好人
```

#### 4. 玩家解耦，世界不等玩家

Region DM独立时钟：
- 玩家在赶路 → DM照样跑 → NPC做自己的事
- 玩家修炼8h → DM横向执行8h → NPC过了完整一天
- 玩家发呆 → DM继续 → 坊市打烊、NPC回家

#### 5. 后果持久化，记忆在外部存储

NPC记忆走外部记忆流存储，不靠LLM上下文保留。

```
王老四的记忆流:
  { content: "玩家上次砍价太狠，净赚我30灵石", day: 3, importance: 7 }
  { content: "玩家帮我赶走了闹事的散修", day: 7, importance: 8 }

下次交互 → 加载记忆摘要 → 影响态度
```

### Region DM的6个职责

| # | 职责 | LLM？ | 说明 |
|---|------|:---:|------|
| 1 | 人口分布 | ✗ | 数值模型，区域定义+时间 |
| 2 | 活动分配 | ✗ | 场景点+行为模板+原型 |
| 3 | 约束生成 | ✓ | 1次/天，产出约束文本 |
| 4 | 事件编排 | ✓ | 1次/天，产出事件列表 |
| 5 | 优先级裁决 | ✗ | 五级系统，纯程序 |
| 6 | 后果追踪 | ✗ | 写入外部记忆流存储 |

**每区域每天的LLM消耗**：2次调用（约束+事件），不是每个NPC都调。

### 待细化

- Region DM的具体输入/输出协议
- 约束生成的LLM prompt结构
- 事件编排的触发条件和传播机制
- 区域之间的信息传播速度（谣言扩散模型）

---

## 十四、已完成 vs 待讨论

### 已完成（本轮头脑风暴）

| # | 模块 | 状态 | 产出 |
|---|------|:---:|------|
| 1 | 项目诊断 + 重写方向 | ✅ | 第二节 |
| 2 | NPC自治分级（T3/T2/T1/T0） | ✅ | 第三节 |
| 3 | 知识气泡 + 世界约束编译 | ✅ | 第四节 |
| 4 | 动态约束注入（bound机制） | ✅ | 第八节 |
| 5 | 游戏模式（模拟器为主） | ✅ | 第九节 |
| 6 | 回合制横向执行 | ✅ | 第五节 |
| 7 | Agent循环状态机 | ✅ | 第十节 |
| 8 | 循环修正（逻辑/预算/超时） | ✅ | 第十节修正记录 |
| 9 | 工具五类定义 | ✅ | 第十一节 |
| 10 | 完整工具目录（25个工具） | ✅ | 第十二节 + `tool-catalog.ts` |
| 11 | Region DM：三款大作调研 | ✅ | 第十三节 |

### 下一轮待讨论

1. **Region DM完整协议** — 输入/输出格式、调度时序
2. **上下文压缩** — 几百回合后对话历史处理
3. **双模型架构** — 快速模型做判断 + 强力模型做叙事
4. **前端Agent可视化** — 玩家看到什么
5. **第一个竖切实验** — 最短闭环验证架构可行性
