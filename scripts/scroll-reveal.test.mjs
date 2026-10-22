import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { CSS_INPUTS, JS_INPUTS } from './inna-build.mjs';

const script = await readFile(new URL('../sites/inna-volos/scroll-reveal.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../sites/inna-volos/scroll-reveal.css', import.meta.url), 'utf8');

class MockElement {
  constructor(name, classes = [], top = 1200, parent = null) {
    this.name = name;
    this.classes = new Set(classes);
    this.attributes = new Map();
    this.properties = new Map();
    this.top = top;
    this.reads = 0;
    this.children = [];
    this.parentElement = parent;
    parent?.children.push(this);
    this.classList = {
      add: (...values) => values.forEach(value => this.classes.add(value)),
      remove: (...values) => values.forEach(value => this.classes.delete(value)),
      contains: value => this.classes.has(value),
    };
    this.style = {
      setProperty: (name, value) => this.properties.set(name, value),
      removeProperty: name => this.properties.delete(name),
    };
  }

  matches(selector) { return selector.split(',').some(value => this.classes.has(value.trim().slice(1))); }
  closest(selector) {
    for (let element = this; element; element = element.parentElement) {
      if (element.matches(selector)) return element;
    }
    return null;
  }
  contains(node) {
    for (let element = node; element; element = element.parentElement) {
      if (element === this) return true;
    }
    return false;
  }
  getBoundingClientRect() { this.reads += 1; return { top: this.top, bottom: this.top + 200 }; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  removeAttribute(name) { this.attributes.delete(name); }
}

function setup({ readyState = 'complete', reduced = false, observerAvailable = true, failObserver = false, failObserve = false, focused = false } = {}) {
  const root = new MockElement('html', ['js', 'motion-ready']);
  root.clientHeight = 800;
  const hero = new MockElement('hero', ['hero'], 0, root);
  const heroCopy = new MockElement('heroCopy', ['reveal'], 100, hero);
  const heading = new MockElement('heading', ['reveal'], 1000, root);
  const serviceGrid = new MockElement('serviceGrid', ['service-grid'], 1200, root);
  const cards = Array.from({ length: 4 }, (_, index) => new MockElement(`card${index}`, ['service-card', 'reveal'], 1200 + index * 100, serviceGrid));
  const link = new MockElement('link', [], 1300, cards[1]);
  const requestIntro = new MockElement('requestIntro', ['requests-intro', 'reveal'], 2000, root);
  const requestHeading = new MockElement('requestHeading', ['requests-heading'], 2000, requestIntro);
  const artwork = new MockElement('artwork', ['requests-neural'], 1800, requestIntro);
  const requestGrid = new MockElement('requestGrid', ['request-grid', 'reveal'], 2300, root);
  const panels = [0, 1].map(index => new MockElement(`panel${index}`, ['request-panel'], 2300, requestGrid));
  const process = new MockElement('process', ['process-steps', 'reveal'], 3000, root);
  const steps = [0, 1].map(index => new MockElement(`step${index}`, [], 3000, process));
  const audience = new MockElement('audience', ['audience-cards', 'reveal'], 4000, root);
  const audienceCards = [0, 1].map(index => new MockElement(`audience${index}`, [], 4000, audience));
  const slider = new MockElement('slider', ['reviews-slider', 'reveal'], 5000, root);
  const slide = new MockElement('slide', ['review-slide', 'reveal'], 5000, slider);
  const faq = new MockElement('faq', ['faq-list', 'reveal'], 6000, root);
  const details = [0, 1].map(index => new MockElement(`details${index}`, [], 6000, faq));
  const parent = new MockElement('parent', ['reveal'], 6500, root);
  const child = new MockElement('child', ['reveal'], 6500, parent);
  const visible = new MockElement('visible', ['reveal'], 300, root);
  const passed = new MockElement('passed', ['reveal'], -500, root);
  const candidates = [heroCopy, heading, ...cards, requestIntro, requestHeading, requestGrid, ...panels,
    process, ...steps, audience, ...audienceCards, slider, slide, faq, ...details, parent, child, visible, passed];
  const documentListeners = new Map();
  const windowListeners = new Map();
  const motionListeners = new Map();
  const observed = new Set();
  const unobserved = new Set();
  let observerCallback;
  let observerOptions;
  let disconnects = 0;
  const preference = {
    matches: reduced,
    addEventListener(type, listener) { motionListeners.set(type, listener); },
  };
  const document = {
    documentElement: root, readyState, activeElement: focused ? link : root,
    querySelectorAll(selector) {
      if (selector === 'main .reveal') return candidates.filter(element => element.classes.has('reveal'));
      assert.ok(selector.includes('.process-steps > li'));
      assert.ok(selector.includes('.faq-list > details'));
      return candidates;
    },
    addEventListener(type, listener, options) { documentListeners.set(type, { listener, options }); },
  };
  const window = {
    innerHeight: 800,
    matchMedia() { return preference; },
    addEventListener(type, listener) { windowListeners.set(type, listener); },
  };
  if (observerAvailable) {
    window.IntersectionObserver = class {
      constructor(callback, options) {
        if (failObserver) throw new Error('Unavailable observer');
        observerCallback = callback;
        observerOptions = options;
      }
      observe(element) {
        if (failObserve) throw new Error('Cannot observe');
        observed.add(element);
      }
      unobserve(element) { observed.delete(element); unobserved.add(element); }
      disconnect() { disconnects += 1; observed.clear(); }
    };
  }
  runInNewContext(script, { document, window });
  return {
    root, heroCopy, heading, cards, link, requestIntro, requestHeading, artwork, requestGrid,
    panels, process, steps, audience, audienceCards, slider, slide, faq, details, parent, child, visible, passed,
    candidates, observed, unobserved, documentListeners, windowListeners, preference,
    get observerOptions() { return observerOptions; },
    get disconnects() { return disconnects; },
    pending: element => element.attributes.has('data-scroll-reveal'),
    documentEvent(type, event = {}) { documentListeners.get(type)?.listener(event); },
    windowEvent(type, event = {}) { windowListeners.get(type)?.(event); },
    intersect(elements) { observerCallback(elements.map(target => ({ target, isIntersecting: true }))); },
    motion(matches) { preference.matches = matches; motionListeners.get('change')?.({ matches }); },
  };
}

test('hero, current viewport, and previously passed blocks are never hidden', () => {
  const page = setup();
  assert.equal(page.root.classes.has('scroll-reveal-ready'), true);
  for (const element of [page.heroCopy, page.visible, page.passed]) {
    assert.equal(page.pending(element), false);
    assert.equal(element.classes.has('is-visible'), true);
  }
  assert.equal(page.heroCopy.reads, 0);
  assert.equal(page.pending(page.heading), true);
  assert.equal(page.observerOptions.threshold, 0.01);
  assert.equal(page.observerOptions.rootMargin, '0px 0px -40px 0px');
});

test('cards and process rows enter independently without hidden grid parents or neural artwork', () => {
  const page = setup();
  for (const element of [page.requestIntro, page.requestGrid, page.process, page.audience, page.faq, page.parent, page.artwork]) {
    assert.equal(page.pending(element), false, element.name);
  }
  for (const element of [...page.cards, ...page.panels, ...page.steps, ...page.audienceCards, ...page.details, page.child, page.requestHeading]) {
    assert.equal(page.pending(element), true, element.name);
  }
  assert.equal(page.pending(page.slider), true);
  assert.equal(page.pending(page.slide), false);
});

test('sibling delays are small and capped; no transform or transition styles are replaced', () => {
  const page = setup();
  assert.deepEqual(page.cards.map(element => element.properties.get('--scroll-reveal-delay')), ['0ms', '70ms', '140ms', '180ms']);
  for (const element of page.candidates) {
    assert.deepEqual([...element.properties.keys()].filter(name => name !== '--scroll-reveal-delay'), []);
  }
});

test('intersection is one-shot and animation completion removes temporary styling', () => {
  const page = setup();
  const card = page.cards[0];
  page.intersect([card]);
  assert.equal(card.classes.has('is-scroll-revealed'), true);
  assert.equal(page.unobserved.has(card), true);
  assert.equal(page.pending(card), true, 'Retain only the temporary animation marker while entering');
  page.documentEvent('animationend', { target: card, animationName: 'unrelated-animation' });
  assert.equal(page.pending(card), true);
  page.documentEvent('animationend', { target: card, animationName: 'iv-scroll-reveal-enter' });
  assert.equal(page.pending(card), false);
  assert.equal(card.properties.has('--scroll-reveal-delay'), false);
  page.intersect([card]);
  assert.equal(page.pending(card), false);
});

test('keyboard focus immediately reveals a pending or entering target', () => {
  const page = setup();
  page.documentEvent('focusin', { target: page.link });
  assert.equal(page.pending(page.cards[1]), false);
  assert.equal(page.cards[1].classes.has('is-scroll-revealed'), true);
  page.intersect([page.cards[0]]);
  page.documentEvent('focusin', { target: page.cards[0] });
  assert.equal(page.pending(page.cards[0]), false);
});

test('already focused content is visible during setup, even outside the initial viewport', () => {
  const page = setup({ focused: true });
  assert.equal(page.pending(page.cards[1]), false);
  assert.equal(page.observed.has(page.cards[1]), false);
});

test('reduced-motion changes reveal everything permanently without resetting user animation classes', () => {
  const page = setup();
  page.cards[0].classes.add('is-motion-paused');
  page.intersect([page.cards[0]]);
  page.motion(true);
  assert.equal(page.observed.size, 0);
  for (const element of page.candidates) assert.equal(page.pending(element), false);
  assert.equal(page.cards[0].classes.has('is-motion-paused'), true);
  page.motion(false);
  assert.equal(page.observed.size, 0);
});

for (const options of [{ reduced: true }, { observerAvailable: false }, { failObserver: true }, { failObserve: true }]) {
  test(`progressive fallback stays readable: ${JSON.stringify(options)}`, () => {
    const page = setup(options);
    assert.equal(page.root.classes.has('scroll-reveal-ready'), false);
    for (const element of page.candidates) assert.equal(page.pending(element), false);
  });
}

test('DOMContentLoaded is deferred once and BFCache restores all pending content', () => {
  const page = setup({ readyState: 'loading' });
  assert.equal(page.root.classes.has('scroll-reveal-ready'), false);
  assert.equal(page.documentListeners.get('DOMContentLoaded').options.once, true);
  page.documentEvent('DOMContentLoaded');
  assert.equal(page.pending(page.heading), true);
  page.windowEvent('pageshow', { persisted: false });
  assert.equal(page.pending(page.heading), true);
  page.windowEvent('pageshow', { persisted: true });
  for (const element of page.candidates) assert.equal(page.pending(element), false);
});

test('observer is released after the last pending block enters and no scroll loop is registered', () => {
  const page = setup();
  page.intersect([...page.observed]);
  assert.equal(page.observed.size, 0);
  assert.ok(page.disconnects > 0);
  assert.equal(page.documentListeners.has('scroll'), false);
  assert.equal(page.windowListeners.has('scroll'), false);
  assert.equal(page.candidates.every(element => element.reads <= 1), true);
});

test('late CSS preserves hover transforms, reduced motion, focus and print fallbacks', () => {
  assert.ok(css.includes('html.js.motion-ready.scroll-reveal-ready [data-scroll-reveal]'));
  assert.match(css, /650ms/);
  assert.match(css, /translate: 0 24px/);
  assert.match(css, /:focus-within/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /@media print/);
  assert.doesNotMatch(css, /(?:^|[;{\s])(?:transform|transition|will-change)\s*:/m);
  assert.equal(CSS_INPUTS.at(-1), 'scroll-reveal.css');
  assert.equal(JS_INPUTS.at(-1), 'scroll-reveal.js');
});

test('source/public runtime and CSS match; the old app observer is removed', async () => {
  for (const [name, content] of [['scroll-reveal.js', script], ['scroll-reveal.css', css]]) {
    assert.equal(await readFile(new URL(`../public/inna-volos/${name}`, import.meta.url), 'utf8'), content);
  }
  const app = await readFile(new URL('../sites/inna-volos/app.js', import.meta.url), 'utf8');
  assert.equal(await readFile(new URL('../public/inna-volos/app.js', import.meta.url), 'utf8'), app);
  assert.doesNotMatch(app, /setupReveals|let revealObserver/);
});
