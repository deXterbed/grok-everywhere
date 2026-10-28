// Minimal self-check for inline-math detection in src/modules/markdown.js:
// currency must stay text, real math must still render. The module imports
// "katex", so it's bundled to a temp ESM file rather than imported directly
// (node treats bare .js as CommonJS in this package). Run with: npm test
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(tmpdir(), "grok-markdown-"));
const outfile = join(outDir, "markdown.mjs");

let parseMarkdown;
try {
  await build({
    entryPoints: [join(root, "src/modules/markdown.js")],
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
    outfile,
  });
  ({ parseMarkdown } = await import(pathToFileURL(outfile).href));
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

const mathCount = (html) => (html.match(/<span class="katex">/g) || []).length;

// Currency ranges/prices must stay plain text. These used to be captured as
// inline math ("$5–$10" → math "5–"), which mangled the answer and logged
// KaTeX's "Unrecognized Unicode character" warning for the en dash.
const currency = [
  ["Costs $5–$10 per month", "$5–$10"],
  [
    "Raised between $88 million and $120 million",
    "$88 million and $120 million",
  ],
  ["I paid $5, then $1 more", "$5, then $1"],
];
for (const [text, expected] of currency) {
  const html = parseMarkdown(text);
  assert.ok(html.includes(expected), `currency must stay text: ${text}`);
  assert.equal(mathCount(html), 0, `currency must not render as math: ${text}`);
}

// Real math still renders, and is still detected next to currency on the
// same line (the matcher must not span across other "$" signs).
assert.equal(mathCount(parseMarkdown("Formula $x^2$ here")), 1);
assert.equal(mathCount(parseMarkdown("$a$ and $b$")), 2);
const mixed = parseMarkdown("I paid $5, then $x^2$ explains it");
assert.ok(mixed.includes("$5, then"), "currency stays text alongside math");
assert.equal(mathCount(mixed), 1, "inline math after currency still renders");

// Display math is unaffected.
assert.ok(parseMarkdown("$$x^2$$").includes("katex-display"));

// Math inside code is code: neither fenced blocks nor inline code spans may
// be rendered through KaTeX.
const fenced = parseMarkdown("```\n$x^2$\n```");
assert.ok(fenced.includes("<pre><code>$x^2$</code></pre>"), fenced);
assert.equal(mathCount(fenced), 0, "fenced code must not render as math");

const inline = parseMarkdown("Use `$x^2$` here");
assert.ok(inline.includes("<code>$x^2$</code>"), inline);
assert.equal(mathCount(inline), 0, "inline code must not render as math");

// Code protection must not swallow math outside the code.
const fenceThenMath = parseMarkdown("```\n$x$\n```\nformula $y^2$");
assert.equal(
  mathCount(fenceThenMath),
  1,
  "math after a code block still renders"
);

// Fenced blocks keep their language hint and render as code.
const closedFence = parseMarkdown("```js\nconst x = 1;\n```");
assert.ok(closedFence.includes('<pre><code class="language-js">'), closedFence);

// A fence with no closing ``` yet (normal mid-stream) must still render its
// content instead of dropping everything after the opening fence.
const unclosed = parseMarkdown("before\n```\nconst x = 1;");
assert.ok(unclosed.includes("<p>before</p>"), unclosed);
assert.ok(unclosed.includes("const x = 1;"), unclosed);
assert.equal(
  mathCount(parseMarkdown("```\n$x^2$\n")),
  0,
  "math inside an unclosed fence stays code"
);

console.log("check-markdown: all assertions passed");
