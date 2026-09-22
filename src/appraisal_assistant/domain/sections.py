from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ReportSection:
    id: str
    label: str
    is_available: bool
    agent_name: str


SECTIONS: tuple[ReportSection, ...] = (
    ReportSection("environment_description", "תיאור סביבת הנכס", True, "EnvironmentDescriptionAgent"),
    ReportSection("property_description", "תיאור הנכס", False, "PropertyDescriptionAgent"),
    ReportSection("planning_status", "מצב תכנוני", False, "PlanningStatusAgent"),
    ReportSection("registration_rights", "נתוני רישום וזכויות", False, "RegistrationRightsAgent"),
    ReportSection("comparable_sales", "ניתוח עסקאות השוואה", False, "ComparableSalesAgent"),
    ReportSection("valuation_summary", "סיכום ושומה", False, "ValuationSummaryAgent"),
)


def section_by_id(section_id: str) -> ReportSection:
    return next(section for section in SECTIONS if section.id == section_id)
