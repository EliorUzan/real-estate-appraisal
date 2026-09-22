from appraisal_assistant.ui.output_tools import without_model_header


def test_copy_text_excludes_the_transport_model_header() -> None:
    assert without_model_header("מודל: gemini-3.8-flash\n\nתיאור הסביבה") == "תיאור הסביבה"


def test_copy_text_leaves_a_normal_output_unchanged() -> None:
    assert without_model_header("תיאור הסביבה") == "תיאור הסביבה"
