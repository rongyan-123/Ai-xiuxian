## Context

当前 `POST /api/game/action` 同时承担 JSON 解析、配置装载、玩家创建、RAG、历史摘要、LLM 调用、工具执行、规则结算、数据库写入和 SSE 编码。请求进入流之前的异常没有统一边界；进入流之后只能用字符串事件表示错误。模块级 `_llmConfig`、多处空 `catch`、分散数据库写入和前端错误文案正则匹配，使并发隔离、失败恢复和自动化验证都不可靠。

本设计以现有 Next.js 16 App Router、TypeScript、Zod、LangGraph、Prisma、PostgreSQL 和 `fetch`/Web Streams 为基础。必须保留现有游戏规则和存档，采用渐进迁移，不进行手机端或视觉改造。

设计依据包括：RFC 9457 Problem Details、OpenAPI 3.1、Next.js 预期错误/未捕获异常分层、OpenTelemetry HTTP 语义，以及项目 Wiki 中的前后端契约、SSE 唯一终态、零静默吞错和五层测试经验。

## Goals / Non-Goals

**Goals:**

- 让每个跨边界输入和输出都有编译期类型及运行时校验。
- 让预期失败成为稳定、可机器判断的应用错误；让未知异常被最外层捕获、脱敏和追踪。
- 保证每个 SSE 回合具有可验证的顺序、关联标识和唯一终态。
- 消除模块级请求状态、重复编排、重复规则引擎和空 `catch`。
- 保证重复、并发、中断和依赖故障不会造成重复结算或不可解释的半写入。
- 在不清空现有存档的前提下切换到 API v1，并提供可回滚路径。
- 建立覆盖传输、契约、应用、基础设施和真实 UI 消费的测试闭环。

**Non-Goals:**

- 不改造手机端、布局、主题或一般交互视觉。
- 不重新设计修仙数值、工具含义、Prompt 文风或游戏内容。
- 不在本变更中实现完整账号系统、计费、跨设备同步或多租户后台。
- 不把所有故障伪装成成功，也不承诺在进程被强制终止、主机断电等场景继续响应。
- 不同时更换数据库、ORM、LLM 编排框架或流式传输协议。

## Decisions

### 1. 契约优先：Zod 为运行时源，OpenAPI 为发布契约

请求、成功响应、Problem Details 和 SSE 事件由共享 Zod Schema 定义；OpenAPI 3.1 文档由这些 Schema 生成或在 CI 中交叉校验，前端类型客户端从同一契约生成/推导。

选择这一方案而不是只维护 TypeScript interface，因为 interface 在运行时不存在，无法保护 JSON、数据库 JSON 字段、LLM 工具参数和 SSE 数据。也不手写前后端两套类型，避免字段漂移。

### 2. 版本化 API 与薄 Route Handler

新接口置于 `/api/v1`。Route Handler 只负责：建立请求上下文、解析媒体类型、校验输入、调用应用服务、将类型化结果编码为 HTTP 或 SSE。它不得直接调用 Prisma、LangGraph 节点、LLM 或规则引擎。

建议边界：

```text
src/app/api/v1/**/route.ts       HTTP/SSE 适配
src/server/contracts/            Zod、OpenAPI、错误目录、事件协议
src/server/application/          游戏回合用例与端口
src/server/domain/               纯规则、领域值、领域错误
src/server/infrastructure/       Prisma、LLM、RAG、时钟、ID 适配器
src/server/streaming/            SSE writer 与终态守卫
src/server/observability/        日志、trace、redaction、health
src/client/api/                  类型化请求和 Problem 解析
src/client/streaming/            SSE 解析与协议验证
```

旧接口在迁移期间调用新应用服务或返回明确弃用头，不维护第二套业务实现。

### 3. 预期错误返回 Result，未知异常在边界转换

应用层使用项目内最小 discriminated union，而非额外 Result 库：

```ts
type AppResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: AppError };
```

校验失败、资源不存在、冲突、限流、供应商拒绝、超时和依赖不可用属于预期错误。编程错误、违反不变量和无法识别的第三方异常继续抛出，最外层边界记录完整内部原因并返回脱敏 `INTERNAL_ERROR`。

所有 HTTP 错误使用 RFC 9457，扩展字段固定为 `code`、`requestId`、`retryable`，校验错误可增加 `errors`。`detail` 仅供人阅读；前端只能依赖 `code`、HTTP status 和扩展字段。

### 4. SSE 使用版本化信封与唯一终态守卫

流式事件统一携带 `protocolVersion`、`requestId`、`runId`、`sequence`、`occurredAt`、`type`、`payload`。第一条事件为 `accepted`；终态只能为 `completed`、`failed` 或 `cancelled`，且只能写入一次。

流建立前失败返回非 2xx Problem Details；流建立后失败发送 `failed` 事件。若连接在没有终态时中断，前端产生本地 `STREAM_INTERRUPTED`，不得将已显示文本视为已提交结果。

SSE writer 负责事件编码、序号、终态检查、安全关闭和写入错误处理。应用服务只产生领域事件，不直接操作 `ReadableStreamDefaultController`。

### 5. 单一应用用例与单一 LangGraph 编排

`ExecuteGameTurn` 是游戏回合的唯一应用入口。LangGraph 负责 RAG → 剧情规划/工具调用 → 纯规则结算的有向编排；持久化协调和传输编码位于 Graph 外层。现有 Route 内联流程和未被调用的另一套 Graph 不得并存。

Rule Engine 只接收已通过 Schema 校验的工具调用和不可变状态，返回新状态、领域事件和类型化错误，不进行网络或数据库访问。

### 6. 请求配置严格按请求隔离

LLM 配置从已校验请求上下文或服务端配置解析后，以不可变依赖传入本次执行；禁止模块级可变变量。日志、trace、错误详情和数据库均不得记录原始 API Key。所有结构化日志通过统一 redactor 处理 `authorization`、`apiKey`、cookie、Prompt 原文和供应商响应中的敏感字段。

### 7. 幂等执行、乐观并发和原子提交

新增 `GameTurnExecution`（名称可在实现时按 Prisma 规范调整），以 `(playerId, idempotencyKey)` 唯一，记录 `PENDING/RUNNING/COMPLETED/FAILED/CANCELLED`、请求摘要、错误码和关联 ID。客户端为每次逻辑提交生成稳定幂等键；重试复用原键。

玩家增加版本字段。应用服务在外部调用前读取快照，完成推演后使用短事务执行版本校验、玩家更新、消息写入和执行终态更新。版本已变化时返回 `TURN_CONFLICT`，不得覆盖新状态。

LLM 调用不放在长数据库事务中。流式文本在最终事务前属于候选输出；只有提交成功后的 `state_update` 和 `completed` 是权威结果。事务失败时发送 `failed`，前端将候选文本标记为未提交。

RAG 历史写入等非核心后处理使用可重试 outbox 或显式告警状态，不得影响已提交回合，也不得静默失败。

### 8. 超时、取消与重试以副作用边界为准

请求具有总 deadline，LLM、RAG 和数据库操作具有独立超时，并通过 `AbortSignal` 传播客户端取消。调用方取消映射为 `cancelled`，不是内部错误。

只有明确无副作用、尚未进入持久化且错误标记为 transient 的操作可自动重试。建议仅对 429、502、503、504、连接复位等短暂上游错误进行有限次数指数退避加抖动；401/403、Schema 错误、领域冲突和流开始后的整个回合不得自动重放。服务端尊重 `Retry-After`。

### 9. 前端由状态归约器消费协议

前端不在 React 组件中手写 SSE 分割、逐条裸 `JSON.parse` 或错误文案正则。类型化客户端区分 Problem Details 与事件流；增量 UTF-8 解码器处理跨 chunk 行；每条事件通过 Schema 后进入纯 reducer。

回合状态固定为 `idle | submitting | streaming | completed | failed | cancelling | cancelled`。`failed` 保留稳定错误码、可重试性、requestId 和候选文本；重试按钮只在协议允许时展示，并复用幂等键。

页面级 `error.tsx`/`global-error.tsx` 仅捕获渲染期未知异常；事件处理和异步请求错误由客户端状态机显式处理。

### 10. 可观测性和健康检查

每个请求生成/接收 `requestId`，每个回合生成 `runId`，并贯穿 HTTP 响应、SSE、日志、执行记录和依赖调用。结构化日志至少记录阶段、耗时、状态、`error.type`/错误码、重试次数和脱敏玩家标识。

`/api/v1/health/live` 只证明进程可响应；`/api/v1/health/ready` 独立报告数据库和关键运行依赖是否可接受请求。可选依赖降级必须显示为 `degraded`，不能返回全绿。健康端点不得调用付费 LLM 生成。

OpenTelemetry 先覆盖 HTTP server span、LLM/RAG/DB 依赖 span 和错误属性，不将完整 Prompt、回复或密钥作为 span attribute。

### 11. 五层测试与故障注入

测试分为：

1. Schema/领域单元测试；
2. HTTP 与 SSE 契约测试；
3. 应用服务集成测试；
4. 使用真实 PostgreSQL 的关键持久化测试；
5. 浏览器消费与错误 UI 测试。

故障矩阵必须覆盖损坏 JSON、非法字段、数据库不可用、玩家不存在、LLM 401/429/5xx/超时/空回复/非法工具参数、RAG 不可用、流中断、客户端取消、重复请求和并发冲突。测试不仅断言 status，还断言响应 Schema、业务内容、数据库副作用和唯一终态。

## Risks / Trade-offs

- **[Risk] API 与 SSE 同时变化造成迁移期间双实现漂移** → 旧 Route 只能调用新应用服务，不复制业务逻辑；前端切换后立即删除兼容层。
- **[Risk] 幂等与版本字段迁移影响现有存档** → 只做向前兼容的增量 migration，先回填默认版本，再启用非空和唯一约束；禁止清库。
- **[Risk] 流式候选文本已展示但事务提交失败** → 明确候选/权威状态，失败终态保留文本但标记未提交，重试复用同一幂等键。
- **[Risk] 过度重试导致重复计费或重复结算** → 重试限制在无副作用适配器；领域提交只由幂等执行记录和事务驱动。
- **[Risk] 统一错误层吞掉程序缺陷** → 未知异常必须以 error 级别记录并保留 cause；外部仅脱敏，测试环境允许暴露诊断，不转为空结果。
- **[Risk] OpenTelemetry 增加复杂度和运行成本** → 首版只做最小 HTTP/依赖 span 与结构化日志，采样和导出器可配置，不阻塞请求。
- **[Risk] 大范围重构期间回归游戏规则** → 先用 characterization tests 锁定当前可接受行为，再移动代码；规则迁移前后使用同一夹具比较结果。

## Migration Plan

1. 建立当前接口 characterization tests、错误清单和存档备份/迁移验证夹具。
2. 增加共享契约、错误模型、请求上下文和观测基础设施，不改变旧接口行为。
3. 增加数据库执行记录、版本字段和 outbox 的向前 migration，并验证旧数据读取。
4. 实现纯 Rule Engine、基础设施 ports/adapters 和单一 `ExecuteGameTurn`。
5. 实现 API v1 普通响应与 SSE writer，完成契约和故障注入测试。
6. 实现前端类型化客户端与 reducer，在测试开关下切换 API v1。
7. 运行双路径对比与完整回归；验证新路径后将旧路径改为兼容转发并发出弃用头。
8. 在一个独立提交中删除旧内联编排、重复 Rule Engine 和旧前端解析器。
9. 更新 OpenAPI、运行手册、错误目录和诊断指南；执行生产构建和业务冒烟。

回滚时只切回旧客户端入口和兼容 Route；新增数据库表/字段保留，不执行破坏性 down migration。旧接口删除前必须保留一个已验证的回滚提交点。

## Open Questions

- 完整账号认证与跨设备存档所有权不属于本变更；API v1 先保留当前玩家标识模型，但所有权校验必须封装为可替换的 `ActorContext` 端口，不再散落在 Route 中。
- OpenTelemetry exporter 的具体后端由部署环境决定；本变更保证标准埋点和可关闭导出，不绑定某一 SaaS。
- RAG 的语义检索质量重构另立 change；本变更只要求其错误、超时、降级和可观测契约正确。
