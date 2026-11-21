// Publication log: the same video does not go to one platform twice.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const key = (file) => {
  const p = resolve(String(file)).replace(/\\/g, '/');
  return process.platform === 'win32' ? p.toLowerCase() : p;
};

export function createLog(path) {
  const all = () => (existsSync(path)
    ? readFileSync(path, 'utf8').split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
    : []);
  return {
    all,
    was: (file, platform) => all().some((r) => r.platform === platform && key(r.file) === key(file)),
    add(rec) {
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, JSON.stringify({ at: new Date().toISOString(), ...rec }) + '\n');
    },
  };
}
