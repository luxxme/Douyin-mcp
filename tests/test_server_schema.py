import unittest

from douyin_mcp.server import mcp


class ServerSchemaTest(unittest.IsolatedAsyncioTestCase):
    async def test_phase_one_tools_expose_output_schemas(self) -> None:
        tools = {tool.name: tool for tool in await mcp.list_tools()}

        self.assertEqual(
            set(tools),
            {"search_user", "list_conversations", "read_messages", "send_message"},
        )
        for name in ("list_conversations", "read_messages", "send_message"):
            self.assertIsNotNone(tools[name].output_schema)


if __name__ == "__main__":
    unittest.main()
