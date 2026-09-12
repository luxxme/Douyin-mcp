"""
Douyin MCP Server — 将抖音私信/聊天功能暴露为 MCP 工具

使用方式:
    python -m douyin_mcp.server                      # stdio 模式 (默认)
    python -m douyin_mcp.server --transport streamable-http --port 6789

暴露的 MCP 工具:
    1. search_user(keyword)          — 搜索抖音用户
    2. list_conversations()          — 列举私信会话列表
    3. read_messages(contact, limit) — 读取与联系人的私信
    4. send_message(user_id, text)   — 向用户发送私信
"""

from __future__ import annotations

import argparse
import asyncio
from contextlib import asynccontextmanager
import logging
import os
import sys
from typing import AsyncIterator, Optional

from mcp.server import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from starlette.requests import Request
from starlette.responses import JSONResponse

from douyin_mcp.core import DouyinController
from douyin_mcp.models import (
    ConversationListResult,
    ReadMessagesResult,
    SendMessageResult,
)

# ── logger ──────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("douyin-mcp")

# ── 启动前检查 ──────────────────────────────────────────────────────────


def _check_environment() -> list[str]:
    """检查运行环境是否就绪，返回所有警告信息列表。"""
    warnings: list[str] = []

    # 1. Python 版本
    if sys.version_info < (3, 10):
        warnings.append(
            f"Python >=3.10 推荐 (当前 {sys.version_info.major}.{sys.version_info.minor})"
        )

    # 2. Playwright Python 包。浏览器可执行文件在首次启动时由
    # BrowserManager 的回退链验证，避免在模块导入阶段创建事件循环。
    try:
        from playwright import async_api as _playwright_async_api
    except ImportError:
        warnings.append("playwright 未安装 (运行 pip install playwright)")

    # 3. 依赖
    missing_deps = []
    for pkg in ["mcp", "httpx"]:
        try:
            __import__(pkg)
        except ImportError:
            missing_deps.append(pkg)
    if missing_deps:
        warnings.append(f"缺少依赖: {', '.join(missing_deps)}")

    return warnings


_checks = _check_environment()
if _checks:
    logger.warning("=" * 50)
    logger.warning("环境检查发现问题:")
    for w in _checks:
        logger.warning(f"  ⚠  {w}")
    logger.warning("=" * 50)
else:
    logger.info("环境检查全部通过 ✅")

# ── controller singleton ────────────────────────────────────────────────

_ctrl: Optional[DouyinController] = None
_tool_lock: Optional[asyncio.Lock] = None


def _get_ctrl() -> DouyinController:
    global _ctrl
    if _ctrl is None:
        headless = os.environ.get("DOUYIN_HEADLESS", "").lower() in ("true", "1", "yes")
        _ctrl = DouyinController(headless=headless)
    return _ctrl


def _get_tool_lock() -> asyncio.Lock:
    """在 MCP Server 的长期事件循环中延迟创建浏览器操作锁。"""
    global _tool_lock
    if _tool_lock is None:
        _tool_lock = asyncio.Lock()
    return _tool_lock


# ── MCP server ──────────────────────────────────────────────────────────


@asynccontextmanager
async def _server_lifespan(_server: MCPServer) -> AsyncIterator[dict]:
    """在 MCP 服务退出时可靠释放 Playwright 和浏览器子进程。"""
    global _ctrl, _tool_lock
    try:
        yield {}
    finally:
        if _ctrl is not None:
            await _ctrl.close()
        _ctrl = None
        _tool_lock = None


mcp = MCPServer("Douyin MCP", lifespan=_server_lifespan)


@mcp.custom_route("/health", methods=["GET"])
async def health_endpoint(request: Request) -> JSONResponse:
    """供 Docker/进程管理器使用的无状态健康检查。"""
    return JSONResponse({
        "status": "ok",
        "service": "douyin-mcp",
        "version": "0.1.0",
    })


# ── tools ───────────────────────────────────────────────────────────────


@mcp.tool()
async def search_user(keyword: str) -> str:
    """搜索抖音用户，返回用户昵称、抖音号、简介、粉丝数等信息。

    Args:
        keyword: 搜索关键词（用户名、抖音号等）。
    """
    try:
        async with _get_tool_lock():
            ctrl = _get_ctrl()
            await ctrl.initialize()
            return await ctrl.search_user(keyword)
    except Exception as exc:
        logger.exception("search_user(%r) failed", keyword)
        return f"搜索用户失败: {exc}"


@mcp.tool()
async def list_conversations() -> ConversationListResult:
    """列举当前账号的所有私信会话列表。

    返回每个会话的联系人昵称、最后一条消息的片段、未读消息数。
    """
    try:
        async with _get_tool_lock():
            ctrl = _get_ctrl()
            await ctrl.initialize()
            return await ctrl.list_conversations()
    except Exception as exc:
        logger.exception("list_conversations failed")
        raise ToolError(f"列举会话失败: {exc}") from exc


@mcp.tool()
async def read_messages(contact: str, limit: int = 20) -> ReadMessagesResult:
    """读取与指定联系人的私信消息。

    先在会话列表中查找联系人，打开对话后从 DOM 提取消息内容。

    Args:
        contact: 联系人昵称（用于在会话列表中定位）。
        limit: 读取的最大消息条数，默认 20。
    """
    try:
        async with _get_tool_lock():
            ctrl = _get_ctrl()
            await ctrl.initialize()
            return await ctrl.read_messages(contact, limit)
    except Exception as exc:
        logger.exception("read_messages(%r) failed", contact)
        raise ToolError(f"读取消息失败: {exc}") from exc


@mcp.tool()
async def send_message(user_id: str, text: str) -> SendMessageResult:
    """向指定用户发送私信消息。

    先在会话列表中查找用户，如果不在列表中则通过搜索找到用户并打开私信窗口。
    通过当前 EditorKit contenteditable 输入框输入文本，然后点击发送按钮。

    Args:
        user_id: 目标用户的昵称。
        text: 要发送的消息内容。
    """
    try:
        async with _get_tool_lock():
            ctrl = _get_ctrl()
            await ctrl.initialize()
            return await ctrl.send_message(user_id, text)
    except Exception as exc:
        logger.exception("send_message(%r) failed", user_id)
        raise ToolError(f"发送消息失败: {exc}") from exc


# ── main ────────────────────────────────────────────────────────────────


def main():
    """运行 MCP server。

    支持三种传输模式:
      - stdio (默认): 标准输入输出传输，适合 MCP host 本地调用
      - streamable-http: 当前推荐的 HTTP 传输，适合 Docker
      - sse: 兼容旧客户端的 HTTP 传输
    """
    parser = argparse.ArgumentParser(description="Douyin MCP Server")
    parser.add_argument(
        "--transport",
        choices=["stdio", "streamable-http", "sse"],
        default=os.environ.get("DOUYIN_TRANSPORT", "stdio"),
        help="传输协议 (默认: stdio, Docker 推荐: streamable-http)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("DOUYIN_PORT", "6789")),
        help="HTTP 模式监听端口 (默认: 6789)",
    )
    args = parser.parse_args()

    logger.info("启动抖音 MCP 服务器...")
    logger.info("暴露的工具: search_user, list_conversations, read_messages, send_message")
    logger.info("传输模式: %s", args.transport)
    if args.transport != "stdio":
        logger.info("监听端口: %d", args.port)
        if args.transport == "streamable-http":
            logger.info("MCP 端点: http://localhost:%d/mcp", args.port)
        else:
            logger.info("SSE 端点: http://localhost:%d/sse", args.port)
        logger.info("健康检查: http://localhost:%d/health", args.port)
    logger.info("首次启动需要扫码登录，请确保手机抖音 App 可用。")

    if args.transport == "stdio":
        mcp.run()
    elif args.transport == "streamable-http":
        mcp.run(
            transport="streamable-http",
            host="0.0.0.0",
            port=args.port,
        )
    else:
        mcp.run(
            transport="sse",
            host="0.0.0.0",
            port=args.port,
            sse_path="/sse",
            message_path="/mcp",
        )


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        logger.info("收到中断信号，服务已停止")
