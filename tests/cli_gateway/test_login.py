import json
import os
import unittest
import uuid
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cli_gateway.login_crypto import LoginKey, encode, ALGORITHM, normalize_code
from cli_gateway.login_protocol import NativeProtocol, validate_url
from cli_gateway.login_recovery import recover_login
from cli_gateway.contracts import GatewayError


def seal(key, value, context):
    aes, nonce = os.urandom(32), os.urandom(12)
    wrapped = key.private.public_key().encrypt(aes, padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None))
    aad = json.dumps([1, "antigravity-login", *context, key.key_id], separators=(",", ":")).encode()
    return {"version": 1, "algorithm": ALGORITHM, "keyId": key.key_id, "wrappedKey": encode(wrapped), "iv": encode(nonce), "ciphertext": encode(AESGCM(aes).encrypt(nonce, value.encode(), aad))}


class LoginTests(unittest.TestCase):
    def test_envelope_is_bound_to_every_delivery_identity(self):
        key = LoginKey()
        context = [str(uuid.uuid4()), 3, str(uuid.uuid4()), str(uuid.uuid4())]
        envelope = seal(key, "synthetic-one-time-code", context)
        self.assertEqual(key.decrypt(envelope, *context), "synthetic-one-time-code")
        for index in range(4):
            changed = list(context)
            changed[index] = 4 if index == 1 else str(uuid.uuid4())
            with self.assertRaises(GatewayError):
                key.decrypt(envelope, *changed)
        envelope["ciphertext"] = envelope["ciphertext"][:-1] + ("A" if envelope["ciphertext"][-1] != "A" else "B")
        with self.assertRaises(GatewayError):
            key.decrypt(envelope, *context)

    def test_code_validation_rejects_urls_controls_and_multiline(self):
        self.assertEqual(normalize_code("  fake-code\r\n"), "fake-code")
        for value in ("", "a\nb", "a b", "https://accounts.google.com/", "\x1b[31mcode", "{\"code\":1}", "a" * 8193):
            with self.assertRaises(GatewayError):
                normalize_code(value)

    def test_chunked_protocol_never_sends_code_twice(self):
        rules = {"protocol": "antigravity-login-v1", "version": "1.3.3", "routes": [["accounts.google.com", "/o/oauth2/v2/auth"]],
                 "codePrompt": "Enter code:", "success": "Authentication saved", "cached": "Cached account ready", "invalid": "Invalid authorization", "menus": []}
        parser = NativeProtocol(rules)
        with self.assertRaises(GatewayError):
            parser.authorize_code()
        message = b"\x1b[32mhttps://accounts.google.com/o/oauth2/v2/auth?state=synthetic\x1b[0m\nEnter code:"
        event = None
        for byte in message:
            event = parser.feed(bytes([byte])) or event
        self.assertEqual(event["kind"], "challenge")
        parser.authorize_code()
        with self.assertRaises(GatewayError):
            parser.authorize_code()
        self.assertEqual(parser.feed(b"Authentication saved")["kind"], "authenticated")

    def test_url_routes_are_exact(self):
        routes = [["accounts.google.com", "/o/oauth2/v2/auth"]]
        for value in ("http://accounts.google.com/o/oauth2/v2/auth", "https://accounts.google.com.evil.test/o/oauth2/v2/auth", "https://u@accounts.google.com/o/oauth2/v2/auth", "https://accounts.google.com:444/o/oauth2/v2/auth", "https://accounts.google.com/other"):
            with self.assertRaises(GatewayError):
                validate_url(value, routes)

    def test_erased_code_prompt_cannot_authorize_input_into_main_agent(self):
        rules = {"protocol": "antigravity-login-v1", "version": "1.3.3", "routes": [["accounts.google.com", "/o/oauth2/auth"]],
                 "codePrompt": "Enter code:", "success": "Authentication saved", "cached": "Cached account ready", "invalid": "Invalid authorization", "menus": []}
        parser = NativeProtocol(rules)
        parser.feed(b'https://accounts.google.com/o/oauth2/auth?state=synthetic\r\nEnter code:')
        self.assertTrue(parser.waiting)
        parser.feed(b'\x1b[2J\x1b[HMain agent ready. Type a message:')
        with self.assertRaises(GatewayError): parser.authorize_code()

    def test_native_wrapped_url_and_split_terminal_query(self):
        rules = {"protocol": "antigravity-login-v1", "version": "1.3.3", "routes": [["accounts.google.com", "/o/oauth2/auth"]],
                 "codePrompt": "paste the authorization code below:", "success": "Authentication saved", "cached": "Cached account ready", "invalid": "Invalid authorization", "menus": []}
        parser = NativeProtocol(rules)
        parser.feed(b"\x1b]11;")
        self.assertEqual(parser.terminal_replies(), [])
        parser.feed(b"?\x07")
        self.assertEqual(len(parser.terminal_replies()), 1)
        self.assertEqual(parser.terminal_replies(), [])
        event = parser.feed(b"Your browser should open automatically. If not:\r\n https://accounts.google.com/o/oauth2/auth?state=synthetic\r\n &response_type=code\r\n Copy and paste the URL or click on the link below:\r\n If you aren't automatically redirected, paste the authorization code below:")
        self.assertEqual(event['url'], 'https://accounts.google.com/o/oauth2/auth?state=synthetic&response_type=code')

    def test_recovery_stops_login_and_never_replays_input(self):
        session = str(uuid.uuid4())
        name = "cli-login-" + session + "-auth"
        calls = []
        class Engine:
            def inventory(self): return [name]
            def stop(self, ref): calls.append(("stop", ref))
            def remove(self, ref): calls.append(("remove", ref))
        class Client:
            def call(self, action, **fields):
                calls.append((action, fields))
                return {"login": {"sessionId": session}} if action == "getLoginAssignment" else {"acknowledged": True}
        class Journal:
            def load(self): return {"sessionId": session, "phase": "code_write_intent"}
            def clear(self): calls.append(("clear",))
        recover_login(Engine(), Client(), Journal())
        self.assertIn(("stop", name), calls)
        self.assertFalse(any(c[0] in ("start", "consumeLoginCode") for c in calls))


if __name__ == "__main__":
    unittest.main()
