// Copy src/modules/*.js into a temp dir as .mjs so Node can import them.
// This package is CommonJS, and node treats a bare .js file as CommonJS.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const modulesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../src/modules",
);

export async function importSrcModules(names) {
  const tmpDir = mkdtempSync(join(tmpdir(), "grok-check-"));
  for (const name of names) {
    const text = readFileSync(join(modulesDir, `${name}.js`), "utf8").replace(
      /from "(\.\/[^"]+)\.js"/g,
      'from "$1.mjs"',
    );
    writeFileSync(join(tmpDir, `${name}.mjs`), text);
  }
  const imported = {};
  for (const name of names) {
    imported[name] = await import(join(tmpDir, `${name}.mjs`));
  }
  rmSync(tmpDir, { recursive: true, force: true });
  return imported;
}
