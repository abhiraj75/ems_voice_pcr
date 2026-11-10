"""Deterministic protocol checks on a PCR. Illustrative only, not clinical guidance."""
import re

from languages import DEFAULT, PHRASES
from schemas import PCR

# Allergy keyword -> drugs in that class.
ALLERGY_CLASSES = {
    "penicillin": ["penicillin", "amoxicillin", "ampicillin", "amoxiclav", "piperacillin"],
    "nsaid": ["aspirin", "diclofenac", "ibuprofen", "ketorolac", "naproxen"],
    "aspirin": ["aspirin", "diclofenac", "ibuprofen", "ketorolac", "naproxen"],
    "sulfa": ["sulfamethoxazole", "cotrimoxazole", "septran"],
}

# Single-dose sanity range in mg (adult).
DOSE_RANGES_MG = {
    "aspirin": (75, 325),
    "tramadol": (25, 100),
    "ondansetron": (2, 8),
    "diazepam": (2, 10),
    "adrenaline": (0.01, 1),
    "epinephrine": (0.01, 1),
}

# Physiologically plausible bounds; outside them the value is almost certainly a mishearing.
PLAUSIBLE = {"vital_hr": (20, 250, "Pulse"), "vital_rr": (4, 60, "Respiratory rate"), "vital_spo2": (50, 100, "SpO2")}

GAPS = [("vital_bp", "BP"), ("vital_hr", "pulse"), ("vital_spo2", "SpO2"), ("vital_gcs", "GCS")]


def dose_mg(dose: str) -> float | None:
    m = re.search(r"(\d+(?:\.\d+)?)\s*(mcg|µg|mg|g)?\b", dose.lower())
    if not m:
        return None
    value, unit = float(m.group(1)), m.group(2) or "mg"
    return value / 1000 if unit in ("mcg", "µg") else value * 1000 if unit == "g" else value


def parse_bp(bp: str | None) -> tuple[int, int] | None:
    m = re.match(r"\s*(\d+)\s*/\s*(\d+)", bp or "")
    return (int(m.group(1)), int(m.group(2))) if m else None


def check(pcr: PCR, lang: str = DEFAULT) -> list[dict]:
    issues = []
    say = PHRASES[lang]["rules"]

    def add(id, severity, field, message, say):
        issues.append({"id": id, "severity": severity, "field": field, "message": message, "say": say})

    allergies = (pcr.allergies or "").lower()
    if "no known" not in allergies:
        for med in pcr.medications:
            name = med.name.lower()
            clash = name in allergies or any(
                key in allergies and any(d in name for d in drugs) for key, drugs in ALLERGY_CLASSES.items()
            )
            if clash:
                add(f"allergy:{name}", "critical", "medications",
                    f"{med.name} given despite allergy: {pcr.allergies}",
                    say["allergy"].format(allergies=pcr.allergies, med=med.name))

    if pcr.vital_gcs is not None and pcr.vital_gcs <= 8 and not pcr.treatment_airway:
        add("gcs_airway", "critical", "treatment_airway",
            f"GCS {pcr.vital_gcs} with no airway management recorded",
            say["gcs"].format(gcs=pcr.vital_gcs))

    def implausible(field, label, value):
        add(f"implausible:{field}:{value}", "critical", field, f"{label} {value} looks implausible",
            say["implausible"].format(label=label, value=value))

    for field, (low, high, label) in PLAUSIBLE.items():
        value = getattr(pcr, field)
        if value is not None and not low <= value <= high:
            implausible(field, label, value)
    bp = parse_bp(pcr.vital_bp)
    bp_ok = bp is not None and 50 <= bp[0] <= 260 and 20 <= bp[1] <= 160 and bp[1] < bp[0]
    if pcr.vital_bp and not bp_ok:
        implausible("vital_bp", "BP", pcr.vital_bp)
    sbp = bp[0] if bp_ok else None
    hr_ok = pcr.vital_hr is not None and 20 <= pcr.vital_hr <= 250
    if sbp and hr_ok and pcr.vital_hr / sbp > 1.0:
        si = pcr.vital_hr / sbp
        add("shock_index", "warning", "vital_bp", f"Shock index {si:.2f} (HR/SBP > 1)",
            say["shock"].format(si=f"{si:.1f}"))

    if pcr.vital_spo2 is not None and pcr.vital_spo2 < 94 and not pcr.oxygen_administered:
        add("spo2_no_o2", "warning", "oxygen_administered", f"SpO2 {pcr.vital_spo2}% with no oxygen recorded",
            say["spo2"].format(spo2=pcr.vital_spo2))

    for med in pcr.medications:
        name, mg = med.name.lower(), dose_mg(med.dose)
        if name in DOSE_RANGES_MG and mg is not None:
            low, high = DOSE_RANGES_MG[name]
            if not low <= mg <= high:
                add(f"dose:{name}", "warning", "medications",
                    f"{med.name} {med.dose} is outside the usual {low:g}-{high:g} mg range",
                    say["dose"].format(med=med.name, dose=med.dose))

    for field, label in GAPS:
        if getattr(pcr, field) is None:
            add(f"gap:{field}", "gap", field, f"{label} not recorded", say["gap"].format(label=label))
    if pcr.transport_decision == "transport" and pcr.consent_obtained is None:
        add("gap:consent", "gap", "consent_obtained", "Consent not recorded", say["consent"])

    return issues
