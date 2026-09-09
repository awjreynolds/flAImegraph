# /// script
# requires-python = ">=3.11"
# dependencies = ["jsonschema==4.26.0"]
# ///
"""Check portable logging syntax without the TypeScript implementation.

Run from any directory with: uv run tools/logging/verify.py
This checks syntax only; it deliberately does not claim semantic conformance.
"""

import json
from pathlib import Path

from jsonschema import Draft202012Validator


def main() -> None:
    root = Path(__file__).resolve().parents[2]
    validators = {}
    for kind in ("usage", "lifecycle", "lifecycle-event", "journal-frame"):
        version = "0.4" if kind == "usage" else "0.5"
        schema = json.loads((root / "spec" / version / f"{kind}.schema.json").read_text())
        Draft202012Validator.check_schema(schema)
        validators[kind] = Draft202012Validator(schema)

    cases = json.loads((root / "spec/fixtures/logging/conformance.json").read_text())
    for case in cases:
        actual = validators[case["kind"]].is_valid(case["value"])
        if actual != case["structural"]:
            raise ValueError(f"Unexpected syntax verdict: {case['name']}")

    for kind, name in (("usage", "v04/native-usage.json"), ("lifecycle", "v05/lifecycle.json")):
        value = json.loads((root / "examples/dogfood" / name).read_text())
        validators[kind].validate(value)
    print(f"Python: {len(cases)} syntax fixtures and two representative captures passed")


if __name__ == "__main__":
    main()
