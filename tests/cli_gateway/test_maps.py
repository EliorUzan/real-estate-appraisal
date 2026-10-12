import json
import unittest
from cli_gateway.maps_config import verify_key, mcp_json, demo_key, recover_setup
from cli_gateway.contracts import GatewayError


class Response:
    headers = {"Mcp-Session-Id": "synthetic-session"}
    def __init__(self, payload): self.payload = payload
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def read(self, limit): return self.payload


class MapsTests(unittest.TestCase):
    def test_demo_setup_uses_only_the_fixed_mcp_catalog_and_not_the_model(self):
        methods, requests, hearts = [], [], []
        key = "AIza" + "x" * 35  # Deliberately synthetic; no upstream network.
        class Opener:
            def open(self, request, timeout):
                requests.append(request)
                message = json.loads(request.data)
                methods.append(message['method'])
                payload = {'jsonrpc': '2.0', 'id': 1, 'result': {'protocolVersion': '2025-06-18'}} if message['method'] == 'initialize' else {'jsonrpc': '2.0', 'id': 2, 'result': {'tools': [{'name': 'search_places'}, {'name': 'resolve_names'}]}} if message['method'] == 'tools/list' else None
                return Response(json.dumps(payload).encode() if payload else b'')
        result = verify_key(key, opener=Opener(), heartbeat=lambda: hearts.append(True))
        self.assertEqual(methods, ['initialize', 'notifications/initialized', 'tools/list'])
        self.assertEqual(len(hearts), 3)
        self.assertEqual(result['toolNames'], ['resolve_names', 'search_places'])
        self.assertNotIn(key, json.dumps(result))
        self.assertTrue(all(r.full_url == 'https://mapstools.googleapis.com/mcp' for r in requests))
        self.assertFalse(any(m == 'tools/call' for m in methods))

    def test_keys_and_upstream_response_bounds_are_strict(self):
        for value in ('https://example.com/key', 'AIza' + 'x' * 35 + '\n', '', 'ordinary-login-code'):
            with self.assertRaises(GatewayError): demo_key(value)
        with self.assertRaises(GatewayError): mcp_json(b'x' * 65537)
        self.assertEqual(mcp_json(b'data: {"result":{"tools":[]}}\n\n'), {'result': {'tools': []}})
        with self.assertRaises(GatewayError): mcp_json(b'data: {}\ndata: {}')

    def test_recovery_never_replays_a_key_or_deletes_an_acknowledged_candidate(self):
        for result_state in ('succeeded', 'failed'):
            calls = []
            class Engine:
                def inventory(self): return []
            class Client:
                def call(self, action, **fields):
                    calls.append(action)
                    return {'setup': None} if action == 'getSetupAssignment' else {'acknowledged': True, 'state': result_state}
            class Journal:
                def load(self): return {'sessionId': 'synthetic-session', 'phase': 'verify_write_intent'}
                def clear(self): calls.append('clear')
            class Store:
                def remove(self, session): calls.append('remove')
            recover_setup(Engine(), Client(), Journal(), Store())
            self.assertEqual(calls, ['getSetupAssignment', 'reconcileSetup'] + ([] if result_state == 'succeeded' else ['remove']) + ['clear'])

    def test_recovery_with_a_container_quarantines_without_deleting_or_replaying(self):
        calls = []
        class Engine:
            def inventory(self): return ['unexpected-container']
        class Client:
            def call(self, action, **fields):
                calls.append(action)
                return {'setup': None}
        class Journal:
            def load(self): return {'sessionId': 'synthetic-session'}
            def clear(self): calls.append('clear')
        class Store:
            def remove(self, session): calls.append('remove')
        with self.assertRaises(GatewayError): recover_setup(Engine(), Client(), Journal(), Store())
        self.assertEqual(calls, ['getSetupAssignment', 'quarantineHost'])


if __name__ == '__main__': unittest.main()
