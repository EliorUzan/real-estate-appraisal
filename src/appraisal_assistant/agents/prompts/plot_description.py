"""Load the independently authored plot-description agent prompt."""

from pathlib import Path
from typing import Any, Dict, List, Optional


PROMPT_PATH = Path(__file__).with_suffix(".md")
SYSTEM_INSTRUCTIONS = PROMPT_PATH.read_text(encoding="utf-8").strip()


def build_user_message(
    gush: int | str,
    parcel: int | str,
    legal_area: float | str | None = None,
    topography: str | None = None,
    geometry_shape: str | None = None,
    borders: Optional[List[Dict[str, Any]]] = None,
    buildings_summary: Optional[str] = None,
    planning_notes: Optional[str] = None,
    example: Optional[str] = None,
    additional_request: Optional[str] = None,
) -> str:
    """Format structured parcel inputs into a user prompt for the agent."""
    borders_text = ""
    if borders:
        borders_lines = []
        for b in borders:
            dir_name = b.get("direction", "")
            land_use = b.get("land_use", "")
            street = b.get("street_name")
            street_part = f" ({street})" if street else ""
            borders_lines.append(f"- {dir_name}: חלקה ביעוד {land_use}{street_part}")
        borders_text = "\n".join(borders_lines)
    else:
        borders_text = "לא סופק פירוט גבולות מרחבי."

    return f"""פרטי משימת תיאור החלקה:
גוש: {gush}
חלקה: {parcel}
שטח רשום לפי נסח: {f'{legal_area} מ"ר' if legal_area is not None else 'לא אומת'}
טופוגרפיה: {topography or 'לא אומתה'}
צורה גיאומטרית: {geometry_shape or 'לא אומתה'}

גבולות וייעודים סובבים:
{borders_text}

בינוי קיים:
{buildings_summary or "לא צוין בינוי קיים."}

היבטים תכנוניים / דרכי גישה:
{planning_notes or "לא אומתו הערות תכנוניות או דרכי גישה."}

דוגמאות סגנון שסופקו על ידי השמאי:
{example or "לא סופקה דוגמה טקסטואלית."}

בקשה נוספת של השמאי:
{additional_request or "לא סופקה בקשה נוספת."}

קבצים מצורפים, אם ישנם, נמסרו כדוגמאות סגנון או כמידע עזר בלבד.
פעלו בהתאם להנחיות הסוכן והחזירו את תיאור החלקה (סעיף 7.1) בלבד."""
