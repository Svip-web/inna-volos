(() => {
  function setupRequestsMotion() {
    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');

    document.querySelectorAll('[data-requests-motion]').forEach((section) => {
      const artwork = section.querySelector('.requests-neural');
      const toggle = section.querySelector('[data-requests-motion-toggle]');
      const label = toggle?.querySelector('[data-requests-motion-label]');
      if (!artwork || !toggle || !label) return;

      let userPaused = false;
      let artworkVisible = true;
      const originalTabIndex = toggle.getAttribute('tabindex');

      function updateMotionState() {
        const reducedMotion = motionPreference.matches;
        const paused = userPaused || reducedMotion;
        section.classList.toggle('is-motion-paused', paused);
        section.classList.toggle('is-motion-offscreen', !artworkVisible || document.hidden);
        const action = paused ? 'Відтворити' : 'Зупинити';
        label.textContent = `${action} анімацію`;
        toggle.setAttribute('aria-label', `${action} анімацію мозку`);
        toggle.setAttribute('aria-pressed', String(paused));
        toggle.disabled = reducedMotion;
        if (reducedMotion) {
          toggle.setAttribute('tabindex', '-1');
        } else if (originalTabIndex === null) {
          toggle.removeAttribute('tabindex');
        } else {
          toggle.setAttribute('tabindex', originalTabIndex);
        }
      }

      toggle.addEventListener('click', () => {
        if (motionPreference.matches) return;
        userPaused = !userPaused;
        updateMotionState();
      });

      if ('IntersectionObserver' in window) {
        artworkVisible = false;
        const observer = new IntersectionObserver((entries) => {
          artworkVisible = entries.some((entry) => entry.isIntersecting);
          updateMotionState();
        }, { threshold: 0 });
        observer.observe(artwork);
      }

      document.addEventListener('visibilitychange', updateMotionState);
      motionPreference.addEventListener?.('change', updateMotionState);
      updateMotionState();
      section.classList.add('is-motion-ready');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupRequestsMotion, { once: true });
  } else {
    setupRequestsMotion();
  }
})();

