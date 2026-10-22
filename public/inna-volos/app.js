const menuButton = document.querySelector('.menu-toggle');
const navigation = document.querySelector('.site-nav');
const menuLabel = menuButton?.querySelector('.sr-only');
const mobileMenu = window.matchMedia('(max-width: 980px)');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const desktopPointer = window.matchMedia('(min-width: 801px) and (hover: hover) and (pointer: fine)');
const header = document.querySelector('.site-header');
const hero = document.querySelector('.hero');
const heroBrain = document.querySelector('.hero-brain');

// Keep short Ukrainian service words with the word that follows them. This
// prevents isolated conjunctions and prepositions at the ends of visible lines.
const shortWordPattern = /(^|[\s([{«„"'])((?:а|і|й|у|в|з|зі|із|та|до|на|за|по|від|під|над|без|для|про|при|чи|не|що|як))[\t ]+(?=\S)/giu;

function bindShortWords(root = document.body) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let textNode = walker.nextNode();

  while (textNode) {
    const parent = textNode.parentElement;
    const ignored = parent?.closest('script, style, textarea, pre, code, svg, [data-typography-ignore]');

    if (!ignored && textNode.nodeValue?.trim()) {
      let updated = textNode.nodeValue;
      let previous;

      // A few passes also cover sequences such as “а у житті”.
      do {
        previous = updated;
        updated = updated.replace(shortWordPattern, '$1$2\u00A0');
      } while (updated !== previous);

      textNode.nodeValue = updated;
    }

    textNode = walker.nextNode();
  }
}

bindShortWords();

function updateHeader() {
  header?.classList.toggle('is-scrolled', window.scrollY > 18);
}

updateHeader();
window.addEventListener('scroll', updateHeader, { passive: true });

function setMenu(open, returnFocus = false) {
  if (!menuButton || !navigation) return;

  const shouldOpen = mobileMenu.matches && open;
  menuButton.setAttribute('aria-expanded', String(shouldOpen));
  navigation.classList.toggle('is-open', shouldOpen);
  navigation.inert = mobileMenu.matches && !shouldOpen;
  document.body.classList.toggle('menu-open', shouldOpen);

  if (menuLabel) {
    menuLabel.textContent = shouldOpen ? 'Закрити меню' : 'Відкрити меню';
  }

  if (shouldOpen) {
    requestAnimationFrame(() => navigation.querySelector('a')?.focus());
  }

  if (returnFocus) menuButton.focus();
}

setMenu(false);

menuButton?.addEventListener('click', () => {
  setMenu(menuButton.getAttribute('aria-expanded') !== 'true');
});

navigation?.querySelectorAll('a').forEach((link) => {
  link.addEventListener('click', () => setMenu(false));
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && menuButton?.getAttribute('aria-expanded') === 'true') {
    setMenu(false, true);
  }

  if (event.key === 'Tab' && menuButton?.getAttribute('aria-expanded') === 'true' && navigation) {
    const focusable = [menuButton, ...navigation.querySelectorAll('a')];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
});

mobileMenu.addEventListener?.('change', () => setMenu(false));

let brainMotionController;
let brainMotionFrame = 0;

function setupBrainMotion() {
  brainMotionController?.abort();
  cancelAnimationFrame(brainMotionFrame);

  if (!hero || !heroBrain) return;

  heroBrain.style.setProperty('--brain-x', '0px');
  heroBrain.style.setProperty('--brain-y', '0px');

  if (reducedMotion.matches || !desktopPointer.matches) return;

  brainMotionController = new AbortController();
  const { signal } = brainMotionController;
  const current = { x: 0, y: 0 };
  const target = { x: 0, y: 0 };

  const render = () => {
    current.x += (target.x - current.x) * 0.14;
    current.y += (target.y - current.y) * 0.14;

    if (Math.abs(target.x - current.x) < 0.03) current.x = target.x;
    if (Math.abs(target.y - current.y) < 0.03) current.y = target.y;

    heroBrain.style.setProperty('--brain-x', `${current.x.toFixed(2)}px`);
    heroBrain.style.setProperty('--brain-y', `${current.y.toFixed(2)}px`);

    if (current.x !== target.x || current.y !== target.y) {
      brainMotionFrame = requestAnimationFrame(render);
    }
  };

  const moveTo = (x, y) => {
    target.x = Math.max(-8, Math.min(8, x));
    target.y = Math.max(-8, Math.min(8, y));
    cancelAnimationFrame(brainMotionFrame);
    brainMotionFrame = requestAnimationFrame(render);
  };

  hero.addEventListener('pointermove', (event) => {
    const bounds = hero.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width - 0.5) * 16;
    const y = ((event.clientY - bounds.top) / bounds.height - 0.5) * 12;
    moveTo(x, y);
  }, { passive: true, signal });

  hero.addEventListener('pointerleave', () => moveTo(0, 0), { signal });
}

setupBrainMotion();
desktopPointer.addEventListener?.('change', setupBrainMotion);
reducedMotion.addEventListener?.('change', setupBrainMotion);

const reviewSlider = document.querySelector('[data-reviews-slider]');

if (reviewSlider) {
  const reviewViewport = reviewSlider.querySelector('[data-review-viewport]');
  const reviewSlides = [...reviewSlider.querySelectorAll('.review-slide')];
  const reviewDots = [...reviewSlider.querySelectorAll('[data-review-dot]')];
  const reviewPrevious = reviewSlider.querySelector('[data-review-prev]');
  const reviewNext = reviewSlider.querySelector('[data-review-next]');
  const reviewCurrent = reviewSlider.querySelector('[data-review-current]');
  const reviewStatus = reviewSlider.querySelector('[data-review-status]');
  if (reviewViewport && reviewSlides.length) {
    let reviewIndex = 0;
    let reviewTargetIndex = 0;
    let reviewScrollTimer = 0;

    const visibleReviewCount = () => Math.min(reviewSlides.length, Math.max(1,
      Number.parseInt(getComputedStyle(reviewSlider).getPropertyValue('--reviews-per-view'), 10) || 1
    ));
    const reviewStartCount = () => reviewSlides.length - visibleReviewCount() + 1;
    const normalizeReviewIndex = (index) => (
      ((index % reviewStartCount()) + reviewStartCount()) % reviewStartCount()
    );
    const reviewOffset = (slide) => slide.offsetLeft - reviewSlides[0].offsetLeft;

    const closestReviewIndex = () => reviewSlides.slice(0, reviewStartCount()).reduce((closest, slide, slideIndex) => (
      Math.abs(reviewOffset(slide) - reviewViewport.scrollLeft)
        < Math.abs(reviewOffset(reviewSlides[closest]) - reviewViewport.scrollLeft)
        ? slideIndex
        : closest
    ), 0);

    const syncReviewSlider = (index) => {
      reviewIndex = normalizeReviewIndex(index);
      reviewTargetIndex = reviewIndex;
      const visibleCount = visibleReviewCount();
      const lastVisible = reviewIndex + visibleCount;

      reviewSlides.forEach((slide, slideIndex) => {
        const active = slideIndex >= reviewIndex && slideIndex < lastVisible;
        slide.classList.toggle('is-active', active);
        slide.setAttribute('aria-hidden', String(!active));
        slide.inert = !active;
      });

      reviewDots.forEach((dot, dotIndex) => {
        dot.hidden = dotIndex >= reviewStartCount();
        dot.setAttribute('aria-current', String(dotIndex === reviewIndex));
        const end = Math.min(reviewSlides.length, dotIndex + visibleCount);
        dot.setAttribute('aria-label', visibleCount > 1
          ? 'Показати відгуки ' + (dotIndex + 1) + '–' + end
          : 'Показати відгук ' + (dotIndex + 1));
        dot.setAttribute('aria-controls', reviewSlides.slice(dotIndex, end).map((slide) => slide.id).join(' '));
      });

      if (reviewCurrent) {
        reviewCurrent.textContent = String(reviewIndex + 1).padStart(2, '0')
          + (visibleCount > 1 ? '–' + String(lastVisible).padStart(2, '0') : '');
      }

      if (reviewStatus) {
        reviewStatus.textContent = (visibleCount > 1 ? 'Демонстраційні відгуки ' : 'Демонстраційний відгук ')
          + (reviewIndex + 1) + (visibleCount > 1 ? '–' + lastVisible : '')
          + '\u00A0з\u00A0' + reviewSlides.length;
      }
    };

    const settleReviewSlider = () => {
      window.clearTimeout(reviewScrollTimer);
      syncReviewSlider(closestReviewIndex());
    };

    const moveToReview = (index) => {
      const nextIndex = normalizeReviewIndex(index);
      const target = reviewSlides[nextIndex];
      if (!target) return;

      // A direct scroll position is deliberately used here. It remains stable
      // with mandatory scroll snapping and late font/layout resizes, while
      // touch dragging still keeps its native snap interaction.
      reviewViewport.scrollLeft = reviewOffset(target);
      syncReviewSlider(nextIndex);
    };

    reviewPrevious?.addEventListener('click', () => moveToReview(reviewTargetIndex - 1));
    reviewNext?.addEventListener('click', () => moveToReview(reviewTargetIndex + 1));

    reviewDots.forEach((dot, dotIndex) => {
      dot.addEventListener('click', () => moveToReview(dotIndex));
    });

    reviewViewport.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        moveToReview(reviewTargetIndex - 1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        moveToReview(reviewTargetIndex + 1);
      } else if (event.key === 'Home') {
        event.preventDefault();
        moveToReview(0);
      } else if (event.key === 'End') {
        event.preventDefault();
        moveToReview(reviewStartCount() - 1);
      }
    });

    reviewViewport.addEventListener('scroll', () => {
      window.clearTimeout(reviewScrollTimer);
      reviewScrollTimer = window.setTimeout(settleReviewSlider, 140);
    }, { passive: true });

    if ('onscrollend' in reviewViewport) {
      reviewViewport.addEventListener('scrollend', settleReviewSlider);
    }

    if ('ResizeObserver' in window) {
      const reviewResizeObserver = new ResizeObserver(() => {
        moveToReview(Math.min(reviewIndex, reviewStartCount() - 1));
      });
      reviewResizeObserver.observe(reviewViewport);
    }

    reviewSlider.classList.add('is-enhanced');
    moveToReview(0);
    const reconcileReviewPosition = () => {
      let previousScrollLeft = reviewViewport.scrollLeft;
      let stableChecks = 0;
      let checks = 0;

      const reconcileRestoredPosition = () => {
        const currentScrollLeft = reviewViewport.scrollLeft;
        stableChecks = Math.abs(currentScrollLeft - previousScrollLeft) < 1
          ? stableChecks + 1
          : 0;
        previousScrollLeft = currentScrollLeft;
        checks += 1;

        if ((checks >= 12 && stableChecks >= 3) || checks >= 30) {
          settleReviewSlider();
          return;
        }

        window.setTimeout(reconcileRestoredPosition, 80);
      };

      window.setTimeout(reconcileRestoredPosition, 80);
    };

    reconcileReviewPosition();
    window.addEventListener('pageshow', reconcileReviewPosition, { once: true });
  }
}

// Progressive enhancement: only opt into the scripted menu and motion after
// the complete script has loaded. If this file is blocked, content and nav stay usable.
document.documentElement.classList.add('js', 'motion-preparing', 'motion-ready');
document.documentElement.classList.remove('js-pending', 'js-failed');
void document.documentElement.offsetWidth;
document.documentElement.classList.remove('motion-preparing');
requestAnimationFrame(() => document.body.classList.add('page-ready'));
