# Ubuntu 24.04 systemd deployment

Production layout:

- Application: `/opt/douyin-mcp`
- Agent secrets: `/etc/douyin-mcp/agent.env`
- Host-specific non-secret overrides: `/etc/douyin-mcp/agent-runtime.env`
- Private personas: `/etc/douyin-mcp/personas`
- Browser login state: `/var/lib/douyin-mcp/.douyin_mcp`
- Agent SQLite state: `/var/lib/douyin-mcp/agent`
- MCP endpoint: `http://127.0.0.1:6789/mcp` (not exposed publicly)

Services:

```bash
systemctl status douyin-mcp douyin-auto-reply
journalctl -u douyin-mcp -u douyin-auto-reply -f
systemctl restart douyin-mcp douyin-auto-reply
systemctl stop douyin-auto-reply douyin-mcp
```

The services run as the locked-down `douyin-mcp` system user. Real `.env`, persona files, browser storage state, and SQLite data must be provisioned separately and must not be committed to Git.
