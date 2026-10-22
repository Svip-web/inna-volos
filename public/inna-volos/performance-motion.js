(() => {
  function setupVisualMotion() {
    if (typeof window.IntersectionObserver !== 'function') return;

    const sections = Array.from(document.querySelectorAll('main > section, body > footer'));
    if (!sections.length) return;

    // Leave artwork active until the observer supplies its first real position.
    const visible = new Map(sections.map(section => [section, true]));
    const update = section => {
      section.classList.toggle('is-visual-offscreen', document.hidden || !visible.get(section));
    };
    const observer = new window.IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!visible.has(entry.target)) continue;
        visible.set(entry.target, entry.isIntersecting);
        update(entry.target);
      }
    }, { rootMargin: '200px', threshold: 0 });

    for (const section of sections) {
      observer.observe(section);
      update(section);
    }
    document.addEventListener('visibilitychange', () => {
      for (const section of sections) update(section);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupVisualMotion, { once: true });
  } else {
    setupVisualMotion();
  }
})();
