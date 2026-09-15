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

  /**
   * 좁은 화면에서 내용이 한 화면에 안 들어가면 그 화면 안에서 스크롤할 수
   * 있어야 합니다. 그런데 넘치지 않는데도 스크롤 상자로 만들어 두면, 손가락이
   * 그 위에서 끄는 동안 페이지가 아니라 상자가 먼저 받습니다. 상자는 스크롤할
   * 것이 없으니 아무 일도 일어나지 않고, 화면이 안 넘어갑니다. 손을 뗐다
   * 다시 끌어야 겨우 넘어가는 것이 이것 때문입니다.
   *
   * 그래서 실제로 넘칠 때만 붙입니다. 글꼴이 늦게 와서 높이가 달라질 수
   * 있으므로 폰트가 준비된 뒤에 한 번 더 잽니다.
   */
  const markTall = () => {
    slides.forEach((slide) => {
      slide.classList.toggle('is-tall', slide.scrollHeight > slide.clientHeight + 1);
    });
  };

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

  /**
   * 한 화면이 차지하는 스크롤 거리.
   *
   * window.innerHeight로 재면 안 됩니다. 모바일 브라우저는 스크롤하는 동안
   * 주소창을 접었다 폈다 하고, 그때마다 innerHeight가 달라집니다. 그러면
   * 손가락은 가만히 있는데 계산된 화면 번호만 앞뒤로 튀어, 화면이 갈리다
   * 말고 되돌아옵니다. 그게 끌 때 중간에 걸리는 것처럼 보입니다.
   *
   * 릴의 높이는 CSS에서 화면 수 × 100svh로 잡혀 있고, svh는 주소창이
   * 접혀도 변하지 않습니다. 그래서 릴에서 직접 꺼냅니다.
   */
  const slideRun = () => slides[0].offsetHeight;

  /** 스크롤한 자리를 화면 번호로 바꿉니다. */
  const measure = () => {
    const run = slideRun();
    if (run <= 0) return 0;
    const at = (window.scrollY - reel.offsetTop) / run;
    const p = Math.max(0, Math.min(slides.length - 1, at));
    if (index < 0) return Math.round(p);
    /* 경계가 정확히 반이면 손이 조금만 떨려도 번호가 뒤집힙니다. 조금 더
       가야 넘어가고 조금 더 돌아와야 되돌아오게 해서 떨림을 없앱니다. */
    const moved = p - index;
    return moved > 0.58 || moved < -0.58 ? Math.round(p) : index;
  };

  const onResize = () => { markTall(); onScroll(); };

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
    const to = reel.offsetTop + slideRun() * i;
    window.scrollTo({ top: Math.round(to), behavior });
  };

  const enable = () => {
    if (pinned) return;
    pinned = true;
    reel.classList.add('is-reel');
    document.body.classList.add('has-reel');
    index = -1;
    markTall();
    show(measure());
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
  };

  const disable = () => {
    if (!pinned) return;
    pinned = false;
    reel.classList.remove('is-reel');
    document.body.classList.remove('has-reel');
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onResize);
    slides.forEach((slide) => {
      slide.classList.remove('is-tall');
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

  quiet.addEventListener('change', () => (quiet.matches ? disable() : enable()));
  if (!quiet.matches) enable();

  /* 주소에 화면이 적혀 있으면 그 자리에서 시작합니다. */
  const wanted = slides.findIndex((s) => `#${s.id}` === window.location.hash);
  if (wanted > 0 && pinned) {
    goTo(wanted, 'auto');
    show(wanted);
  }

  paintIcons(reel);
  // 글꼴이 늦게 오면 글자 높이가 달라집니다. 온 뒤에 한 번 더 잽니다.
  document.fonts?.ready.then(() => { if (pinned) markTall(); });
  return { goTo, show };
}

mountLanding(document.querySelector('[data-reel]'));
