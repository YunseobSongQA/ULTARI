/**
 * landing.js — 첫 화면을 제자리에 두고, 스크롤로 화면을 갈아 끼웁니다.
 *
 * 화면은 움직이지 않습니다. 스크롤한 만큼 어느 화면을 보여 줄지만 바뀌고,
 * 글자는 한 자씩 올라오면서 굵기가 붙습니다(Pretendard Variable의 wght를
 * 그대로 애니메이션합니다 — 그래서 글자가 "변하는" 것처럼 보입니다).
 *
 * 기본 상태는 애니메이션이 아닙니다
 *   HTML과 CSS만으로는 화면들이 위에서 아래로 그냥 이어집니다. 자바스크립트가
 *   붙으면 `is-reel`을 켜서 고정과 전환을 시작합니다. 스크립트가 실패하거나
 *   막혀 있어도 내용은 전부 읽힙니다.
 *
 * 움직임을 줄이는 설정에서는 켜지 않습니다
 *   prefers-reduced-motion이면 고정도 전환도 하지 않습니다. 어지러움을 유발할
 *   수 있는 효과를 설정보다 앞세우지 않습니다.
 *
 * 보이지 않는 화면은 누를 수도 없습니다
 *   투명하게만 해 두면 키보드 tab이 안 보이는 버튼으로 들어갑니다.
 *   inert와 aria-hidden으로 아예 빼 둡니다.
 */

import { paintIcons } from './site.js';

const SWITCH_MS = 520;        // 화면이 갈리는 시간
const LETTER_STEP = 26;       // 글자 한 자씩 늦는 간격 (ms)
const LETTER_MAX = 14;        // 이보다 긴 제목은 뒤 글자를 함께 올립니다

/** 제목을 한 자씩 감싸 굵기와 위치를 따로 움직일 수 있게 합니다. */
function splitLetters(el) {
  if (!el || el.dataset.split) return;
  const source = el.textContent;
  el.dataset.split = '1';
  el.setAttribute('aria-label', source);
  el.textContent = '';
  [...source].forEach((ch, i) => {
    if (ch === ' ') {
      el.append(' ');
      return;
    }
    const span = document.createElement('span');
    span.textContent = ch;
    span.setAttribute('aria-hidden', 'true');
    span.style.setProperty('--i', String(Math.min(i, LETTER_MAX)));
    el.append(span);
  });
}

export function mountLanding(reel) {
  if (!reel) return;

  const slides = [...reel.querySelectorAll('.slide')];
  if (slides.length < 2) return;

  const rail = document.querySelector('[data-rail]');
  const quiet = window.matchMedia('(prefers-reduced-motion: reduce)');
  /* 좁은 화면에서는 고정하지 않습니다. 화면을 붙잡아 두고 갈아 끼우면
     손가락으로 끄는 만큼 화면이 따라오지 않다가 툭 바뀌어, 스크롤이 중간에
     걸린 것처럼 느껴집니다. 게다가 눈금자는 880px 아래에서 감춰져 있어
     지금 몇 번째인지도 보이지 않습니다. 폭이 좁으면 화면들을 그냥 위에서
     아래로 잇습니다. 눈금자가 나오는 폭과 같은 선을 씁니다. */
  const narrow = window.matchMedia('(max-width: 880px)');

  /* 제목은 어느 쪽이든 한 자씩 나눠 둡니다. 움직이지 않는 설정에서는
     CSS가 곧바로 제자리에 두므로 보이는 결과는 같습니다. */
  slides.forEach((slide) => splitLetters(slide.querySelector('.morph')));

  /* ── 눈금자 — 지금 몇 번째 화면인지, 눌러서 옮겨 가기 ── */
  const dots = slides.map((slide, i) => {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'rail-dot';
    dot.dataset.to = String(i);
    const name = slide.dataset.name || `${i + 1}번째 화면`;
    dot.setAttribute('aria-label', name);
    dot.innerHTML = `<i></i><span>${name}</span>`;
    rail?.append(dot);
    return dot;
  });

  let index = -1;
  let pinned = false;

  const show = (next) => {
    if (next === index) return;
    index = next;
    slides.forEach((slide, i) => {
      const on = i === index;
      slide.classList.toggle('is-on', on);
      slide.classList.toggle('is-past', i < index);
      // 보이지 않는 화면은 읽히지도, tab으로 들어가지도 않게 합니다.
      slide.inert = pinned && !on;
      if (pinned) slide.setAttribute('aria-hidden', on ? 'false' : 'true');
      else slide.removeAttribute('aria-hidden');
    });
    dots.forEach((dot, i) => {
      dot.classList.toggle('is-on', i === index);
      dot.setAttribute('aria-current', i === index ? 'true' : 'false');
    });
    const id = slides[index].id;
    if (id && window.history.replaceState) {
      // 주소는 조용히 맞춰 둡니다. 스크롤을 다시 튀게 하지 않습니다.
      window.history.replaceState(null, '', `#${id}`);
    }
  };

  /** 스크롤한 자리를 화면 번호로 바꿉니다. */
  const measure = () => {
    const top = reel.offsetTop;
    const run = reel.offsetHeight - window.innerHeight;
    if (run <= 0) return 0;
    const p = (window.scrollY - top) / run;
    return Math.max(0, Math.min(slides.length - 1, Math.round(p * (slides.length - 1))));
  };

  let raf = 0;
  const onScroll = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      show(measure());
    });
  };

  /** 눈금자나 바로가기로 그 화면의 스크롤 자리로 옮깁니다. */
  const goTo = (i, behavior = 'smooth') => {
    const run = reel.offsetHeight - window.innerHeight;
    const to = reel.offsetTop + (run * i) / (slides.length - 1);
    window.scrollTo({ top: Math.round(to), behavior });
  };

  const enable = () => {
    if (pinned) return;
    pinned = true;
    reel.classList.add('is-reel');
    document.body.classList.add('has-reel');
    index = -1;
    show(measure());
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
  };

  const disable = () => {
    if (!pinned) return;
    pinned = false;
    reel.classList.remove('is-reel');
    document.body.classList.remove('has-reel');
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onScroll);
    slides.forEach((slide) => {
      slide.classList.add('is-on');
      slide.classList.remove('is-past');
      slide.inert = false;
      slide.removeAttribute('aria-hidden');
    });
    dots.forEach((dot) => dot.classList.remove('is-on'));
  };

  rail?.addEventListener('click', (e) => {
    const dot = e.target.closest('.rail-dot');
    if (!dot) return;
    if (pinned) goTo(Number(dot.dataset.to));
    else slides[Number(dot.dataset.to)]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  /* 첫 화면의 "아래로"와 주소의 #photo 같은 것도 받아 줍니다. */
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[href^="#"]');
    if (!link || !pinned) return;
    const at = slides.findIndex((s) => `#${s.id}` === link.getAttribute('href'));
    if (at < 0) return;
    e.preventDefault();
    goTo(at);
  });

  const sync = () => (quiet.matches || narrow.matches ? disable() : enable());
  quiet.addEventListener('change', sync);
  narrow.addEventListener('change', sync);
  sync();

  /* 주소에 화면이 적혀 있으면 그 자리에서 시작합니다. */
  const wanted = slides.findIndex((s) => `#${s.id}` === window.location.hash);
  if (wanted > 0 && pinned) {
    goTo(wanted, 'auto');
    show(wanted);
  }

  paintIcons(reel);
  return { goTo, show };
}

mountLanding(document.querySelector('[data-reel]'));
