#!/usr/bin/env node
/**
 * Check the committed WebAssembly module without the toolchain that built it.
 *
 * `public/wasm/manifest-socket.wasm` needs Samsung's own fork of Emscripten, which cannot be
 * installed in CI, so the module and its glue are committed and this stands in for a rebuild. It
 * proves three things, each of which has been wrong at some point:
 *
 * The module is valid WebAssembly and the browser will compile it, which catches a truncated or
 * corrupted binary from a bad merge or a checkout without the binary attribute.
 *
 * The four C functions the application calls are still exported. The wasm's own export names are
 * single letters, because the build minifies them, so this reads the glue where the real names live.
 *
 * Every socket function the glue asks the host for is supplied by the worker. This is the one that
 * matters. Samsung's SDK maps those calls onto `tizentvwasm.SocketsHostBindings` itself, but only
 * links the mapping under conditions this build does not meet, so the glue emits bare `__wasm_*`
 * globals and the worker defines them. When they last disagreed the module died on the television
 * with `ReferenceError: __wasm_accept is not defined`, and nothing on a laptop noticed.
 *
 * Run by CI and by `npm run wasm:check`. Exits 1 with a plain sentence about what is wrong.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const GLUE = "public/wasm/manifest-socket.js";
const WORKER = "public/wasm/manifest-socket.worker.js";
const MODULE = "public/wasm/manifest-socket.wasm";
const SOURCE = "wasm/manifest-socket.c";
const SUMS = "wasm/checksums.txt";

/**
 * Rewrite the checksums, header and all, when the module has been deliberately rebuilt.
 *
 * Here rather than as a shell one liner in package.json, which is how it was first written and how
 * it broke: `npm run` prints two lines of its own before the command's output, and redirecting that
 * into the file left npm's banner in the middle of it, which shasum then reported as malformed lines
 * while still checking the four real ones.
 */
const HEADER = `# What the committed WebAssembly was built from, so a change to one without the other is caught.
#
# The module needs Samsung's own fork of Emscripten, which CI cannot install, so the built files are
# committed and this file ties them to the source. Editing the C without rebuilding, or replacing a
# binary without touching the C, fails the check until somebody regenerates this deliberately.
#
# The build recipe, including the two patches Samsung's SDK needs, is in docs/testing.md.
# Regenerate with: npm run wasm:sums
`;

if (process.argv.includes("--write")) {
  const lines = [SOURCE, GLUE, MODULE, WORKER].map((file) => {
    const digest = createHash("sha256").update(readFileSync(file)).digest("hex");
    return `${digest}  ${file}`;
  });
  writeFileSync(SUMS, `${HEADER}${lines.join("\n")}\n`);
  console.log(`Recorded ${lines.length} checksums in ${SUMS}.`);
  process.exit(0);
}

/** The C the application drives through cwrap, from services/repair by way of the worker. */
const REQUIRED_EXPORTS = ["_set_manifest", "_start_server", "_serve_once", "_stop_server"];

/**
 * Emscripten's own name for the module's static constructor call.
 *
 * It looks exactly like the socket bindings and is nothing like them: it is exported by the wasm
 * rather than asked of the host, so the worker neither defines it nor should.
 */
const NOT_A_HOST_BINDING = new Set(["__wasm_call_ctors"]);

const complaints = [];
const glue = readFileSync(GLUE, "utf8");
const worker = readFileSync(WORKER, "utf8");

const module_ = readFileSync(MODULE);
try {
  await WebAssembly.compile(module_);
} catch (error) {
  complaints.push(`${MODULE} is not something a browser will compile: ${error.message}`);
}

for (const name of REQUIRED_EXPORTS) {
  if (!glue.includes(name)) complaints.push(`${GLUE} no longer exports ${name}`);
}

const asked = new Set(
  [...glue.matchAll(/__wasm_[a-z_]+/g)].map(([name]) => name).filter((n) => !NOT_A_HOST_BINDING.has(n)),
);
const supplied = new Set([...worker.matchAll(/__wasm_[a-z_]+:/g)].map(([match]) => match.slice(0, -1)));

for (const name of asked) {
  if (!supplied.has(name)) {
    complaints.push(`${GLUE} asks the host for ${name} and ${WORKER} does not supply it`);
  }
}
for (const name of supplied) {
  // Not a failure. A binding nothing asks for is dead weight rather than a fault, and saying so is
  // cheaper than someone later wondering whether it is load bearing.
  if (!asked.has(name)) console.log(`  note: ${WORKER} supplies ${name}, which the module never asks for`);
}

if (complaints.length) {
  console.error("The committed WebAssembly does not hold together:\n");
  for (const complaint of complaints) console.error(`  ${complaint}`);
  console.error("\nRebuild it with the recipe in docs/testing.md, or restore the committed files.");
  process.exit(1);
}

console.log(
  `WebAssembly is consistent: ${module_.length} bytes compile, ${REQUIRED_EXPORTS.length} exports`
  + ` present, ${asked.size} host socket functions asked for and all supplied.`,
);
