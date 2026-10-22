import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { Script } from 'node:vm';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';

// Keep these editable sources in their original cascade / execution order.
// No third-party package, network access, selector pruning, or CSS rewriting is used.
export const CSS_INPUTS = Object.freeze([
  'fonts.css',
  'styles.css',
  'audience.css',
  'reviews.css',
  'hero-reference.css',
  'section-system.css',
  'requests-motion.css',
  'process-editorial-v1.css',
  'premium-buttons.css',
  'performance.css',
  'scroll-reveal.css',
]);
export const JS_INPUTS = Object.freeze(['app.js', 'requests-motion.js', 'performance-motion.js', 'scroll-reveal.js']);

const workspace = fileURLToPath(new URL('../', import.meta.url));
const sourceDirectory = resolve(workspace, 'sites/inna-volos');
const outputDirectory = resolve(workspace, 'public/inna-volos');
// CSS whitespace is ASCII; NBSP and other Unicode spaces may be identifiers.
const whitespace = /[\t\n\f\r ]/;
const optionalSpaceBoundary = /[{};]/;
const hexadecimal = /[\da-f]/i;

// This intentionally conservative scanner changes formatting only. It keeps
// strings, escapes, calc() operators, selector descendant spaces, custom
// properties, and comments between adjacent tokens unchanged.
export function compactCss(source) {
  let result = '';
  let pendingSpace = false;
  let index = 0;

  const append = (text) => {
    if (pendingSpace && result
      && !optionalSpaceBoundary.test(result.at(-1))
      && !optionalSpaceBoundary.test(text[0])) {
      result += ' ';
    }
    pendingSpace = false;
    result += text;
  };

  while (index < source.length) {
    const character = source[index];

    if (whitespace.test(character)) {
      pendingSpace = true;
      index += 1;
      continue;
    }

    if (character === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2);
      if (end < 0) throw new Error('Unterminated CSS comment');
      const comment = source.slice(index, end + 2);
      const before = source[index - 1];
      const after = source[end + 2];
      const adjacentToWhitespace = before === undefined || after === undefined
        || whitespace.test(before) || whitespace.test(after);
      if (comment.startsWith('/*!') || !adjacentToWhitespace) {
        append(comment);
      } else {
        pendingSpace = true;
      }
      index = end + 2;
      continue;
    }

    if (character === '"' || character === "'") {
      const start = index;
      const quote = character;
      let closed = false;
      index += 1;
      while (index < source.length) {
        if (source[index] === '\\') {
          index += 2;
        } else if (source[index++] === quote) {
          closed = true;
          break;
        }
      }
      if (!closed) throw new Error('Unterminated CSS string');
      append(source.slice(start, index));
      continue;
    }

    if (character === '\\') {
      const start = index++;
      let digits = 0;
      while (digits < 6 && index < source.length && hexadecimal.test(source[index])) {
        digits += 1;
        index += 1;
      }
      if (!digits && index < source.length) {
        index += 1;
      } else if (index < source.length && whitespace.test(source[index])) {
        // A hex escape consumes exactly one following whitespace character.
        if (source[index] === '\r' && source[index + 1] === '\n') index += 1;
        index += 1;
      }
      append(source.slice(start, index));
      continue;
    }

    append(character);
    index += 1;
  }

  return `${result}\n`;
}

function compress(buffer) {
  return {
    plain: buffer,
    gzip: gzipSync(buffer, { level: 9 }),
    brotli: brotliCompressSync(buffer, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: 11,
        [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
      },
    }),
  };
}

// Mechanical cache-version refresh only. The caller must first opt into the
// bundles in HTML; individual source stylesheet/script tags are never replaced.
export function refreshBundleHashes(html, hashes) {
  return html.replace(
    /(<(?:link|script)\b[^>]*?\b(?:href|src)\s*=\s*)(["'])(site\.min\.(?:css|js))([?#][^"']*)?\2/gi,
    (match, prefix, quote, name, suffix = '') => {
      const hash = hashes[name.toLowerCase()];
      if (!hash) throw new Error(`Missing content hash for ${name}`);
      const fragmentStart = suffix.indexOf('#');
      const fragment = fragmentStart < 0 ? '' : suffix.slice(fragmentStart);
      const search = (fragmentStart < 0 ? suffix : suffix.slice(0, fragmentStart)).replace(/^\?/, '');
      const parameters = search ? search.split('&') : [];
      let found = false;
      const updated = parameters.map((parameter) => {
        if (!/^v(?:=|$)/.test(parameter)) return parameter;
        found = true;
        return `v=${hash}`;
      });
      if (!found) updated.push(`v=${hash}`);
      return `${prefix}${quote}${name}?${updated.join('&')}${fragment}${quote}`;
    },
  );
}

export async function buildBundles({ check = false } = {}) {
  const readInputs = async (names) => Promise.all(names.map(async (name) => ({
    name,
    content: await readFile(resolve(sourceDirectory, name), 'utf8'),
  })));
  const [cssSources, jsSources] = await Promise.all([readInputs(CSS_INPUTS), readInputs(JS_INPUTS)]);

  if (cssSources.some(({ content }) => /@(?:charset|import)\b/i.test(content))) {
    throw new Error('CSS @charset / @import requires an explicit bundler update');
  }

  jsSources.forEach(({ name, content }) => new Script(content, { filename: name }));
  const css = cssSources.map(({ name, content }) => `/* ${name} */\n${compactCss(content)}`).join('');
  // Preserve JS source structure instead of risking semantic changes with an
  // ad-hoc JS minifier. Compression provides the transfer-size reduction.
  const js = jsSources.map(({ name, content }) => `/* ${name} */\n${content.trim()}\n;\n`).join('');
  new Script(js, { filename: 'site.min.js' });

  const bundles = [
    { name: 'site.min.css', sources: cssSources, content: css, strategy: 'conservative-formatting-only' },
    { name: 'site.min.js', sources: jsSources, content: js, strategy: 'syntax-checked-concatenation' },
  ];
  const report = { checked: check, sourceRequests: CSS_INPUTS.length + JS_INPUTS.length, bundleRequests: 2, bundles: [] };

  for (const { name, sources, content, strategy } of bundles) {
    const outputs = compress(Buffer.from(content));
    const variants = [[name, outputs.plain], [`${name}.gz`, outputs.gzip], [`${name}.br`, outputs.brotli]];
    for (const directory of [sourceDirectory, outputDirectory]) {
      for (const [fileName, bytes] of variants) {
        const target = resolve(directory, fileName);
        if (check) {
          const current = await readFile(target);
          if (!current.equals(bytes)) throw new Error(`${target} is stale; run node scripts/inna-build.mjs`);
        } else {
          await writeFile(target, bytes);
        }
      }
    }
    report.bundles.push({
      name,
      hash: createHash('sha256').update(outputs.plain).digest('hex').slice(0, 16),
      strategy,
      inputs: sources.map(({ name }) => name),
      sourceBytes: sources.reduce((sum, { content }) => sum + Buffer.byteLength(content), 0),
      bytes: outputs.plain.length,
      gzipBytes: outputs.gzip.length,
      brotliBytes: outputs.brotli.length,
    });
  }

  const hashes = Object.fromEntries(report.bundles.map(({ name, hash }) => [name, hash]));
  const pages = await Promise.all([sourceDirectory, outputDirectory].map(async (directory) => {
    const target = resolve(directory, 'index.html');
    const current = await readFile(target, 'utf8');
    const updated = refreshBundleHashes(current, hashes);
    if (check && current !== updated) {
      throw new Error(`${target} has stale bundle link hashes; run node scripts/inna-build.mjs`);
    }
    return { target, current, updated, directory };
  }));
  if (pages[0].updated !== pages[1].updated) {
    throw new Error('Source and served index.html differ; mirror the intended HTML changes before building');
  }

  // HTML is compressed after its content-hash references have been refreshed.
  const htmlOutputs = compress(Buffer.from(pages[0].updated));
  for (const { target, current, updated, directory } of pages) {
    if (!check && current !== updated) await writeFile(target, updated);
    for (const [extension, bytes] of [['gz', htmlOutputs.gzip], ['br', htmlOutputs.brotli]]) {
      const sidecar = resolve(directory, `index.html.${extension}`);
      if (check) {
        if (!(await readFile(sidecar)).equals(bytes)) {
          throw new Error(`${sidecar} is stale; run node scripts/inna-build.mjs`);
        }
      } else {
        await writeFile(sidecar, bytes);
      }
    }
  }
  report.html = {
    name: 'index.html',
    hash: createHash('sha256').update(htmlOutputs.plain).digest('hex').slice(0, 16),
    bytes: htmlOutputs.plain.length,
    gzipBytes: htmlOutputs.gzip.length,
    brotliBytes: htmlOutputs.brotli.length,
    updatedPages: pages.filter(({ current, updated }) => current !== updated).length,
  };
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const unexpected = process.argv.slice(2).filter((argument) => argument !== '--check');
  if (unexpected.length) throw new Error(`Unknown arguments: ${unexpected.join(' ')}`);
  console.log(JSON.stringify(await buildBundles({ check: process.argv.includes('--check') }), null, 2));
}
