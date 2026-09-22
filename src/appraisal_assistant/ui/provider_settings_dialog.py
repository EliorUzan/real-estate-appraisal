from __future__ import annotations

from PySide6.QtCore import QSize, Qt
from PySide6.QtWidgets import (QComboBox, QDialog, QDialogButtonBox, QFormLayout, QFrame, QLabel,
                               QLineEdit, QMessageBox, QVBoxLayout, QWidget)

from appraisal_assistant.infrastructure.provider_settings import PROVIDERS, ProviderSettingsError, ProviderSettingsStore
from appraisal_assistant.ui.provider_icons import provider_icon


class ProviderSettingsDialog(QDialog):
    """Small, provider-aware settings dialog for local development credentials."""

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._store = ProviderSettingsStore()
        self.setWindowTitle("הגדרות ספקי AI")
        self.setLayoutDirection(Qt.RightToLeft)
        self.setMinimumWidth(460)
        layout = QVBoxLayout(self)
        explanation = QLabel("המפתחות נשמרים רק במאגר האישורים של Windows. לאחר שמירה הם נותרים בשדות מוסתרים, כדי שאפשר יהיה לוודא שנשמרו.")
        explanation.setWordWrap(True)
        layout.addWidget(explanation)
        default_form = QFormLayout()
        default_heading = QLabel("ברירת מחדל לאפליקציה")
        default_heading.setObjectName("settingsHeading")
        layout.addWidget(default_heading)
        self.default_provider = QComboBox()
        self.default_provider.setIconSize(QSize(24, 24))
        self.default_provider.setLayoutDirection(Qt.LayoutDirection.LeftToRight)
        for identifier, definition in PROVIDERS.items():
            self.default_provider.addItem(provider_icon(identifier), definition.label, identifier)
        default_index = self.default_provider.findData(self._store.load_default_provider())
        if default_index >= 0:
            self.default_provider.setCurrentIndex(default_index)
        default_form.addRow("ספק ברירת מחדל:", self.default_provider)
        layout.addLayout(default_form)
        divider = QFrame()
        divider.setFrameShape(QFrame.Shape.HLine)
        divider.setFrameShadow(QFrame.Shadow.Sunken)
        layout.addWidget(divider)
        provider_heading = QLabel("הגדרות ספק AI")
        provider_heading.setObjectName("settingsHeading")
        layout.addWidget(provider_heading)
        form = QFormLayout()
        self.provider = QComboBox()
        self.provider.setIconSize(QSize(24, 24))
        self.provider.setLayoutDirection(Qt.LayoutDirection.LeftToRight)
        for identifier, definition in PROVIDERS.items():
            self.provider.addItem(provider_icon(identifier), definition.label, identifier)
        provider_index = self.provider.findData(self._store.load_default_provider())
        if provider_index >= 0:
            self.provider.setCurrentIndex(provider_index)
        form.addRow("ספק:", self.provider)
        self.api_key = QLineEdit()
        self.api_key.setEchoMode(QLineEdit.EchoMode.Password)
        self.api_key.setPlaceholderText("הדביקו מפתח חדש כאן כדי לשמור או להחליף אותו")
        form.addRow("מפתח API:", self.api_key)
        self.key_status = QLabel()
        self.key_status.setWordWrap(True)
        form.addRow("מצב מפתח:", self.key_status)
        self.model = QComboBox()
        self.model.setEditable(True)
        form.addRow("מזהה מודל:", self.model)
        layout.addLayout(form)
        self.provider.currentIndexChanged.connect(self._load_provider)
        buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Save | QDialogButtonBox.StandardButton.Cancel)
        buttons.accepted.connect(self._save)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)
        self.setStyleSheet("#settingsHeading { font-size: 16px; font-weight: 700; color: #102A43; }")
        self._load_provider()

    def _provider_id(self) -> str:
        return str(self.provider.currentData())

    def _load_provider(self) -> None:
        provider = self._provider_id()
        definition = PROVIDERS[provider]
        self.api_key.clear()
        self.model.clear()
        for label, model_id in definition.model_options:
            self.model.addItem(f"{label} — {model_id}", model_id)
        try:
            api_key, saved_model = self._store.load(provider)
        except ProviderSettingsError as error:
            self.key_status.setText(str(error))
            return
        self.api_key.setText(api_key or "")
        self.key_status.setText("מפתח API שמור" if api_key else "לא נשמר מפתח — אפשר להדביק מפתח חדש")
        if saved_model:
            saved_index = self.model.findData(saved_model)
            if saved_index >= 0:
                self.model.setCurrentIndex(saved_index)
            else:
                self.model.setEditText(saved_model)

    def _save(self) -> None:
        try:
            self._store.save(self._provider_id(), self.api_key.text() or None, self._selected_model_id())
            self._store.save_default_provider(str(self.default_provider.currentData()))
        except ProviderSettingsError as error:
            QMessageBox.warning(self, "לא ניתן לשמור", str(error))
            return
        self.accept()

    def _selected_model_id(self) -> str:
        index = self.model.currentIndex()
        if index >= 0 and self.model.currentText() == self.model.itemText(index):
            return str(self.model.itemData(index))
        return self.model.currentText().strip()
