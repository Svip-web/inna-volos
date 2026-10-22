(() => {
  function setupScrollReveals() {
    const root = document.documentElement;
    if (root.classList.contains('scroll-reveal-ready')) return;

    // Preserve legacy reveal hooks, but never conceal content until this
    // independent observer has been constructed successfully.
    document.querySelectorAll('main .reveal').forEach(element => element.classList.add('is-visible'));
    const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (preference?.matches || typeof window.IntersectionObserver !== 'function') return;

    const selectors = [
      'main .reveal',
      '.problem-patterns-heading', '.problem-group', '.problem-footer',
      '.service-card', '.requests-heading', '.request-panel',
      '.audience-cards > article', '.process-steps > li', '.faq-list > details',
    ];
    const splitWrappers = '.requests-intro, .request-grid, .audience-cards, .process-steps';
    const candidates = Array.from(document.querySelectorAll(selectors.join(', '))).filter(element => {
      if (element.closest('.hero, .site-header') || element.matches(splitWrappers)) return false;
      const slider = element.closest('.reviews-slider');
      return !slider || slider === element;
    });

    // Reveal the most specific blocks only: a card must never enter inside an
    // independently hidden parent grid. Original layout classes stay intact.
    const candidateSet = new Set(candidates);
    const ancestors = new Set();
    for (const element of candidates) {
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        if (candidateSet.has(parent)) ancestors.add(parent);
      }
    }
    const targets = candidates.filter(element => !ancestors.has(element));
    if (!targets.length) return;

    const pending = new Set();
    const entering = new Set();
    let observer;

    const finish = element => {
      pending.delete(element);
      entering.delete(element);
      element.classList.add('is-visible', 'is-scroll-revealed');
      element.removeAttribute('data-scroll-reveal');
      element.style.removeProperty('--scroll-reveal-delay');
      observer?.unobserve(element);
      if (!pending.size) observer?.disconnect();
    };
    const finishAll = () => targets.forEach(finish);
    const reveal = element => {
      if (!pending.delete(element)) return;
      entering.add(element);
      element.classList.add('is-visible', 'is-scroll-revealed');
      observer.unobserve(element);
      if (!pending.size) observer.disconnect();
    };
    const revealFocused = node => {
      for (let element = node; element; element = element.parentElement) {
        if (pending.has(element) || entering.has(element)) finish(element);
      }
    };

    try {
      observer = new window.IntersectionObserver(entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) reveal(entry.target);
        }
      }, { threshold: 0.01, rootMargin: '0px 0px -40px 0px' });

      // Read geometry in one batch before applying attributes. Content already
      // visible (including restored hash positions) must not flash or fade out.
      const viewportHeight = window.innerHeight || root.clientHeight;
      const snapshots = targets.map(element => ({
        element,
        alreadyVisible: element.getBoundingClientRect().top < viewportHeight
          || element.contains(document.activeElement),
      }));
      const groups = '.service-grid, .request-grid, .audience-cards, .process-steps, .problem-groups, .faq-list';
      for (const { element, alreadyVisible } of snapshots) {
        if (alreadyVisible) {
          finish(element);
          continue;
        }
        const parent = element.parentElement;
        const index = parent?.matches(groups) ? Array.from(parent.children).indexOf(element) : 0;
        element.style.setProperty('--scroll-reveal-delay', `${Math.min(Math.max(0, index) * 70, 180)}ms`);
        element.setAttribute('data-scroll-reveal', '');
        pending.add(element);
      }
      if (!pending.size) return;
      pending.forEach(element => observer.observe(element));
      root.classList.add('scroll-reveal-ready');

      document.addEventListener('focusin', event => revealFocused(event.target));
      document.addEventListener('animationend', event => {
        if (event.animationName === 'iv-scroll-reveal-enter' && entering.has(event.target)) finish(event.target);
      });
      preference?.addEventListener?.('change', event => {
        if (event.matches) finishAll();
      });
      window.addEventListener('pageshow', event => {
        if (event.persisted) finishAll();
      });
    } catch {
      // A partial setup failure must never leave an invisible keyboard target.
      observer?.disconnect();
      finishAll();
      root.classList.remove('scroll-reveal-ready');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupScrollReveals, { once: true });
  } else {
    setupScrollReveals();
  }
})();
