import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const extra = process.argv.slice(2);
const host = extra.some(value => ['--offline', '--tunnel', '--localhost', '--lan', '--host'].includes(value)) ? [] : ['--lan'];
const child = spawn(process.execPath, [require.resolve('expo/bin/cli'), 'start', '--go', ...host, '--port', '8083', ...extra], {
  stdio: 'inherit', env: process.env,
});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 0; });
