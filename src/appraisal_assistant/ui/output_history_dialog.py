from __future__ import annotations

from dataclasses import dataclass

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (QDialog, QDialogButtonBox, QHBoxLayout, QLabel, QListWidget,
                               QListWidgetItem, QPlainTextEdit, QVBoxLayout, QWidget)


@dataclass(frozen=True)
class OutputHistoryEntry:
    address: str
    output_text: str


class OutputHistoryDialog(QDialog):
    def __init__(self, entries: list[OutputHistoryEntry], parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._entries = entries
        self.setWindowTitle("היסטוריית תוצאות")
        self.setLayoutDirection(Qt.RightToLeft)
        self.resize(760, 470)
        layout = QVBoxLayout(self)
        layout.addWidget(QLabel("בחרו כתובת כדי לצפות בתוצאה שנוצרה עבורה."))
        content = QHBoxLayout()
        self.entry_list = QListWidget()
        self.entry_list.setMinimumWidth(240)
        for entry in entries:
            self.entry_list.addItem(QListWidgetItem(entry.address))
        self.entry_list.currentRowChanged.connect(self._show_entry)
        content.addWidget(self.entry_list, 1)
        self.output = QPlainTextEdit()
        self.output.setReadOnly(True)
        self.output.setPlaceholderText("אין עדיין תוצאות בהיסטוריה.")
        content.addWidget(self.output, 3)
        layout.addLayout(content)
        buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Close)
        buttons.rejected.connect(self.reject)
        buttons.accepted.connect(self.accept)
        layout.addWidget(buttons)
        if entries:
            self.entry_list.setCurrentRow(len(entries) - 1)

    def _show_entry(self, row: int) -> None:
        self.output.setPlainText(self._entries[row].output_text if 0 <= row < len(self._entries) else "")
