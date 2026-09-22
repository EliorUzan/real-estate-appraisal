from appraisal_assistant.services.file_text_extractor import FileTextExtractor


def test_returns_first_five_words_from_text_file(tmp_path) -> None:
    attachment = tmp_path / "example.txt"
    attachment.write_text("אחת שתיים שלוש ארבע חמש שש שבע", encoding="utf-8")

    preview = FileTextExtractor().first_words(attachment)

    assert preview.words == "אחת שתיים שלוש ארבע חמש"
    assert preview.warning is None
