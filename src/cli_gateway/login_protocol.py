"""A reviewed, pinned native terminal protocol. Unknown prompts never receive codes."""
import codecs
import re
from urllib.parse import urlsplit
from .contracts import GatewayError
from .login_terminal import LoginScreen

PROTOCOL = "antigravity-login-v1"
BUFFER_LIMIT = 262144


def validate_url(value, routes):
    if not isinstance(value, str) or len(value) > 8192:
        raise GatewayError("LOGIN_PROTOCOL_CHANGED")
    parsed = urlsplit(value)
    try:
        valid = (parsed.scheme == "https" and not parsed.username and not parsed.password and not parsed.port
                 and not parsed.fragment and [parsed.hostname, parsed.path] in routes)
    except ValueError:
        valid = False
    if not valid:
        raise GatewayError("LOGIN_PROTOCOL_CHANGED")
    return value


class NativeProtocol:
    def __init__(self, rules):
        required = {"protocol", "version", "routes", "codePrompt", "success", "cached", "invalid", "menus"}
        if not isinstance(rules, dict) or not required<=set(rules) or set(rules)-required-{"codeTerminator"} or rules["protocol"] != PROTOCOL or rules["version"] != "1.3.3":
            raise GatewayError("LOGIN_PROTOCOL_CHANGED")
        if rules.get("codeTerminator", "\r") not in {"\r", "\n"}:
            raise GatewayError("LOGIN_PROTOCOL_CHANGED")
        if not rules["routes"] or any(not isinstance(r, list) or len(r) != 2 for r in rules["routes"]):
            raise GatewayError("LOGIN_PROTOCOL_CHANGED")
        for field in ("codePrompt", "success", "cached", "invalid"):
            if not isinstance(rules[field], str) or not 1 <= len(rules[field]) <= 500:
                raise GatewayError("LOGIN_PROTOCOL_CHANGED")
        self.rules, self.decoder, self.buffer = rules, codecs.getincrementaldecoder("utf-8")("strict"), ""
        self.url, self.waiting, self.sent = None, False, False
        self.selected = set()
        self.screen = LoginScreen()
        self.theme_replied = self.cursor_replied = False

    def feed(self, chunk):
        try:
            decoded = self.decoder.decode(chunk)
            self.buffer += decoded
            self.screen.feed(decoded)
        except UnicodeError:
            raise GatewayError("LOGIN_PROTOCOL_CHANGED") from None
        if len(self.buffer.encode("utf-8")) > BUFFER_LIMIT:
            raise GatewayError("OUTPUT_LIMIT")
        # Retain incomplete escapes in the raw bounded buffer until complete.
        plain = self.screen.text()
        self.waiting = False
        if re.search(self.rules["invalid"], plain):
            raise GatewayError("INVALID_CODE")
        if re.search(self.rules["success"], plain) or (not self.sent and re.search(self.rules["cached"], plain)):
            self.waiting = False
            return {"kind": "authenticated"}
        for index, menu in enumerate(self.rules["menus"]):
            if index not in self.selected and re.search(menu["pattern"], plain):
                if set(menu) != {"pattern", "input"} or menu["input"] not in ("\r", "1\r", "\x1b[B\r"):
                    raise GatewayError("LOGIN_PROTOCOL_CHANGED")
                self.selected.add(index)
                return {"kind": "menu", "input": menu["input"].encode()}
        if re.search(self.rules["codePrompt"], plain):
            # OSC8's target remains complete even when native visible text wraps.
            urls = re.findall(r"\x1b\]8;[^;]*;(https://[^\x07\x1b]+)(?:\x07|\x1b\\)", self.buffer)
            if not urls:
                # Pinned 1.3.3 also prints the URL inside this fixed bounded block.
                match = re.search(r"Your browser should open automatically\. If not:\s*(https://[\s\S]*?)Copy and paste the URL", plain)
                urls = [re.sub(r"\s+", "", match.group(1))] if match else re.findall(r"https://[^\s\x1b<>\"']+", plain)
            candidates = [u for u in urls if [urlsplit(u).hostname, urlsplit(u).path] in self.rules["routes"]]
            if not candidates:
                return None  # URL can arrive in a later output chunk.
            url = validate_url(candidates[-1], self.rules["routes"])
            if self.url is not None and self.url != url:
                raise GatewayError("LOGIN_PROTOCOL_CHANGED")
            if self.sent:
                return None
            self.url, self.waiting = url, True
            return {"kind": "challenge", "url": url}
        return None

    def authorize_code(self):
        if not self.waiting or self.sent or not self.url or not re.search(self.rules["codePrompt"], self.screen.text()):
            raise GatewayError("LOGIN_PROTOCOL_CHANGED")
        self.sent, self.waiting = True, False
        # Discard old prompt/URL so later output cannot reuse the previous wait marker.
        self.buffer = ""

    def terminal_replies(self):
        replies = []
        if "\x1b]11;?" in self.buffer and not self.theme_replied:
            self.theme_replied = True
            replies.append(b"\x1b]11;rgb:ffff/ffff/ffff\x1b\\")
        if "\x1b[6n" in self.buffer and not self.cursor_replied:
            self.cursor_replied = True
            replies.append(b"\x1b[1;1R")
        return replies
