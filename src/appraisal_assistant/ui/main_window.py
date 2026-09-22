from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import QSize, Qt
from PySide6.QtWidgets import (QApplication, QComboBox, QFileDialog, QFormLayout, QFrame, QHBoxLayout, QLabel,
                               QListWidgetItem, QMainWindow, QMessageBox, QPlainTextEdit, QPushButton, QStatusBar, QScrollArea, QSizePolicy, QStyle,
                               QToolButton, QVBoxLayout, QWidget)

from appraisal_assistant.application.agent_router import AgentRouter, SectionNotAvailableError
from appraisal_assistant.domain.models import Attachment, SectionRequest
from appraisal_assistant.domain.sections import SECTIONS, section_by_id
from appraisal_assistant.ui.drop_widgets import AgentTextInput, AttachmentList, DropLineEdit
from appraisal_assistant.ui.provider_icons import provider_icon
from appraisal_assistant.infrastructure.provider_settings import PROVIDERS, ProviderSettingsStore
from appraisal_assistant.ui.provider_settings_dialog import ProviderSettingsDialog
from appraisal_assistant.ui.output_history_dialog import OutputHistoryDialog, OutputHistoryEntry
from appraisal_assistant.ui.output_tools import output_tool_icon, without_model_header


class MainWindow(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self._router = AgentRouter()
        self._example_attachments: list[Attachment] = []
        self._additional_request_attachments: list[Attachment] = []
        self._output_history: list[OutputHistoryEntry] = []
        self.setWindowTitle("עוזר להערכת מקרקעין")
        self.setMinimumSize(800, 800)
        self.setLayoutDirection(Qt.RightToLeft)
        self._build_ui()
        self._on_section_changed()

    def _build_ui(self) -> None:
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QFrame.Shape.NoFrame)
        central = QWidget()
        scroll.setWidget(central)
        self.setCentralWidget(scroll)
        layout = QVBoxLayout(central)
        layout.setContentsMargins(32, 26, 32, 26)
        layout.setSpacing(16)
        title = QLabel("עוזר להערכת מקרקעין")
        title.setObjectName("title")
        subtitle = QLabel("בחרו סעיף, מלאו את הפרטים ולחצו על ׳צור׳.")
        subtitle.setObjectName("subtitle")
        title_row = QHBoxLayout()
        title_row.addWidget(title)
        title_row.addStretch()
        self.settings_button = QToolButton()
        self.settings_button.setObjectName("settingsButton")
        self.settings_button.setText("⚙")
        self.settings_button.setToolTip("הגדרות ספקי AI")
        self.settings_button.setAccessibleName("הגדרות ספקי AI")
        self.settings_button.setFixedSize(38, 38)
        self.settings_button.clicked.connect(self._open_settings)
        title_row.addWidget(self.settings_button)
        layout.addLayout(title_row)
        layout.addWidget(subtitle)

        card = QFrame()
        card.setObjectName("card")
        form = QFormLayout(card)
        form.setLabelAlignment(Qt.AlignRight | Qt.AlignTop)
        form.setFormAlignment(Qt.AlignTop)
        form.setHorizontalSpacing(18)
        form.setVerticalSpacing(16)
        form.setContentsMargins(22, 22, 22, 22)
        self.section_selector = QComboBox()
        for section in SECTIONS:
            self.section_selector.addItem(section.label if section.is_available else f"{section.label} (בקרוב)", section.id)
        self.section_selector.currentIndexChanged.connect(self._on_section_changed)
        form.addRow("סעיף דוח:", self.section_selector)

        self.provider_selector = QComboBox()
        self.provider_selector.setIconSize(QSize(24, 24))
        # Provider names are English; LTR rendering prevents their first letters
        # from being hidden beneath the RTL icon area.
        self.provider_selector.setLayoutDirection(Qt.LayoutDirection.LeftToRight)
        self.provider_selector.addItem(provider_icon("openai"), "ChatGPT (OpenAI)", "openai")
        self.provider_selector.addItem(provider_icon("gemini"), "Gemini", "gemini")
        self.provider_selector.addItem(provider_icon("anthropic"), "Claude (Anthropic)", "anthropic")
        self.provider_selector.addItem(provider_icon("moonshot"), "Kimi (Moonshot)", "moonshot")
        self.provider_selector.addItem(provider_icon("qwen"), "Qwen (DashScope)", "qwen")
        default_provider_index = self.provider_selector.findData(ProviderSettingsStore().load_default_provider())
        if default_provider_index >= 0:
            self.provider_selector.setCurrentIndex(default_provider_index)
        self.provider_selector.currentIndexChanged.connect(self._on_section_changed)
        form.addRow("סוכן AI:", self.provider_selector)

        self.address_input = DropLineEdit()
        self.address_input.setPlaceholderText("לדוגמה: רחוב התחייה 2, חדרה")
        self.address_input.drop_problem.connect(self._show_drop_problem)
        form.addRow("כתובת *:", self.address_input)

        self.example_input, self.example_attachment_tray = self._make_agent_input(
            "example", "פרט דוגמאות נוספות אם יש צורך", 150
        )
        form.addRow("דוגמאות נוספות:\n(אופציונלי)", self._input_container(
            self.example_input, self.example_attachment_tray, "example"
        ))
        self.additional_request_input, self.additional_request_attachment_tray = self._make_agent_input(
            "additional_request", "כתבו, הדביקו או גררו לכאן בקשה נוספת. אפשר גם לגרור קובץ ישירות לתיבה.", 125
        )
        form.addRow("בקשה נוספת:\n(אופציונלי)", self._input_container(
            self.additional_request_input, self.additional_request_attachment_tray, "additional_request"
        ))

        self.section_notice = QLabel()
        self.section_notice.setObjectName("notice")
        self.section_notice.setWordWrap(True)
        form.addRow("", self.section_notice)
        buttons = QHBoxLayout()
        self.generate_button = QPushButton("צור")
        self.generate_button.setObjectName("primaryButton")
        self.generate_button.setMinimumHeight(44)
        self.generate_button.clicked.connect(self._generate)
        buttons.addStretch()
        buttons.addWidget(self.generate_button)
        form.addRow("", buttons)
        layout.addWidget(card)

        output_header = QHBoxLayout()
        output_label = QLabel("תוצאה")
        output_label.setObjectName("sectionHeading")
        output_header.addWidget(output_label)
        output_header.addStretch()
        self.copy_output_button = QToolButton()
        self.copy_output_button.setObjectName("outputToolButton")
        self.copy_output_button.setIcon(output_tool_icon("copy"))
        self.copy_output_button.setToolTip("העתקת התוצאה ללא שורת המודל")
        self.copy_output_button.setAccessibleName("העתקת התוצאה")
        self.copy_output_button.setEnabled(False)
        self.copy_output_button.clicked.connect(self._copy_output)
        output_header.addWidget(self.copy_output_button)
        self.history_button = QToolButton()
        self.history_button.setObjectName("outputToolButton")
        self.history_button.setIcon(output_tool_icon("history"))
        self.history_button.setToolTip("היסטוריית תוצאות")
        self.history_button.setAccessibleName("היסטוריית תוצאות")
        self.history_button.clicked.connect(self._show_history)
        output_header.addWidget(self.history_button)
        layout.addLayout(output_header)
        self.output = QPlainTextEdit()
        self.output.setPlaceholderText("כאן תוצג התוצאה לאחר לחיצה על ׳צור׳.")
        self.output.setMinimumHeight(180)
        self.output.document().setDocumentMargin(8)
        layout.addWidget(self.output, 1)
        self.warnings = QLabel()
        self.warnings.setObjectName("warning")
        self.warnings.setWordWrap(True)
        self.warnings.setVisible(False)
        layout.addWidget(self.warnings)
        status = QStatusBar()
        status.showMessage("מוכן")
        self.setStatusBar(status)
        self._apply_styles()

    def _make_agent_input(self, target: str, placeholder: str, height: int) -> tuple[AgentTextInput, AttachmentList]:
        text_input = AgentTextInput()
        text_input.setPlaceholderText(placeholder)
        text_input.setMinimumHeight(height)
        text_input.document().setDocumentMargin(8)
        text_input.drop_problem.connect(self._show_drop_problem)
        text_input.files_dropped.connect(lambda paths: self._add_attachment_paths(target, paths))
        tray = AttachmentList()
        tray.setObjectName("attachmentTray")
        tray.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)
        tray.setMinimumHeight(68)
        tray.setMaximumHeight(68)
        tray.files_dropped.connect(lambda paths: self._add_attachment_paths(target, paths))
        tray.drop_problem.connect(self._show_drop_problem)
        self._set_empty_attachment_message(tray)
        return text_input, tray

    def _input_container(self, text_input: AgentTextInput, attachment_tray: AttachmentList, target: str) -> QWidget:
        container = QWidget()
        content = QVBoxLayout(container)
        content.setContentsMargins(0, 0, 0, 0)
        content.setSpacing(8)
        content.addWidget(text_input)
        file_header = QHBoxLayout()
        file_header.addStretch()
        file_header.addWidget(QLabel("קבצים מצורפים"))
        add_button = QToolButton()
        add_button.setObjectName("addAttachment")
        add_button.setIcon(self.style().standardIcon(QStyle.StandardPixmap.SP_DialogOpenButton))
        add_button.setToolTip("הוספת קבצים")
        add_button.setAccessibleName("הוספת קבצים")
        add_button.setFixedSize(30, 30)
        add_button.clicked.connect(lambda: self._choose_attachments(target))
        file_header.addWidget(add_button)
        content.addLayout(file_header)
        content.addWidget(attachment_tray)
        minimum_height = text_input.minimumHeight() + attachment_tray.minimumHeight() + 44
        container.setMinimumHeight(minimum_height)
        container.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Minimum)
        return container

    def _apply_styles(self) -> None:
        self.setStyleSheet(
            "QMainWindow { background: #F6F7F9; } QLabel { color: #1F2937; font-size: 14px; }"
            "#title { font-size: 25px; font-weight: 700; color: #102A43; } #subtitle { color: #52606D; font-size: 15px; }"
            "#card { background: white; border: 1px solid #D9E2EC; border-radius: 10px; }"
            "QLineEdit, QComboBox { background: white; border: 1px solid #AAB7C4; border-radius: 6px; padding: 8px; font-size: 14px; }"
            "QPlainTextEdit { background: white; border: 1px solid #AAB7C4; border-radius: 6px; padding: 3px 6px; font-size: 15px; }"
            "QLineEdit:focus, QPlainTextEdit:focus, QComboBox:focus { border: 2px solid #2F80ED; }"
            "#primaryButton { background: #1769AA; color: white; border: none; border-radius: 6px; padding: 8px 32px; font-size: 16px; font-weight: 600; }"
            "#primaryButton:hover { background: #125A92; } #primaryButton:disabled { background: #B8C5D1; }"
            "#notice { color: #7C4D00; background: #FFF4CC; border-radius: 5px; padding: 8px; }"
            "#sectionHeading { font-weight: 700; font-size: 17px; }"
            "#warning { color: #8A1C1C; background: #FDE8E7; border-radius: 5px; padding: 10px; }"
            "#attachmentTray { background: #F9FBFD; border: 1px solid #D9E2EC; border-radius: 6px; }"
            "#addAttachment { border: none; background: transparent; } #addAttachment:hover { background: #E3F0FF; border-radius: 4px; }"
            "#settingsButton { color: #334E68; background: #EAF2F8; border: none; border-radius: 19px; font-size: 21px; }"
            "#settingsButton:hover { background: #D5E7F5; }"
            "#outputToolButton { border: none; background: #EAF2F8; border-radius: 5px; padding: 5px; }"
            "#outputToolButton:hover { background: #D5E7F5; } #outputToolButton:disabled { background: #F1F5F9; }"
            "#removeAttachment { color: #9B1C1C; background: #FDE8E7; border: none; border-radius: 12px; font-size: 18px; font-weight: 700; }"
            "#removeAttachment:hover { background: #F8CACA; }"
        )

    def _selected_section_id(self) -> str:
        return str(self.section_selector.currentData())

    def _selected_provider_id(self) -> str:
        return str(self.provider_selector.currentData())

    def _on_section_changed(self) -> None:
        section = section_by_id(self._selected_section_id())
        if section.is_available:
            provider = self._selected_provider_id()
            provider_name = PROVIDERS[provider].label
            if self._router.is_provider_configured(provider):
                self.section_notice.setText(f"סעיף פעיל. לחיצה על ׳צור׳ שולחת את הטקסט והקבצים שנבחרו ל-{provider_name}.")
            else:
                definition = PROVIDERS[provider]
                variable = f"{definition.api_key_environment_name} / {definition.model_environment_name}"
                self.section_notice.setText(f"יש להגדיר {variable} כדי להשתמש ב-{provider_name}.")
            self.generate_button.setEnabled(True)
        else:
            self.section_notice.setText(f"הסעיף ׳{section.label}׳ יתווסף בגרסה עתידית.")
            self.generate_button.setEnabled(False)
        self.output.clear()
        self.copy_output_button.setEnabled(False)
        self.warnings.setVisible(False)

    def _generate(self) -> None:
        address = self.address_input.text().strip()
        example = self.example_input.toPlainText().strip()
        if not address:
            QMessageBox.warning(self, "חסרים פרטים", "נא למלא: כתובת")
            return
        request = SectionRequest(
            section_id=self._selected_section_id(), address=address, example=example,
            provider=self._selected_provider_id(),
            additional_request=self.additional_request_input.toPlainText().strip(),
            example_attachments=tuple(self._example_attachments),
            additional_request_attachments=tuple(self._additional_request_attachments),
        )
        self.generate_button.setEnabled(False)
        self.statusBar().showMessage("יוצר תוצאה…")
        try:
            result = self._router.run(request)
        except (SectionNotAvailableError, RuntimeError) as error:
            QMessageBox.warning(self, "לא ניתן ליצור", str(error))
            self.statusBar().showMessage("הפעולה לא הושלמה")
        else:
            self.output.setPlainText(result.output_text)
            self._output_history.append(OutputHistoryEntry(address=address, output_text=result.output_text))
            self.copy_output_button.setEnabled(True)
            self._render_warnings(result.warnings)
            self.statusBar().showMessage("הפעולה הושלמה")
        finally:
            self.generate_button.setEnabled(True)

    def _open_settings(self) -> None:
        if ProviderSettingsDialog(self).exec():
            self._router = AgentRouter()
            default_index = self.provider_selector.findData(ProviderSettingsStore().load_default_provider())
            if default_index >= 0:
                self.provider_selector.blockSignals(True)
                self.provider_selector.setCurrentIndex(default_index)
                self.provider_selector.blockSignals(False)
            self._on_section_changed()

    def _copy_output(self) -> None:
        copied_text = without_model_header(self.output.toPlainText())
        if not copied_text.strip():
            return
        QApplication.clipboard().setText(copied_text)
        self.statusBar().showMessage("התוצאה הועתקה ללוח ללא שורת המודל", 4000)

    def _show_history(self) -> None:
        OutputHistoryDialog(self._output_history, self).exec()

    def _choose_attachments(self, target: str) -> None:
        file_filter = "קבצים נתמכים (*.pdf *.doc *.docx *.xlsx *.xls *.csv *.txt *.md);;כל הקבצים (*.*)"
        paths, _ = QFileDialog.getOpenFileNames(self, "בחירת קבצים להעברה לסוכן", "", file_filter)
        self._add_attachment_paths(target, [Path(path) for path in paths])

    def _add_attachment_paths(self, target: str, paths: list[Path]) -> None:
        attachments, _tray = self._attachment_target(target)
        existing_paths = {attachment.path.resolve() for attachment in attachments}
        added_count = 0
        for path in paths:
            if not path.is_file():
                continue
            resolved_path = path.resolve()
            if resolved_path in existing_paths:
                continue
            attachment = Attachment(resolved_path, path.name, path.suffix.lower().strip())
            attachments.append(attachment)
            existing_paths.add(resolved_path)
            added_count += 1
        self._refresh_attachment_list(target)
        if added_count:
            self.statusBar().showMessage(f"נוספו {added_count} קבצים להעברה לסוכן", 5000)
        elif paths:
            self._show_drop_problem("לא נוספו קבצים. נא לוודא שהקבצים עדיין קיימים במחשב.")

    def _remove_attachment(self, target: str, path: Path) -> None:
        attachments, _tray = self._attachment_target(target)
        removed = next((attachment for attachment in attachments if attachment.path == path), None)
        if removed is None:
            return
        attachments.remove(removed)
        self._refresh_attachment_list(target)
        self.statusBar().showMessage(f"הקובץ הוסר: {removed.name}", 4000)

    def _attachment_target(self, target: str) -> tuple[list[Attachment], AttachmentList]:
        if target == "example":
            return self._example_attachments, self.example_attachment_tray
        return self._additional_request_attachments, self.additional_request_attachment_tray

    @staticmethod
    def _set_empty_attachment_message(tray: AttachmentList) -> None:
        tray.clear()
        item = QListWidgetItem("לא צורפו קבצים — גררו קבצים לכאן או לחצו על הסמל")
        item.setFlags(Qt.NoItemFlags)
        tray.addItem(item)

    def _refresh_attachment_list(self, target: str) -> None:
        attachments, tray = self._attachment_target(target)
        if not attachments:
            self._set_empty_attachment_message(tray)
            return
        tray.clear()
        for attachment in attachments:
            chip = QWidget()
            chip_layout = QHBoxLayout(chip)
            chip_layout.setContentsMargins(2, 0, 2, 0)
            chip_layout.setSpacing(1)
            chip.setFixedSize(56, 36)
            file_button = QToolButton()
            file_button.setIcon(self.style().standardIcon(QStyle.StandardPixmap.SP_FileIcon))
            file_button.setToolTip(attachment.name)
            file_button.setAccessibleName(attachment.name)
            file_button.setFixedSize(29, 29)
            remove_button = QToolButton()
            remove_button.setObjectName("removeAttachment")
            remove_button.setText("×")
            remove_button.setFixedSize(20, 20)
            remove_button.setToolTip("הסרת קובץ")
            remove_button.setAccessibleName(f"הסרת {attachment.name}")
            remove_button.clicked.connect(lambda _checked=False, file_path=attachment.path: self._remove_attachment(target, file_path))
            chip_layout.addWidget(file_button)
            chip_layout.addWidget(remove_button)
            item = QListWidgetItem()
            item.setSizeHint(QSize(62, 42))
            tray.addItem(item)
            tray.setItemWidget(item, chip)

    def _render_warnings(self, warnings: list[str]) -> None:
        if warnings:
            self.warnings.setText("אזהרה: " + "\n".join(warnings))
            self.warnings.setVisible(True)
        else:
            self.warnings.setVisible(False)

    def _show_drop_problem(self, message: str) -> None:
        QMessageBox.warning(self, "לא ניתן לטעון", message)
