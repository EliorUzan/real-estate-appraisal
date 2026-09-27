"""Run with unittest; real HTTP protocol test needs the pinned Nadlan package."""
import asyncio
import importlib.util
import os
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("nadlan_host", Path(__file__).resolve().parents[1] / "deploy/nadlan/server.py")
host = importlib.util.module_from_spec(spec)
spec.loader.exec_module(host)


class HostTests(unittest.TestCase):
    def request(self, headers=(), path="/mcp", kind="http"):
        messages, downstream = [], []

        async def app(scope, receive, send):
            downstream.append(scope)

        async def send(message):
            messages.append(message)

        wrapper = host.AuthenticatedMcp(app, "x" * 32)
        asyncio.run(wrapper({"type": kind, "method": "GET", "path": path, "headers": headers}, None, send))
        return messages, downstream

    def test_auth_health_and_lifespan(self):
        self.assertEqual(self.request()[0][0]["status"], 401)
        self.assertEqual(self.request([(b"authorization", b"Bearer wrong")])[0][0]["status"], 401)
        self.assertEqual(self.request(path="/health")[0][0]["status"], 200)
        self.assertTrue(self.request([(b"authorization", b"Bearer " + b"x" * 32)])[1])
        self.assertTrue(self.request(kind="lifespan")[1])
        with self.assertRaises(ValueError):
            host.AuthenticatedMcp(None, "short")

    @unittest.skipUnless(importlib.util.find_spec("nadlan_mcp"), "Install pinned Nadlan dependency for protocol integration")
    def test_actual_nadlan_http_tools_with_fixture_data(self):
        from starlette.testclient import TestClient
        from nadlan_mcp.fastmcp_server import client as govmap
        from nadlan_mcp.govmap.models import Deal

        deal = Deal(objectid=123, deal_amount=3000000, deal_date="2026-09-01", asset_area=100, rooms=4,
                    street_name="דיזנגוף", house_number="50", settlement_name_heb="תל אביב", deal_source="same_building")
        with patch.dict(os.environ, {"NADLAN_PUBLIC_HOST": "testserver", "NADLAN_MCP_TOKEN": "x" * 32}), \
             patch.object(govmap, "autocomplete_address", return_value=SimpleNamespace(results=[])), \
             patch.object(govmap, "find_recent_deals_for_address", return_value=[deal]), \
             TestClient(host.create_app()) as http:
            self.assertEqual(http.get("/health").status_code, 200)
            self.assertEqual(http.post("/mcp", json={}).status_code, 401)
            headers = {"Authorization": "Bearer " + "x" * 32, "Accept": "application/json, text/event-stream", "MCP-Protocol-Version": "2025-03-26"}

            def rpc(method, params):
                response = http.post("/mcp", headers=headers, json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
                self.assertEqual(response.status_code, 200, response.text)
                payload = response.json()
                self.assertNotIn("error", payload)
                return payload["result"]

            self.assertIn("protocolVersion", rpc("initialize", {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "test", "version": "1"}}))
            self.assertIn("find_recent_deals_for_address", [t["name"] for t in rpc("tools/list", {})["tools"]])
            result = rpc("tools/call", {"name": "find_recent_deals_for_address", "arguments": {"address": "דיזנגוף 50 תל אביב", "years_back": 2, "radius_meters": 500, "max_deals": 100, "deal_type": 2, "lang": "he"}})
            self.assertFalse(result.get("isError"))
            self.assertIn("3000000", str(result))
            self.assertIn("asset_area", str(result))


if __name__ == "__main__":
    unittest.main()
