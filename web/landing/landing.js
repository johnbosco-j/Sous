// Sous landing: scroll progress, parallax, reveals, counters, chat playback, card tilt.
(() => {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia('(pointer: fine)').matches;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const nav = $('#nav');
  const bar = $('.progress span');
  const hero = $('#hero');
  const parallax = $$('[data-speed]');

  // ---------- scroll-driven bits ----------
  let ticking = false;
  function update() {
    ticking = false;
    const y = window.scrollY;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    bar.style.setProperty('--p', max > 0 ? (y / max).toFixed(4) : 0);
    nav.classList.toggle('scrolled', y > 40);
    if (hero) {
      const hs = Math.min(1, Math.max(0, y / Math.max(1, hero.offsetHeight)));
      hero.style.setProperty('--hs', hs.toFixed(3));
    }
    if (reduce) return;
    for (const el of parallax) {
      const r = el.parentElement.getBoundingClientRect();
      if (r.bottom < -300 || r.top > window.innerHeight + 300) continue;
      const off = r.top + r.height / 2 - window.innerHeight / 2;
      el.style.transform = `translate3d(0, ${(-off * parseFloat(el.dataset.speed)).toFixed(1)}px, 0)`;
    }
  }
  const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  update();

  // ---------- reveals + counters ----------
  function countUp(el) {
    const target = parseFloat(el.dataset.count);
    const prefix = el.dataset.prefix || '';
    const suffix = el.dataset.suffix || '';
    const fmt = n => prefix + Math.round(n).toLocaleString('en-US') + suffix;
    if (reduce) { el.textContent = fmt(target); return; }
    const start = performance.now();
    const dur = 1600;
    const step = now => {
      const k = Math.min(1, (now - start) / dur);
      el.textContent = fmt(target * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  const revealables = $$('[data-reveal]');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add('is-in');
        $$('[data-count]', e.target).forEach(countUp);
        io.unobserve(e.target);
      }
    }, { threshold: 0.15, rootMargin: '0px 0px -6% 0px' });
    revealables.forEach(el => io.observe(el));
  } else {
    revealables.forEach(el => el.classList.add('is-in'));
  }

  // ---------- hero: cycling utterances ----------
  const utter = $('#utter');
  const phrases = [
    'Alexa, what should we cook tonight?',
    "Alexa, what's about to expire?",
    "Alexa, add what we're missing to the cart.",
    'Alexa, next step.',
    'Alexa, how much food have we saved?',
  ];
  async function typeLoop() {
    let i = 0;
    for (;;) {
      const text = phrases[i % phrases.length];
      for (let n = 1; n <= text.length; n++) { utter.textContent = text.slice(0, n); await sleep(36); }
      await sleep(2300);
      for (let n = text.length; n >= 0; n--) { utter.textContent = text.slice(0, n); await sleep(14); }
      await sleep(320);
      i++;
    }
  }
  if (utter && !reduce) { utter.textContent = ''; setTimeout(typeLoop, 1700); }

  // ---------- say it: chat playback ----------
  const chat = $('#chat');
  if (chat) {
    const bubbles = $$('.bubble', chat);
    const typing = $('.typing', chat);
    const play = async () => {
      for (const b of bubbles) {
        if (b.classList.contains('alexa')) {
          chat.insertBefore(typing, b);
          typing.classList.add('show');
          await sleep(750);
          typing.classList.remove('show');
        } else {
          await sleep(380);
        }
        b.classList.add('show');
        await sleep(420);
      }
      typing.remove();
    };
    if (reduce || !('IntersectionObserver' in window)) {
      bubbles.forEach(b => b.classList.add('show'));
      typing.remove();
    } else {
      const io = new IntersectionObserver(([e]) => {
        if (e.isIntersecting) { io.disconnect(); play(); }
      }, { threshold: 0.25 });
      io.observe(chat);
    }
  }

  // ---------- feature card tilt + spotlight ----------
  if (finePointer && !reduce) {
    for (const card of $$('.card')) {
      card.addEventListener('pointermove', e => {
        const r = card.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width;
        const py = (e.clientY - r.top) / r.height;
        card.style.setProperty('--mx', `${(px * 100).toFixed(1)}%`);
        card.style.setProperty('--my', `${(py * 100).toFixed(1)}%`);
        card.style.setProperty('--rx', `${((0.5 - py) * 9).toFixed(2)}deg`);
        card.style.setProperty('--ry', `${((px - 0.5) * 11).toFixed(2)}deg`);
      });
      card.addEventListener('pointerleave', () => {
        card.style.setProperty('--rx', '0deg');
        card.style.setProperty('--ry', '0deg');
      });
    }
    const cta = $('.cta-card');
    const device = $('#device');
    if (cta && device) {
      cta.addEventListener('pointermove', e => {
        const r = cta.getBoundingClientRect();
        device.style.setProperty('--dx', (((e.clientX - r.left) / r.width - 0.5) * 10).toFixed(2));
        device.style.setProperty('--dy', ((0.5 - (e.clientY - r.top) / r.height) * 8).toFixed(2));
      });
      cta.addEventListener('pointerleave', () => { device.style.setProperty('--dx', 0); device.style.setProperty('--dy', 0); });
    }
  }

  // ---------- CTA: live, scaled-down /device preview ----------
  const screen = $('#device-screen');
  const frame = $('#device-frame');
  if (screen && frame) {
    const fit = () => { frame.style.transform = `scale(${screen.clientWidth / 1280})`; };
    if ('ResizeObserver' in window) new ResizeObserver(fit).observe(screen);
    fit();
    frame.addEventListener('load', () => {
      try {
        const doc = frame.contentDocument;
        const looksReal = doc && doc.body && doc.body.childElementCount > 0 && !/404|not found|error/i.test(doc.title || '');
        if (looksReal) frame.classList.add('loaded');
      } catch {
        frame.classList.add('loaded');
      }
    });
    const load = () => { if (!frame.src) frame.src = frame.dataset.src; };
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { io.disconnect(); load(); } }, { rootMargin: '400px' });
      io.observe(screen);
    } else {
      load();
    }
  }

  // poster clock
  const clock = $('#poster-clock');
  const tick = () => {
    if (clock) clock.textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M$/i, '');
  };
  tick();
  setInterval(tick, 30000);

  // ---------- optional hero video (e.g. generated with Google Flow) ----------
  const video = $('.hero-video');
  if (video) {
    const source = $('source', video);
    const drop = () => video.remove();
    source && source.addEventListener('error', drop);
    video.addEventListener('error', drop);
    video.addEventListener('loadeddata', () => {
      video.classList.add('ready');
      if (reduce) video.pause();
    });
  }

  const year = $('#year');
  if (year) year.textContent = new Date().getFullYear();
})();
