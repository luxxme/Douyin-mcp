import unittest
from unittest.mock import AsyncMock, MagicMock

from douyin_mcp.core import DouyinController
from douyin_mcp.models import Conversation


def make_conversation() -> Conversation:
    return Conversation(
        conversation_id="conversation-1",
        user_id="user-1",
        nickname="好友",
        last_message="你好",
        unread=True,
        unread_count=1,
        timestamp="刚刚",
    )


class ConversationSwitchingTest(unittest.IsolatedAsyncioTestCase):
    async def test_already_open_conversation_skips_list_navigation(self) -> None:
        controller = DouyinController()
        page = MagicMock()
        message_list = MagicMock()
        message_list.wait_for = AsyncMock()
        page.locator.return_value = message_list
        controller._browser = MagicMock()
        controller._browser.page = page
        controller._extract_conversations = AsyncMock(return_value=[make_conversation()])
        controller._is_conversation_open = AsyncMock(return_value=True)
        controller._return_to_conversation_list = AsyncMock()

        result = await controller._open_conversation("好友")

        self.assertEqual(result.nickname, "好友")
        controller._return_to_conversation_list.assert_not_awaited()

    async def test_switch_closes_old_layer_and_verifies_new_title(self) -> None:
        controller = DouyinController()
        page = MagicMock()
        chat_layers = MagicMock()
        chat_layers.count = AsyncMock(return_value=1)
        items = MagicMock()
        items.count = AsyncMock(return_value=1)
        item = MagicMock()
        item.click = AsyncMock()
        item.evaluate = AsyncMock()
        title = MagicMock()
        title.count = AsyncMock(return_value=1)
        title.inner_text = AsyncMock(return_value="好友")
        item.locator.return_value = title
        items.nth.return_value = item
        message_list = MagicMock()
        message_list.wait_for = AsyncMock()

        def locate(selector: str):
            if selector == '[data-stack-layer="chat"]:visible':
                return chat_layers
            if selector == ".conversationConversationItemwrapper":
                return items
            if selector == ".messageMessageListwrapper":
                return message_list
            raise AssertionError(f"unexpected selector: {selector}")

        page.locator.side_effect = locate
        controller._browser = MagicMock()
        controller._browser.page = page
        controller._extract_conversations = AsyncMock(return_value=[make_conversation()])
        controller._is_conversation_open = AsyncMock(side_effect=[False, True])
        controller._return_to_conversation_list = AsyncMock()

        result = await controller._open_conversation("好友")

        self.assertEqual(result.nickname, "好友")
        controller._return_to_conversation_list.assert_awaited_once()
        item.click.assert_awaited_once()
        self.assertEqual(controller._is_conversation_open.await_count, 2)


if __name__ == "__main__":
    unittest.main()
