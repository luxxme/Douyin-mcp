# Douyin Auto Reply Agent Service

当前已实现需求文档中的 Phase 2、Phase 3 和 Phase 4：通过 Streamable HTTP 连接 Python Douyin MCP，读取会话，用 SQLite 对最新 incoming 消息做幂等记录，并通过 OpenAI-compatible LLM 生成 Dry Run 回复草稿。

Phase 4 **不会调用 `send_message`**。当前 TypeScript MCP Client 刻意不暴露发送方法，即使设置 `AUTO_REPLY_ENABLED=true` 也只会打印警告并保持 Dry Run。

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
- `SQLITE_PATH`：幂等状态数据库，默认 `./data/douyin-agent.db`。
- `OPENAI_BASE_URL`：可选的 OpenAI-compatible API 地址；使用 OpenAI 官方地址时可留空。
- `OPENAI_API_KEY`、`OPENAI_MODEL`：仅在出现符合联系人策略的待处理消息时才校验。
- `LLM_TIMEOUT_MS`：模型调用超时，默认 30000。

查看最近 20 条已处理记录：

```bash
npm run processed
```

## 验证

```bash
npm run typecheck
npm test
```
