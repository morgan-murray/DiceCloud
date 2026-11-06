import { spawn } from 'node:child_process';
import path from 'node:path';
export const workerPath = () => process.env.AURORA_IMPORTER_PATH || '/opt/dicecloud/importer/worker.py';
export function runWorker(request) {
  return new Promise((resolve, reject) => {
    const input = JSON.stringify(request);
    if (Buffer.byteLength(input) > 14 * 1024 ** 2) return reject(new Meteor.Error('aurora-size', 'Import input exceeds 14 MiB.'));
    const child = spawn(process.env.AURORA_PYTHON || '/usr/local/bin/python3', ['-I', '-B', workerPath()], {
      cwd: path.dirname(workerPath()), env: { PATH: '/usr/local/bin:/usr/bin:/bin', PYTHONDONTWRITEBYTECODE: '1', LANG: 'C.UTF-8' },
      stdio: ['pipe', 'pipe', 'pipe'], shell: false,
    });
    let output = [], bytes = 0, settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (error) { child.kill('SIGKILL'); reject(error); } else resolve(result);
    };
    const timer = setTimeout(() => finish(new Meteor.Error('aurora-timeout', 'Import exceeded its time limit.')), 15000);
    child.on('error', () => finish(new Meteor.Error('aurora-worker', 'The import worker is unavailable.')));
    child.stdin.on('error', () => {});
    child.stderr.on('data', () => {}); // Never log private XML or worker payloads.
    child.stdout.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > 2 * 1024 ** 2) finish(new Meteor.Error('aurora-output', 'Import result exceeds its limit.'));
      else output.push(chunk);
    });
    child.on('close', code => {
      if (settled) return;
      if (code !== 0) return finish(new Meteor.Error('aurora-worker', 'The import worker stopped before completing.'));
      try { finish(null, JSON.parse(Buffer.concat(output).toString('utf8'))); }
      catch { finish(new Meteor.Error('aurora-worker', 'Invalid worker response.')); }
    });
    child.stdin.end(input);
  });
}
