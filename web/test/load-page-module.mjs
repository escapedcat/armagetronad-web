// Loads one of web/page/*.js the way the page does -- as a plain script that
// defines a global -- into a fresh vm context, and returns that global.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

export const repoPath = (rel) => fileURLToPath(new URL('../../' + rel, import.meta.url));
export const readRepoFile = (rel) => readFileSync(repoPath(rel), 'utf8');

export function loadPageModule(file, globalName, sandbox = {}) {
  const context = vm.createContext({ ...sandbox });
  vm.runInContext(readRepoFile(file), context, { filename: file });
  if (!(globalName in context)) throw new Error(file + ' did not define ' + globalName);
  return context[globalName];
}
