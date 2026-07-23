# 修仙模拟器 (Cultivation Simulator)

> 继续开发或交接给新的 AI Agent 前，请先阅读
> [项目交接与开发守则](./HANDOFF.md)。当前 API 健壮性重构仍有 PostgreSQL
> 迁移验证与集成测试两项未完成，不能仅凭单元/E2E 全绿视为全部验收。

基于 AI 的高自由度文字修仙游戏。使用 Next.js 16 App Router + LangGraph 工作流引擎构建。

## 快速开始

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev
# → http://localhost:3000

# 运行测试
npm test                    # 单元测试 + 契约测试 (573 用例)
npm run test:e2e           # Playwright E2E 测试
```

## 项目结构

```
src/
├── app/                    # Next.js App Router 页面和 API 路由
│   ├── api/
│   │   ├── v1/game/action/ # API v1 游戏行动端点 (SSE)
│   │   └── v1/health/      # 健康检查端点
│   ├── layout.tsx
│   ├── page.tsx            # 主游戏页面
│   └── error.tsx           # 路由级错误边界
├── client/                 # 前端客户端库 (纯函数，无 React 依赖)
│   ├── sse-parser.ts       # 增量 SSE 解析器
│   ├── game-turn-client.ts # API v1 HTTP 客户端 (AsyncIterator)
│   └── game-turn-reducer.ts # 游戏回合状态机 (7 状态)
├── components/             # React UI 组件
│   ├── chat-panel.tsx      # 主聊天面板
│   ├── select-screen.tsx   # 开局流派选择
│   └── error-boundary.tsx  # 渲染错误边界
├── server/                 # 服务端代码
│   ├── application/        # 应用服务层
│   │   ├── execute-game-turn.ts  # 游戏回合编排
│   │   └── game-graph.ts         # LangGraph 工作流定义
│   ├── contracts/          # Zod Schema + 类型定义
│   │   ├── sse-events.ts   # SSE 事件协议 (判别联合)
│   │   ├── problem-details.ts # RFC 9457 错误 Schema
│   │   ├── player.ts       # 玩家状态 Schema
│   │   └── game-action.ts  # 游戏行动请求 Schema
│   ├── domain/             # 纯领域规则引擎 (无副作用)
│   ├── infrastructure/     # 适配器、仓储实现、依赖端口
│   └── streaming/          # SSE 编码器、序列号、终端守卫
├── stores/                 # Zustand 状态管理
└── types/                  # 共享 TypeScript 类型
tests/
├── unit/                   # 单元测试 (472 用例)
├── contract/               # API 契约测试 (101 用例)
├── fixtures/               # 共享测试固件
└── e2e/                    # Playwright E2E 测试
```

## API v1

### 游戏行动 (SSE 流)

```
POST /api/v1/game/action
Content-Type: application/json
Accept: text/event-stream

{
  "input": "修炼",
  "playerId": "player-1",
  "mode": "action",
  "playerName": "修仙者",
  "idempotencyKey": "optional-unique-key"
}
```

响应为版本化的 SSE 事件流，事件类型包括：

| 事件 | 说明 |
|------|------|
| `accepted` | 请求已接受 (必须为第一个事件, sequence=0) |
| `step` | 处理步骤标签 |
| `text-delta` | 增量文本内容 |
| `codex` | 典籍条目 |
| `journal` | 日志条目 |
| `state_update` | 玩家状态更新 |
| `completed` | 成功完成 (终端事件) |
| `failed` | 失败 (终端事件, 携带 RFC 9457 Problem Details) |
| `cancelled` | 已取消 (终端事件) |

每个事件包装在版本化信封中：

```json
{
  "protocolVersion": "1.0",
  "requestId": "req-xxx",
  "runId": "run-xxx",
  "sequence": 1,
  "occurredAt": "2026-07-23T00:00:00.000Z",
  "type": "text-delta",
  "payload": { "content": "修炼中..." }
}
```

### 错误 (RFC 9457 Problem Details)

错误响应格式：

```json
{
  "type": "https://api.xiuxian.com/errors/llm-timeout",
  "title": "LLM Timeout",
  "status": 504,
  "detail": "The LLM provider timed out after 30 seconds",
  "code": "LLM_TIMEOUT",
  "requestId": "req-xxx",
  "retryable": true
}
```

### 稳定错误码

| 错误码 | HTTP 状态 | 可重试 | 说明 |
|--------|----------|--------|------|
| `VALIDATION_ERROR` | 422 | No | 输入校验失败 |
| `MALFORMED_JSON` | 400 | No | 请求体非 JSON |
| `PLAYER_NOT_FOUND` | 404 | No | 玩家不存在 |
| `TURN_CONFLICT` | 409 | No | 并发冲突 (版本不匹配) |
| `TURN_IN_PROGRESS` | 409 | Yes | 该玩家有进行中的回合 |
| `TURN_ALREADY_COMPLETED` | 409 | No | 幂等重放 |
| `LLM_TIMEOUT` | 504 | Yes | LLM 超时 |
| `LLM_AUTH_ERROR` | 502 | No | LLM 认证失败 |
| `LLM_PROTOCOL_ERROR` | 502 | No | LLM 协议错误 |
| `LLM_UNAVAILABLE` | 503 | Yes | LLM 服务不可用 |
| `LLM_RATE_LIMITED` | 502 | Yes | LLM 速率限制 |
| `RAG_UNAVAILABLE` | 503 | Yes | RAG 服务不可用 |
| `DB_UNAVAILABLE` | 503 | Yes | 数据库不可用 |
| `DB_TIMEOUT` | 504 | Yes | 数据库超时 |
| `INTERNAL_ERROR` | 500 | No | 意外内部错误 |
| `PROTOCOL_ERROR` | 502 | No | SSE 协议违规 (序列号跳变等) |
| `STREAM_INTERRUPTED` | 502 | Yes | 流中断 (网络断开等) |

### 幂等性

- 客户端可提供 `idempotencyKey` 实现安全重试
- 相同 `(playerId, idempotencyKey)` 的重复请求返回已完成的回合结果
- 并发重复请求返回 `TURN_CONFLICT` (409)

### 超时与重试

| 组件 | 超时 | 最大重试 | 退避 |
|------|------|---------|------|
| LLM | 30s | 3 次 | 指数 + 30% 抖动 |
| RAG | 5s | 1 次 | 固定 1s |
| 数据库 | 10s | 3 次 | 指数 + 30% 抖动 |

## 技术栈

- **框架:** Next.js 16 (App Router)
- **语言:** TypeScript (strict)
- **AI:** LangGraph, Vercel AI SDK
- **数据库:** PostgreSQL + Prisma ORM
- **验证:** Zod v4 (判别联合)
- **测试:** Vitest + Playwright + Testing Library
- **状态管理:** Zustand (前端)
- **流式:** Server-Sent Events (SSE) + Web Streams API
- **可观测性:** OpenTelemetry (span/trace)

## 测试命令

```bash
npm test                          # 全部单元 + 契约测试
npx vitest run tests/unit/        # 仅单元测试
npx vitest run tests/contract/    # 仅契约测试
npx vitest run --config vitest.db.config.mts  # 数据库集成测试 (需要 PostgreSQL)
npx playwright test               # E2E 测试
npm run typecheck                 # TypeScript 检查
npm run lint                      # ESLint
```

## 环境变量

```bash
DATABASE_URL=postgresql://...     # PostgreSQL 连接 (必需)
LLM_API_KEY=sk-...               # LLM API 密钥
LLM_BASE_URL=https://api.openai.com/v1  # LLM 端点
LLM_MODEL=gpt-4o-mini            # 模型名称
```

## 健康检查

```
GET /api/v1/health/live    → 200 (进程存活)
GET /api/v1/health/ready   → 200/503 (依赖就绪检查)
```
