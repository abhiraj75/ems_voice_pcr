"""Everything the agent says in fixed wording, per language.

These lines include safety alerts, so a new language or a wording change needs a fluent reviewer.
Prisma and Timbre support more languages than this table; adding one means adding a reviewed entry here.
"""
import re

# "hindi" is everyday spoken Hindi: Roman script, with the English words medics actually use (gender, BP, age).
DEFAULT = "hindi"
ASK_LANGUAGE = "Aap kis language mein baat karna chahenge?"
NOT_SUPPORTED = "Sorry, {language} abhi supported nahi hai. Abhi English aur Hindi available hain, kaunsi chalegi?"

# What the screen shows for the two lines above; the agent's written lines are always English.
ASK_LANGUAGE_ENGLISH = "Which language would you like to speak in?"
NOT_SUPPORTED_ENGLISH = "Sorry, {language} isn't supported yet. English and Hindi are available right now. Which would you like?"

# Named by the medic but not offered yet: answered with NOT_SUPPORTED.
UNSUPPORTED = {
    "tamil": "Tamil", "telugu": "Telugu", "kannada": "Kannada", "malayalam": "Malayalam", "marathi": "Marathi",
    "bengali": "Bengali", "bangla": "Bengali", "gujarati": "Gujarati", "punjabi": "Punjabi", "odia": "Odia",
    "oriya": "Odia", "urdu": "Urdu", "assamese": "Assamese", "bhojpuri": "Bhojpuri", "french": "French",
    "nepali": "Nepali", "konkani": "Konkani", "sanskrit": "Sanskrit", "sindhi": "Sindhi", "kashmiri": "Kashmiri",
    "maithili": "Maithili", "dogri": "Dogri", "manipuri": "Manipuri", "santali": "Santali", "tulu": "Tulu",
    "spanish": "Spanish", "german": "German", "arabic": "Arabic", "chinese": "Chinese", "japanese": "Japanese",
    "korean": "Korean", "russian": "Russian", "portuguese": "Portuguese", "italian": "Italian",
}

SPOKEN_LABELS = {
    "patient_name": "name", "patient_age": "age", "patient_gender": "gender", "chief_complaint": "complaint",
    "incident_location": "location", "scene_type": "scene", "allergies": "allergies",
    "vital_bp": "B P", "vital_hr": "pulse", "vital_rr": "respiratory rate", "vital_spo2": "S P O 2",
    "vital_gcs": "G C S", "vital_temp": "temperature", "vital_skin": "skin", "pain_scale": "pain score",
    "treatment_airway": "airway", "treatment_iv": "IV", "oxygen_administered": "oxygen",
    "transport_decision": "transport", "destination": "destination", "consent_obtained": "consent",
    "caregiver_present": "caregiver",
}
ACKNOWLEDGED = {"history": "history noted", "additional_notes": "added to other details"}

_READ_OUT = {
    "spoken": SPOKEN_LABELS, "acknowledged": ACKNOWLEDGED, "over": " over ", "noted": "Noted: ", "cleared": "{} cleared",
    "medication": "medication {}", "removed": "removed {}", "readback": "Readback.", "medications": "Medications: ",
    "please_confirm": "Please confirm.", "nothing_to_read": "No vitals or medications recorded.",
}

PHRASES = {
    "hindi": {
        **_READ_OUT,
        "name": "Hinglish (Roman script)",
        "yes": "haan", "no": "nahi",
        "chosen": "Theek hai, Hindi mein baat karte hain.",
        "chosen_english": "Okay, let's continue in Hindi.",
        "ask": "{} batayein.", "and": "aur",
        "ask_labels": {
            "patient_name": "patient ka naam", "patient_age": "age", "patient_gender": "gender",
            "chief_complaint": "kya hua hai", "scene_type": "kahan hua",
            "vital_bp": "BP", "vital_hr": "pulse", "vital_spo2": "SpO2", "vital_gcs": "GCS",
            "allergies": "koi allergy",
            "destination": "kahan le ja rahe hain", "consent_obtained": "consent mila ya nahi",
        },
        "treatment": "Koi dawai, oxygen ya IV diya?",
        "history": "Patient ki history batayein, jaise kab se problem hai aur koi purani bimari.",
        "anything_else": "Aur kuch add karna hai?",
        "done": "Report ho gaya.", "closing": "Readback ke liye boliye, ya save kar dijiye.",
        "rules": {
            "allergy": "Alert. Allergy recorded: {allergies}. Phir bhi {med} diya gaya hai. Please check.",
            "gcs": "Alert. GCS {gcs} hai, airway management record nahi hua.",
            "implausible": "{label} {value} sahi nahi lag raha. Please repeat karo.",
            "shock": "Shock index {si} hai, patient shock mein ho sakta hai.",
            "spo2": "SpO2 {spo2} hai, oxygen record nahi hua.",
            "dose": "{med} ka dose {dose} usual range se bahar hai. Please confirm.",
            "gap": "{label} abhi record nahi hua.",
            "consent": "Consent record nahi hua.",
        },
    },
    "english": {
        **_READ_OUT,
        "name": "English",
        "yes": "yes", "no": "no",
        "chosen": "Okay, let's continue in English.",
        "chosen_english": "Okay, let's continue in English.",
        "ask": "Please tell me {}.", "and": "and",
        "ask_labels": {
            "patient_name": "the patient's name", "patient_age": "age", "patient_gender": "gender",
            "chief_complaint": "what happened", "scene_type": "where it happened",
            "vital_bp": "BP", "vital_hr": "pulse", "vital_spo2": "SpO2", "vital_gcs": "GCS",
            "allergies": "any allergies",
            "destination": "where you are taking the patient", "consent_obtained": "whether consent was given",
        },
        "treatment": "Was any medication, oxygen or IV given?",
        "history": "Tell me the patient's history, like how long this has been going on and any past illness.",
        "anything_else": "Anything else to add?",
        "done": "The report is complete.", "closing": "Say readback to hear it, or save it.",
        "rules": {
            "allergy": "Alert. Allergy recorded: {allergies}, but {med} was given. Please check.",
            "gcs": "Alert. GCS is {gcs} and no airway management is recorded.",
            "implausible": "{label} {value} does not look right. Please repeat.",
            "shock": "Shock index is {si}. The patient may be in shock.",
            "spo2": "SpO2 is {spo2} and no oxygen is recorded.",
            "dose": "{med} dose {dose} is outside the usual range. Please confirm.",
            "gap": "{label} is not recorded yet.",
            "consent": "Consent is not recorded.",
        },
    },
}

# Timbre: hi-en reads Roman-script Hindi that carries English words.
TTS_CODES = {"english": "en-IN", "hindi": "hi-en"}


def pick_language(text: str) -> str | None:
    """A PHRASES key, the display name of a language we don't offer, or None if no language was named."""
    words = set(re.findall(r"[a-z]+", text.lower()))
    if words & {"hindi", "hinglish"}:
        return "hindi"
    if words & {"english", "angrezi", "inglish"}:
        return "english"
    return next((name for key, name in UNSUPPORTED.items() if key in words), None)
