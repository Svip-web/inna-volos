import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../sites/inna-volos/performance-motion.js', import.meta.url), 'utf8');

function setup({ readyState = 'complete', hidden = false, observerAvailable = true, sectionCount = 3 } = {}) {
  const listeners = new Map();
  const observed = [];
  let callback;
  let options;
  let queries = 0;
  const sections = Array.from({ length: sectionCount }, () => {
    const classes = new Set(['original-section-class']);
    return {
      classes,
      classList: {
        toggle(name, value) { value ? classes.add(name) : classes.delete(name); }
      }
    };
  });
  const document = {
    readyState, hidden,
    querySelectorAll(selector) {
      queries++;
      assert.equal(selector, 'main > section, body > footer');
      return sections;
    },
    addEventListener(type, listener, config) { listeners.set(type, { listener, config }); }
  };
  const window = {};
  if (observerAvailable) {
    window.IntersectionObserver = class {
      constructor(listener, config) { callback = listener; options = config; }
      observe(section) { observed.push(section); }
    };
  }
  runInNewContext(source, { document, window });
  return {
    document, sections, observed, listeners,
    get options() { return options; },
    get queries() { return queries; },
    paused(index) { return sections[index].classes.has('is-visual-offscreen'); },
    event(type) { listeners.get(type)?.listener(); },
    intersect(entries) {
      callback(entries.map(([index, visible]) => ({ target: sections[index], isIntersecting: visible })));
    }
  };
}

test('boots without changing visible content and observes only top-level sections/footer', () => {
  const page = setup();
  assert.deepEqual(page.observed, page.sections);
  assert.equal(page.options.rootMargin, '200px');
  assert.equal(page.options.threshold, 0);
  assert.equal(page.queries, 1);
  assert.deepEqual(page.sections.map((_, index) => page.paused(index)), [false, false, false]);
  assert.deepEqual([...page.listeners.keys()], ['visibilitychange']);
});

test('waits for DOMContentLoaded when deferred initialization is needed', () => {
  const page = setup({ readyState: 'loading' });
  assert.equal(page.observed.length, 0);
  assert.equal(page.queries, 0);
  assert.equal(page.listeners.get('DOMContentLoaded').config.once, true);
  page.event('DOMContentLoaded');
  assert.equal(page.observed.length, 3);
});

test('pauses only sections outside the observer margin and resumes on return', () => {
  const page = setup();
  page.intersect([[0, true], [1, false], [2, false]]);
  assert.deepEqual(page.sections.map((_, index) => page.paused(index)), [false, true, true]);
  page.intersect([[1, true]]);
  assert.deepEqual(page.sections.map((_, index) => page.paused(index)), [false, false, true]);
  assert.equal(page.queries, 1);
});

test('hidden tabs pause all sections and visibility restoration keeps actual intersection state', () => {
  const page = setup();
  page.intersect([[0, true], [1, false], [2, true]]);
  page.document.hidden = true;
  page.event('visibilitychange');
  assert.deepEqual(page.sections.map((_, index) => page.paused(index)), [true, true, true]);
  // Observer entries can still arrive while the tab is hidden.
  page.intersect([[0, false], [1, true]]);
  assert.deepEqual(page.sections.map((_, index) => page.paused(index)), [true, true, true]);
  page.document.hidden = false;
  page.event('visibilitychange');
  assert.deepEqual(page.sections.map((_, index) => page.paused(index)), [true, false, false]);
});

test('initially hidden documents pause immediately, without assuming sections are offscreen', () => {
  const page = setup({ hidden: true });
  assert.deepEqual(page.sections.map((_, index) => page.paused(index)), [true, true, true]);
  page.document.hidden = false;
  page.event('visibilitychange');
  assert.deepEqual(page.sections.map((_, index) => page.paused(index)), [false, false, false]);
});

test('does not modify user pause, requests offscreen, or reduced-motion classes', () => {
  const page = setup();
  const ownedElsewhere = ['is-motion-paused', 'is-motion-offscreen', 'is-motion-ready', 'is-reduced-motion'];
  for (const name of ownedElsewhere) page.sections[1].classes.add(name);
  page.intersect([[1, false]]);
  page.document.hidden = true;
  page.event('visibilitychange');
  page.document.hidden = false;
  page.intersect([[1, true]]);
  page.event('visibilitychange');
  assert.equal(page.paused(1), false);
  for (const name of ownedElsewhere) assert.equal(page.sections[1].classes.has(name), true);
  assert.equal(page.sections[1].classes.has('original-section-class'), true);
});

test('missing IntersectionObserver leaves the progressive fallback active without errors', () => {
  const page = setup({ observerAvailable: false, hidden: true });
  assert.equal(page.queries, 0);
  assert.equal(page.listeners.size, 0);
  assert.deepEqual(page.sections.map((_, index) => page.paused(index)), [false, false, false]);
});

test('empty pages require no observer or visibility listener', () => {
  const page = setup({ sectionCount: 0 });
  assert.equal(page.observed.length, 0);
  assert.equal(page.options, undefined);
  assert.equal(page.listeners.size, 0);
});

test('served runtime is identical to the source runtime', async () => {
  const served = await readFile(new URL('../public/inna-volos/performance-motion.js', import.meta.url), 'utf8');
  assert.equal(served, source);
});
