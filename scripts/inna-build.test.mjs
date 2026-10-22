import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { compactCss, refreshBundleHashes, buildBundles, CSS_INPUTS, JS_INPUTS } from './inna-build.mjs';

test('CSS formatting does not change calc, descendant selectors, or custom properties', () => {
  const original = '\n .card :hover {\n  width: calc(100% - 20px);\n  --gradient: linear-gradient(90deg, #fff 0%, #000 100%);\n}\n';
  assert.equal(compactCss(original), '.card :hover{width: calc(100% - 20px);--gradient: linear-gradient(90deg, #fff 0%, #000 100%);}\n');
});

test('CSS quoted strings and URLs remain exact', () => {
  const original = String.raw`.x { content: "a  b\\\"c"; background: url("data:image/svg+xml,<svg a='1  2'>/* untouched */</svg>"); }`;
  const compact = compactCss(original);
  assert.ok(compact.includes(String.raw`"a  b\\\"c"`));
  assert.ok(compact.includes(`url("data:image/svg+xml,<svg a='1  2'>/* untouched */</svg>")`));
});

test('token-boundary comments and license comments are retained', () => {
  assert.equal(compactCss('/*! keep */\n .a/**/.b { color: red; }\n/* note */\n .c { color: blue; }'), '/*! keep */ .a/**/.b{color: red;}.c{color: blue;}\n');
});

test('escaped selectors and hex-escape terminators remain unchanged', () => {
  const original = String.raw`.\31  a, .foo\ bar { color: red; }`;
  assert.equal(compactCss(original), String.raw`.\31  a, .foo\ bar{color: red;}` + '\n');
});

test('Unicode spaces in CSS identifiers are not treated as formatting', () => {
  assert.equal(compactCss('.a\u00a0\u00a0b { color: red; }'), '.a\u00a0\u00a0b{color: red;}\n');
});

test('malformed CSS fails rather than silently altering sources', () => {
  assert.throws(() => compactCss('.x { /* unclosed'), /Unterminated CSS comment/);
  assert.throws(() => compactCss('.x { content: "unclosed'), /Unterminated CSS string/);
});

test('only existing bundle tags receive fresh hash versions', () => {
  const html = '<link rel="stylesheet" href="styles.css?v=original">\n'
    + '<link rel="stylesheet" href="site.min.css?v=old&mode=1#sheet">\n'
    + "<script src='site.min.js' defer></script>\n"
    + '<script src="app.js?v=original"></script>';
  const updated = refreshBundleHashes(html, { 'site.min.css': 'csshash', 'site.min.js': 'jshash' });
  assert.ok(updated.includes('href="styles.css?v=original"'));
  assert.ok(updated.includes('href="site.min.css?v=csshash&mode=1#sheet"'));
  assert.ok(updated.includes("src='site.min.js?v=jshash' defer"));
  assert.ok(updated.includes('src="app.js?v=original"'));
  assert.equal(refreshBundleHashes(updated, { 'site.min.css': 'csshash', 'site.min.js': 'jshash' }), updated);
});

test('non-bundled HTML is not modified and missing bundle hashes fail', () => {
  const html = '<link href="styles.css?v=1"><script src="app.js"></script>';
  assert.equal(refreshBundleHashes(html, {}), html);
  assert.throws(() => refreshBundleHashes('<link href="site.min.css">', {}), /Missing content hash/);
});

test('generated bundles and compression sidecars are mirrored and reversible', async () => {
  assert.equal(CSS_INPUTS.length, 12);
  assert.equal(CSS_INPUTS[0], 'fonts.css');
  assert.equal(CSS_INPUTS.at(-1), 'scroll-reveal.css');
  assert.equal(CSS_INPUTS.at(-2), 'problem-refresh-v2.css');
  assert.equal(JS_INPUTS.length, 4);
  assert.equal(JS_INPUTS.at(-1), 'scroll-reveal.js');
  for (const name of ['site.min.css', 'site.min.js']) {
    const source = new URL(`../sites/inna-volos/${name}`, import.meta.url);
    const output = new URL(`../public/inna-volos/${name}`, import.meta.url);
    const plain = await readFile(source);
    assert.deepEqual(await readFile(output), plain);
    for (const [extension, decompress] of [['gz', gunzipSync], ['br', brotliDecompressSync]]) {
      const compressed = await readFile(new URL(`../sites/inna-volos/${name}.${extension}`, import.meta.url));
      assert.deepEqual(decompress(compressed), plain);
    }
  }
});

test('HTML hash references and compressed sidecars are current', async () => {
  const report = await buildBundles({ check: true });
  assert.equal(report.checked, true);
  assert.equal(report.html.updatedPages, 0);
  for (const directory of ['sites', 'public']) {
    const html = await readFile(new URL(`../${directory}/inna-volos/index.html`, import.meta.url));
    for (const [extension, decompress] of [['gz', gunzipSync], ['br', brotliDecompressSync]]) {
      const compressed = await readFile(new URL(`../${directory}/inna-volos/index.html.${extension}`, import.meta.url));
      assert.deepEqual(decompress(compressed), html);
    }
  }
});
