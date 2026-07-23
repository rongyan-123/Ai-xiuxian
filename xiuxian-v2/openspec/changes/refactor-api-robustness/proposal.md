## Why

当前游戏接口将请求解析、LLM/RAG 调用、规则结算、数据库写入和 SSE 输出耦合在单个超大 Route Handler 中，存在异常逃逸、静默吞错、半写入、并发配置串扰和前端依赖错误文案的问题。项目需要先建立可验证的接口契约与失败语义，确保所有可控失败都能被分类、脱敏、追踪和恢复，再继续扩展功能。

## What Changes

- **BREAKING**：引入版本化 `/api/v1` 接口，并以 OpenAPI 3.1+ 与运行时 Schema 作为前后端唯一契约来源。
- 普通 HTTP 错误统一采用 RFC 9457 `application/problem+json`，附带稳定错误码、追踪编号和可重试标志；前端不再解析错误文案。
- **BREAKING**：重定义游戏回合 SSE 协议。所有事件带协议版本、请求/运行标识、单调序号和时间；每条流必须且只能进入 `completed`、`failed` 或 `cancelled` 中的一个终态。
- 将 Route Handler 收敛为传输适配层；请求校验、应用编排、领域规则、外部依赖和持久化分别进入明确边界。
- 以 LangGraph 作为唯一游戏回合编排实现，删除 Route 内重复编排和重复规则引擎。
- 将预期失败建模为类型化结果，将未知异常交给最外层异常边界转换为脱敏 500；禁止空 `catch` 和静默降级。
- 为 LLM、RAG 和数据库增加请求级超时、取消传播、依赖隔离及有限重试；禁止模块级保存请求相关配置。
- 为有副作用的游戏回合增加幂等键、执行状态、乐观并发控制和原子持久化，防止重复结算与部分写入。
- 重写前端类型化 API 客户端与 SSE 状态归约器，显式处理加载、完成、失败、取消、空结果和协议错误。
- 增加结构化日志、关联 ID、存活/就绪检查和最小 OpenTelemetry HTTP/依赖调用观测。
- 建立单元、Schema 契约、服务集成、SSE 协议、故障注入和关键 UI 流程测试；不再把“HTTP 200”视为业务成功。
- 冻结手机端和其他产品功能，不在本变更中进行 UI 响应式改造。

## Capabilities

### New Capabilities

- `api-error-contracts`: 版本化 HTTP API、请求/响应 Schema、RFC 9457 错误目录及一致的状态码语义。
- `game-action-stream-protocol`: 带版本、关联标识、序号和唯一终态的游戏回合 SSE 协议。
- `resilient-game-turn-execution`: 单一 LangGraph 编排、类型化失败、超时取消、幂等、并发控制和原子持久化。
- `typed-api-client`: 由契约驱动的前端请求客户端、流解析器和显式异步状态机。
- `api-observability-health`: 脱敏结构化日志、关联追踪、依赖健康状态以及存活/就绪端点。

### Modified Capabilities

<!-- 当前尚无已归档的项目级 capability specs。 -->

## Impact

- 主要影响 `src/app/api/`、`src/lib/game/`、`src/lib/vector-store.ts`、Prisma schema、前端聊天/开局请求逻辑与 Zustand 状态。
- 将新增 `src/server/` 与 `src/client/` 边界、API v1 Route Handlers、OpenAPI/Schema 生成流程和数据库迁移。
- 现有 `/api/game` 与 `/api/game/action` 在迁移期间仅作为兼容入口；新前端切换并通过回归测试后删除。
- 可能新增 Schema/OpenAPI、追踪和测试辅助依赖；选择依赖时优先使用当前项目已有能力和最小新增原则。
- 当前存档数据必须通过向前迁移保留；本变更不得清空或重建用户数据。
