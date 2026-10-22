import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { relative, isAbsolute } from 'node:path';
import { CSS_INPUTS, JS_INPUTS } from './inna-build.mjs';

const sourceRoot = new URL('../sites/inna-volos/', import.meta.url);
const servedRoot = new URL('../public/inna-volos/', import.meta.url);
const html = await readFile(new URL('index.html', sourceRoot), 'utf8');
const css = await readFile(new URL('site.min.css', sourceRoot), 'utf8');

// The site is buildless HTML; inspect quoted start tags without adding a DOM
// package or executing page scripts. Quoted SVG/data-URI values stay intact.
function startTags(document) {
  return [...document.matchAll(/<([a-z][\w:-]*)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi)].map(([tag, name]) => {
    const attributes = new Map();
    const body = tag.slice(name.length + 1, -1);
    for (const [, key, double, single, unquoted] of body.matchAll(/(?:^|\s)([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
      attributes.set(key.toLowerCase(), double ?? single ?? unquoted ?? '');
    }
    return { name: name.toLowerCase(), attributes };
  });
}

const tags = startTags(html);
const hasClass = ({ attributes }, value) => (attributes.get('class') || '').split(/\s+/).includes(value);
const srcsetUrls = (value = '') => value.split(',').map((candidate) => candidate.trim().split(/\s+/)[0]).filter(Boolean);

function isLocalReference(reference) {
  return reference && !/^(?:#|\/\/|[a-z][\w+.-]*:)/i.test(reference);
}

function localReferencePath(reference) {
  const url = new URL(reference.replace(/&amp;/g, '&'), sourceRoot);
  const path = relative(fileURLToPath(sourceRoot), fileURLToPath(url));
  assert.ok(path && !path.startsWith('..') && !isAbsolute(path), `Unexpected local resource path: ${reference}`);
  return path;
}

function htmlResources() {
  const references = new Set();
  for (const { attributes } of tags) {
    for (const key of ['src', 'href', 'xlink:href']) {
      const value = attributes.get(key);
      if (isLocalReference(value)) references.add(localReferencePath(value));
    }
    for (const key of ['srcset', 'imagesrcset']) {
      for (const value of srcsetUrls(attributes.get(key))) {
        if (isLocalReference(value)) references.add(localReferencePath(value));
      }
    }
  }
  return references;
}

function cssResources() {
  const references = new Set();
  for (const [, double, single, unquoted] of css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)) {
    const value = (double ?? single ?? unquoted).trim();
    if (isLocalReference(value)) references.add(localReferencePath(value));
  }
  return references;
}

test('all HTML images, srcsets, SVG images, bundles, fonts, and preloads exist locally', async () => {
  const references = htmlResources();
  assert.ok(references.size > 30, 'Resource inspection must cover the responsive image candidates');
  for (const path of references) {
    for (const root of [sourceRoot, servedRoot]) {
      assert.ok((await stat(new URL(path.replaceAll('\\', '/'), root))).isFile(), `Missing HTML resource: ${path}`);
    }
  }
});

test('every bundled CSS URL resolves locally, including self-hosted fonts', async () => {
  const references = cssResources();
  assert.ok([...references].some((path) => path.endsWith('.woff2')), 'The CSS bundle must contain the self-hosted font faces');
  for (const path of references) {
    for (const root of [sourceRoot, servedRoot]) {
      assert.ok((await stat(new URL(path.replaceAll('\\', '/'), root))).isFile(), `Missing CSS resource: ${path}`);
    }
  }
});

test('only one local stylesheet and one deferred external script are requested', () => {
  const stylesheets = tags.filter(({ name, attributes }) => name === 'link' && attributes.get('rel') === 'stylesheet');
  const scripts = tags.filter(({ name, attributes }) => name === 'script' && attributes.has('src'));
  assert.equal(stylesheets.length, 1);
  assert.match(stylesheets[0].attributes.get('href'), /^site\.min\.css\?v=[a-f\d]{16}$/);
  assert.equal(scripts.length, 1);
  assert.match(scripts[0].attributes.get('src'), /^site\.min\.js\?v=[a-f\d]{16}$/);
  assert.ok(scripts[0].attributes.has('defer'));
  assert.doesNotMatch(html, /fonts\.(?:googleapis|gstatic)\.com/i);
});

test('only the hero is eager/high-priority; all other HTML images are lazy', () => {
  const images = tags.filter(({ name }) => name === 'img');
  const heroes = images.filter((image) => hasClass(image, 'hero-image'));
  assert.equal(heroes.length, 1);
  const [hero] = heroes;
  assert.notEqual(hero.attributes.get('loading'), 'lazy');
  assert.equal(hero.attributes.get('fetchpriority'), 'high');
  assert.ok(srcsetUrls(hero.attributes.get('srcset')).length >= 3);
  assert.equal(hero.attributes.get('sizes'), '100vw');
  for (const image of images) {
    assert.ok(Number(image.attributes.get('width')) > 0, 'Every image needs an explicit intrinsic width');
    assert.ok(Number(image.attributes.get('height')) > 0, 'Every image needs an explicit intrinsic height');
    assert.equal(image.attributes.get('decoding'), 'async');
    if (image !== hero) {
      assert.equal(image.attributes.get('loading'), 'lazy', `Non-hero image must be lazy: ${image.attributes.get('src')}`);
      assert.notEqual(image.attributes.get('fetchpriority'), 'high');
    }
  }
});

test('responsive hero preloads match the picture candidates and do not double-fetch mobile/desktop', () => {
  const hero = tags.find((tag) => tag.name === 'img' && hasClass(tag, 'hero-image'));
  const mobileSource = tags.find(({ name, attributes }) => name === 'source' && attributes.get('media') === '(max-width: 680px)');
  assert.ok(mobileSource);
  const preloads = tags.filter(({ name, attributes }) => name === 'link' && attributes.get('rel') === 'preload');
  const images = preloads.filter(({ attributes }) => attributes.get('as') === 'image');
  assert.equal(images.length, 2);
  for (const [media, imageAttributes] of [
    ['(min-width: 681px)', hero.attributes],
    ['(max-width: 680px)', mobileSource.attributes],
  ]) {
    const preload = images.find(({ attributes }) => attributes.get('media') === media);
    assert.ok(preload, `Missing responsive preload: ${media}`);
    const attributes = preload.attributes;
    assert.equal(attributes.get('type'), 'image/webp');
    assert.equal(attributes.get('fetchpriority'), 'high');
    assert.equal(attributes.get('imagesrcset'), imageAttributes.get('srcset'));
    assert.equal(attributes.get('imagesizes'), imageAttributes.get('sizes'));
    assert.ok(srcsetUrls(attributes.get('imagesrcset')).includes(attributes.get('href')));
  }
  const fonts = preloads.filter(({ attributes }) => attributes.get('as') === 'font');
  assert.equal(fonts.length, 2);
  for (const { attributes } of fonts) {
    assert.equal(attributes.get('type'), 'font/woff2');
    assert.ok(attributes.has('crossorigin'));
    assert.ok(isLocalReference(attributes.get('href')));
  }
});

test('upcoming services contain only the two approved directions after the existing service grid', async () => {
  for (const root of [sourceRoot, servedRoot]) {
    const document = await readFile(new URL('index.html', root), 'utf8');
    const documentTags = startTags(document);
    const upcomingTags = documentTags.filter(({ attributes }) => attributes.get('id') === 'upcoming');
    assert.equal(upcomingTags.length, 1, 'Each HTML mirror must contain exactly one upcoming subsection');
    assert.ok(hasClass(upcomingTags[0], 'services-upcoming'));
    assert.equal(upcomingTags[0].attributes.get('aria-labelledby'), 'upcoming-title');

    const upcomingSections = [...document.matchAll(/<section\b(?=[^>]*\bid="upcoming")[^>]*>[\s\S]*?<\/section>/g)];
    assert.equal(upcomingSections.length, 1);
    const [upcoming] = upcomingSections;
    const servicesStart = document.search(/<section\b[^>]*\bid="services"[^>]*>/);
    const processStart = document.search(/<section\b[^>]*\bid="process"[^>]*>/);
    assert.ok(servicesStart >= 0 && servicesStart < upcoming.index, 'Upcoming directions must follow the services heading');
    assert.ok(upcoming.index + upcoming[0].length < processStart, 'Upcoming directions must appear before the process section');

    const precedingServices = document.slice(servicesStart, upcoming.index);
    const precedingTags = startTags(precedingServices);
    assert.equal(precedingTags.filter((tag) => hasClass(tag, 'service-grid')).length, 1);
    assert.equal(precedingTags.filter((tag) => tag.name === 'article' && hasClass(tag, 'service-card')).length, 4);
    assert.equal([...precedingServices.matchAll(/<\/article>/g)].length, 4, 'All four main service cards must finish before upcoming directions');
    assert.match(precedingServices, /<\/div>\s*$/, 'The main service grid must close before the upcoming subsection');

    const sectionTags = startTags(upcoming[0]);
    const cards = sectionTags.filter(({ name }) => name === 'article');
    assert.equal(cards.length, 2);
    assert.ok(cards.every((tag) => hasClass(tag, 'upcoming-card')));
    assert.deepEqual(
      [...upcoming[0].matchAll(/<h4\b[^>]*>([^<]*)<\/h4>/g)].map(([, name]) => name.trim()),
      ['Проведення регресу', 'Самопрограмування'],
    );
    assert.match(upcoming[0], /<h3\b[^>]*\bid="upcoming-title"[^>]*>Незабаром<\/h3>/);
    assert.match(upcoming[0], /<p\b[^>]*>У розробці<\/p>/);
    assert.match(upcoming[0], /Нові напрями готуються\. Деталі та дати оголосимо окремо\./);
    assert.ok(sectionTags.every(({ name, attributes }) =>
      !['a', 'img', 'image', 'picture', 'script'].includes(name)
      && !attributes.has('href') && !attributes.has('xlink:href')),
    'Upcoming directions must not add links, images, or scripts');
  }
});

test('approved PDF copy is preserved in the hero and problem sections of both HTML mirrors', async () => {
  const entities = { nbsp: ' ', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' };
  const normalizeText = (markup) => markup
    .replace(/<br\b[^>]*>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, value) => {
      if (value.startsWith('#')) {
        const hexadecimal = /^#x/i.test(value);
        return String.fromCodePoint(Number.parseInt(value.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10));
      }
      return entities[value.toLowerCase()] ?? entity;
    })
    .replace(/\s+/g, ' ')
    .trim();
  const texts = (document, name, matches) => [...document.matchAll(new RegExp(`(<${name}\\b[^>]*>)([\\s\\S]*?)<\\/${name}>`, 'gi'))]
    .filter(([, opening]) => matches(startTags(opening)[0]))
    .map(([, , content]) => normalizeText(content));
  const textByClass = (document, name, className) => {
    const values = texts(document, name, (tag) => hasClass(tag, className));
    assert.equal(values.length, 1, `Expected exactly one ${name}.${className}`);
    return values[0];
  };

  for (const root of [sourceRoot, servedRoot]) {
    const document = await readFile(new URL('index.html', root), 'utf8');
    const expectedParagraphs = [
      ['hero-kicker-ref', 'Тренування мозку, зміна мислення та створення нової якості життя'],
      ['hero-formats', 'Допомагаю віднайти себе та створити життя, яке подобається саме вам. Зрозуміти свої справжні бажання, відчути власну цінність, знайти внутрішню опору, подолати страх змін і перестати відкладати життя на потім.'],
      ['hero-emphasis', 'Не просто зрозуміти себе. А навчитися жити по-новому.'],
      ['hero-location', 'Індивідуальні та групові сесії · онлайн та офлайн у Торонто'],
      ['problem-lead', 'Ви можете усвідомлювати свої бажання та цілі, але продовжувати повторювати звичні реакції та поведінкові сценарії.'],
      ['problem-detail', 'Розуміння проблеми — важливий початок, проте для змін потрібні нові дії та практики.'],
    ];
    for (const [className, expected] of expectedParagraphs) {
      assert.equal(textByClass(document, 'p', className), expected, `Approved copy differs: ${className}`);
    }
    assert.deepEqual(texts(document, 'h1', ({ attributes }) => attributes.get('id') === 'hero-title'),
      ['Від розуміння себе — до змін у житті']);
    assert.deepEqual(texts(document, 'h2', ({ attributes }) => attributes.get('id') === 'problem-title'),
      ['Ви знаєте, що хочете змінити. Але чому продовжуєте діяти по-старому?']);
    const problemNote = textByClass(document, 'p', 'problem-note');
    assert.match(problemNote, /автоматизованими звичками мислення й поведінки/);
    assert.doesNotMatch(problemNote, /сформованими/);
    assert.deepEqual(texts(document, 'li', (tag) => hasClass(tag, 'problem-callout')), [
      'Постійно відкладаю важливі рішення',
      'Залежу від думки інших і сумніваюся у власних рішеннях',
      'Повторюю знайомі сценарії у житті',
      'Хочу змін, але повертаюся до звичних реакцій',
      'Прагну фінансового зростання, але відчуваю внутрішні обмеження',
      'Відчуваю, що маю потенціал, але не знаю, як його реалізувати',
    ]);
    const upcoming = document.match(/<section\b(?=[^>]*\bid="upcoming")[^>]*>[\s\S]*?<\/section>/);
    assert.ok(upcoming, 'The previously approved upcoming directions must remain present');
    assert.deepEqual(texts(upcoming[0], 'h4', () => true), ['Проведення регресу', 'Самопрограмування']);
  }
});

test('served HTML, editable sources, generated bundles, and active assets match source mirrors', async () => {
  const paths = new Set([
    'index.html', 'index.html.br', 'index.html.gz',
    'site.min.css', 'site.min.css.br', 'site.min.css.gz',
    'site.min.js', 'site.min.js.br', 'site.min.js.gz',
    ...CSS_INPUTS, ...JS_INPUTS, ...htmlResources(), ...cssResources(),
  ]);
  for (const path of paths) {
    const normalized = path.replaceAll('\\', '/');
    const [source, served] = await Promise.all([
      readFile(new URL(normalized, sourceRoot)),
      readFile(new URL(normalized, servedRoot)),
    ]);
    assert.deepEqual(source, served, `Source / public mirror differs: ${path}`);
  }
});
