from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import QEvent, QSize, Qt, Signal
from PySide6.QtWidgets import QLineEdit, QListView, QListWidget, QPlainTextEdit


_TEXT_SUFFIXES = {".txt", ".md"}
SUPPORTED_ATTACHMENT_SUFFIXES = {".pdf", ".doc", ".docx", ".xlsx", ".xls", ".csv", ".txt", ".md"}


class _DropSupport:
    def _accepts_drop(self, event) -> bool:
        mime_data = event.mimeData()
        return mime_data.hasText() or mime_data.hasUrls()

    def dragEnterEvent(self, event):  # noqa: N802 - Qt callback name
        if self._accepts_drop(event):
            event.acceptProposedAction()
        else:
            event.ignore()

    def dropEvent(self, event):  # noqa: N802 - Qt callback name
        mime_data = event.mimeData()
        if mime_data.hasText() and not mime_data.hasUrls():
            self._append_dropped_text(mime_data.text())
            event.acceptProposedAction()
            return
        urls = mime_data.urls()
        if len(urls) != 1 or not urls[0].isLocalFile():
            self.drop_problem.emit("אפשר לגרור טקסט או קובץ טקסט יחיד בלבד.")
            event.ignore()
            return
        path = Path(urls[0].toLocalFile())
        if path.suffix.lower() not in _TEXT_SUFFIXES:
            self.drop_problem.emit("ניתן לטעון קבצי ‎.txt או ‎.md בלבד.")
            event.ignore()
            return
        try:
            self._append_dropped_text(path.read_text(encoding="utf-8"))
        except UnicodeDecodeError:
            self.drop_problem.emit("לא ניתן לקרוא את הקובץ. נא לשמור אותו בקידוד UTF-8.")
            event.ignore()
            return
        except OSError:
            self.drop_problem.emit("לא ניתן לקרוא את הקובץ שנגרר.")
            event.ignore()
            return
        self.file_loaded.emit(path.name)
        event.acceptProposedAction()


class DropLineEdit(_DropSupport, QLineEdit):
    """Single-line field accepting dropped text or a UTF-8 text file."""

    file_loaded = Signal(str)
    drop_problem = Signal(str)

    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        self.setAcceptDrops(True)

    def _append_dropped_text(self, text: str) -> None:
        self.setText(text.strip().replace("\n", " "))


class DropPlainTextEdit(_DropSupport, QPlainTextEdit):
    """Multiline field accepting dropped text or a UTF-8 text file."""

    file_loaded = Signal(str)
    drop_problem = Signal(str)

    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        self.setAcceptDrops(True)
        self.viewport().setAcceptDrops(True)
        self.viewport().installEventFilter(self)

    def eventFilter(self, watched, event):  # noqa: N802 - Qt callback name
        if watched is self.viewport():
            if event.type() == QEvent.Type.DragEnter:
                self.dragEnterEvent(event)
                return event.isAccepted()
            if event.type() == QEvent.Type.DragMove:
                event.acceptProposedAction()
                return True
            if event.type() == QEvent.Type.Drop:
                self.dropEvent(event)
                return event.isAccepted()
        return super().eventFilter(watched, event)

    def _append_dropped_text(self, text: str) -> None:
        self.setPlainText(text.strip())


class AgentTextInput(QPlainTextEdit):
    """Editable text input that also accepts file drops for a section agent."""

    files_dropped = Signal(list)
    drop_problem = Signal(str)

    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        self.setAcceptDrops(True)
        self.viewport().setAcceptDrops(True)
        self.viewport().installEventFilter(self)

    def eventFilter(self, watched, event):  # noqa: N802 - Qt callback name
        if watched is self.viewport():
            if event.type() == QEvent.Type.DragEnter:
                self.dragEnterEvent(event)
                return event.isAccepted()
            if event.type() == QEvent.Type.DragMove:
                self.dragMoveEvent(event)
                return True
            if event.type() == QEvent.Type.Drop:
                self.dropEvent(event)
                return event.isAccepted()
        return super().eventFilter(watched, event)

    def dragEnterEvent(self, event):  # noqa: N802 - Qt callback name
        if event.mimeData().hasUrls() or event.mimeData().hasText():
            event.acceptProposedAction()
        else:
            event.ignore()

    def dragMoveEvent(self, event):  # noqa: N802 - Qt callback name
        event.acceptProposedAction()

    def dropEvent(self, event):  # noqa: N802 - Qt callback name
        mime_data = event.mimeData()
        if mime_data.hasUrls():
            paths = [Path(url.toLocalFile()) for url in mime_data.urls() if url.isLocalFile()]
            if not paths:
                self.drop_problem.emit("אפשר לגרור לכאן קבצים מהמחשב בלבד.")
                event.ignore()
                return
            self.files_dropped.emit(paths)
            event.acceptProposedAction()
            return
        if mime_data.hasText():
            cursor = self.textCursor()
            cursor.insertText(mime_data.text())
            self.setTextCursor(cursor)
            event.acceptProposedAction()
            return
        event.ignore()


class AttachmentList(QListWidget):
    """Horizontal list of attachment chips that also accepts dropped files."""

    files_dropped = Signal(list)
    drop_problem = Signal(str)

    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        self.setAcceptDrops(True)
        self.setViewMode(QListView.ViewMode.IconMode)
        self.setFlow(QListView.Flow.LeftToRight)
        self.setWrapping(False)
        self.setGridSize(QSize(62, 42))
        self.setSpacing(2)
        self.setMovement(QListView.Movement.Static)
        self.setHorizontalScrollMode(QListView.ScrollMode.ScrollPerPixel)
        self.setVerticalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        self.setHorizontalScrollBarPolicy(Qt.ScrollBarAsNeeded)
        self.viewport().setAcceptDrops(True)
        self.viewport().installEventFilter(self)

    def eventFilter(self, watched, event):  # noqa: N802 - Qt callback name
        if watched is self.viewport():
            if event.type() == QEvent.Type.DragEnter:
                self.dragEnterEvent(event)
                return event.isAccepted()
            if event.type() == QEvent.Type.DragMove:
                self.dragMoveEvent(event)
                return True
            if event.type() == QEvent.Type.Drop:
                self.dropEvent(event)
                return event.isAccepted()
        return super().eventFilter(watched, event)

    def dragEnterEvent(self, event):  # noqa: N802 - Qt callback name
        if event.mimeData().hasUrls():
            event.acceptProposedAction()
        else:
            event.ignore()

    def dragMoveEvent(self, event):  # noqa: N802 - Qt callback name
        event.acceptProposedAction()

    def dropEvent(self, event):  # noqa: N802 - Qt callback name
        paths = [Path(url.toLocalFile()) for url in event.mimeData().urls() if url.isLocalFile()]
        if not paths:
            self.drop_problem.emit("לא זוהו קבצים שניתן לצרף. נסו לגרור אותם לאזור הקבצים המצורפים.")
            event.ignore()
            return
        self.files_dropped.emit(paths)
        event.acceptProposedAction()
