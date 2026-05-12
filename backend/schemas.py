from typing import List, Literal, Optional

from pydantic import BaseModel, Field


class Medication(BaseModel):
    name: str
    dose: str
    route: str


class PCR(BaseModel):
    # Patient
    patient_name: Optional[str] = None
    patient_age: Optional[int] = None
    patient_gender: Optional[Literal["male", "female", "unknown"]] = None

    # Incident
    chief_complaint: Optional[str] = None
    history: Optional[str] = None
    incident_location: Optional[str] = None
    scene_type: Optional[Literal["home", "public", "road", "work", "other"]] = None

    # Vitals
    vital_hr: Optional[int] = None
    vital_rr: Optional[int] = None
    vital_bp: Optional[str] = None
    vital_spo2: Optional[int] = None
    vital_gcs: Optional[int] = Field(default=None, ge=3, le=15)
    vital_skin: Optional[str] = None

    # Treatment
    treatment_airway: Optional[str] = None
    treatment_iv: Optional[str] = None
    medications: List[Medication] = Field(default_factory=list)

    # Disposition
    transport_decision: Optional[Literal["transport", "refused", "deceased"]] = None
    destination: Optional[str] = None
    consent_obtained: Optional[bool] = None
    caregiver_present: Optional[str] = None

    # Meta
    confidence_notes: Optional[str] = None
    additional_notes: Optional[str] = None


class TranscriptRequest(BaseModel):
    transcript: str
