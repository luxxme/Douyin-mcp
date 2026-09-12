"""Structured return models shared by the Douyin controller and MCP tools."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class Conversation(BaseModel):
    """A conversation row from Douyin's message panel."""

    conversation_id: str = Field(description="Stable conversation key")
    user_id: str | None = Field(
        default=None,
        description="Douyin sec_user_id when exposed by the web client",
    )
    nickname: str
    last_message: str = ""
    unread: bool = False
    unread_count: int = 0
    timestamp: str | None = None


class ConversationListResult(BaseModel):
    conversations: list[Conversation]
    count: int


class DouyinMessage(BaseModel):
    """Normalized message needed by the future auto-reply service."""

    id: str = Field(description="Stable DOM/virtual-list message identifier")
    sender: Literal["me", "friend", "system"]
    sender_name: str | None = None
    content: str
    timestamp: str | None = None
    type: Literal["text", "image", "video", "other"]


class ReadMessagesResult(BaseModel):
    conversation_id: str
    user_id: str | None = None
    nickname: str
    messages: list[DouyinMessage]
    count: int


class SendMessageResult(BaseModel):
    ok: bool
    recipient: str
    status: Literal["sent", "drafted", "failed"]
    detail: str
