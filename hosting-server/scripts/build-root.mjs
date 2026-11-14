import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

const hosting = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(hosting, "..");
const source = join(root, "dist");
const runtime = join(hosting, ".sites-runtime", "root-builds", randomUUID());
const allowedDirectories = new Set(["workpaper-layouts", "workpaper-word-layouts", "word-layouts"]);

function confined(base, destination) {
  const rel = relative(base, destination);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error("Build path escaped its owned output root");
}

function regularTree(directory) {
  if (lstatSync(directory).isSymbolicLink()) throw new Error("Build source cannot contain symlinks");
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error("Build source cannot contain symlinks");
    if (entry.isDirectory()) regularTree(file);
    else if (!entry.isFile()) throw new Error("Build source must contain regular files only");
  }
}

if (realpathSync(process.cwd()) !== realpathSync(root)) throw new Error("Run the root build from the selected Site checkout");
if (!statSync(source).isDirectory() || lstatSync(source).isSymbolicLink()) throw new Error("Original static dist source is missing or unsafe");
confined(hosting, runtime);
mkdirSync(runtime, { recursive: true });
const stagedPublic = join(runtime, "public-next");
mkdirSync(stagedPublic);
let staticFiles = 0;
for (const entry of readdirSync(source, { withFileTypes: true })) {
  if (entry.name.startsWith(".") || entry.name === "client" || entry.name === "server") continue;
  const from = join(source, entry.name);
  if (entry.isSymbolicLink()) throw new Error("Original static source cannot contain symlinks");
  if (entry.isFile()) {
    cpSync(from, join(stagedPublic, entry.name), { force: false, errorOnExist: true });
    staticFiles++;
  } else if (entry.isDirectory() && allowedDirectories.has(entry.name)) {
    regularTree(from);
    cpSync(from, join(stagedPublic, entry.name), { recursive: true, force: false, errorOnExist: true });
  } else throw new Error("Unexpected original static directory: review asset staging allowlist before building");
}
if (!existsSync(join(stagedPublic, "index.html"))) throw new Error("Original index.html must be preserved");

// Keep the previous generated public copy; never delete the original root dist.
const publicDirectory = join(hosting, "public");
confined(hosting, publicDirectory);
if (existsSync(publicDirectory)) {
  regularTree(publicDirectory);
  const previous = join(runtime, "public-before");
  confined(hosting, previous);
  renameSync(publicDirectory, previous);
}
renameSync(stagedPublic, publicDirectory);

const rootManifest = join(root, ".openai", "hosting.json");
const manifest = JSON.parse(readFileSync(rootManifest, "utf8"));
if (!manifest.project_id || manifest.static || manifest.d1 !== "DB") throw new Error("Root manifest must retain the Site identity and declare the account D1 Worker binding");
const nestedManifest = join(hosting, ".openai", "hosting.json");
if (readFileSync(nestedManifest, "utf8") !== readFileSync(rootManifest, "utf8")) {
  cpSync(nestedManifest, join(runtime, "hosting-before.json"));
  const temporary = `${nestedManifest}.tmp-${randomUUID()}`;
  writeFileSync(temporary, readFileSync(rootManifest), { flag: "wx" });
  renameSync(temporary, nestedManifest);
}

// Invoke the unmodified official starter build entrypoint with its installed lockfile.
const result = spawnSync(process.execPath, [join(hosting, "scripts", "run-framework.mjs"), "build"], { cwd: hosting, stdio: "inherit", env: process.env });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

// Replace only generated Worker deployment trees. Original flat assets stay put.
for (const name of ["client", "server", ".openai"]) {
  const from = join(hosting, "dist", name);
  const target = join(source, name);
  if (!existsSync(from)) throw new Error("Official starter did not produce required deployment tree: " + name);
  regularTree(from);
  confined(source, target);
  const next = join(source, `${name}.tmp-${randomUUID()}`);
  confined(source, next);
  cpSync(from, next, { recursive: true, force: false, errorOnExist: true });
  if (existsSync(target)) {
    regularTree(target);
    const previous = join(runtime, name + "-before");
    confined(hosting, previous);
    renameSync(target, previous);
  }
  renameSync(next, target);
}
console.log(JSON.stringify({ originalStaticRootPreserved: true, topLevelStaticFiles: staticFiles, workerEntry: "dist/server/index.js", staticAssetDirectory: "dist/client", bindings: { d1: "DB", r2: null }, profileOnly: true }));
