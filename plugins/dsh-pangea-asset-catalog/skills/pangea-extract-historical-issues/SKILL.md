---
name: pangea-extract-historical-issues
description: Extract grounded historical issue candidates from one normalized PANGEA inbox asset. Use only for an explicit Asset Catalog extraction job that supplies one asset ID and one normalized Markdown path, then submit structured drafts through pangea_asset_issue_submit.
---

# Extract Historical Issues

Analyze only the normalized Markdown path named in the extraction task. The task may name a `source_path` for identity, but you must not read that original file, including after a rejected submission. Do not inspect other inbox assets, PANGEA Runs, source repositories, reports, or prior extraction results.

## Identify issues

Extract an issue only when the document describes an event, defect, incident, failure, regression, or previously observed problem. Do not turn requirements, design intentions, examples, recommendations, or hypothetical risks into historical facts.

Keep separate issues separate. Merge passages only when the document clearly says they describe the same problem.

For every issue:

- state only facts supported by the document;
- use empty strings or empty arrays for missing information;
- list absent important fields in `missing_fields`;
- use `high`, `medium`, or `low` confidence without inventing numerical precision;
- cite at least one exact source marker copied character-for-character from a `<!-- source: ... -->` comment, using its `line`, `page`, `sheet`, or `block` form exactly as written;
- keep each evidence excerpt short and verbatim from the cited section; preserve Markdown characters such as backticks, punctuation, whitespace, and capitalization;
- prefer a short unmistakable substring over a whole sentence when inline formatting makes exact copying difficult.

## Submit the result

Call `pangea_asset_issue_submit` exactly once with the task's `asset_id` and an `issues` array. Submit an empty array when the asset contains no grounded historical issue.

Each issue must have this shape:

```json
{
  "title": "short problem name",
  "symptom": "observable problem, or empty",
  "trigger_conditions": ["condition"],
  "impact": ["effect"],
  "root_causes": ["cause"],
  "resolutions": ["action actually taken"],
  "verification": ["check actually described"],
  "limitations": ["exception or remaining limitation"],
  "missing_fields": ["root_causes"],
  "confidence": "high",
  "evidence": [
    {
      "location": "inbox/example.docx#block=3",
      "excerpt": "short exact excerpt"
    }
  ]
}
```

If validation rejects a submission, re-read only the normalized Markdown and correct the exact marker or excerpt. Never inspect the original `source_path` as a fallback.

The plugin may deterministically repair a wrong marker only when the exact excerpt occurs in one and only one source section of this asset. It still rejects missing or ambiguous evidence.

Do not write files directly. Do not generate methodology. After the tool accepts the submission, briefly report the number of issue drafts submitted.
