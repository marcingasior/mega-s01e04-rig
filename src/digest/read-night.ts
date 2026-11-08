import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestCounts, DigestRow, DigestStatus, ReadNight } from './types.js';

type Event = {
  at: string;
  instant: number;
  fraction: string;
  job: string;
  status: DigestStatus;
  owner: string | null;
  error?: string;
};

function isNight(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function parseEvent(value: unknown): Event | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.job !== 'string' || record.job.length === 0
    || typeof record.at !== 'string'
    || (record.status !== 'ok' && record.status !== 'retry' && record.status !== 'fail')
    || (record.owner !== null && typeof record.owner !== 'string')
    || ('error' in record && typeof record.error !== 'string')) return null;

  const timestamp = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.(\d+))?)?(Z|[+-](?:[01]\d|2[0-3])(?::?[0-5]\d)?)$/.exec(record.at);
  if (!timestamp || !isNight(timestamp[1])) return null;
  const [, date, hour, minute, second = '00', fraction = '', offset] = timestamp;
  const zone = offset === 'Z' || offset.includes(':') ? offset
    : offset.length === 3 ? `${offset}:00` : `${offset.slice(0, 3)}:${offset.slice(3)}`;
  const instant = Date.parse(`${date}T${hour}:${minute}:${second}${zone}`);
  if (!Number.isFinite(instant)) return null;
  return {
    at: record.at, instant, fraction: fraction.replace(/0+$/, ''), job: record.job,
    status: record.status, owner: record.owner,
    ...(typeof record.error === 'string' ? { error: record.error } : {}),
  };
}

// Fractions are compared as decimals, without losing sub-millisecond precision.
function compareTime(left: Event, right: Event): number {
  if (left.instant !== right.instant) return left.instant - right.instant;
  const width = Math.max(left.fraction.length, right.fraction.length);
  const a = left.fraction.padEnd(width, '0');
  const b = right.fraction.padEnd(width, '0');
  return a < b ? -1 : a > b ? 1 : 0;
}

export const readNight: ReadNight = (runsDir, night) => {
  if (!isNight(night)) return { kind: 'missing', night };
  let contents: string;
  try {
    contents = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return { kind: 'missing', night };
    }
    throw error;
  }

  const events: Event[] = [];
  let badLines = 0;
  for (const line of contents.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      badLines++;
      continue;
    }
    const event = parseEvent(value);
    if (event) events.push(event);
    else badLines++;
  }

  // Stable sorting retains physical line order for equal instants.
  events.sort(compareTime);
  const jobs = new Map<string, DigestRow>();
  const counts: DigestCounts = { ok: 0, retry: 0, fail: 0 };
  for (const event of events) {
    counts[event.status]++;
    let row = jobs.get(event.job);
    if (!row) {
      row = {
        job: event.job, owner: event.owner, runs: 0, retries: 0,
        lastStatus: event.status, lastError: null, firstAt: event.at, lastAt: event.at,
      };
      jobs.set(event.job, row);
    }
    row.runs++;
    if (event.status === 'retry') row.retries++;
    row.owner = event.owner;
    row.lastStatus = event.status;
    row.lastAt = event.at;
    if (event.error !== undefined) row.lastError = event.error;
  }
  const rows = [...jobs.values()].sort((a, b) => a.job < b.job ? -1 : a.job > b.job ? 1 : 0);
  return { kind: 'ready', night, rows, badLines, counts };
};
