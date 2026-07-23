# Refactor Baseline Document

Recorded: 2026-07-22

## 1. Current API Routes

| Method | Route | File | Lines | Purpose |
|--------|-------|------|-------|---------|
| POST | `/api/game` | `src/app/api/game/route.ts` | 5-19 | Accept `{input, playerId}`, create user ChatMessage, return `{success: true}` |
| DELETE | `/api/game` | `src/app/api/game/route.ts` | 21-40 | Accept `{playerId}`, clear vectors, delete ChatMessages, delete Player |
| POST | `/api/game/action` | `src/app/api/game/action/route.ts` | 30-438 | Main game turn: validate→load/create player→save user msg→RAG→LLM→tools→rules→persist→SSE stream |

All routes are unversioned. No `/api/v1` prefix exists.

## 2. SSE Event Shapes (current protocol)

SSE frames are manually formatted: `event: <type>\ndata: <json>\n\n`

| Event | Payload | Emitter (file:line) |
|-------|---------|---------------------|
| `step` | `{label: string}` | action/route.ts:139-408 (13 emit sites) |
| `text-delta` | `{content: string}` | action/route.ts:280 |
| `codex` | `{name, entry_type, description, metadata, timestamp}` | action/route.ts:410 |
| `journal` | `{title, content, entry_type, timestamp}` | action/route.ts:413 |
| `reply` | `{reply: string, player: Player, deltas: object}` | action/route.ts:415-422 |
| `done` | `""` (empty string) | action/route.ts:423 |
| `error` | `{message: string}` | action/route.ts:428 |

**Missing from current protocol**: No `protocolVersion`, `requestId`, `runId`, `sequence`, `occurredAt`, or `type` envelope. No terminal event guard. No `accepted` first event. No `cancelled` event type.

## 3. Error Handling Inventory

### 3a. Empty/bare catch blocks (17 found)

| File | Line | Context |
|------|------|---------|
| `src/app/api/game/action/route.ts` | 122 | `catch {}` — auto-summarization failure silently ignored |
| `src/app/api/game/action/route.ts` | 157 | `catch {` — RAG search failure, fallback context |
| `src/app/api/game/action/route.ts` | 403 | `catch {}` — vector storage failure on save |
| `src/components/chat-panel.tsx` | 33 | `catch {}` — LLM config JSON parse |
| `src/components/chat-panel.tsx` | 151 | `catch {}` — error body JSON parse |
| `src/components/select-screen.tsx` | 36 | `catch { return {} }` — LLM config parse |
| `src/components/select-screen.tsx` | 94 | `catch {}` — error body JSON parse |
| `src/components/settings-panel.tsx` | 91 | `catch {}` — saved config parse |
| `src/lib/game/summarizer.ts` | 33 | `catch { /* table may not exist */ }` |
| `src/lib/game/summarizer.ts` | 88 | `catch { /* table may not exist */ }` |
| `src/lib/game/summarizer.ts` | 97 | `catch {}` — vector storage |
| `src/lib/game/summarizer.ts` | 117 | `catch { return '' }` — summary fetch |
| `src/lib/game/summarizer.ts` | 132 | `catch { /* table may not exist */ }` |
| `src/lib/game/summarizer.ts` | 142 | `catch {` — recent messages fetch |
| `src/lib/game/summarizer.ts` | 151 | `catch { return [] }` — fallback messages |
| `src/lib/game/nodes.ts` | 62 | `catch {` — RAG search fallback |
| `src/lib/vector-store.ts` | 91 | `.catch(() => pool.query(...))` — ILIKE fallback to all rows |

### 3b. Logged-but-continued catches

| File | Line | Pattern |
|------|------|---------|
| `action/route.ts` | 221-222 | `console.error(e)` — tool execution failure, loop continues |
| `action/route.ts` | 352-353 | `console.error("[Critique] Failed:", e)` — critique step, continues |
| `action/route.ts` | 425 | `console.error(err)` — error → SSE `error` event + `done` |
| `summarizer.ts` | 100-101 | `console.error('[Summarizer] Failed:', e)` |
| `chat-panel.tsx` | 228 | `console.error("Chat error:", error)` |

### 3c. Frontend error detection (regex-based)

In `chat-panel.tsx:110-120` and `select-screen.tsx:64-68`:
- `/\[Server Error\]/` — match SSE error event messages
- `/\[Connection Error\]/` — network failures
- HTTP status code extraction
- `ECONNREFUSED`, `ECONNRESET`, `ETIMEDOUT`, `ENOTFOUND` substring checks
- JSON error body detection via `{` prefix

## 4. Database Write Order (per game turn)

### Prisma Schema Models
- `Player` — JSON fields: `stats`, `inventory`, `codex`, `relationships`, `situations`, `foreshadowings`
- `ChatMessage` — `(id, playerId, role, content, createdAt)`
- `ConversationSummary` — `(id, playerId, summaryText, messageRange, createdAt)`
- `ConversationVector` — raw SQL, `(id, conversation_id, content, metadata)`

### Write sequence in `POST /api/game/action`

1. **Before stream**: `prisma.chatMessage.create({role: "user", content: input})` (line 85)
2. **Inside stream**: `prisma.player.update({stats, inventory, relationships, status, codex, situations, foreshadowings})` (lines 379-390)
3. **After player update**: `prisma.chatMessage.create({role: "assistant", content: reply})` (lines 393-395)
4. **After message**: `storeVector()` — raw SQL INSERT (lines 398-402)
5. **Read-back**: `prisma.player.findUnique()` (lines 404-406)

**Issues**: Steps 2-4 are NOT in a transaction. If step 3 fails after step 2, player state is mutated but no assistant message exists. If step 4 fails, it's silently caught (empty catch).

## 5. Game Rule Engine — Tool Inventory

### Tool implementations (two copies: action/route.ts:441-906 + nodes.ts:182-703)

| Tool | Effect | Has Validation? |
|------|--------|----------------|
| `Backpack_additems` | Merge items by name into inventory | No schema validation |
| `Backpack_reduceitems` / `Consume_Item` | Subtract items, remove at 0 | No bounds check |
| `Modify_Stats` | Shield→HP→MP→SP→reputation→fortune→karma→state_of_mind | Shield overflow protection exists |
| `Modify_Techniques` | Add/remove main/combat/movement/support techniques | No duplicate check |
| `Modify_Traits` | Add/remove talents and traits | No |
| `Modify_Mental` | emotion, mental_state, realm, alignment, sect, spiritual_root, race | No enum validation |
| `Update_Relationship` | NPC relationship delta | No bounds |
| `Change_Location` | Set location string | No validation |
| `Check_Breakthrough` | SUCCESS/FAIL → realm update | No probability validation |
| `Generate_NPC` / `Generate_Location` / `Generate_Sect` / `Generate_Item` | Create codex entries | No required-field validation |
| `Write_Codex` | Create codex entry | No |
| `Write_Journal` | Set journal delta | No |
| `Update_Situation` | create/update_status/end/add_outcome | Has status transition logic |
| `Create_Foreshadowing` | plant/resolve, links to situations | Has resolution logic |
| `Search_History` | Read-only, no state change | N/A |

### Key behavioral characteristics
- HP damage hits shield first, overflow to HP
- HP ≤ 0 → status = `DEAD`
- `state_of_mind` documented as "only positive" but not enforced
- Turn estimation from `Math.max(1, max startTurn)` — not DB sequence
- Injury grading: 90%+ HP = "状态良好", <10% = "神仙难救"

## 6. External Call Inventory

### LLM Calls (via `@langchain/openai` ChatOpenAI)

| Call Site | Purpose | Streaming | Temperature | Retry? |
|-----------|---------|-----------|-------------|--------|
| action/route.ts:195 | First LLM with tools + RAG context | No | from config | No |
| action/route.ts:264 | Streaming follow-up (text delta) | Yes | from config | No |
| action/route.ts:296 | Critique LLM (logic review) | No | 0.1 | No |
| action/route.ts:326 | Fix LLM (rewrite with fixes) | No | 0.5 | No |
| summarizer.ts:49 | Conversation summarization | No | from config | No |

### RAG Calls (raw `pg` pool)

| Function | SQL | Location |
|----------|-----|----------|
| `storeVector` | `INSERT INTO conversation_vectors` | vector-store.ts:73 |
| `searchVectors` | `SELECT ... WHERE ILIKE $2 LIMIT $3` | vector-store.ts:86 |
| `listVectors` | `SELECT ... ORDER BY id` | vector-store.ts:100 |
| `clearVectors` | `DELETE FROM conversation_vectors` | vector-store.ts:108 |
| `injectWorldview` | Batch INSERT 8 worldview chunks | vector-store.ts:56 |

**Note**: RAG uses ILIKE pattern matching, NOT vector similarity search.

## 7. Module-Level Mutable State

| Variable | File | Set By | Read By | Hazard |
|----------|------|--------|---------|--------|
| `_cid` | `src/lib/game/tools.ts:18` | `setConversationId()` | All tool `func` impls | Cross-request tool invocation pollution |
| `_llmConfig` | `action/route.ts:24` | POST handler line 40-44 | All LLM calls in stream | Cross-request config leakage |
| `_llmConfig` | `nodes.ts:17` | `setLLMConfig()` from action/route.ts:45 | `getLLM()`, `getPlainLLM()` | Same as above |
| `_llmConfig` | `summarizer.ts:5` | `setSummaryLLMConfig()` from action/route.ts:46 | `maybeSummarize()` | Same as above |

## 8. Duplicate Implementations

1. **Rule Engine**: Inline in `action/route.ts:441-906` AND in `nodes.ts:182-703` — two copies of the same logic
2. **Game Turn Orchestration**: Inline in `action/route.ts:125-434` AND LangGraph pipeline in `graph.ts` — the LangGraph version is NOT used by the live route
3. **SSE Parsing**: Duplicated in `chat-panel.tsx:159-225` and `select-screen.tsx:98-129`
4. **Error Detection**: Duplicated `isErrorLike()` in `chat-panel.tsx:110-120` and `select-screen.tsx:64-68`

## 9. Frontend State (Zustand)

- **Persisted**: `player`, `chatHistory`, `phase`, `journal`, `codex`
- **Ephemeral**: `currentView`, `isLoading`, `currentEvent`, `notifications`, `pendingInput`
- **Phases**: `INIT` → `SELECT` → `PLAYING` → `DEAD`
- **No turn-level state machine**: Streaming state is ad-hoc (`isLoading` boolean + `streamingText` string)
- **No idempotency keys**: Retry creates a new submission
