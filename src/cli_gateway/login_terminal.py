"""Bounded VT screen for authentication only; never renders a terminal in the browser."""
import re
import unicodedata
from .contracts import GatewayError


class LoginScreen:
    def __init__(self, rows=40, columns=160):
        self.rows, self.columns = rows, columns
        self.lines = [[" "] * columns for _ in range(rows)]
        self.row = self.column = 0
        self.pending = ""
        self.saved = (0, 0)

    def text(self):
        return "\n".join("".join(line).rstrip() for line in self.lines)

    def feed(self, text):
        value = self.pending + text
        self.pending = ""
        index = 0
        while index < len(value):
            char = value[index]
            if char == "\x1b":
                if index + 1 == len(value):
                    self.pending = value[index:]
                    break
                next_char = value[index + 1]
                if next_char == "]":
                    match = re.search(r"\x07|\x1b\\", value[index + 2:])
                    if not match:
                        self.pending = value[index:]
                        break
                    index += 2 + match.end()
                    continue
                if next_char == "[":
                    match = re.match(r"\x1b\[([0-?]*)([ -/]*)([@-~])", value[index:])
                    if not match:
                        self.pending = value[index:]
                        break
                    self.csi(match.group(1), match.group(3))
                    index += match.end()
                    continue
                if next_char == "7":
                    self.saved = self.row, self.column
                elif next_char == "8":
                    self.row, self.column = self.saved
                elif next_char not in {"=", ">", "\\"}:
                    raise GatewayError("LOGIN_PROTOCOL_CHANGED")
                index += 2
                continue
            if char == "\r":
                self.column = 0
            elif char == "\n":
                self.row += 1
            elif char == "\b":
                self.column = max(0, self.column - 1)
            elif char == "\t":
                self.column = min(self.columns - 1, (self.column // 8 + 1) * 8)
            elif ord(char) >= 32 and char != "\x7f":
                if self.column >= self.columns:
                    self.column, self.row = 0, self.row + 1
                self.scroll()
                self.lines[self.row][self.column] = char
                self.column += 2 if unicodedata.east_asian_width(char) in {"W", "F"} else 1
            self.scroll()
            index += 1
        if len(self.pending.encode()) > 16384:
            raise GatewayError("LOGIN_PROTOCOL_CHANGED")

    def scroll(self):
        while self.row >= self.rows:
            self.lines.pop(0)
            self.lines.append([" "] * self.columns)
            self.row -= 1

    def csi(self, parameters, command):
        if parameters.startswith("?") and command in {"h", "l"}:
            return  # Cursor, mouse, focus, bracketed-paste and alternate-screen modes.
        try:
            values = [int(value or "0") for value in parameters.split(";")]
        except ValueError:
            raise GatewayError("LOGIN_PROTOCOL_CHANGED") from None
        first = values[0] or 1
        if command in {"H", "f"}:
            self.row = min(self.rows - 1, max(0, first - 1))
            self.column = min(self.columns - 1, max(0, (values[1] if len(values) > 1 else 1) - 1))
        elif command == "A": self.row = max(0, self.row - first)
        elif command in {"B", "e"}: self.row = min(self.rows - 1, self.row + first)
        elif command in {"C", "a"}: self.column = min(self.columns - 1, self.column + first)
        elif command == "D": self.column = max(0, self.column - first)
        elif command == "G": self.column = min(self.columns - 1, first - 1)
        elif command == "E": self.row, self.column = min(self.rows - 1, self.row + first), 0
        elif command == "F": self.row, self.column = max(0, self.row - first), 0
        elif command == "K":
            start, end = (0, self.column + 1) if values[0] == 1 else (0, self.columns) if values[0] == 2 else (self.column, self.columns)
            self.lines[self.row][start:end] = [" "] * (end - start)
        elif command == "J":
            if values[0] in {2, 3}:
                self.lines = [[" "] * self.columns for _ in range(self.rows)]
            elif values[0] == 0:
                self.lines[self.row][self.column:] = [" "] * (self.columns - self.column)
                for row in range(self.row + 1, self.rows): self.lines[row] = [" "] * self.columns
            elif values[0] == 1:
                for row in range(self.row): self.lines[row] = [" "] * self.columns
                self.lines[self.row][:self.column + 1] = [" "] * (self.column + 1)
        elif command == "s": self.saved = self.row, self.column
        elif command == "u": self.row, self.column = self.saved
        elif command not in {"m", "n", "c", "h", "l", "t"}:
            raise GatewayError("LOGIN_PROTOCOL_CHANGED")
