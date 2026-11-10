import { CheckCircle2, Loader2, Plus, Printer, Quote, Trash2, Volume2 } from "lucide-react";
import { useState, type ChangeEvent } from "react";
import { readbackAudio } from "../lib/api";
import { readbackKey, type Gender, type PCR, type SceneType, type TransportDecision } from "../lib/types";

interface PCRFormProps {
  pcr: PCR;
  onChange: (next: PCR) => void;
  onLooksGood: () => void;
  isEditing?: boolean;
  extractionMs?: number | null;
  vitalsConfirmed: boolean;
  onConfirmVitals: () => void;
  flash?: Set<string>;
  onEvidenceHover?: (quote: string | null) => void;
}

type PCRKey = keyof PCR;
type ScalarPCRKey = Exclude<PCRKey, "medications" | "evidence" | "unsupported">;

const fieldBase =
  "w-full rounded-md border border-line bg-white px-3 py-2 text-[15px] text-ink outline-none transition placeholder:text-muted/70 focus:border-ink focus:ring-2 focus:ring-ink/15";
// Vitals read like a monitor: big condensed numerals, small placeholder.
const vitalType = "font-display !text-2xl font-semibold tabular-nums placeholder:font-sans placeholder:text-sm placeholder:font-normal";

function valueOrEmpty(value: string | number | boolean | null) {
  return value === null ? "" : String(value);
}

export function PCRForm({ pcr, onChange, onLooksGood, isEditing = false, extractionMs, vitalsConfirmed, onConfirmVitals, flash, onEvidenceHover }: PCRFormProps) {
  const [playing, setPlaying] = useState(false);
  const [heardKey, setHeardKey] = useState<string | null>(null);
  const [readbackError, setReadbackError] = useState<string | null>(null);

  const playReadback = async () => {
    const key = readbackKey(pcr);
    setPlaying(true);
    setReadbackError(null);
    try {
      const url = URL.createObjectURL(await readbackAudio(pcr));
      const audio = new Audio(url);
      audio.onended = () => {
        URL.revokeObjectURL(url);
        setPlaying(false);
        setHeardKey(key);
      };
      await audio.play();
    } catch (err) {
      setPlaying(false);
      setReadbackError(err instanceof Error ? err.message : "Readback failed.");
    }
  };

  // A hand edit makes the field medic-entered: drop its transcript evidence and "no source" flag.
  const setField = <K extends PCRKey>(key: K, value: PCR[K], provenanceKey: string = key) => {
    const evidence = { ...pcr.evidence };
    delete evidence[provenanceKey];
    const unsupported = (pcr.unsupported ?? []).filter((k) => k !== provenanceKey);
    onChange({ ...pcr, [key]: value, evidence, unsupported });
  };

  const hover = (key: string) => ({
    onMouseEnter: () => onEvidenceHover?.(pcr.evidence?.[key] ?? null),
    onMouseLeave: () => onEvidenceHover?.(null),
    onFocus: () => onEvidenceHover?.(pcr.evidence?.[key] ?? null),
    onBlur: () => onEvidenceHover?.(null),
  });

  const flashClass = (key: string) => (flash?.has(key) ? "ring-2 ring-green-300 bg-green-50" : "");

  const provenance = (key: string) =>
    pcr.unsupported?.includes(key) ? (
      <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-xs font-bold text-red-700" title="The agent set this, but the words it cited are not in the transcript">
        no source
      </span>
    ) : pcr.evidence?.[key] ? (
      <span className="inline-flex items-center gap-1 normal-case text-muted" title={`Heard: "${pcr.evidence[key]}"`}>
        <Quote className="h-3 w-3" />
      </span>
    ) : null;

  const fieldLabel = (key: string, label: string) => (
    <span className="mb-1 flex items-center gap-1.5 text-sm font-bold text-muted">
      {label}
      {provenance(key)}
    </span>
  );

  const textInput = (key: ScalarPCRKey, label: string, placeholder = "Not mentioned - add manually", vital = false) => (
    <label className="block" {...hover(key)}>
      {fieldLabel(key, label)}
      <input
        className={`${fieldBase} ${vital ? vitalType : ""} ${pcr[key] === null ? "border-l-2 border-l-amber-400" : ""} ${flashClass(key)}`}
        value={valueOrEmpty(pcr[key])}
        placeholder={placeholder}
        onChange={(event) => setField(key, event.target.value || null)}
      />
    </label>
  );

  const numberInput = (key: ScalarPCRKey, label: string, vital = false) => (
    <label className="block" {...hover(key)}>
      {fieldLabel(key, label)}
      <input
        type="number"
        className={`${fieldBase} ${vital ? vitalType : ""} ${pcr[key] === null ? "border-l-2 border-l-amber-400" : ""} ${flashClass(key)}`}
        value={valueOrEmpty(pcr[key])}
        placeholder={vital ? "Not recorded" : "Not mentioned - add manually"}
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
    <label className="block" {...hover(key)}>
      {fieldLabel(key, label)}
      <select className={`${fieldBase} ${pcr[key] === null ? "border-l-2 border-l-amber-400" : ""} ${flashClass(key)}`} value={valueOrEmpty(pcr[key])} onChange={(event) => setField(key, onCast(event.target.value))}>
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
    setField("medications", medications, `medications.${index}`);
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
      className="rounded-xl border border-line bg-white p-5 sm:p-6 print:border-0 print:p-0"
      onSubmit={(event) => {
        event.preventDefault();
        onLooksGood();
      }}
    >
      <div className="flex flex-col gap-3 border-b border-line pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold leading-tight text-ink">Patient care report</h1>
          <div className="mt-1 flex items-center gap-2">
            <p className="text-[15px] text-muted print:hidden">Check each field before you save.</p>
            <p className="hidden text-[15px] text-muted print:block">Printed {new Date().toLocaleString("en-IN")}</p>
            {extractionMs != null && (
              <span className="print:hidden rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800">
                {(extractionMs / 1000).toFixed(1)}s
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <button
            type="button"
            onClick={() => {
              // The PDF's default file name comes from the page title.
              const title = document.title;
              document.title = `PCR ${pcr.patient_name || "unknown patient"}`;
              window.print();
              document.title = title;
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-2 text-sm font-semibold text-ink hover:bg-cabin"
          >
            <Printer className="h-4 w-4" />
            Print / PDF
          </button>
          <button
            type="button"
            onClick={() => {
              const blob = new Blob([JSON.stringify(pcr, null, 2)], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `pcr-${pcr.patient_name?.replace(/\s+/g, "-").toLowerCase() || "unknown"}-${Date.now()}.json`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            className="rounded-md border border-line px-3 py-2 text-sm font-semibold text-ink hover:bg-cabin"
          >
            Export JSON
          </button>
          <button
            type="submit"
            className="rounded-md bg-signal px-4 py-2 text-sm font-bold text-white hover:bg-signal-dark focus:outline-none focus:ring-4 focus:ring-signal/30"
          >
            {isEditing ? "Update report" : "Save report"}
          </button>
        </div>
      </div>

      {pcr.confidence_notes && (
        <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
          Not sure about this: {pcr.confidence_notes}
        </div>
      )}

      <div className="mt-1 divide-y divide-line [&>section]:py-6 [&>section:last-child]:pb-0">
        <section>
          <h3 className="mb-3 font-display text-xl font-bold text-ink">Patient</h3>
          <div className="grid gap-4 sm:grid-cols-3">
            {textInput("patient_name", "Name")}
            {numberInput("patient_age", "Age")}
            {selectInput<Gender>("patient_gender", "Gender", ["male", "female", "unknown"], (value) =>
              value ? (value as Gender) : null,
            )}
          </div>
        </section>

        <section>
          <h3 className="mb-3 font-display text-xl font-bold text-ink">Incident</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            {textInput("chief_complaint", "Chief complaint")}
            {textInput("incident_location", "Location")}
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-sm font-bold text-muted">History</span>
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
            {textInput("allergies", "Allergies")}
          </div>
        </section>

        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-display text-xl font-bold text-ink">Vitals</h3>
            {vitalsConfirmed ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-2.5 py-1 text-xs font-bold text-green-800">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Vitals confirmed by medic
              </span>
            ) : (
              <div className="flex items-center gap-2 print:hidden">
                <button
                  type="button"
                  onClick={playReadback}
                  disabled={playing}
                  className="inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-xs font-bold text-ink hover:bg-cabin disabled:opacity-60"
                >
                  {playing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Volume2 className="h-3.5 w-3.5" />}
                  {playing ? "Reading back..." : "Read back"}
                </button>
                {heardKey === readbackKey(pcr) && (
                  <button
                    type="button"
                    onClick={onConfirmVitals}
                    className="inline-flex items-center gap-1.5 rounded-md bg-green-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-green-700"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Confirm vitals
                  </button>
                )}
              </div>
            )}
          </div>
          {readbackError && (
            <p className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{readbackError}</p>
          )}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {numberInput("vital_hr", "HR", true)}
            {numberInput("vital_rr", "RR", true)}
            {textInput("vital_bp", "BP", "Not recorded", true)}
            {numberInput("vital_spo2", "SpO2", true)}
            {numberInput("vital_gcs", "GCS", true)}
            {numberInput("vital_temp", "Temp", true)}
            {textInput("vital_skin", "Skin")}
            {numberInput("pain_scale", "Pain (0-10)")}
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="font-display text-xl font-bold text-ink">Treatment</h3>
            <button
              type="button"
              onClick={addMedication}
              className="print:hidden inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-xs font-bold text-ink hover:bg-cabin"
            >
              <Plus className="h-3.5 w-3.5" />
              Add med
            </button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {textInput("treatment_airway", "Airway")}
            {textInput("treatment_iv", "IV")}
            {textInput("oxygen_administered", "Oxygen")}
          </div>

          <div className="mt-4 space-y-3">
            {pcr.medications.length === 0 && (
              <p className="rounded-md border border-dashed border-line px-3 py-3 text-sm text-muted">
                No medications mentioned.
              </p>
            )}
            {pcr.medications.map((medication, index) => (
              <div key={`${medication.name}-${index}`} {...hover(`medications.${index}`)} className={`grid gap-3 rounded-md border border-line p-3 sm:grid-cols-[1fr_1fr_1fr_auto] ${flashClass("medications")}`}>
                {provenance(`medications.${index}`) && <div className="sm:col-span-4 -mb-1 text-xs">{provenance(`medications.${index}`)}</div>}
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
                  className="print:hidden inline-flex h-10 items-center justify-center rounded-md border border-line px-3 text-muted hover:bg-cabin"
                  aria-label="Remove medication"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-3 font-display text-xl font-bold text-ink">Disposition</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            {selectInput<TransportDecision>(
              "transport_decision",
              "Transport decision",
              ["transport", "refused", "deceased"],
              (value) => (value ? (value as TransportDecision) : null),
            )}
            {textInput("destination", "Destination")}
            {textInput("caregiver_present", "Caregiver present")}
            <label className="flex min-h-[66px] items-center gap-3 rounded-md border border-line px-3 py-2">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-line text-signal focus:ring-signal"
                checked={pcr.consent_obtained === true}
                onChange={consentChange}
              />
              <span>
                <span className="block text-sm font-semibold text-ink">Consent obtained</span>
                <span className="block text-xs text-muted">
                  {pcr.consent_obtained === null ? "Not mentioned" : pcr.consent_obtained ? "Yes" : "No"}
                </span>
              </span>
            </label>
          </div>
        </section>

        <section>
          <h3 className="mb-3 font-display text-xl font-bold text-ink">Other details</h3>
          <textarea
            className={`${fieldBase} min-h-24 resize-y`}
            value={pcr.additional_notes ?? ""}
            placeholder="Anything that doesn't fit a field above"
            onChange={(event) => setField("additional_notes", event.target.value || null)}
          />
        </section>
      </div>
    </form>
  );
}
