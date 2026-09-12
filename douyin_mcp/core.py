"""
Douyin MCP Core — 抖音操作核心模块

基于 Playwright 浏览器自动化，通过 DOM 操作实现：
  - 搜索用户（search_user）
  - 读取私信（read_messages）
  - 发送私信（send_message）
  - 列举会话（list_conversations）

关键依赖:
  - playwright: 浏览器自动化
  - 抖音网页版首页的消息侧栏

注意:
  - 聊天输入框使用 EditorKit contenteditable，通过 Playwright fill 输入文本
  - 消息读取通过 DOM 提取，零成本
  - 所有操作需要先登录（由 browser.BrowserManager 管理）
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import re

from douyin_mcp.browser import BrowserManager, DOUYIN_URL
from douyin_mcp.models import (
    Conversation,
    ConversationListResult,
    DouyinMessage,
    ReadMessagesResult,
    SendMessageResult,
)

logger = logging.getLogger("douyin-mcp.core")


# ══════════════════════════════════════════════════════════════════════
#  DouyinController
# ══════════════════════════════════════════════════════════════════════


class DouyinController:
    """抖音私信操作控制器。

    提供搜索用户、读取私信、发送私信、列举会话四个核心功能。
    所有操作通过 Playwright 控制抖音网页版完成。
    """

    def __init__(self, headless: bool = False) -> None:
        self._browser = BrowserManager(headless=headless)
        self._initialized = False

    async def initialize(self) -> str:
        """初始化浏览器并确保已登录。

        Returns:
            状态信息字符串。
        """
        if self._initialized:
            return "已经初始化"

        await self._browser.start()
        await self._browser.ensure_authenticated()
        self._initialized = True
        return "浏览器初始化完成，已登录 ✅"

    async def close(self) -> None:
        """关闭浏览器，释放资源。"""
        await self._browser.close()
        self._initialized = False

    @property
    def page(self):
        return self._browser.page

    # ── 工具函数 ────────────────────────────────────────────────────

    async def _ensure_messages_page(self) -> None:
        """确保抖音首页的私信侧栏已打开。

        抖音当前的 ``/messages`` 路由会返回 404，私信入口实际是首页导航中
        的“消息”按钮。侧栏节点即使关闭时也可能留在 DOM 中，因此必须检查
        可见性，不能只检查节点是否存在。已经打开的聊天层会被保留，因为
        会话列表 DOM 仍可读取，关闭后重开会造成轮询期间的页面闪烁。
        """
        panel = self.page.locator(".conversationConversationListwrapper")
        if await panel.count() and await panel.first.is_visible():
            return

        for attempt in range(3):
            if not self.page.url.startswith(DOUYIN_URL) or attempt:
                await self._browser.navigate(DOUYIN_URL)
                await asyncio.sleep(3)

            trigger_groups = [
                self.page.locator("p.phl13lpd").filter(has_text="消息"),
                self.page.get_by_text("消息", exact=True),
            ]
            for triggers in trigger_groups:
                for index in range(await triggers.count()):
                    trigger = triggers.nth(index)
                    try:
                        if not await trigger.is_visible():
                            continue
                        await trigger.click(timeout=5000)
                        await panel.first.wait_for(state="visible", timeout=8000)
                        return
                    except Exception:
                        continue

        raise RuntimeError("无法打开抖音私信面板，网页结构可能已变化")

    async def _return_to_conversation_list(self) -> None:
        """如果聊天详情层已打开，则点击其返回箭头回到会话列表。"""
        chat_layers = self.page.locator('[data-stack-layer="chat"]:visible')
        if not await chat_layers.count():
            return
        chat_layer = chat_layers.last

        back = chat_layer.locator(".StackLayoutStackTitleBarleftArea").first
        if not await back.count() or not await back.is_visible():
            raise RuntimeError("聊天详情已打开，但没有找到返回会话列表的按钮")

        await back.click()
        try:
            await chat_layer.wait_for(state="hidden", timeout=5000)
        except Exception:
            # 部分版本会保留覆盖层节点；只要它不再阻挡会话项即可继续。
            logger.debug("聊天覆盖层在返回后仍保留在 DOM")

    async def _safe_text(self, element_handle, default: str = "") -> str:
        """安全地获取元素文本内容。"""
        try:
            text = await element_handle.inner_text()
            return text.strip() or default
        except Exception:
            return default

    # ══════════════════════════════════════════════════════════════════
    #  Tool 1: search_user
    # ══════════════════════════════════════════════════════════════════

    async def search_user(self, keyword: str) -> str:
        """搜索抖音用户。

        在抖音搜索页面搜索用户，返回匹配的用户列表。

        Args:
            keyword: 搜索关键词（用户名、抖音号等）。

        Returns:
            用户列表文本（昵称、抖音号、粉丝数等）。
        """
        search_url = f"{DOUYIN_URL}/search/{keyword}"

        logger.info("搜索用户: %s", keyword)
        await self._browser.navigate(search_url)

        # 等待搜索结果渲染
        await asyncio.sleep(3)

        # 切换到"用户"标签页（如果有）
        user_tab_selectors = [
            "span:has-text('用户')",
            "div:has-text('用户')",
            "[class*='tab']:has-text('用户')",
            "a:has-text('用户')",
        ]
        for sel in user_tab_selectors:
            try:
                el = await self.page.wait_for_selector(sel, timeout=3000)
                if el:
                    await el.click()
                    await asyncio.sleep(2)
                    logger.info("切换到用户标签")
                    break
            except Exception:
                continue

        # 提取用户信息 — 尝试多种 DOM 结构
        results = []

        # 方法 1: 用户卡片通用选择器
        user_cards = await self._query_user_cards()

        if not user_cards:
            # 方法 2: 搜索结果的通用选择
            user_cards = await self._query_search_results()

        if not user_cards:
            return f"未找到用户「{keyword}」的搜索结果"

        for card in user_cards[:10]:  # 最多返回 10 个
            results.append(card)

        output = [f"搜索「{keyword}」的结果 ({len(results)}):\n"]
        for i, r in enumerate(results, 1):
            output.append(
                f"  {i}. {r.get('nickname', '?')} "
                f"(@{r.get('unique_id', '?')})"
            )
            if r.get("desc"):
                output.append(f"     简介: {r['desc']}")
            if r.get("followers"):
                output.append(f"     粉丝: {r['followers']}")
            output.append("")

        return "\n".join(output).strip()

    async def _query_user_cards(self) -> list[dict]:
        """从搜索页面提取用户卡片信息。"""
        results = []

        # 尝试多种卡片选择器
        card_selectors = [
            "[class*='user-card']",
            "[class*='UserCard']",
            "[class*='search-result-item']",
            "[class*='searchResultItem']",
            "li[class*='user']",
            "div[class*='user-item']",
        ]

        cards = []
        for sel in card_selectors:
            try:
                els = await self.page.query_selector_all(sel)
                if els:
                    cards = els
                    break
            except Exception:
                continue

        for card in cards:
            try:
                info = await self._extract_user_info(card)
                if info.get("nickname"):
                    results.append(info)
            except Exception:
                continue

        return results

    async def _query_search_results(self) -> list[dict]:
        """降级方案：从页面中提取所有可能的用户信息。"""
        results = []
        try:
            # 提取所有链接中的用户信息
            links = await self.page.query_selector_all("a[href*='/user/']")
            seen = set()
            for link in links[:10]:
                try:
                    href = await link.get_attribute("href") or ""
                    text = await self._safe_text(link)
                    if text and href not in seen:
                        seen.add(href)
                        sec_uid = href.split("/user/")[-1].split("?")[0]
                        results.append({
                            "nickname": text,
                            "unique_id": sec_uid[:12] + "...",
                            "sec_uid": sec_uid,
                            "desc": "",
                            "followers": "",
                        })
                except Exception:
                    continue
        except Exception:
            pass

        return results

    async def _extract_user_info(self, card) -> dict:
        """从用户卡片元素提取信息。"""
        info = {
            "nickname": "",
            "unique_id": "",
            "sec_uid": "",
            "desc": "",
            "followers": "",
        }

        # 昵称
        for sel in [
            "[class*='nickname']",
            "[class*='Nickname']",
            "[class*='name']",
            "a[href*='/user/']",
            "span",
        ]:
            try:
                el = await card.query_selector(sel)
                if el:
                    text = await self._safe_text(el)
                    if text:
                        info["nickname"] = text
                        break
            except Exception:
                continue

        # 抖音号 (@xxx)
        for sel in [
            "[class*='unique-id']",
            "[class*='uniqueId']",
            "[class*='douyin-id']",
            "span:has-text('@')",
        ]:
            try:
                el = await card.query_selector(sel)
                if el:
                    text = await self._safe_text(el)
                    if text:
                        info["unique_id"] = text.strip("@")
                        break
            except Exception:
                continue

        # 如果找不到 unique_id，尝试从昵称元素提取
        if not info["unique_id"] and info["nickname"]:
            # 很多卡片在昵称下方有 @xxx
            pass

        # 简介
        for sel in ["[class*='desc']", "[class*='signature']", "p"]:
            try:
                el = await card.query_selector(sel)
                if el:
                    text = await self._safe_text(el)
                    if text and text != info["nickname"]:
                        info["desc"] = text
                        break
            except Exception:
                continue

        # 粉丝数
        for sel in [
            "[class*='follower']",
            "[class*='follow-count']",
            "span:has-text('粉丝')",
        ]:
            try:
                el = await card.query_selector(sel)
                if el:
                    info["followers"] = await self._safe_text(el)
                    break
            except Exception:
                continue

        # sec_uid
        try:
            link = await card.query_selector("a[href*='/user/']")
            if link:
                href = await link.get_attribute("href") or ""
                sec_uid = href.split("/user/")[-1].split("?")[0]
                if sec_uid:
                    info["sec_uid"] = sec_uid
        except Exception:
            pass

        return info

    # ══════════════════════════════════════════════════════════════════
    #  Tool 2: list_conversations
    # ══════════════════════════════════════════════════════════════════

    async def list_conversations(self) -> ConversationListResult:
        """列举当前所有的私信会话列表。

        从 /messages 页面左侧会话面板提取会话信息。

        Returns:
            结构化会话列表（联系人、最后消息、未读状态等）。
        """
        await self._ensure_messages_page()
        await asyncio.sleep(3)  # 等待左侧列表渲染

        conversations = await self._extract_conversations()

        return ConversationListResult(
            conversations=conversations,
            count=len(conversations),
        )

    async def _extract_conversations(self) -> list[Conversation]:
        """从已打开的私信侧栏提取结构化会话列表。"""
        results: list[Conversation] = []
        items = self.page.locator(".conversationConversationItemwrapper")

        for index in range(await items.count()):
            item = items.nth(index)
            try:
                conv = await self._extract_conversation_item(item)
                if conv.nickname:
                    results.append(conv)
            except Exception as exc:
                logger.warning("解析第 %d 个会话失败: %s", index, exc)

        return results

    async def _extract_conversation_item(self, item) -> Conversation:
        """从单个会话项提取信息。"""
        async def child_text(selector: str) -> str:
            locator = item.locator(selector).first
            if not await locator.count():
                return ""
            return await self._safe_text(locator)

        nickname = await child_text(".conversationConversationItemtitle")
        last_message = await child_text(".ConversationItemHinttextBox")
        timestamp = await child_text(".ConversationItemTagNextToTitletimeStr")

        unread_badge = item.locator(
            ".ConversationItemUnReadCountmutedUnreadBadge, "
            "[class*='ConversationItemUnReadCount']"
        ).first
        has_unread_badge = bool(await unread_badge.count()) and await unread_badge.is_visible()
        unread_text = await self._safe_text(unread_badge) if has_unread_badge else ""
        unread_match = re.search(r"\d+", unread_text)
        unread_count = int(unread_match.group()) if unread_match else int(has_unread_badge)

        user_id = await item.evaluate("""el => {
            const fiberKey = Object.keys(el).find(key => key.startsWith('__reactFiber'));
            let fiber = fiberKey ? el[fiberKey] : null;
            while (fiber) {
                for (const props of [fiber.pendingProps, fiber.memoizedProps]) {
                    const conversation = props && props.conversation;
                    if (conversation && typeof conversation.toParticipantSecUserId === 'string') {
                        return conversation.toParticipantSecUserId || null;
                    }
                }
                fiber = fiber.return;
            }
            return null;
        }""")

        conversation_id = user_id or hashlib.sha256(
            f"douyin-conversation:{nickname}".encode("utf-8")
        ).hexdigest()

        return Conversation(
            conversation_id=conversation_id,
            user_id=user_id,
            nickname=nickname,
            last_message=last_message,
            unread=has_unread_badge,
            unread_count=unread_count,
            timestamp=timestamp or None,
        )

    # ══════════════════════════════════════════════════════════════════
    #  Tool 3: read_messages
    # ══════════════════════════════════════════════════════════════════

    async def read_messages(self, contact: str, limit: int = 20) -> ReadMessagesResult:
        """读取指定联系人的私信消息。

        Args:
            contact: 联系人昵称（用于在会话列表中定位）。
            limit: 读取的最大消息条数（默认 20）。

        Returns:
            带稳定消息 ID、发送方向和类型的结构化消息列表。
        """
        await self._ensure_messages_page()
        await asyncio.sleep(2)

        # 1. 在会话列表中点击指定联系人
        conversation = await self._open_conversation(contact)
        if conversation is None:
            raise LookupError(f"未找到与「{contact}」的会话")

        # 2. 等待消息区域加载
        await asyncio.sleep(2)

        # 3. 提取消息
        messages = await self._extract_messages(limit)

        return ReadMessagesResult(
            conversation_id=conversation.conversation_id,
            user_id=conversation.user_id,
            nickname=conversation.nickname,
            messages=messages,
            count=len(messages),
        )

    async def _open_conversation(self, contact: str) -> Conversation | None:
        """在会话列表中点击指定联系人的会话。

        支持精确匹配和模糊匹配。
        """
        conversations = await self._extract_conversations()

        target: Conversation | None = None
        for conv in conversations:
            name = conv.nickname
            if contact == name or contact in name or name in contact:
                target = conv
                break

        if target is None:
            logger.warning("未找到联系人: %s", contact)
            return False

        # 尝试点击 — 用昵称文本定位
        nickname = target.nickname
        if await self._is_conversation_open(nickname):
            await self.page.locator(".messageMessageListwrapper").wait_for(
                state="visible", timeout=10000
            )
            return target

        try:
            items = self.page.locator(".conversationConversationItemwrapper")
            for index in range(await items.count()):
                item = items.nth(index)
                title = item.locator(".conversationConversationItemtitle")
                if not await title.count():
                    continue
                if (await title.inner_text()).strip() == nickname:
                    try:
                        await item.click(timeout=5000)
                    except Exception:
                        # 打开的聊天层会覆盖会话列表并拦截鼠标动作，但底层
                        # React 会话项仍存在。精确匹配后用 DOM click 作为降级。
                        await item.evaluate("el => el.click()")
                    await self.page.locator(".messageMessageListwrapper").wait_for(
                        state="visible", timeout=10000
                    )
                    return target

        except Exception as exc:
            logger.warning("点击联系人失败: %s", exc)

        return None

    async def _is_conversation_open(self, nickname: str) -> bool:
        """通过聊天标题确认目标会话是否已经打开。"""
        chat_layers = self.page.locator('[data-stack-layer="chat"]:visible')
        if not await chat_layers.count():
            return False

        chat_layer = chat_layers.last
        candidates = [
            chat_layer.locator(".StackLayoutStackTitleBartitle").first,
            chat_layer.locator("[class*='StackTitleBartitle']").first,
            chat_layer.locator("[class*='StackTitleBarcenterArea']").first,
            chat_layer.locator("[class*='StackTitleBarcenter']").first,
        ]

        left_area = chat_layer.locator(".StackLayoutStackTitleBarleftArea").first
        if await left_area.count():
            candidates.append(left_area.locator("xpath=..").first)

        for candidate in candidates:
            try:
                if not await candidate.count() or not await candidate.is_visible():
                    continue
                text = await self._safe_text(candidate)
                if any(line.strip() == nickname for line in text.splitlines()):
                    return True
            except Exception:
                # React 重新渲染标题栏时 locator 可能瞬时失效；此时回退到
                # 精确匹配会话项并点击，不能因为优化路径影响正常读取。
                continue
        return False

    async def _extract_messages(self, limit: int = 20) -> list[DouyinMessage]:
        """从聊天区域提取消息，并按从旧到新的顺序返回。

        抖音当前虚拟列表的 DOM 顺序是从新到旧（索引 0 位于视觉底部），
        因此必须反向遍历最近的节点。Agent Service 约定数组最后一项才是
        最新消息。
        """
        limit = max(1, min(limit, 100))
        messages: list[DouyinMessage] = []
        items = self.page.locator(".messageMessageBoxmessageBox")
        item_count = await items.count()

        for index in self._recent_message_dom_indices(item_count, limit):
            try:
                message = await self._extract_message(items.nth(index))
                if message.content:
                    messages.append(message)
            except Exception as exc:
                logger.warning("解析第 %d 条消息失败: %s", index, exc)

        return messages

    @staticmethod
    def _recent_message_dom_indices(item_count: int, limit: int) -> range:
        """返回最近消息的 DOM 索引，顺序为从旧到新。"""
        recent_count = min(max(item_count, 0), max(limit, 0))
        return range(recent_count - 1, -1, -1)

    @staticmethod
    def _normalize_message_sender(
        *, system: bool, is_from_me: bool | None
    ) -> str:
        """把抖音当前网页的内部方向标记转换成 Agent 方向。

        React message 对象中的 ``isMyMessage`` 在双方消息上都可能为 true，
        不能用于判断方向。真实 DOM 验证显示，我方气泡的 contentBox 包含
        ``messageMessageBoxisFromMe``，并使用 row-reverse 右侧布局。字段缺失
        时返回 ``system``，避免把无法确认方向的消息误判为 incoming。
        """
        if system:
            return "system"
        if is_from_me is True:
            return "me"
        if is_from_me is False:
            return "friend"
        return "system"

    async def _extract_message(self, item) -> DouyinMessage:
        """把抖音消息节点规范化为自动回复服务需要的数据结构。"""
        data = await item.evaluate("""el => {
            const fiberKey = Object.keys(el).find(key => key.startsWith('__reactFiber'));
            let fiber = fiberKey ? el[fiberKey] : null;
            let message = null;
            let messageId = null;

            while (fiber) {
                const props = [fiber.pendingProps, fiber.memoizedProps];
                for (const prop of props) {
                    if (!message && prop && prop.message && typeof prop.message.isMyMessage === 'boolean') {
                        message = prop.message;
                    }
                    if (!messageId && prop && prop.virtualItem && typeof prop.virtualItem.id === 'string') {
                        messageId = prop.virtualItem.id;
                    }
                }
                fiber = fiber.return;
            }

            const parsed = message && message.parsedContent && typeof message.parsedContent === 'object'
                ? message.parsedContent : {};
            const active = el.querySelector('.MessageBoxContentactiveClickArea');
            const fullRow = el.querySelector('.messageMessageBoxfullRowContent');
            const contentBox = el.querySelector('.messageMessageBoxcontentBox');
            const senderName = el.querySelector('.MessageBoxMessageTitleavatarName');
            const time = el.querySelector('.MessageBoxTimetimeLayout');
            const system = el.classList.contains('messageMessageBoxisFullRowCenterMessage');
            const classText = [...el.querySelectorAll('[class]')]
                .map(node => typeof node.className === 'string' ? node.className : '').join(' ');

            let type = 'other';
            if (system) type = 'other';
            else if (typeof parsed.text === 'string') type = 'text';
            else if (/MessageItemImage/i.test(classText)) type = 'image';
            else if (/MessageItemShareAweme|MessageItemVideo/i.test(classText) || parsed.itemId) type = 'video';

            let content = '';
            if (typeof parsed.text === 'string') content = parsed.text;
            else if (system && fullRow) content = fullRow.innerText;
            else if (active) content = active.innerText;

            return {
                id: messageId,
                system,
                isFromMe: contentBox
                    ? contentBox.classList.contains('messageMessageBoxisFromMe') : null,
                senderName: senderName ? senderName.innerText.trim() : null,
                content: content.trim(),
                timestamp: time ? time.innerText.trim() : null,
                type
            };
        }""")

        sender = self._normalize_message_sender(
            system=data["system"], is_from_me=data["isFromMe"]
        )

        if not data["id"]:
            fingerprint = "|".join([
                sender,
                data["content"],
                data["timestamp"] or "",
            ])
            data["id"] = hashlib.sha256(fingerprint.encode("utf-8")).hexdigest()

        return DouyinMessage(
            id=data["id"],
            sender=sender,
            sender_name=data["senderName"],
            content=data["content"],
            timestamp=data["timestamp"] or None,
            type=data["type"],
        )

    # ══════════════════════════════════════════════════════════════════
    #  Tool 4: send_message
    # ══════════════════════════════════════════════════════════════════

    async def send_message(self, user_id: str, text: str) -> SendMessageResult:
        """向指定用户发送私信。

        流程:
          1. 打开首页私信侧栏
          2. 通过联系人昵称打开会话（或通过搜索用户打开新会话）
          3. 操作 EditorKit contenteditable 输入框
          4. 点击发送按钮

        Args:
            user_id: 用户昵称（用于查找会话或搜索用户）。
            text: 消息内容。

        Returns:
            结构化发送结果。
        """
        if not user_id.strip():
            raise ValueError("user_id 不能为空")
        if not text.strip():
            raise ValueError("text 不能为空")

        await self._ensure_messages_page()
        await asyncio.sleep(2)

        # 1. 尝试在会话列表中找到该用户
        opened = await self._open_conversation(user_id)

        if not opened:
            # 2. 如果不在会话列表中，尝试搜索用户并发送私信
            logger.info("会话列表未找到 %s，尝试搜索并发送私信", user_id)
            detail = await self._search_and_send(user_id, text)
            if detail.startswith("✅"):
                status = "sent"
            elif "已输入" in detail:
                status = "drafted"
            else:
                status = "failed"
            return SendMessageResult(
                ok=status == "sent",
                recipient=user_id,
                status=status,
                detail=detail,
            )

        # 3. 等待聊天区域加载
        await asyncio.sleep(2)

        # 4. 在输入框中输入文本
        typed = await self._type_message(text)
        if not typed:
            return SendMessageResult(
                ok=False,
                recipient=user_id,
                status="failed",
                detail="无法操作输入框",
            )

        # 5. 点击发送按钮
        sent = await self._click_send()
        if not sent:
            return SendMessageResult(
                ok=False,
                recipient=user_id,
                status="drafted",
                detail="消息已输入但未能自动发送，请手动点击发送按钮",
            )

        await asyncio.sleep(1)
        return SendMessageResult(
            ok=True,
            recipient=user_id,
            status="sent",
            detail="消息已发送",
        )

    async def _search_and_send(self, user_id: str, text: str) -> str:
        """搜索用户并发送私信的降级方案。"""
        # 搜索用户
        search_result = await self.search_user(user_id)

        if "未找到" in search_result:
            return f"未找到用户「{user_id}」，无法发送消息"

        # 尝试点击第一个搜索结果的链接
        try:
            link = await self.page.query_selector("a[href*='/user/']")
            if link:
                href = await link.get_attribute("href") or ""
                await self._browser.navigate(DOUYIN_URL + href)
                await asyncio.sleep(3)

                # 在用户主页找"发私信"按钮
                send_btn_selectors = [
                    "button:has-text('发私信')",
                    "span:has-text('发私信')",
                    "[class*='send-message']",
                    "button:has-text('私信')",
                ]
                for sel in send_btn_selectors:
                    try:
                        btn = await self.page.wait_for_selector(sel, timeout=3000)
                        if btn:
                            await btn.click()
                            await asyncio.sleep(2)
                            break
                    except Exception:
                        continue

                # 输入并发送
                typed = await self._type_message(text)
                if not typed:
                    return f"无法操作输入框向「{user_id}」发送消息"

                sent = await self._click_send()
                if sent:
                    await asyncio.sleep(1)
                    return f"✅ 已向「{user_id}」发送消息: {text[:50]}{'...' if len(text) > 50 else ''}"
                else:
                    return f"消息已输入但未能自动发送，请手动点击发送按钮"

        except Exception as exc:
            logger.warning("搜索并发送失败: %s", exc)

        return f"向「{user_id}」发送消息失败"

    async def _type_message(self, text: str) -> bool:
        """在抖音当前的 EditorKit contenteditable 输入框中输入文本。

        Args:
            text: 要输入的文本内容。

        Returns:
            True 如果输入成功。
        """
        try:
            editor = self.page.locator(
                ".messageEditorinputArea[contenteditable='true']"
            ).first
            await editor.wait_for(state="visible", timeout=5000)
            await editor.fill(text)
            actual = self._normalize_editor_text(await editor.inner_text())
            return actual == self._normalize_editor_text(text)

        except Exception as exc:
            logger.warning("输入文本失败: %s", exc)
            return False

    @staticmethod
    def _normalize_editor_text(text: str) -> str:
        """移除 EditorKit 自动插入的不可见占位字符。"""
        return text.translate(
            {
                ord("\u200b"): None,  # zero-width space
                ord("\u2060"): None,  # word joiner
                ord("\ufeff"): None,  # zero-width no-break space
            }
        ).strip()

    async def _wait_for_editor_clear(self, editor, timeout: float = 3.0) -> bool:
        """发送后等待编辑器正文清空，以此确认网页已接受发送动作。"""
        attempts = max(1, int(timeout / 0.2))
        for _ in range(attempts):
            if not self._normalize_editor_text(await editor.inner_text()):
                return True
            await asyncio.sleep(0.2)
        return False

    async def _click_send(self) -> bool:
        """点击发送按钮。"""
        editor = self.page.locator(
            ".messageEditorinputArea[contenteditable='true']"
        ).first
        try:
            # 当前网页版在输入框右侧放置两个 SVG 操作：表情、发送。
            # 发送始终是 message input 容器中的最后一个可见 SVG。
            actions = self.page.locator(".messageMsgInputcontainer svg:visible")
            if await actions.count() >= 2:
                await actions.last.click()
                if await self._wait_for_editor_clear(editor):
                    return True
        except Exception as exc:
            logger.warning("点击发送按钮失败: %s", exc)

        # 降级：按 Enter 发送
        try:
            await editor.press("Enter")
            return await self._wait_for_editor_clear(editor)
        except Exception as exc:
            logger.warning("按 Enter 发送失败: %s", exc)

        return False
