import zipfile

import pytest

from appraisal_assistant.services.file_text_extractor import FileTextExtractor


def test_oversized_attachment_rejected_before_parsing(tmp_path):
    path = tmp_path / "large.pdf"
    with path.open("wb") as stream:
        stream.truncate(20 * 1024 * 1024 + 1)
    with pytest.raises(ValueError, match="20MB"):
        FileTextExtractor().extract_text(path)


def test_high_expansion_office_document_rejected_before_parser(tmp_path):
    path = tmp_path / "large.docx"
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("word/document.xml", b"A" * (100 * 1024 * 1024 + 1))
    with pytest.raises(ValueError, match="פריסה"):
        FileTextExtractor().extract_text(path)


def test_bounded_output_and_normal_hebrew_preview(tmp_path):
    path = tmp_path / "normal.txt"
    path.write_text("שלום עולם זה קובץ לבדיקה בלבד", encoding="utf-8")
    assert FileTextExtractor().first_words(path).words == "שלום עולם זה קובץ לבדיקה"
    with pytest.raises(ValueError, match="טקסט"):
        FileTextExtractor._bounded_join(["a" * 1_000_000, "b" * 1_000_000])
