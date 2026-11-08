import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';
import type { ReadNightResult } from '../src/digest/types.js';

const night = '2026-10-31';
const tempDirs: string[] = [];

function createRig() {
  const root = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));
  tempDirs.push(root);
  const runsDir = join(root, 'runs');
  mkdirSync(runsDir);
  const app = createApp({
    adapter: 'test',
    installed: '2026-10-29T14:06:00+01:00',
    beatEverySeconds: 60,
    runsDir,
  });

  return {
    app,
    writeNight(contents: string) {
      writeFileSync(join(runsDir, `${night}.jsonl`), contents);
    },
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('digest routes', () => {
  it('serves ordered rows as HTML and JSON with matching data and visible warnings', async () => {
    const rig = createRig();
    rig.writeNight(
      [
        JSON.stringify({ job: 'z<&script>', at: '2026-10-31T09:00:00+02:00', status: 'retry', owner: 'builder' }),
        JSON.stringify({ job: 'z<&script>', at: '2026-10-31T09:05:00+02:00', status: 'retry', owner: 'builder', error: '<script>alert(1)</script>' }),
        JSON.stringify({ job: 'z<&script>', at: '2026-10-31T09:10:00+02:00', status: 'retry', owner: 'builder' }),
        JSON.stringify({ job: 'z<&script>', at: '2026-10-31T05:30:00-04:00', status: 'ok', owner: null }),
        JSON.stringify({ job: 'alpha', at: '2026-10-31T08:00:00Z', status: 'fail', owner: 'runner' }),
      ].join('\n'),
    );

    const [htmlResponse, jsonResponse] = await Promise.all([
      rig.app.request(`/digest/${night}`),
      rig.app.request(`/api/digest/${night}`),
    ]);
    const html = await htmlResponse.text();
    const json = (await jsonResponse.json()) as ReadNightResult;

    expect(htmlResponse.status).toBe(200);
    expect(jsonResponse.status).toBe(200);
    expect(json.kind).toBe('ready');
    if (json.kind !== 'ready') throw new Error('expected a ready digest');

    expect(json.rows.map((row) => row.job)).toEqual(['alpha', 'z<&script>']);
    expect(html.indexOf('<td>alpha</td>')).toBeGreaterThan(-1);
    expect(html.indexOf('<td>alpha</td>')).toBeLessThan(html.indexOf('z&lt;&amp;script&gt;'));
    expect(json.rows[1]).toMatchObject({
      owner: null,
      runs: 4,
      retries: 3,
      lastStatus: 'ok',
      lastError: '<script>alert(1)</script>',
      firstAt: '2026-10-31T09:00:00+02:00',
      lastAt: '2026-10-31T05:30:00-04:00',
    });
    expect(html).toContain('<td>—</td>');
    expect(html).toContain('2026-10-31T09:00:00+02:00');
    expect(html).toContain('2026-10-31T05:30:00-04:00');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html.match(/<tr class="warn">/g)).toHaveLength(2);
    expect(html).toContain('<td>fail</td>');
    expect(html).toContain('<td>ok</td>');
  });

  it('returns readable HTML and a missing result as 404 when no night exists', async () => {
    const rig = createRig();
    const [htmlResponse, jsonResponse] = await Promise.all([
      rig.app.request(`/digest/${night}`),
      rig.app.request(`/api/digest/${night}`),
    ]);

    expect(htmlResponse.status).toBe(404);
    expect(await htmlResponse.text()).toContain('No run log found for this night.');
    expect(jsonResponse.status).toBe(404);
    expect(await jsonResponse.json()).toEqual({ kind: 'missing', night });
  });

  it('renders an empty night as nothing ran and returns zero counts', async () => {
    const rig = createRig();
    rig.writeNight('');
    const [htmlResponse, jsonResponse] = await Promise.all([
      rig.app.request(`/digest/${night}`),
      rig.app.request(`/api/digest/${night}`),
    ]);
    const json = (await jsonResponse.json()) as ReadNightResult;

    expect(htmlResponse.status).toBe(200);
    expect(await htmlResponse.text()).toContain('nothing ran');
    expect(jsonResponse.status).toBe(200);
    expect(json).toMatchObject({
      kind: 'ready',
      night,
      rows: [],
      badLines: 0,
      counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('shows malformed-line count without hiding a valid row', async () => {
    const rig = createRig();
    rig.writeNight(
      [
        'not json',
        JSON.stringify({ job: 'valid-job', at: '2026-10-31T10:00:00+02:00', status: 'ok', owner: 'runner' }),
      ].join('\n'),
    );
    const [htmlResponse, jsonResponse] = await Promise.all([
      rig.app.request(`/digest/${night}`),
      rig.app.request(`/api/digest/${night}`),
    ]);
    const html = await htmlResponse.text();
    const json = (await jsonResponse.json()) as ReadNightResult;

    expect(htmlResponse.status).toBe(200);
    expect(html).toContain('1 malformed line skipped');
    expect(html).toContain('<td>valid-job</td>');
    expect(jsonResponse.status).toBe(200);
    expect(json).toMatchObject({ kind: 'ready', badLines: 1 });
  });
});
