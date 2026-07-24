@AGENTS.md

# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

## 架构头脑风暴日志（最高优先级）

**任何关于 Agent 框架重写的讨论、设计、头脑风暴，必须：**
1. **先读** `docs/architecture-brainstorm-log.md` — 了解之前的讨论上下文
2. **写入** 相同的日志文件 — 追加新的思考、决策、待讨论问题
3. 日志格式遵循现有结构：用户思考点 + AI 回应 + 决策结论

---

## OpenSpec 规范驱动开发（SDD）

本项目已安装 [OpenSpec](https://github.com/Fission-AI/OpenSpec)（`@fission-ai/openspec` v1.4.1），**所有非 trivial 任务必须走完整四阶段工作流**：

| 阶段   | 斜杠命令        | Skill                     | 做什么                                     |
| ------ | --------------- | ------------------------- | ------------------------------------------ |
| ① 探索 | `/opsx:explore` | `openspec-explore`        | 思考、调研、画图、对比方案。只读，不写代码 |
| ② 提案 | `/opsx:propose` | `openspec-propose`        | 生成 proposal.md + design.md + tasks.md    |
| ③ 实现 | `/opsx:apply`   | `openspec-apply-change`   | 按 tasks.md 逐条实现，自动标记完成状态     |
| ④ 归档 | `/opsx:archive` | `openspec-archive-change` | 合并 spec、清理 change 目录                |

**强制规则**：

- 用户提出功能需求 → **先 `/opsx:explore`** 搞清问题和方案
- 方案明确后 → **`/opsx:propose "change-name"`** 生成规划制品
- 用户确认提案 → **`/opsx:apply`** 开始写代码
- 全部完成 → **`/opsx:archive`** 归档

**CLI 辅助命令**（需要时用）：

- `openspec list --json` — 查看所有活跃 change
- `openspec status --change "<name>" --json` — 查看指定 change 状态
- `openspec instructions <artifact> --change "<name>" --json` — 获取制品生成指引

---

其他要做的事:
0, **【最高优先级 — 技能优先】** 执行任何编程/设计/测试任务前,必须先搜索项目技能库中是否有相关技能。找到匹配技能后必须先读取并遵循其指导,再开始工作。设计 UI 必须参照 baseline-ui / ui-ux-ui-styling / ui-ux-design；写 React/Next.js 代码必须参照 react-best-practices / next-best-practices；写测试必须参照 webapp-testing / test-driven-development；完成功能前必须参照 verification-before-completion。
1, 多阅读 `D:\xiuxian\核心技术架构与 API 接口文档 V1 0 36ab52be0b408085ba10caeb38a716f8.md` 每当你不懂或者不确定时,就查阅
2, 文件夹有修改时,你需要同步修改该文件 `D:\xiuxian\xiuxian\xiuxian-v2\项目文件说明.txt`
3, 每次都要读取`D:\xiuxian\xiuxian\xiuxian-v2\上次对话记录.txt` 同时保证其中每次都只有最新的一轮对话,且最多只能保存一轮(不缩减的情况),在不浪费 token 的情况下,你也可以自行总结后,存入多轮对话.
4, 当完成一项功能时,提醒使用者使用 git 保存,如果他不会,你就自己用 git 尝试保存
6, 每次都必须先 plan 再行动 — 非 trivial 实现任务必须先进入 plan mode，写清楚方案等用户确认后再写代码
7, 优先回答用户问题 — 用户提了问题就先用文字回答，不要跳过问题直接写代码
8, **测试优先用 browser**: 优先使用 `mcp__playwright__browser_*` 工具在浏览器中测试功能，同时使用 Playwright 脚本,但测试用例必须先写好再问用户"是否覆盖大部分情况?"。而且写出来的测试代码必须详尽!不能为了过关而敷衍!必须极为细节,你要像是一个杠精一样去写测试用例!测试的代码也得尽量鲁棒性高一点,比如说测试问答功能,检测的时候就只看它回复是不是超过了 10 个字等等,这种极度敷衍的绝对禁止!此处为了详尽和全面,你得设置多层检测,比如检测 api 是否发送,前后端是否连通等等,而非单纯为了通过就测试字数!
9,装东西禁止装到 C 盘!可以去 D 或者 E 盘!
10,happy 是一个类似于 cc- connect 的工具,可以在手机上访问 claude 终端,如果是以 happy 启动终端的话,对话结束时记得清理一下 sessions:echo '{"sessions":{}}' > ~/.happy/sessions.json
11, 任何不懂的技术问题,卡了很久的技术问题优先 web 搜索,看看大厂和企业级规范都是怎么做的
