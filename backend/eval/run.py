"""Score single-shot extraction vs the live agent on the same handoffs.

    python -m eval.run                  # both modes, all cases (run from backend/)
    python -m eval.run --mode agent --cases stroke,asthma

Each expected field scores correct / wrong / missed (expected a value, got none) /
hallucinated (expected null, got a value). Expected answers are hand-written in cases.jsonl.
"""
import argparse
import asyncio
import difflib
import json
import re
import time
from collections import Counter
from pathlib import Path

from fastapi import HTTPException

import rules
from agent import AgentSession
from main import extract_pcr
from schemas import PCR

HERE = Path(__file__).parent
ENUMS = {"patient_gender", "scene_type", "transport_decision"}
ROUTES = {"intravenous": "iv", "po": "oral", "by mouth": "oral", "pr": "rectal", "neb": "nebulized",
          "nebulised": "nebulized", "nebulization": "nebulized", "inhaled": "nebulized"}


def empty(value) -> bool:
    return value in (None, "", [])


def norm_dose(dose: str) -> str:
    d = dose.lower().replace(" ", "").replace("milligrams", "mg").replace("milligram", "mg")
    return d.replace("grams", "g").replace("gram", "g")


def norm_route(route: str) -> str:
    r = route.lower().strip()
    return ROUTES.get(r, r)


def same_text(expected: str, got: str) -> bool:
    e, g = expected.lower().strip(), str(got).lower().strip()
    return e in g or g in e or difflib.SequenceMatcher(None, e, g).ratio() >= 0.8


def score_field(field: str, expected, got) -> str:
    if expected is None or expected == []:
        return "correct" if empty(got) else "hallucinated"
    if empty(got):
        return "missed"
    if isinstance(expected, bool) or isinstance(expected, (int, float)):
        ok = isinstance(got, (int, float)) and abs(float(got) - float(expected)) < 0.01
    elif field == "vital_bp":
        ok = re.findall(r"\d+", str(got)) == re.findall(r"\d+", expected)
    elif field in ENUMS:
        ok = str(got).lower() == expected.lower()
    else:
        ok = same_text(expected, got)
    return "correct" if ok else "wrong"


def score_case(case: dict, pcr: PCR) -> dict[str, str]:
    """field -> outcome; medications expand to medications.<name>[.dose|.route]."""
    out = {}
    for field, expected in case["expected"].items():
        if field != "medications":
            out[field] = score_field(field, expected, getattr(pcr, field))
            continue
        got = {m.name.lower(): m for m in pcr.medications}
        for med in expected:
            key = f"medications.{med['name']}"
            match = next((g for name, g in got.items() if same_text(med["name"], name)), None)
            out[key] = "correct" if match else "missed"
            if match:
                got.pop(match.name.lower())
                if "dose" in med:
                    out[key + ".dose"] = "correct" if norm_dose(match.dose) == norm_dose(med["dose"]) else "wrong"
                if "route" in med:
                    out[key + ".route"] = "correct" if norm_route(match.route) == norm_route(med["route"]) else "wrong"
        for name in got:
            out[f"medications.{name}"] = "hallucinated"
    return out


async def run_single(case: dict) -> PCR:
    for attempt in range(8):
        try:
            return await asyncio.to_thread(extract_pcr, " ".join(case["segments"]))
        except HTTPException as exc:
            if "rate" not in str(exc.detail).lower() or attempt == 7:
                raise
            await asyncio.sleep(10)
    raise AssertionError


async def run_agent(case: dict) -> PCR:
    session = AgentSession()
    for segment in case["segments"]:
        await session.handle_segment(segment)
    return session.pcr


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["single", "agent", "both"], default="both")
    parser.add_argument("--cases", help="comma-separated case ids")
    args = parser.parse_args()

    cases = [json.loads(line) for line in (HERE / "cases.jsonl").read_text().splitlines() if line.strip()]
    if args.cases:
        cases = [c for c in cases if c["id"] in args.cases.split(",")]
    modes = ["single", "agent"] if args.mode == "both" else [args.mode]

    results = {m: {} for m in modes}
    for case in cases:
        for mode in modes:
            t = time.time()
            pcr = await (run_single if mode == "single" else run_agent)(case)
            scores = score_case(case, pcr)
            issue_ids = {i["id"] for i in rules.check(pcr)}
            flagged = [i for i in case.get("expect_issues", []) if any(x.startswith(i) for x in issue_ids)]
            results[mode][case["id"]] = {"scores": scores, "seconds": round(time.time() - t, 1),
                                         "issues_expected": case.get("expect_issues", []), "issues_flagged": flagged,
                                         "evidence": pcr.evidence, "unsupported": pcr.unsupported,
                                         "pcr": pcr.model_dump(exclude={"evidence", "unsupported"})}
            bad = {k: v for k, v in scores.items() if v != "correct"}
            print(f"{mode:6} {case['id']:26} {sum(v == 'correct' for v in scores.values())}/{len(scores)}"
                  f" {results[mode][case['id']]['seconds']:5}s  {bad or ''}", flush=True)

    print("\n| mode | accuracy (valued fields) | hallucination rate (null fields) | missed | wrong | critical issues raised | evidence verified |")
    print("|---|---|---|---|---|---|---|")
    for mode in modes:
        valued = Counter()
        nulls = Counter()
        raised = expected_issues = evidenced = settable = 0
        for case in cases:
            r = results[mode][case["id"]]
            for field, outcome in r["scores"].items():
                is_null = case["expected"].get(field, "x") in (None, []) or outcome == "hallucinated"
                (nulls if is_null else valued)[outcome] += 1
            raised += len(r["issues_flagged"])
            expected_issues += len(r["issues_expected"])
            filled = [k for k, v in r["pcr"].items() if not empty(v) and k != "medications"]
            settable += len(filled) + len(r["pcr"]["medications"])
            evidenced += len(r["evidence"])
        n_valued = sum(valued.values())
        n_null = sum(nulls.values())
        evidence = f"{evidenced}/{settable}" if mode == "agent" else "n/a"
        print(f"| {mode} | {valued['correct']}/{n_valued} ({valued['correct'] / max(n_valued, 1):.0%})"
              f" | {nulls['hallucinated']}/{n_null} ({nulls['hallucinated'] / max(n_null, 1):.0%})"
              f" | {valued['missed']} | {valued['wrong']} | {raised}/{expected_issues} | {evidence} |")

    out = HERE / "results" / f"{time.strftime('%Y%m%d-%H%M%S')}.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(results, indent=2, ensure_ascii=False))
    print(f"\nSaved {out.relative_to(HERE.parent)}")


if __name__ == "__main__":
    asyncio.run(main())
