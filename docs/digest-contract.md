# Digest contract

`src/digest/types.ts` is the shared contract. The reader will export
`readNight: ReadNight` from `src/digest/read-night.ts`. It synchronously reads
`runsDir/<night>.jsonl`. Views can accept the result or a `ReadNight` dependency
without importing an unfinished implementation.

## Results

- `kind: 'missing'` means the file does not exist, or `night` is not a valid
  calendar date in `YYYY-MM-DD` form. Reject invalid nights before filesystem access.
- `kind: 'ready'` contains `night`, `rows`, `badLines` and `counts`. Empty files
  return this variant with no rows, zero bad lines and zero counts. Files containing
  only bad lines also return this variant, with their bad-line count.
- Other filesystem failures propagate; an unreadable file must not look like a
  missing or empty night.

## Input

Each nonblank line must be a JSON object with a nonempty string `job`, a valid
ISO 8601 `at` timestamp with explicit timezone (`Z` or numeric offset), a `status`
of `ok`, `retry` or `fail`, and an `owner` that is a string or `null`. Optional
`error`, when present, must be a string. Unknown fields are ignored.

Malformed JSON and records failing this shape count once in `badLines` and do not
contribute to rows or counts. Blank lines (including a trailing newline) are ignored.
An explicit null owner is valid and must keep its job in the result.

## Aggregation

Rows are grouped by exact job string and sorted ascending by JavaScript string
comparison (`<` / `>`), so HTML and JSON consume one deterministic order.

- `runs` counts all valid records for the job, including retries and failures.
- `retries` counts its records whose status is `retry`.
- `firstAt` and `lastAt` are the earliest and latest timestamps by instant, not
  lexical order. Return the original strings unchanged, preserving their offsets.
- `lastStatus` and `owner` come from the latest record, including a null owner.
- `lastError` is the error from the latest record that supplies an `error`, or
  `null` if none does. A later record without an error does not erase it. An empty
  error string is still supplied. "Latest" always means chronological order.
- Equal timestamp instants are ordered by physical line position: earlier lines
  come first, later lines last. This resolves ties for timestamps, owner, status
  and error consistently.

`counts.ok`, `counts.retry` and `counts.fail` count valid events across the whole
night, regardless of each job's final status. Their sum equals the sum of row
`runs`; `counts.retry` equals the sum of row `retries`. These are the board's
ok / retry / fail summary counts. Missing data remains `null` in the contract;
views render it as `—`.
