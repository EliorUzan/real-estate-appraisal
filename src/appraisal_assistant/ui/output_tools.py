from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtGui import QColor, QIcon, QPainter, QPen, QPixmap


def output_tool_icon(tool: str) -> QIcon:
    pixmap = QPixmap(24, 24)
    pixmap.fill(Qt.GlobalColor.transparent)
    painter = QPainter(pixmap)
    painter.setRenderHint(QPainter.RenderHint.Antialiasing)
    pen = QPen(QColor("#334E68"), 1.8)
    painter.setPen(pen)
    painter.setBrush(Qt.BrushStyle.NoBrush)
    if tool == "copy":
        painter.drawRoundedRect(8, 4, 11, 14, 2, 2)
        painter.drawRoundedRect(4, 8, 11, 12, 2, 2)
        painter.drawLine(7, 12, 12, 12)
        painter.drawLine(7, 15, 12, 15)
    else:
        painter.drawEllipse(4, 4, 16, 16)
        painter.drawLine(12, 8, 12, 12)
        painter.drawLine(12, 12, 16, 14)
        painter.drawLine(5, 12, 2, 12)
    painter.end()
    return QIcon(pixmap)


def without_model_header(output_text: str) -> str:
    """Remove only the test-only model line added by transport adapters."""
    lines = output_text.splitlines()
    if lines and lines[0].strip().startswith("מודל:"):
        return "\n".join(lines[1:]).lstrip()
    return output_text
