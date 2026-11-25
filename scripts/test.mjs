#!/usr/bin/env node
/** Portable Node test runner; no machine-specific directories or browser install. */
import path from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HELP = `Usage: node scripts/test.mjs [--unit] [--strict] [--list]\n\n` +
  `Default: run tests/**/*.test.cjs plus scripts/dev-tools.test.cjs.\n` +
  `--unit    Exclude whole application test files mentioning playwright; keep isolated developer-tool tests.\n` +
  `          This is a coarse file filter, not complete unit coverage.\n` +
  `--strict  Fail if any selected test is skipped; use for full acceptance with browser dependencies installed.\n` +
  `--list    Print selected files without running them.\n` +
  `--help    Show this help.\n\n` +
  `Runs Node --test --test-concurrency=2 (two isolated test-file processes). Cases within each file retain their normal sequential behavior. Browser cases need Playwright and a supported browser.\n` +
  `Default allows existing skips, but skipped browser tests are NOT verified. No dependencies are installed.\n` +
  `NODE_PATH prepends this repository's node_modules and preserves existing NODE_PATH.\n`;

async function walk(directory) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const result = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await walk(file));
    else if (entry.isFile() && entry.name.endsWith('.test.cjs')) result.push(file);
  }
  return result;
}

async function main() {
  const options = new Set(process.argv.slice(2));
  const known = new Set(['--unit', '--strict', '--list', '--help']);
  const unknown = [...options].filter(option => !known.has(option));
  if (unknown.length) { console.error(`Unknown option: ${unknown.join(', ')}\n${HELP}`); process.exitCode = 2; return; }
  if (options.has('--help')) { console.log(HELP); return; }
  const sourceFiles = await walk(path.join(ROOT, 'tests'));
  const files = [...sourceFiles, path.join(ROOT, 'scripts', 'dev-tools.test.cjs')];
  let selected = files;
  if (options.has('--unit')) {
    selected = [];
    for (const file of sourceFiles) if (!/playwright/i.test(await readFile(file, 'utf8'))) selected.push(file);
    selected.push(path.join(ROOT, 'scripts', 'dev-tools.test.cjs'));
  }
  console.log(`[test-runner] ${selected.length} selected files; ${files.length - selected.length} whole files excluded by --unit.`);
  if (!sourceFiles.length) console.warn('[test-runner] No application tests found under tests/. Only developer-tool tests will run. This is not application acceptance.');
  console.log('[test-runner] Browser cases require Playwright and a supported browser. Default permits skips; skipped cases are not verified. Use --strict to reject every selected SKIP.');
  if (options.has('--list')) { for (const file of selected) console.log(path.relative(ROOT, file)); return; }
  if (!selected.length) { console.error('[test-runner] No tests selected.'); process.exitCode = 1; return; }
  const nodePaths = [path.join(ROOT, 'node_modules'), ...(process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean)];
  const env = { ...process.env, NODE_PATH: [...new Set(nodePaths)].join(path.delimiter) };
  // A fresh Mac/Linux clone must not inherit historical Windows Edge defaults.
  // Use the lockfile's installed browser, only when it actually exists.
  if (!env.QUOTE_LEDGER_CHROMIUM_EXECUTABLE) {
    try {
      const browser = createRequire(import.meta.url)('playwright').chromium.executablePath();
      if (existsSync(browser)) env.QUOTE_LEDGER_CHROMIUM_EXECUTABLE = browser;
    } catch { /* Existing tests report missing browser dependencies explicitly. */ }
  }
  // The child already runs in ROOT. Repeating an absolute prefix can exceed
  // the Windows CreateProcess command-line limit for the full test suite.
  const testPaths = selected.map(file => path.relative(ROOT, file));
  const child = spawn(process.execPath, ['--test', '--test-reporter=tap', '--test-concurrency=2', ...testPaths], {
    cwd: ROOT, env, stdio: ['inherit', 'pipe', 'inherit'], windowsHide: true,
  });
  let pending = '', skipped = false;
  const inspect = line => {
    if (/^\s*(?:not )?ok\b.*#\s*SKIP\b/i.test(line) || /^\s*#\s*skipped\s+[1-9]\d*\s*$/i.test(line)) skipped = true;
  };
  child.stdout.on('data', chunk => {
    process.stdout.write(chunk);
    pending += chunk.toString();
    const lines = pending.split(/\r?\n/); pending = lines.pop(); lines.forEach(inspect);
  });
  const exit = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  inspect(pending);
  if (exit.signal) console.error(`[test-runner] Test process terminated by ${exit.signal}.`);
  if (skipped) console.warn('[test-runner] SKIP observed: these cases did not run and are not verified.');
  if (options.has('--strict') && skipped) console.error('[test-runner] --strict rejects skipped tests.');
  process.exitCode = exit.code === 0 && !exit.signal && !(options.has('--strict') && skipped) ? 0 : 1;
}

main().catch(error => { console.error(`[test-runner] ${error.message}`); process.exitCode = 1; });
