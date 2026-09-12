# Douyin Auto Reply Agent Service

当前已实现需求文档中的 Phase 2 和 Phase 3：通过 Streamable HTTP 连接 Python Douyin MCP，读取会话，并用 SQLite 对最新 incoming 消息做幂等记录。

当前不会调用 LLM，也不会调用 `send_message`。

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

配置项：

- `DOUYIN_MCP_URL`：Python MCP 的 Streamable HTTP 地址。
- `PHASE2_MESSAGE_LIMIT`：每个 unread 会话最多读取的最近消息数，默认 20。
- `PHASE3_MESSAGE_LIMIT`：Phase 3 每个会话最多读取的最近消息数，默认 20。
- `SQLITE_PATH`：幂等状态数据库，默认 `./data/douyin-agent.db`。

查看最近 20 条已处理记录：

```bash
npm run processed
```

## 验证

```bash
npm run typecheck
npm test
```
