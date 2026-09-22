from __future__ import annotations

from PySide6.QtCore import QPointF, Qt
from PySide6.QtGui import QColor, QIcon, QPainter, QPixmap, QPolygonF


def provider_icon(provider: str) -> QIcon:
    """Small original provider identifiers for the local selector, not vendor logos."""
    pixmap = QPixmap(28, 28)
    pixmap.fill(Qt.GlobalColor.transparent)
    painter = QPainter(pixmap)
    painter.setRenderHint(QPainter.RenderHint.Antialiasing)
    if provider == "openai":
        painter.setBrush(QColor("#10A37F"))
        painter.setPen(Qt.PenStyle.NoPen)
        painter.drawRoundedRect(2, 2, 24, 24, 7, 7)
        painter.setBrush(QColor("#FFFFFF"))
        for x, y in ((14, 7), (20, 10), (20, 17), (14, 21), (8, 17), (8, 10)):
            painter.drawEllipse(x - 3, y - 3, 6, 6)
        painter.setBrush(QColor("#10A37F"))
        painter.drawEllipse(11, 11, 6, 6)
    elif provider == "gemini":
        painter.setBrush(QColor("#4285F4"))
        painter.setPen(Qt.PenStyle.NoPen)
        star = QPolygonF([QPointF(14, 2), QPointF(17, 11), QPointF(26, 14), QPointF(17, 17), QPointF(14, 26), QPointF(11, 17), QPointF(2, 14), QPointF(11, 11)])
        painter.drawPolygon(star)
        painter.setBrush(QColor("#A855F7"))
        painter.drawEllipse(19, 3, 6, 6)
    elif provider == "anthropic":
        painter.setBrush(QColor("#D97757"))
        painter.setPen(Qt.PenStyle.NoPen)
        painter.drawRoundedRect(2, 2, 24, 24, 7, 7)
        painter.setBrush(QColor("#FFFFFF"))
        painter.drawPolygon(QPolygonF([QPointF(14, 5), QPointF(23, 22), QPointF(5, 22)]))
        painter.setBrush(QColor("#D97757"))
        painter.drawEllipse(11, 12, 6, 6)
    elif provider == "moonshot":
        painter.setBrush(QColor("#334155"))
        painter.setPen(Qt.PenStyle.NoPen)
        painter.drawRoundedRect(2, 2, 24, 24, 7, 7)
        painter.setPen(QColor("#F5C34B"))
        painter.setFont(painter.font())
        painter.drawText(2, 1, 24, 25, Qt.AlignmentFlag.AlignCenter, "K")
    else:
        painter.setBrush(QColor("#6B4EFF"))
        painter.setPen(Qt.PenStyle.NoPen)
        painter.drawRoundedRect(2, 2, 24, 24, 7, 7)
        painter.setPen(QColor("#FFFFFF"))
        painter.drawText(2, 1, 24, 25, Qt.AlignmentFlag.AlignCenter, "Q")
    painter.end()
    return QIcon(pixmap)
