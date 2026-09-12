# Douyin Auto Reply Agent Service

当前已实现需求文档中的 Phase 2 至 Phase 5：通过 Streamable HTTP 连接 Python Douyin MCP，读取会话，用 SQLite 对最新 incoming 消息做幂等记录，通过 OpenAI-compatible LLM 生成回复，并在显式开启后调用现有 `send_message`。

Phase 4 **永远不会调用 `send_message`**。Phase 5 默认也是 Dry Run，只有严格设置 `AUTO_REPLY_ENABLED=true` 才进入发送分支。

## 启动

先在仓库根目录启动 Python MCP：

```bash
.venv/Scripts/python.exe -m douyin_mcp.server --transport streamable-http --port 6789
```

再打开另一个终端：

```bash
cd agent-service
npm install
copy .env.example .env
npm run phase2
```

Phase 3 会扫描所有会话（unread 只影响扫描优先级），并把最新 incoming 消息写入 SQLite：

```bash
npm run phase3
```

Phase 4 只扫描联系人策略允许的会话，调用 LLM 生成回复后打印并写入 SQLite：

```bash
npm run phase4
```

Phase 5 使用同一套联系人策略、幂等状态和 LLM；默认只生成草稿：

```bash
npm run phase5
```

真实发送必须同时满足：

- `AUTO_REPLY_ENABLED=true`；
- 联系人在白名单内，或已显式设置 `AUTO_REPLY_ALLOW_ALL=true`；
- 联系人不在黑名单；
- 最新消息是未处理的好友文字消息；
- 没有触发全局或单联系人频率限制。

发送前会先写入 `phase5_sending` 幂等占位。明确发送成功后更新为 `phase5_sent`；明确失败会释放占位供后续重试；结果不确定会更新为 `phase5_send_uncertain` 并禁止自动重试，避免重复发送。

最安全的单好友配置示例：

```env
AUTO_REPLY_ENABLED=false
AUTO_REPLY_ALLOWLIST=好友昵称
AUTO_REPLY_BLOCKLIST=
AUTO_REPLY_ALLOW_ALL=false
OPENAI_BASE_URL=https://your-openai-compatible-endpoint/v1
OPENAI_API_KEY=your-api-key
OPENAI_MODEL=your-model-name
```

`AUTO_REPLY_ALLOWLIST` 为空且 `AUTO_REPLY_ALLOW_ALL=false` 时，任何联系人都不会被读取，也不会调用 LLM。黑名单优先于白名单和 `allow_all`。

配置项：

- `DOUYIN_MCP_URL`：Python MCP 的 Streamable HTTP 地址。
- `PHASE2_MESSAGE_LIMIT`：每个 unread 会话最多读取的最近消息数，默认 20。
- `PHASE3_MESSAGE_LIMIT`：Phase 3 每个会话最多读取的最近消息数，默认 20。
- `PHASE4_MESSAGE_LIMIT`：Phase 4 提供给 LLM 的最近消息数上限，默认 20。
- `PHASE5_MESSAGE_LIMIT`：Phase 5 提供给 LLM 的最近消息数上限，默认 20。
- `SQLITE_PATH`：幂等状态数据库，默认 `./data/douyin-agent.db`。
- `OPENAI_BASE_URL`：可选的 OpenAI-compatible API 地址；使用 OpenAI 官方地址时可留空。
- `OPENAI_API_KEY`、`OPENAI_MODEL`：仅在出现符合联系人策略的待处理消息时才校验。
- `LLM_TIMEOUT_MS`：模型调用超时，默认 30000。
- `MAX_REPLIES_PER_MINUTE`：一分钟内最多发送数，默认 5。
- `MAX_REPLIES_PER_CONTACT_PER_HOUR`：单个联系人一小时内最多发送数，默认 10。
- `POLL_INTERVAL_MS`、`MESSAGE_DEBOUNCE_MS`：为后续连续轮询阶段预留，Phase 5 单次扫描暂不使用。

查看最近 20 条已处理记录：

```bash
npm run processed
```

## 验证

```bash
npm run typecheck
npm test
```
