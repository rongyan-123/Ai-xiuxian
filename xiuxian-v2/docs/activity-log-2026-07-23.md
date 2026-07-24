# 修仙项目 — 长线任务活动日志

> 启动时间：2026-07-23
> 目标：契约测试 → 单元测试 → 集成测试 → 冒烟测试（完整Agent生命周期）
> 模式：红灯→绿灯，任何失败打回重做

---

## Phase 0: 基础设施检查

### 环境状态

| 服务 | 状态 | 端口 |
|------|------|------|
| Dev Server (Next.js) | ✅ 运行中 | 3000 |
| PostgreSQL | ✅ 连接正常 | 5433 |
| Chroma | 等待检查 | 8000 |
| Chrome | 已定位 | C:\Users\Administrator\AppData\Local\Google\Chrome\Application\chrome.exe |

---

## Phase 1: 契约测试基线 ✅ (2026-07-23)

| 套件 | 文件数 | 测试数 | 结果 |
|------|--------|--------|------|
| api-schemas.test.ts | 1 | - | ✅ |
| openapi-drift.test.ts | 1 | - | ✅ |
| health-endpoints.test.ts | 1 | - | ✅ |
| api-v1-game-action.test.ts | 1 | - | ✅ |
| api-v1-fault-injection.test.ts | 1 | - | ✅ |
| **合计（schema级）** | **5** | **132** | ✅ |

## Phase 2: HTTP级契约测试 🔴→🟢 (2026-07-24)

### 发现的契约缺口

1. **`eventSink.complete()` 发出 `{"type":"done"}` 事件** — 不在 SSEEventSchema 枚举中，客户端 `game-turn-client.ts` 会抛出 PROTOCOL_ERROR
2. **`eventSink.fail()` 发出非信封格式** — `{"type":"failed","code":...,"message":...,"retryable":...}` 缺少 protocolVersion、requestId、runId、sequence、occurredAt
3. **`eventSink.cancel()` 发出非信封格式** — 同上
4. **双重终端事件** — `executeGameTurn` 的提交失败路径同时调用 `emit('failed',...)` 和 `eventSink.fail(...)`，产生两个终端事件

### 修复内容

**route.ts:**
- `complete()`: 移除 `{"type":"done"}` 发射，仅关闭流
- `fail()`: 发射完整信封（protocolVersion, requestId, runId, sequence, occurredAt, type='failed', payload=ProblemDetails）
- `cancel()`: 发射完整信封（type='cancelled', payload={requestId, runId, reason}）
- `createSSEEventSink` 接收 `requestId` 参数用于错误信封

**execute-game-turn.ts:**
- 提交失败路径：移除重复 `eventSink.fail()`，改用 `eventSink.complete()`
- 修正 `emit('failed',...)` payload 字段名 `message→detail` 以匹配 ProblemDetails

### 新增测试文件

`tests/contract/api-v1-http-contract.test.ts` — 34项HTTP级契约测试：
- **A. SSE事件信封契约** (5 tests) — 所有事件必须通过SSEEventSchema验证
- **B. SSE事件排序契约** (6 tests) — accepted首事件、唯一终端、单调序列
- **C. 响应头契约** (6 tests) — Content-Type, X-Request-Id, X-Protocol-Version, Cache-Control
- **D. 错误响应契约** (7 tests) — ProblemDetails RFC 9457合规性
- **E. 客户端集成契约** (5 tests) — sse-parser + game-turn-reducer 处理实际服务端输出
- **F. 协议边界情况** (5 tests) — unicode/emoji, XSS注入, 大payload, 并发请求

### 测试结果汇总

| 套件 | 文件数 | 测试数 | 结果 |
|------|--------|--------|------|
| 契约测试（schema级） | 5 | 132 | ✅ |
| 契约测试（HTTP级） | 1 | 34 | ✅ |
| 单元测试 | ~19 | ~472 | ✅ |
| **全部** | **25** | **638** | ✅ (1个预存jsdom错误) |

---

## Phase 3: 集成测试 ✅ (2026-07-24)

### 数据库状态

| 数据库 | 地址 | 状态 |
|--------|------|------|
| xiuxian (主库) | localhost:5433 | ✅ schema同步 |
| xiuxian_test (测试库) | localhost:5433 | ✅ schema同步 |

### Prisma Repository 集成测试

`tests/integration/prisma-repositories.test.ts` — 30项测试，全部通过：

- **PlayerRepository** (6 tests): findById、save、乐观并发、PLAYER_NOT_FOUND、连续版本更新
- **TurnExecutionRepository** (9 tests): reserve、DUPLICATE_RUNNING、失败后重试、ALREADY_COMPLETED幂等重放、markRunning/Completed/Failed/Cancelled
- **OutboxRepository** (5 tests): enqueue、getPending、markCompleted、markFailed+重试调度、limit分页
- **Transaction** (4 tests): commitGameTurn持久化+更新+出箱、版本冲突拒绝、rollbackGameTurn不回写player
- **边界情况** (6 tests): 空背包/图鉴、50物品大背包、复杂关系图谱、并发预约、幂等重放

### 最终测试汇总 (2026-07-24)

| 套件 | 文件数 | 测试数 | 结果 |
|------|--------|--------|------|
| 契约测试（schema级） | 5 | 132 | ✅ |
| 契约测试（HTTP级） | 1 | 34 | ✅ |
| 集成测试（Prisma/PostgreSQL） | 1 | 30 | ✅ |
| 冒烟测试（Agent生命周期） | 1 | 9 | ✅ |
| 单元测试 | ~19 | ~472 | ✅ |
| **全部** | **27** | **677** | ✅ (1个预存jsdom错误) |

### 本阶段修复的契约缺口

1. `eventSink.complete()` 不再发送 `{"type":"done"}` → 仅关闭流
2. `eventSink.fail()` 发送完整信封（protocolVersion, requestId, type='failed', ProblemDetails payload）
3. `eventSink.cancel()` 发送完整信封
4. `executeGameTurn` 提交失败路径移除重复 `eventSink.fail()`，用 `emit('failed',...)` + `complete()`
5. `createSSEEventSink` 接收 `requestId` 参数
6. `route.ts` 支持根据 DATABASE_URL 环境变量自动切换 Prisma/Fake 仓库

---

## Phase 4: 冒烟测试 ✅ (2026-07-24)

### route.ts 改造

`src/app/api/v1/game/action/route.ts` 支持双模式：
- `DATABASE_URL` 已设置 → 使用 Prisma/PostgreSQL 真实仓库（生产模式）
- `DATABASE_URL` 未设置 → 使用内存 Fake 仓库 + 自动播种（开发模式）

### 冒烟测试

`tests/integration/smoke-agent-lifecycle.test.ts` — 9项测试，全部通过：

- **SMOKE-1**: 完整生命周期 — HTTP POST → SSE流 → 事件验证 → DB持久化 → player版本递增 → turn记录 ✅
- **SMOKE-2**: 客户端集成 — sse-parser + game-turn-reducer 处理真实服务端SSE输出，状态流转submitting→streaming→completed ✅
- **SMOKE-3**: 幂等重放 — 相同idempotencyKey不产生副作用，player版本不变，turn不增加 ✅
- **SMOKE-4**: 错误处理 — 玩家不存在返回failed事件 ✅
- **SMOKE-5**: 出箱事件 — 完成的turn入列出箱记录 ✅
- **SMOKE-H1**: 响应头 — Content-Type, Cache-Control, X-Request-Id, X-Protocol-Version, X-Accel-Buffering ✅
- **SMOKE-V1**: JSON解析错误 → 400 Problem Details ✅
- **SMOKE-V2**: 缺少必填字段 → 422 with error pointers ✅
- **SMOKE-V3**: 缺少playerId → 422 ✅

### 配置修改

`vitest.config.mts` 添加 `fileParallelism: false` — 防止集成测试文件并行执行导致数据库FK冲突。

### 全部四阶段完成

| Phase | 名称 | 测试数 | 状态 |
|-------|------|--------|------|
| 1 | 契约测试（schema级） | 132 | ✅ |
| 2 | 契约测试（HTTP级） | 34 | ✅ |
| 3 | 集成测试（Prisma/PostgreSQL） | 30 | ✅ |
| 4 | 冒烟测试（Agent生命周期） | 9 | ✅ |
| — | 单元测试（预存） | ~472 | ✅ |
| **合计** | | **677** | ✅ |

---

