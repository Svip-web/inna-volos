import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const script = readFileSync(new URL('../sites/inna-volos/requests-motion.js', import.meta.url), 'utf8');

class MockTarget {
  constructor() {
    this.listeners = new Map();
    this.attributes = new Map();
    this.disabled = false;
    this.textContent = '';
  }

  addEventListener(type, listener, options) {
    const listeners = this.listeners.get(type) || [];
    listeners.push({ listener, once: Boolean(options?.once) });
    this.listeners.set(type, listeners);
  }

  emit(type) {
    const listeners = this.listeners.get(type) || [];
    this.listeners.set(type, listeners.filter(({ once }) => !once));
    listeners.forEach(({ listener }) => listener());
  }

  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
}

function createFixture({ reduced = false, observer = true, readyState = 'complete', missing, tabIndex } = {}) {
  const classes = new Set();
  const label = new MockTarget();
  const toggle = new MockTarget();
  const artwork = {};
  const section = {
    classList: {
      add(name) { classes.add(name); },
      toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); },
    },
    querySelector(selector) {
      if (selector === '.requests-neural') return missing === 'artwork' ? null : artwork;
      if (selector === '[data-requests-motion-toggle]') return missing === 'toggle' ? null : toggle;
      return null;
    },
  };
  toggle.querySelector = (selector) => selector === '[data-requests-motion-label]' && missing !== 'label' ? label : null;
  if (tabIndex !== undefined) toggle.setAttribute('tabindex', tabIndex);
  const document = new MockTarget();
  document.readyState = readyState;
  document.hidden = false;
  document.querySelectorAll = () => missing === 'section' ? [] : [section];
  const preference = new MockTarget();
  preference.matches = reduced;
  const observers = [];
  class MockIntersectionObserver {
    constructor(callback, options) {
      this.callback = callback;
      this.options = options;
      observers.push(this);
    }
    observe(target) { this.target = target; }
    emit(isIntersecting) { this.callback([{ target: artwork, isIntersecting }]); }
  }
  const window = { matchMedia: () => preference };
  if (observer) window.IntersectionObserver = MockIntersectionObserver;
  vm.runInNewContext(script, { window, document, IntersectionObserver: MockIntersectionObserver }, {
    filename: fileURLToPath(new URL('../sites/inna-volos/requests-motion.js', import.meta.url)),
  });
  return { classes, label, toggle, artwork, document, preference, observers };
}

test('boot waits for DOMContentLoaded and marks the artwork ready only once', () => {
  const fixture = createFixture({ readyState: 'loading' });
  assert.equal(fixture.classes.has('is-motion-ready'), false);
  fixture.document.emit('DOMContentLoaded');
  fixture.document.emit('DOMContentLoaded');
  assert.equal(fixture.classes.has('is-motion-ready'), true);
  assert.equal(fixture.observers.length, 1);
  assert.equal(fixture.observers[0].target, fixture.artwork);
  assert.equal(fixture.observers[0].options.threshold, 0);
  assert.equal(fixture.classes.has('is-motion-offscreen'), true);
  assert.equal(fixture.toggle.getAttribute('aria-pressed'), 'false');
  assert.equal(fixture.toggle.getAttribute('aria-label'), 'Зупинити анімацію мозку');
});

test('click toggles the pause state and accessible action without visible content', () => {
  const fixture = createFixture({ observer: false });
  assert.equal(fixture.classes.has('is-motion-offscreen'), false);
  fixture.toggle.emit('click');
  assert.equal(fixture.classes.has('is-motion-paused'), true);
  assert.equal(fixture.toggle.getAttribute('aria-pressed'), 'true');
  assert.equal(fixture.toggle.getAttribute('aria-label'), 'Відтворити анімацію мозку');
  assert.equal(fixture.label.textContent, 'Відтворити анімацію');
  fixture.toggle.emit('click');
  assert.equal(fixture.classes.has('is-motion-paused'), false);
  assert.equal(fixture.toggle.getAttribute('aria-pressed'), 'false');
});

test('offscreen and hidden-document pausing are independent of the user pause choice', () => {
  const fixture = createFixture();
  fixture.observers[0].emit(true);
  assert.equal(fixture.classes.has('is-motion-offscreen'), false);
  fixture.document.hidden = true;
  fixture.document.emit('visibilitychange');
  assert.equal(fixture.classes.has('is-motion-offscreen'), true);
  fixture.document.hidden = false;
  fixture.document.emit('visibilitychange');
  assert.equal(fixture.classes.has('is-motion-offscreen'), false);
  fixture.toggle.emit('click');
  fixture.observers[0].emit(false);
  assert.equal(fixture.classes.has('is-motion-offscreen'), true);
  fixture.observers[0].emit(true);
  assert.equal(fixture.classes.has('is-motion-offscreen'), false);
  assert.equal(fixture.classes.has('is-motion-paused'), true);
});

test('reduced motion disables the overlay, removes its tab stop, and prevents toggling', () => {
  const fixture = createFixture({ reduced: true, observer: false });
  assert.equal(fixture.classes.has('is-motion-paused'), true);
  assert.equal(fixture.toggle.disabled, true);
  assert.equal(fixture.toggle.getAttribute('tabindex'), '-1');
  assert.equal(fixture.toggle.getAttribute('aria-pressed'), 'true');
  fixture.toggle.emit('click');
  fixture.preference.matches = false;
  fixture.preference.emit('change');
  assert.equal(fixture.classes.has('is-motion-paused'), false);
  assert.equal(fixture.toggle.disabled, false);
  assert.equal(fixture.toggle.getAttribute('tabindex'), null);
  assert.equal(fixture.toggle.getAttribute('aria-pressed'), 'false');
});

test('preference changes preserve the user pause choice and an explicit tab index', () => {
  const fixture = createFixture({ observer: false, tabIndex: '0' });
  fixture.toggle.emit('click');
  fixture.preference.matches = true;
  fixture.preference.emit('change');
  assert.equal(fixture.toggle.disabled, true);
  assert.equal(fixture.toggle.getAttribute('tabindex'), '-1');
  fixture.preference.matches = false;
  fixture.preference.emit('change');
  assert.equal(fixture.toggle.disabled, false);
  assert.equal(fixture.toggle.getAttribute('tabindex'), '0');
  assert.equal(fixture.classes.has('is-motion-paused'), true);
  assert.equal(fixture.toggle.getAttribute('aria-pressed'), 'true');
});

for (const missing of ['section', 'artwork', 'toggle', 'label']) {
  test(`missing ${missing} is handled safely`, () => {
    const fixture = createFixture({ missing });
    assert.equal(fixture.classes.has('is-motion-ready'), false);
    assert.equal(fixture.observers.length, 0);
  });
}

test('the served motion script is identical to the source script', () => {
  const served = readFileSync(new URL('../public/inna-volos/requests-motion.js', import.meta.url), 'utf8');
  assert.equal(served, script);
});
