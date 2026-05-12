export type Gender = "male" | "female" | "unknown";
export type SceneType = "home" | "public" | "road" | "work" | "other";
export type TransportDecision = "transport" | "refused" | "deceased";

export interface Medication {
  name: string;
  dose: string;
  route: string;
}

export interface PCR {
  patient_name: string | null;
  patient_age: number | null;
  patient_gender: Gender | null;
  chief_complaint: string | null;
  history: string | null;
  incident_location: string | null;
  scene_type: SceneType | null;
  vital_hr: number | null;
  vital_rr: number | null;
  vital_bp: string | null;
  vital_spo2: number | null;
  vital_gcs: number | null;
  vital_skin: string | null;
  treatment_airway: string | null;
  treatment_iv: string | null;
  medications: Medication[];
  transport_decision: TransportDecision | null;
  destination: string | null;
  consent_obtained: boolean | null;
  caregiver_present: string | null;
  confidence_notes: string | null;
}

export type RecorderState =
  | "idle"
  | "recording"
  | "transcribing"
  | "extracting"
  | "ready";

export const emptyPCR = (): PCR => ({
  patient_name: null,
  patient_age: null,
  patient_gender: null,
  chief_complaint: null,
  history: null,
  incident_location: null,
  scene_type: null,
  vital_hr: null,
  vital_rr: null,
  vital_bp: null,
  vital_spo2: null,
  vital_gcs: null,
  vital_skin: null,
  treatment_airway: null,
  treatment_iv: null,
  medications: [],
  transport_decision: null,
  destination: null,
  consent_obtained: null,
  caregiver_present: null,
  confidence_notes: null,
});
