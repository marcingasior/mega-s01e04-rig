export type DigestStatus = 'ok' | 'retry' | 'fail';

// Event counts, not counts of jobs grouped by their final status.
export type DigestCounts = Record<DigestStatus, number>;

export type DigestRow = {
  job: string;
  owner: string | null;
  runs: number;
  retries: number;
  lastStatus: DigestStatus;
  lastError: string | null;
  firstAt: string;
  lastAt: string;
};

export type ReadNightResult =
  | { kind: 'missing'; night: string }
  | {
      kind: 'ready';
      night: string;
      rows: DigestRow[];
      badLines: number;
      counts: DigestCounts;
    };

// Synchronous implementation belongs in ./read-night.ts; views need only these types.
// Aggregation, validation, ordering and missing-file semantics: docs/digest-contract.md.
export type ReadNight = (runsDir: string, night: string) => ReadNightResult;
