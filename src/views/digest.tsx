import type { ReadNightResult } from '../digest/types.js';

type ReadyNight = Extract<ReadNightResult, { kind: 'ready' }>;

export function DigestPage({ result }: { result: ReadyNight }) {
  return (
    <>
      <h1>digest · {result.night}</h1>
      <p>
        ok {result.counts.ok} · retry {result.counts.retry} · fail {result.counts.fail}
      </p>
      {result.badLines > 0 ? (
        <p class="warn">{result.badLines} malformed {result.badLines === 1 ? 'line' : 'lines'} skipped</p>
      ) : null}
      {result.rows.length === 0 ? (
        <p class="mute">nothing ran</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>job</th>
              <th>owner</th>
              <th>runs</th>
              <th>retries</th>
              <th>last status</th>
              <th>last error</th>
              <th>first at</th>
              <th>last at</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row) => {
              const warn = row.retries >= 3 || row.lastStatus === 'fail';
              return (
                <tr class={warn ? 'warn' : undefined}>
                  <td>{row.job}</td>
                  <td>{row.owner ?? '—'}</td>
                  <td>{row.runs}</td>
                  <td>{row.retries}</td>
                  <td>{row.lastStatus}</td>
                  <td>{row.lastError ?? '—'}</td>
                  <td>{row.firstAt}</td>
                  <td>{row.lastAt}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}

export function DigestMissing({ night }: { night: string }) {
  return (
    <>
      <h1>digest · {night}</h1>
      <p class="warn">No run log found for this night.</p>
    </>
  );
}
