import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read-night.js';

const night = '2026-10-28';
const event = { at: '2026-10-29T01:00:00+01:00', job: 'job', status: 'ok', owner: 'rook' };
let runsDir: string;
const writeEvents = (records: unknown[]) => writeFileSync(
  join(runsDir, `${night}.jsonl`), records.map(record => JSON.stringify(record)).join('\n'),
);

beforeEach(() => { runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-')); });
afterEach(() => { rmSync(runsDir, { recursive: true, force: true }); });

describe('night reader', () => {
  it('reads the real fixture without changing it: five jobs and one bad line', () => {
    const result = readNight(fileURLToPath(new URL('../runs', import.meta.url)), night);
    expect(result.kind).toBe('ready');
    if (result.kind !== 'ready') throw new Error('fixture missing');
    expect(result.badLines).toBe(1);
    expect(result.rows.map(row => row.job)).toEqual([
      'digest/render', 'fixtures/refresh', 'lane/sync', 'notes/backup', 'rig/rotate-logs',
    ]);
    expect(result.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
    expect(result.rows[0]).toMatchObject({ owner: null, runs: 1, retries: 0, lastError: null });
    expect(result.rows[1]).toEqual({
      job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3, lastStatus: 'ok',
      lastError: 'upstream 503', firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00',
    });
    expect(result.rows[2]).toMatchObject({ runs: 8, retries: 1, lastStatus: 'ok', lastError: 'lock held' });
    expect(result.rows[3]).toMatchObject({ runs: 1, lastStatus: 'fail', lastError: 'quota exceeded' });
    expect(Object.values(result.counts).reduce((sum, count) => sum + count, 0))
      .toBe(result.rows.reduce((sum, row) => sum + row.runs, 0));
  });

  it('orders by instant rather than line position or timestamp spelling and retains errors', () => {
    writeEvents([
      { ...event, at: '2026-10-29T00:30:00Z', owner: null },
      { ...event, at: '2026-10-29T02:00:00+02:00', status: 'retry', error: 'new error' },
      { ...event, at: '2026-10-28T23:30:00Z', status: 'fail', error: 'old error' },
      { ...event, job: 'Z' }, { ...event, job: 'a' }, { ...event, job: 'A' },
    ]);
    const result = readNight(runsDir, night);
    expect(result.kind).toBe('ready');
    if (result.kind !== 'ready') throw new Error('night missing');
    expect(result.rows.map(row => row.job)).toEqual(['A', 'Z', 'a', 'job']);
    expect(result.rows[3]).toEqual({
      job: 'job', owner: null, runs: 3, retries: 1, lastStatus: 'ok', lastError: 'new error',
      firstAt: '2026-10-28T23:30:00Z', lastAt: '2026-10-29T00:30:00Z',
    });
    expect(result.counts).toEqual({ ok: 4, retry: 1, fail: 1 });
  });

  it('breaks equal-instant ties by physical line and keeps a supplied empty error', () => {
    writeEvents([
      { ...event, status: 'fail', error: 'old' },
      { ...event, at: '2026-10-29T00:00:00Z', status: 'retry', error: '' },
      { ...event, at: '2026-10-28T19:00:00-05:00', owner: null },
    ]);
    expect(readNight(runsDir, night)).toMatchObject({
      kind: 'ready', counts: { ok: 1, retry: 1, fail: 1 },
      rows: [{ runs: 3, retries: 1, owner: null, lastStatus: 'ok', lastError: '',
        firstAt: event.at, lastAt: '2026-10-28T19:00:00-05:00' }],
    });
  });

  it('compares fractional seconds precisely and accepts explicit numeric offset forms', () => {
    writeEvents([
      { ...event, at: '2026-10-29T00:00:00.0002Z', owner: 'latest' },
      { ...event, at: '2026-10-29T01:00:00.0001+0100', owner: 'earlier' },
      { ...event, at: '2026-10-29T01:00+01', owner: 'first' },
    ]);
    expect(readNight(runsDir, night)).toMatchObject({ rows: [{
      runs: 3, owner: 'latest', firstAt: '2026-10-29T01:00+01', lastAt: '2026-10-29T00:00:00.0002Z',
    }], badLines: 0 });
  });

  it('counts each malformed JSON or invalid record once, ignoring blank lines and unknown fields', () => {
    const invalid = [null, [], 5, 'text', {},
      { ...event, job: '' }, { ...event, job: 1 }, { ...event, status: 'unknown' },
      { ...event, owner: undefined }, { ...event, owner: 1 }, { ...event, error: null },
      { ...event, error: false }, { ...event, at: 'not a timestamp' },
      { ...event, at: '2026-10-29T00:00:00' }, { ...event, at: '2026-02-30T00:00:00Z' },
      { ...event, at: '2026-10-29T25:00:00Z' }, { ...event, at: '2026-10-29T00:00:00+24:00' },
    ];
    writeEvents([...invalid, { ...event, owner: null, extra: true }]);
    const path = join(runsDir, `${night}.jsonl`);
    writeFileSync(path, '\n \t\r\n{broken\n', { flag: 'a' });
    expect(readNight(runsDir, night)).toMatchObject({
      kind: 'ready', badLines: invalid.length + 1, counts: { ok: 1, retry: 0, fail: 0 },
      rows: [{ owner: null, runs: 1 }],
    });
  });

  it('distinguishes a missing night from empty or entirely malformed files', () => {
    expect(readNight(runsDir, night)).toEqual({ kind: 'missing', night });
    writeFileSync(join(runsDir, `${night}.jsonl`), '\n \r\n');
    expect(readNight(runsDir, night)).toEqual({
      kind: 'ready', night, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 },
    });
    writeFileSync(join(runsDir, `${night}.jsonl`), '{broken\nnull\n');
    expect(readNight(runsDir, night)).toEqual({
      kind: 'ready', night, rows: [], badLines: 2, counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it.each(['../2026-10-28', '/2026-10-28', '2026-10-28/..', '2026-02-29', '2026-04-31',
    '2026-13-01', '2026-00-01', '2026-10-00', '2026-1-01', '2026-10-28\n'])
  ('rejects invalid or unsafe night %j before reading its path', invalidNight => {
    // A directory in place of a file would throw if the reader accessed it.
    if (/^[\d-]+$/.test(invalidNight)) mkdirSync(join(runsDir, `${invalidNight}.jsonl`));
    expect(readNight(runsDir, invalidNight)).toEqual({ kind: 'missing', night: invalidNight });
  });

  it('accepts a real leap day and propagates filesystem errors other than missing files', () => {
    writeFileSync(join(runsDir, '2024-02-29.jsonl'), '');
    expect(readNight(runsDir, '2024-02-29').kind).toBe('ready');
    mkdirSync(join(runsDir, `${night}.jsonl`));
    expect(() => readNight(runsDir, night)).toThrow();
  });
});
