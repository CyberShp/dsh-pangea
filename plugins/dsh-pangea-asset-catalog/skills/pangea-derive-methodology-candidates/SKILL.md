---
name: pangea-derive-methodology-candidates
description: Derive non-binding methodology candidates only from user-confirmed historical issues supplied by a PANGEA Asset Catalog job. Use only for an explicit methodology job, read its confirmed-issues input, and submit candidates through pangea_asset_methodology_submit.
---

# Derive Methodology Candidates

Read only the confirmed-issues JSON path named in the task. Do not inspect draft or excluded issues, inbox assets, PANGEA Runs, source repositories, reports, or existing methodologies.

## Derive reusable checks

Turn confirmed historical experience into a candidate only when it supports a reusable check. Keep product-specific facts as applicability conditions instead of presenting them as universal rules.

Every candidate must:

- identify when it applies;
- describe concrete checks rather than broad advice;
- distinguish expected and failure signals;
- preserve known exceptions and limitations;
- cite one or more supplied confirmed issue IDs;
- carry through source evidence supplied by those issues;
- remain a draft and never claim to change PANGEA behavior.

Do not infer a rule when the confirmed issues do not support one. It is valid to submit an empty array.

## Submit the result

Call `pangea_asset_methodology_submit` exactly once with a `candidates` array. Each candidate must have this shape:

```json
{
  "title": "short reusable check name",
  "applicable_when": ["condition"],
  "checks": ["concrete action"],
  "expected_signals": ["expected observation"],
  "failure_signals": ["failure observation"],
  "exceptions": ["known exception"],
  "source_issue_ids": ["material-example-issue-001"],
  "evidence": [
    {
      "location": "inbox/example.docx#block=3",
      "excerpt": "short exact excerpt"
    }
  ]
}
```

Do not write files directly. After the tool accepts the submission, briefly report the number of candidates submitted.
