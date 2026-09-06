#!/usr/bin/env python3
"""Render a cost projection with the unmodified, pinned FlameGraph renderer.

This reads public numeric evidence only. Obtain flamegraph.pl separately from
RENDERER_URL, then run:
    python3 render.py --renderer /absolute/path/to/flamegraph.pl
No network access or provider calls are performed by this script.
"""

import argparse
from decimal import Decimal, ROUND_HALF_EVEN
import hashlib
import json
from pathlib import Path
import subprocess
import xml.etree.ElementTree as ET


RENDERER_COMMIT = "41fee1f99f9276008b7cd112fca19dc3ea84ac32"
RENDERER_URL = (
    "https://raw.githubusercontent.com/brendangregg/FlameGraph/"
    f"{RENDERER_COMMIT}/flamegraph.pl"
)
RENDERER_SHA256 = "088f82e6848a4f12a56e1e8e8170ee6761fccf12e5615cd64630f6b087c99ea7"
SCALE = Decimal(1_000_000_000)
EXPECTED_NANODOLLARS = 42_595_907_500
EXPECTED_OBSERVATIONS = 484
EXPECTED_ZERO_RECORDS = 13
UNKNOWN_COMPACTIONS = 2


def frame(value):
    text = str(value)
    if not text or any(char in text for char in ";\n\r\t"):
        raise ValueError(f"Invalid folded frame: {text!r}")
    return text


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--renderer", required=True, type=Path)
    args = parser.parse_args()
    directory = Path(__file__).resolve().parent
    evidence_path = directory / "evidence.json"
    data = json.loads(evidence_path.read_text())
    observations = data["observations"]
    if len(observations) != EXPECTED_OBSERVATIONS:
        raise ValueError("Public fixture observation count changed; audit first")
    renderer_hash = hashlib.sha256(args.renderer.read_bytes()).hexdigest()
    if renderer_hash != RENDERER_SHA256:
        raise ValueError("Renderer differs from the inspected pinned revision")

    ids = set()
    lines = []
    exact_total = Decimal(0)
    widths = []
    zero_records = 0
    model_totals = {}
    response_labels = []
    for observation in observations:
        identity = observation["id"]
        if identity in ids:
            raise ValueError(f"Duplicate evidence observation: {identity}")
        ids.add(identity)
        cost = Decimal(observation["recordedCost"]["total"])
        if not cost.is_finite() or cost < 0:
            raise ValueError("Negative or invalid cost requires a different projection")
        expected_width = int((cost * SCALE).quantize(Decimal(1), rounding=ROUND_HALF_EVEN))
        width = observation["widthNanodollars"]
        if type(width) is not int or width != expected_width:
            raise ValueError(f"Incorrect nanodollar conversion: {identity}")
        exact_total += cost
        widths.append(width)
        if width == 0:
            zero_records += 1
            continue
        model = frame(observation["model"])
        # A final whitespace-separated number is parsed as a differential count
        # by FlameGraph, so use a hyphen in this display identifier.
        response = frame(f"Response-{observation['assistantSequence']:04d}")
        response_labels.append(response)
        model_totals[model] = model_totals.get(model, 0) + width
        lines.append(f"Illustrative work item;{model};{response} {width}")

    total = sum(widths)
    if total != EXPECTED_NANODOLLARS or zero_records != EXPECTED_ZERO_RECORDS:
        raise ValueError("Fixture accounting changed; audit before regenerating")
    if sum(model_totals.values()) != total:
        raise ValueError("Model subtotals do not conserve the projected total")
    folded_path = directory / "cost.folded"
    folded_path.write_text("\n".join(lines) + "\n")
    display_usd = format(Decimal(total) / SCALE, "f").rstrip("0").rstrip(".")
    title = f"Recorded model-price subtotal: ${display_usd} USD"
    subtitle = (
        "Width = USD cost | 2 compactions unreported; 13 zero records do not prove free usage | "
        "Complete cost unknown"
    )
    notes = (
        "Public Pi fixture; illustrative work-item attribution, not a real ticket. "
        "Recorded model-price estimates, not invoice charges. "
        "Weights are nanodollars: 1,000,000,000 nUSD = 1 USD. "
        "Each positive-cost response contributes once; parent widths are inclusive. "
        "Native zero-cost records and unreported compactions have no invented area. "
        "Per-observation decimal half-even rounding to nUSD. "
        f"Unmodified Brendan Gregg FlameGraph renderer at {RENDERER_COMMIT}. "
        f"Source: {RENDERER_URL}"
    )
    command = [
        "perl", str(args.renderer.resolve()),
        "--title", title,
        "--subtitle", subtitle,
        "--countname", "nUSD (1e-9 USD)",
        "--nametype", "Attribution:",
        "--width", "1800",
        "--height", "28",
        "--fontsize", "13",
        "--minwidth", "0",
        "--colors", "blue",
        "--hash",
        "--notes", notes,
        str(folded_path),
    ]
    result = subprocess.run(command, check=True, capture_output=True)
    if result.stderr:
        raise ValueError(f"Renderer warning: {result.stderr.decode()}")
    svg_path = directory / "cost-flamegraph.svg"
    svg_path.write_bytes(result.stdout)
    root = ET.fromstring(result.stdout)
    namespace = {"svg": "http://www.w3.org/2000/svg"}
    tooltips = [element.text or "" for element in root.findall(".//svg:title", namespace)]
    expected_root = f"all ({total:,} nUSD (1e-9 USD), 100%)"
    if expected_root not in tooltips:
        raise ValueError("Rendered root tooltip does not match the exact projected subtotal")
    for label in response_labels:
        if sum(tip.startswith(label + " (") for tip in tooltips) != 1:
            raise ValueError(f"Response missing or repeated in SVG: {label}")
    for model, model_total in model_totals.items():
        if not any(tip.startswith(f"{model} ({model_total:,} nUSD ") for tip in tooltips):
            raise ValueError(f"Model subtotal missing from SVG: {model}")

    metadata = {
        "costBasis": "recorded model-price estimate; not invoice or settled charge",
        "currency": "USD",
        "weightUnit": "nanodollars",
        "nanodollarsPerUsd": int(SCALE),
        "exactSumOfSourceDecimalStringsUsd": str(exact_total),
        "projectedSubtotalNanodollars": total,
        "projectedSubtotalUsd": display_usd,
        "roundingDifferenceUsd": str(Decimal(total) / SCALE - exact_total),
        "roundingPolicy": "Decimal ROUND_HALF_EVEN per observation to 1e-9 USD",
        "observationCount": len(observations),
        "renderedPositiveCostResponses": len(lines),
        "nativeZeroCostRecords": zero_records,
        "nativeZeroCostDoesNotProveZeroBilling": True,
        "unreportedCompactionCount": UNKNOWN_COMPACTIONS,
        "completeCostKnown": False,
        "grouping": ["illustrative work item", "model", "response"],
        "modelSubtotalsNanodollars": model_totals,
        "evidenceSha256": hashlib.sha256(evidence_path.read_bytes()).hexdigest(),
        "renderer": {
            "name": "Brendan Gregg FlameGraph",
            "commit": RENDERER_COMMIT,
            "sourceUrl": RENDERER_URL,
            "sha256": renderer_hash,
            "unmodified": True,
        },
        "verification": {
            "uniqueEvidenceIds": True,
            "eachWidthMatchesDecimalConversion": True,
            "modelTotalsConserveSubtotal": True,
            "svgRootMatchesSubtotal": True,
            "eachPositiveResponseAppearsOnce": True,
        },
        "reproduce": "python3 render.py --renderer /absolute/path/to/pinned/flamegraph.pl",
    }
    (directory / "render.json").write_text(json.dumps(metadata, indent=2) + "\n")
    print(json.dumps({"svg": str(svg_path), "subtotalUsd": display_usd,
                      "positiveResponses": len(lines), "completeCostKnown": False}))


if __name__ == "__main__":
    main()
