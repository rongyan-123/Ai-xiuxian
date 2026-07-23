# 项目交接与开发守则

本文是人类开发者、Claude Code、Codex 或其他 Agent 接手本项目时的单一入口。
它解释“我们为什么重构、现在完成了什么、还有什么没完成，以及哪些边界不能破坏”。

## 1. 项目初衷

这是一个由大模型驱动的修仙文字模拟器。玩家输入行动，系统结合玩家存档、世界观
检索、历史上下文和游戏规则生成叙事，并把属性、物品、关系、图鉴、日志、局面与伏笔
等结果持久化。

当前阶段的首要目标不是增加玩法，也不是改造手机界面，而是让一次游戏回合具备可验证
的工程可靠性：

- 所有跨边界数据都有 TypeScript 类型和运行时 Schema；
- 所有可控失败都被分类、脱敏、追踪并返回稳定错误码；
- SSE 流有版本、关联 ID、连续序号和唯一终态；
- 重复提交、并发请求、超时、取消和依赖故障不能造成重复结算或半写入；
- 前端只消费统一契约，不解析错误文案，不把候选文本误认为已提交状态；
- 重构不得清空或损坏现有玩家存档。

完整意图以以下 OpenSpec 工件为准：

1. `openspec/changes/refactor-api-robustness/proposal.md`
2. `openspec/changes/refactor-api-robustness/design.md`
3. `openspec/changes/refactor-api-robustness/specs/**/*.md`
4. `openspec/changes/refactor-api-robustness/tasks.md`
5. `openspec/changes/refactor-api-robustness/execution-log.md`

## 2. 当前架构边界

```text
React UI
  -> src/client/                 类型化 HTTP/SSE 客户端与回合状态机
  -> src/app/api/v1/            薄 Route Handler，只做传输适配
  -> src/server/application/    ExecuteGameTurn 等应用编排
  -> src/server/domain/         无网络、数据库和全局状态的纯规则
  -> src/server/infrastructure/ Prisma、LLM、RAG 等适配器
  -> src/server/streaming/      SSE 编码、序号和终态守卫
  -> src/server/observability/  请求上下文、日志、脱敏、追踪、健康检查
```

必须保持的边界：

- Route Handler 不直接导入 Prisma、Provider SDK 或规则引擎内部实现；
- React 组件不自行切割 SSE、不裸用 `JSON.parse` 处理事件、不匹配错误文案；
- 请求相关的模型配置、凭证、取消信号和关联 ID 不得保存在模块级可变变量；
- Rule Engine 必须是确定性的纯函数；
- 权威玩家状态只能在最终事务成功后发布；
- 兼容入口不得发展成第二套业务编排。

## 3. 当前真实状态（2026-07-23）

OpenSpec 状态应为 **58/60 完成，2 项未完成**。

已验证的本地结果：

| 层级 | 结果 |
| --- | --- |
| Unit | 472 通过 |
| Contract | 132 通过 |
| Playwright Desktop | 14 通过 |
| Playwright Mobile | 14 通过 |
| 合计 | 632 通过 |
| Production build | 通过 |

“Mobile 14 通过”仅表示现有关键流程能在移动 viewport 中运行，不代表已经完成响应式
设计或手机端产品改造。手机端视觉与交互重构仍不在本 change 范围内。

不要只依据本表宣称整体完成。权威的逐项执行证据位于
`openspec/changes/refactor-api-robustness/execution-log.md`。

## 4. 剩余两个阻塞任务

### 12.3 遗留数据迁移验证

目标：在包含真实结构的遗留玩家快照上执行 forward-only Prisma migration，并证明玩家、
物品、图鉴、日志、关系、局面、伏笔和聊天数据没有丢失。

需要外部资源：

- 可销毁的 PostgreSQL 测试实例，预期端口为 5433；
- 经脱敏的遗留玩家数据库快照或等价结构化 fixture；
- 明确的测试数据库名称和破坏性测试开关。

禁止拿开发库或生产库代替测试库，禁止使用 `reset`、清库或依赖 URL 包含 `test`
子串的弱保护。

### 12.4 完整集成验证

目标：执行 `tests/integration/`，并与 unit、contract、fault injection、Playwright
结果一起形成完整验收记录。

建议命令：

```powershell
npm run test:unit
npm run test:contract
npm run test:db:integration
npm run test:e2e
npm run typecheck
npm run lint
npm run build
openspec validate refactor-api-robustness --strict
```

只有数据库集成层真实通过后，12.4 才能勾选。

## 5. 接手执行协议

任何 Agent 开始工作前必须：

1. 阅读 `AGENTS.md` 和上述全部 OpenSpec 工件；
2. 查看 `git status`，保留现有用户改动，不擅自清理或覆盖；
3. 阅读 `execution-log.md` 最新 checkpoint；
4. 明确当前任务、验收标准、验证命令和数据安全边界；
5. 先写/修测试并确认红灯，再实现，再跑绿；
6. 测试必须导入真实生产实现，禁止在测试中复制函数或 Schema；
7. 每项任务结束立即更新 execution log，没有证据不得勾选；
8. 完成前运行相关完整测试、typecheck、lint、build、OpenSpec strict validation，
   并自审 diff。

若遇到以下情况必须停止并记录阻塞，不得猜测：

- 无法安全区分测试数据库和开发/生产数据库；
- migration 可能删除、覆盖或错误转换用户数据；
- OpenSpec 要求发生实质冲突；
- 缺少必要凭证、数据库、快照或用户决策；
- 工作将扩展到手机 UI、玩法重设计或其他未授权范围。

## 6. 下一步优先级

1. 保存当前大规模改动到独立分支/提交，避免继续堆叠未提交状态；
2. 准备 PostgreSQL 5433 的一次性测试实例；
3. 获取或构造经脱敏的遗留数据快照；
4. 完成 12.3 migration/data-loss verification；
5. 完成 12.4 integration suite；
6. 重新执行所有最终检查；
7. 由 Codex 做最终审计；
8. 60/60 有证据通过后，再同步/归档 OpenSpec change；
9. 新功能或手机端改造必须另开新的 OpenSpec change。

## 7. 给 Claude Code 的短接手指令

```text
继续 refactor-api-robustness。先完整阅读 AGENTS.md、HANDOFF.md，以及该
OpenSpec change 的 proposal、design、specs、tasks、execution-log。
当前真实状态是 58/60；只处理 12.3 和 12.4。必须使用一次性 PostgreSQL
测试库和脱敏遗留快照，禁止连接、清空或重置开发/生产库。按 TDD 执行并实时更新
execution-log.md。只有迁移无数据丢失且 integration 全绿后才能勾选任务。
随后运行 unit、contract、integration、E2E、typecheck、lint、build 和
OpenSpec strict validation；保留完整命令与结果。遇到数据库身份不明确、
迁移风险或缺少快照时停止并写 blocker，不得猜测。不要做手机端或无关功能。
```

## 8. 完成定义

本 change 只有同时满足以下条件才能称为完成：

- `tasks.md` 为 60/60；
- execution log 对每项验收有可复现证据；
- 遗留快照迁移后数据完整；
- unit、contract、integration、fault injection、Playwright 全绿；
- typecheck、lint、production build 和 OpenSpec strict validation 通过；
- 没有密钥泄漏、空 catch、请求级全局状态、重复编排或未校验边界；
- 最终 diff 不包含未授权的手机/UI 或其他无关改动。
