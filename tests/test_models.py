import unittest

from douyin_mcp.models import (
    Conversation,
    ConversationListResult,
    DouyinMessage,
    ReadMessagesResult,
)


class StructuredModelsTest(unittest.TestCase):
    def test_conversation_result_has_agent_required_fields(self) -> None:
        conversation = Conversation(
            conversation_id="conversation-1",
            user_id="sec-user-1",
            nickname="好友",
            last_message="你好",
            unread=True,
            unread_count=1,
            timestamp="12:30",
        )
        result = ConversationListResult(conversations=[conversation], count=1)

        self.assertEqual(result.count, 1)
        self.assertTrue(result.conversations[0].unread)

    def test_message_result_distinguishes_sender_and_type(self) -> None:
        message = DouyinMessage(
            id="message-1",
            sender="friend",
            sender_name="好友",
            content="在吗",
            timestamp="12:31",
            type="text",
        )
        result = ReadMessagesResult(
            conversation_id="conversation-1",
            user_id="sec-user-1",
            nickname="好友",
            messages=[message],
            count=1,
        )

        self.assertEqual(result.messages[0].sender, "friend")
        self.assertEqual(result.messages[0].type, "text")


if __name__ == "__main__":
    unittest.main()
