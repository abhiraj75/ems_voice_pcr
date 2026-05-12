import { Plus, Trash2 } from "lucide-react";
import type { ChangeEvent } from "react";
import type { Gender, PCR, SceneType, TransportDecision } from "../lib/types";

interface PCRFormProps {
  pcr: PCR;
  onChange: (next: PCR) => void;
  onLooksGood: () => void;
  isEditing?: boolean;
}

type PCRKey = keyof PCR;
type ScalarPCRKey = Exclude<PCRKey, "medications">;

const fieldBase =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-red-600 focus:ring-2 focus:ring-red-100";

function valueOrEmpty(value: string | number | boolean | null) {
  return value === null ? "" : String(value);
}

export function PCRForm({ pcr, onChange, onLooksGood, isEditing = false }: PCRFormProps) {
  const setField = <K extends PCRKey>(key: K, value: PCR[K]) => {
    onChange({ ...pcr, [key]: value });
  };

  const textInput = (key: ScalarPCRKey, label: string, placeholder = "Not mentioned - add manually") => (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-normal text-slate-500">{label}</span>
      <input
        className={fieldBase}
        value={valueOrEmpty(pcr[key])}
        placeholder={placeholder}
        onChange={(event) => setField(key, event.target.value || null)}
      />
    </label>
  );

  const numberInput = (key: ScalarPCRKey, label: string) => (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-normal text-slate-500">{label}</span>
      <input
        type="number"
        className={fieldBase}
        value={valueOrEmpty(pcr[key])}
        placeholder="Not mentioned - add manually"
        onChange={(event) => {
          const value = event.target.value;
          setField(key, (value === "" ? null : Number(value)) as PCR[typeof key]);
        }}
      />
    </label>
  );

  const selectInput = <T extends string>(
    key: ScalarPCRKey,
    label: string,
    options: T[],
    onCast: (value: string) => PCR[typeof key],
  ) => (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-normal text-slate-500">{label}</span>
      <select className={fieldBase} value={valueOrEmpty(pcr[key])} onChange={(event) => setField(key, onCast(event.target.value))}>
        <option value="">Not mentioned - add manually</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );

  const updateMedication = (index: number, field: "name" | "dose" | "route", value: string) => {
    const medications = pcr.medications.map((medication, medicationIndex) =>
      medicationIndex === index ? { ...medication, [field]: value } : medication,
    );
    setField("medications", medications);
  };

  const removeMedication = (index: number) => {
    setField(
      "medications",
      pcr.medications.filter((_, medicationIndex) => medicationIndex !== index),
    );
  };

  const addMedication = () => {
    setField("medications", [...pcr.medications, { name: "", dose: "", route: "" }]);
  };

  const consentChange = (event: ChangeEvent<HTMLInputElement>) => {
    setField("consent_obtained", event.target.checked);
  };

  return (
    <form
      className="rounded-md border border-slate-200 bg-white p-5"
      onSubmit={(event) => {
        event.preventDefault();
        onLooksGood();
      }}
    >
      <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-extrabold tracking-normal text-slate-950">Patient Care Report</h1>
          <p className="mt-1 text-sm text-slate-500">Review extracted fields before saving demo mode.</p>
        </div>
        <button
          type="submit"
          className="rounded-md bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700 focus:outline-none focus:ring-4 focus:ring-red-100"
        >
          {isEditing ? "Update PCR" : "Looks good"}
        </button>
      </div>

      {pcr.confidence_notes && (
        <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
          AI flagged uncertainty: {pcr.confidence_notes}
        </div>
      )}

      <div className="mt-5 space-y-8">
        <section>
          <h3 className="mb-3 text-sm font-extrabold uppercase tracking-normal text-slate-800">Patient</h3>
          <div className="grid gap-4 sm:grid-cols-3">
            {textInput("patient_name", "Name")}
            {numberInput("patient_age", "Age")}
            {selectInput<Gender>("patient_gender", "Gender", ["male", "female", "unknown"], (value) =>
              value ? (value as Gender) : null,
            )}
          </div>
        </section>

        <section>
          <h3 className="mb-3 text-sm font-extrabold uppercase tracking-normal text-slate-800">Incident</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            {textInput("chief_complaint", "Chief complaint")}
            {textInput("incident_location", "Location")}
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-normal text-slate-500">History</span>
              <textarea
                className={`${fieldBase} min-h-28 resize-y`}
                value={pcr.history ?? ""}
                placeholder="Not mentioned - add manually"
                onChange={(event) => setField("history", event.target.value || null)}
              />
            </label>
            {selectInput<SceneType>("scene_type", "Scene type", ["home", "public", "road", "work", "other"], (value) =>
              value ? (value as SceneType) : null,
            )}
          </div>
        </section>

        <section>
          <h3 className="mb-3 text-sm font-extrabold uppercase tracking-normal text-slate-800">Vitals</h3>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {numberInput("vital_hr", "HR")}
            {numberInput("vital_rr", "RR")}
            {textInput("vital_bp", "BP")}
            {numberInput("vital_spo2", "SpO2")}
            {numberInput("vital_gcs", "GCS")}
            {textInput("vital_skin", "Skin")}
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-sm font-extrabold uppercase tracking-normal text-slate-800">Treatment</h3>
            <button
              type="button"
              onClick={addMedication}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
            >
              <Plus className="h-3.5 w-3.5" />
              Add med
            </button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {textInput("treatment_airway", "Airway")}
            {textInput("treatment_iv", "IV")}
          </div>

          <div className="mt-4 space-y-3">
            {pcr.medications.length === 0 && (
              <p className="rounded-md border border-dashed border-slate-300 px-3 py-3 text-sm text-slate-500">
                No medications mentioned.
              </p>
            )}
            {pcr.medications.map((medication, index) => (
              <div key={`${medication.name}-${index}`} className="grid gap-3 rounded-md border border-slate-200 p-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
                <input
                  className={fieldBase}
                  value={medication.name}
                  placeholder="Name"
                  onChange={(event) => updateMedication(index, "name", event.target.value)}
                />
                <input
                  className={fieldBase}
                  value={medication.dose}
                  placeholder="Dose"
                  onChange={(event) => updateMedication(index, "dose", event.target.value)}
                />
                <input
                  className={fieldBase}
                  value={medication.route}
                  placeholder="Route"
                  onChange={(event) => updateMedication(index, "route", event.target.value)}
                />
                <button
                  type="button"
                  onClick={() => removeMedication(index)}
                  className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 px-3 text-slate-500 hover:bg-slate-50"
                  aria-label="Remove medication"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-3 text-sm font-extrabold uppercase tracking-normal text-slate-800">Disposition</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            {selectInput<TransportDecision>(
              "transport_decision",
              "Transport decision",
              ["transport", "refused", "deceased"],
              (value) => (value ? (value as TransportDecision) : null),
            )}
            {textInput("destination", "Destination")}
            {textInput("caregiver_present", "Caregiver present")}
            <label className="flex min-h-[66px] items-center gap-3 rounded-md border border-slate-300 px-3 py-2">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-red-600 focus:ring-red-600"
                checked={pcr.consent_obtained === true}
                onChange={consentChange}
              />
              <span>
                <span className="block text-sm font-semibold text-slate-900">Consent obtained</span>
                <span className="block text-xs text-slate-500">
                  {pcr.consent_obtained === null ? "Not mentioned" : pcr.consent_obtained ? "Yes" : "No"}
                </span>
              </span>
            </label>
          </div>
        </section>

        <section>
          <h3 className="mb-3 text-sm font-extrabold uppercase tracking-normal text-slate-800">Additional Notes</h3>
          <textarea
            className={`${fieldBase} min-h-24 resize-y`}
            value={pcr.additional_notes ?? ""}
            placeholder="Add any extra observations, context, or notes not captured above..."
            onChange={(event) => setField("additional_notes", event.target.value || null)}
          />
        </section>
      </div>
    </form>
  );
}
