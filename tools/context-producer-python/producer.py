#!/usr/bin/env python3
"""Emit the independent, synthetic v0.2 context producer fixture.

This producer is deliberately small and self-contained.  It uses only the
Python standard library, retains no raw context in the exported manifest, and
does not import or call the TypeScript implementation.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any


DATASET_ID = "independent-producer-fixture-v02"
CAPTURE_ARTIFACT_ID = "context-capture"
PROFILE_ARTIFACT_ID = "profile-manifest"
HARNESS = "independent-python"


def ref(source_id: str, record: str) -> dict[str, str]:
    return {"source_id": source_id, "record": record}


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def fact(value: str | int | float | bool | None, evidence: str, source_refs: list[dict[str, str]]) -> dict[str, Any]:
    return {"value": value, "evidence": evidence, "source_refs": source_refs}


def measurement(
    value: str | None,
    unit: str,
    evidence: str,
    method: str,
    source_refs: list[dict[str, str]],
) -> dict[str, Any]:
    return {
        "value": value,
        "unit": unit,
        "evidence": evidence,
        "method": method,
        "source_refs": source_refs,
    }


def revision(
    revision_id: str,
    source_id: str,
    representation: str,
    content: str,
    token_value: str | None,
    token_evidence: str,
    token_method: str,
    byte_value: str | None,
    byte_evidence: str,
    byte_method: str,
    record: str,
) -> dict[str, Any]:
    revision_refs = [ref(CAPTURE_ARTIFACT_ID, record)]
    return {
        "id": revision_id,
        "source_id": source_id,
        "representation": representation,
        "media": "text",
        "content_sha256": sha256_text(content),
        "fingerprint_evidence": "derived",
        "fingerprint_method": "sha256(UTF-8 synthetic fixture text)",
        "tokens": measurement(
            token_value,
            "tokens",
            token_evidence,
            token_method,
            [ref(CAPTURE_ARTIFACT_ID, f"{record}.tokens")],
        ),
        "bytes": measurement(
            byte_value,
            "utf8_bytes",
            byte_evidence,
            byte_method,
            [ref(CAPTURE_ARTIFACT_ID, f"{record}.bytes")],
        ),
        "source_refs": revision_refs,
    }


def build_profile() -> dict[str, Any]:
    profile_ref = lambda record: ref(PROFILE_ARTIFACT_ID, record)
    declared = lambda value, record: fact(value, "declared", [profile_ref(record)])
    unknown = lambda: fact(None, "unknown", [])
    tool_schema = '{"name":"synthetic_tool","schema":"v1"}'

    return {
        "schema_version": "0.2.0",
        "id": "independent-python-profile-v1",
        "name": "Independent Python synthetic harness",
        "harness": HARNESS,
        "harness_version": declared("0.1.0", "profile.harness_version"),
        "profile_version": "0.2.0-independent-fixture-v1",
        "model": {
            "provider": declared("synthetic-provider", "profile.model.provider"),
            "name": declared("synthetic-model", "profile.model.name"),
            "settings": {
                "temperature": declared("0", "profile.model.settings.temperature"),
                "max_output_tokens": unknown(),
            },
        },
        "instruction_sources": [
            {
                "origin": "repository_instruction",
                "label": "synthetic repository instruction",
                "delivery": "always",
                "evidence": "declared",
                "source_refs": [profile_ref("profile.instruction_sources[0]")],
            },
            {
                "origin": "skill",
                "label": "synthetic TDD skill",
                "delivery": "conditional",
                "evidence": "declared",
                "source_refs": [profile_ref("profile.instruction_sources[1]")],
            },
        ],
        "tools": [
            {
                "id": "synthetic-tool",
                "name": "synthetic_tool",
                "definition_sha256": sha256_text(tool_schema),
                "definition_evidence": "derived",
                "definition_method": "sha256(canonical synthetic tool definition)",
                "evidence": "declared",
                "source_refs": [profile_ref("profile.tools[0]")],
            }
        ],
        "policies": {
            "assembly": declared("ordered", "profile.policies.assembly"),
            "truncation": unknown(),
            "compaction": declared("summary-v1", "profile.policies.compaction"),
            "caching": unknown(),
        },
        "context_capabilities": [
            {
                "origin": "user_prompt",
                "capture": "direct",
                "evidence": "declared",
                "source_refs": [profile_ref("profile.context_capabilities.user_prompt")],
                "note": "The synthetic request includes a direct user occurrence.",
            },
            {
                "origin": "conversation_history",
                "capture": "reconstructed",
                "evidence": "declared",
                "source_refs": [profile_ref("profile.context_capabilities.conversation_history")],
                "note": "The history summary is a declared fixture transformation.",
            },
            {
                "origin": "tool_schema",
                "capture": "unavailable",
                "evidence": "declared",
                "source_refs": [profile_ref("profile.context_capabilities.tool_schema")],
                "note": "Tool identity is declared, but a request-level schema occurrence is not captured.",
            },
        ],
        "artifacts": [
            {
                "id": PROFILE_ARTIFACT_ID,
                "harness": HARNESS,
                "format": "synthetic-profile-json",
                "version": "0.2.0",
                "coverage": "complete",
                "description": "Declared profile provenance for the independent synthetic fixture.",
            }
        ],
    }


def build_bundle() -> dict[str, Any]:
    capture_ref = lambda record: ref(CAPTURE_ARTIFACT_ID, record)
    source_refs = lambda record: [capture_ref(record)]
    synthetic_message = (
        "Synthetic fixture: token measurements and model_price_estimate are illustrative; "
        "no provider call, billed amount, or accepted user task exists."
    )

    system_text = "Synthetic system instruction for the independent producer."
    user_text = "Synthetic user request for context lineage."
    history_text = "Synthetic full conversation history before compaction."
    summary_text = "Synthetic compacted history summary."

    revisions = [
        revision(
            "revision-system",
            "source-system",
            "original",
            system_text,
            None,
            "unavailable",
            "no tokenizer record in synthetic fixture",
            str(len(system_text.encode("utf-8"))),
            "derived",
            "UTF-8 byte length via Python standard library",
            "revisions[0]",
        ),
        revision(
            "revision-user",
            "source-user",
            "original",
            user_text,
            "30",
            "estimated",
            "synthetic fixture token estimate",
            str(len(user_text.encode("utf-8"))),
            "derived",
            "UTF-8 byte length via Python standard library",
            "revisions[1]",
        ),
        revision(
            "revision-history-full",
            "source-history",
            "original",
            history_text,
            "40",
            "estimated",
            "synthetic fixture token estimate before compaction",
            None,
            "unavailable",
            "raw byte length not captured for this synthetic history record",
            "revisions[2]",
        ),
        revision(
            "revision-history-summary",
            "source-history",
            "summary",
            summary_text,
            "20",
            "estimated",
            "synthetic fixture token estimate after compaction",
            None,
            "unavailable",
            "raw byte length not captured for this synthetic summary record",
            "revisions[3]",
        ),
    ]

    occurrences = [
        {
            "id": "occurrence-system",
            "revision_id": "revision-system",
            "role": "system",
            "placement": "instruction",
            "treatment": {
                "value": "fresh",
                "evidence": "declared",
                "method": "synthetic request manifest",
                "source_refs": [capture_ref("requests[0].occurrences[0]")],
            },
        },
        {
            "id": "occurrence-user-first",
            "revision_id": "revision-user",
            "role": "user",
            "placement": "current_turn",
            "treatment": {
                "value": "fresh",
                "evidence": "declared",
                "method": "synthetic request manifest",
                "source_refs": [capture_ref("requests[0].occurrences[1]")],
            },
        },
        {
            "id": "occurrence-history-summary",
            "revision_id": "revision-history-summary",
            "role": "assistant",
            "placement": "history",
            "treatment": {
                "value": "fresh",
                "evidence": "declared",
                "method": "synthetic compaction output",
                "source_refs": [capture_ref("requests[0].occurrences[2]")],
            },
        },
        {
            "id": "occurrence-user-repeat",
            "revision_id": "revision-user",
            "role": "user",
            "placement": "current_turn",
            "treatment": {
                "value": "unknown",
                "evidence": "unknown",
                "method": "cache treatment was not captured; repetition is not a cache hit",
                "source_refs": [],
            },
        },
    ]

    return {
        "schema_version": "0.2.0",
        "dataset_id": DATASET_ID,
        "evidence_schema_version": "0.1.0",
        "artifacts": [
            {
                "id": CAPTURE_ARTIFACT_ID,
                "harness": HARNESS,
                "format": "synthetic-context-json",
                "version": "0.2.0",
                "coverage": "partial",
                "description": "Synthetic independent producer capture; no provider call, bill, or accepted task is represented.",
            }
        ],
        "profiles": [build_profile()],
        "sources": [
            {
                "id": "source-system",
                "origin": "system_instruction",
                "origin_evidence": "declared",
                "label": "synthetic system instruction",
                "identity_basis": "producer",
                "source_refs": source_refs("sources[0]"),
            },
            {
                "id": "source-user",
                "origin": "user_prompt",
                "origin_evidence": "observed",
                "label": "synthetic user request",
                "identity_basis": "producer",
                "source_refs": source_refs("sources[1]"),
            },
            {
                "id": "source-history",
                "origin": "conversation_history",
                "origin_evidence": "declared",
                "label": "synthetic conversation history",
                "identity_basis": "producer",
                "source_refs": source_refs("sources[2]"),
            },
        ],
        "revisions": revisions,
        "requests": [
            {
                "id": "request-main",
                "observation_id": "model-call-1",
                "profile_id": "independent-python-profile-v1",
                "captured_at": "2026-09-06T20:00:00Z",
                "boundary": "harness_context",
                "coverage": "partial",
                "coverage_evidence": "observed",
                "occurrences": occurrences,
                "overrides": {
                    "temperature": {
                        "value": 0.2,
                        "evidence": "observed",
                        "source_refs": [capture_ref("requests[0].overrides.temperature")],
                    },
                    "compaction": {
                        "value": "summary-v1",
                        "evidence": "observed",
                        "source_refs": [capture_ref("requests[0].overrides.compaction")],
                    },
                },
                "source_refs": [capture_ref("requests[0]")],
            }
        ],
        "transformations": [
            {
                "id": "transformation-history-summary",
                "kind": "summarize",
                "from_revision_ids": ["revision-history-full"],
                "to_revision_ids": ["revision-history-summary"],
                "evidence": "declared",
                "method": "synthetic compaction summary-v1 with explicit source lineage",
                "observation_id": "model-call-1",
                "source_refs": [capture_ref("transformations[0]")],
            }
        ],
        "issues": [{"code": "SYNTHETIC_FIXTURE", "message": synthetic_message, "severity": "info"}],
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Emit the independent synthetic flAImegraph v0.2 context bundle")
    parser.add_argument("--out", default="-", help="write JSON to this path (default: stdout)")
    args = parser.parse_args(argv)
    serialized = json.dumps(build_bundle(), ensure_ascii=False, sort_keys=True, indent=2) + "\n"
    if args.out == "-":
        sys.stdout.write(serialized)
    else:
        Path(args.out).write_text(serialized, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
