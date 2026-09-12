# Douyin Auto Reply Agent Service

当前只实现需求文档中的 Phase 2：通过 Streamable HTTP 连接 Python Douyin MCP，列出会话，筛选 unread 候选并打印最近消息。

本阶段不会调用 LLM、不会写 SQLite，也不会调用 `send_message`。

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

配置项：

- `DOUYIN_MCP_URL`：Python MCP 的 Streamable HTTP 地址。
- `PHASE2_MESSAGE_LIMIT`：每个 unread 会话最多读取的最近消息数，默认 20。

## 验证

```bash
npm run typecheck
npm test
```
