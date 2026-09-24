from pathlib import Path

from appraisal_assistant.agents.prompts.plot_description import (
    PROMPT_PATH,
    SYSTEM_INSTRUCTIONS,
    build_user_message,
)


def test_plot_agent_uses_the_markdown_prompt_file() -> None:
    assert PROMPT_PATH.name == "plot_description.md"
    assert SYSTEM_INSTRUCTIONS == Path(PROMPT_PATH).read_text(encoding="utf-8").strip()
    assert "תיאור החלקה" in SYSTEM_INSTRUCTIONS
    assert "עוזר מקצועי לשמאי מקרקעין בישראל" in SYSTEM_INSTRUCTIONS


def test_plot_user_message_formatting() -> None:
    borders = [
        {"direction": "מצפון", "land_use": "דרך", "street_name": "רחוב נחל קדומים"},
        {"direction": "ממערב", "land_use": "מגורים"},
    ]
    message = build_user_message(
        gush=11140,
        parcel=91,
        legal_area="1,003.00",
        topography="מישורית",
        geometry_shape="מעין מלבנית",
        borders=borders,
        buildings_summary="שני מבני מגורים",
        planning_notes="בפיצול יש לאפשר דרך גישה לרכב למגרש העורפי",
    )

    assert "11140" in message
    assert "91" in message
    assert "1,003.00" in message
    assert "רחוב נחל קדומים" in message
    assert "שני מבני מגורים" in message
    assert "בפיצול יש לאפשר דרך גישה" in message


def test_plot_user_message_does_not_invent_defaults() -> None:
    message = build_user_message(gush=11140, parcel=91)
    assert "שטח רשום לפי נסח: לא אומת" in message
    assert "טופוגרפיה: לא אומתה" in message
    assert "צורה גיאומטרית: לא אומתה" in message
    assert "מישורית" not in message
