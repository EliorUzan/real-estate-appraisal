from __future__ import annotations

import csv
import re
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class TextPreview:
    words: str
    warning: str | None = None


class FileTextExtractor:
    """Extracts a short local preview for development-time agent verification."""

    def first_words(self, path: Path, count: int = 5) -> TextPreview:
        try:
            text = self._read_text(path)
        except Exception as error:  # The agent must expose, not hide, an unreadable attachment.
            return TextPreview("לא ניתן לקרוא את הקובץ", f"לא ניתן לקרוא את {path.name}: {error}")
        words = re.findall(r"[\w\u0590-\u05FF]+(?:['׳\-][\w\u0590-\u05FF]+)*", text, flags=re.UNICODE)
        if not words:
            return TextPreview("לא נמצא טקסט קריא", f"לא נמצא טקסט קריא בקובץ {path.name}.")
        warning = None
        if path.suffix.lower() == ".doc":
            warning = f"הטקסט מתוך {path.name} חולץ מקובץ Word ישן ועלול להיות חלקי."
        return TextPreview(" ".join(words[:count]), warning)

    def extract_text(self, path: Path) -> str:
        """Return full readable text for a provider that cannot accept the raw format."""
        return self._read_text(path)

    def _read_text(self, path: Path) -> str:
        suffix = path.suffix.lower()
        if suffix in {".txt", ".md"}:
            return self._read_plain_text(path)
        if suffix == ".csv":
            return self._read_csv(path)
        if suffix == ".pdf":
            from pypdf import PdfReader

            return "\n".join(page.extract_text() or "" for page in PdfReader(path).pages)
        if suffix == ".docx":
            from docx import Document

            document = Document(path)
            return "\n".join(paragraph.text for paragraph in document.paragraphs)
        if suffix == ".xlsx":
            from openpyxl import load_workbook

            workbook = load_workbook(path, read_only=True, data_only=True)
            return "\n".join(str(value) for sheet in workbook.worksheets for row in sheet.iter_rows(values_only=True) for value in row if value is not None)
        if suffix == ".xls":
            import xlrd

            workbook = xlrd.open_workbook(path)
            return "\n".join(str(sheet.cell_value(row, column)) for sheet in workbook.sheets() for row in range(sheet.nrows) for column in range(sheet.ncols))
        if suffix == ".doc":
            return self._read_legacy_doc(path)
        raise ValueError("סוג קובץ אינו נתמך")

    @staticmethod
    def _read_plain_text(path: Path) -> str:
        for encoding in ("utf-8-sig", "utf-8", "cp1255"):
            try:
                return path.read_text(encoding=encoding)
            except UnicodeDecodeError:
                continue
        return path.read_text(encoding="latin-1")

    def _read_csv(self, path: Path) -> str:
        text = self._read_plain_text(path)
        return "\n".join(" ".join(row) for row in csv.reader(text.splitlines()))

    @staticmethod
    def _read_legacy_doc(path: Path) -> str:
        """Best-effort fallback for legacy binary Word files; production should use a dedicated converter."""
        raw = path.read_bytes()
        candidates = [raw.decode(encoding, errors="ignore") for encoding in ("utf-16le", "cp1255", "latin-1")]
        return max(candidates, key=lambda value: len(re.findall(r"[\w\u0590-\u05FF]+", value)))
