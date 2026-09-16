/**
 * demo.js — 심사·시연용 화면.
 *
 * 파일을 올리지 않고도 결과 화면을 볼 수 있게 합니다. 심사관이 자기
 * 카메라 원본을 찾아 올려야만 이 서비스가 무엇을 하는지 알 수 있다면,
 * 그건 보여 주지 않은 것과 같습니다.
 *
 * 다만 두 가지는 지킵니다.
 *
 *   측정값은 견본이라고 화면에 적습니다. demo-data.js의 숫자는 파일을
 *   재서 나온 값이 아닙니다. 그 사실을 감추면 이 서비스가 파는 것이
 *   없어집니다.
 *
 *   판정은 견본으로 만들지 않습니다. 견본 측정값을 실제 판정 함수에
 *   그대로 넣어 등급을 받습니다. 그래서 화면의 등급과 근거는 지어낸 것이
 *   아니라 이 측정값에서 실제로 나오는 결과입니다.
 *
 * 누르면 파일이 필요한 자리(마크 새기기, 신청서 보내기)는 여기서 떼어
 * 냅니다. 견본에는 원본 파일이 없어 눌러도 아무 일이 일어나지 않고,
 * 눌리지 않는 버튼을 남겨 두면 그것대로 거짓말입니다.
 */

import { renderResult, renderStatus } from './ui.js';
import { gradeResult } from './grade.js';
import { gradeMedia } from './media.js';
import { paintIcons } from './site.js';
import { escapeHtml } from './html.js';
import { DEMO_CASES, DEMO_STATUS } from './demo-data.js';

const tabs = document.querySelector('[data-demo-tabs]');
const out = document.querySelector('[data-demo-out]');
const statusBox = document.querySelector('[data-demo-status]');

/** 견본 측정값에 실제 판정을 붙입니다. 여기만 실물입니다. */
const judge = (bundle) => ({
  ...bundle,
  result: bundle.kind === 'image' ? gradeResult(bundle) : gradeMedia(bundle),
});

/**
 * 원본 파일이 있어야 동작하는 자리를 떼어 냅니다.
 * 마크는 원본에 새기는 것이고 신청은 원본을 올리는 것이라, 견본에는 둘 다 없습니다.
 */
function stripLiveParts(scope) {
  /* 받기 칸은 통째로 뗍니다. 견본에는 원본 파일이 없어 마크를 새길 수도,
     등록할 파일을 올릴 수도 없습니다. 안내만 남겨 두면 눌러도 아무 일이
     일어나지 않는 버튼이 됩니다 — 이 페이지에는 걸음을 옮길 것이 없습니다. */
  scope.querySelectorAll(
    '[data-claim-body], .claim-cta, .claim-panel, [data-watermark], .top-actions, .end-actions, [data-apply]',
  ).forEach((el) => el.remove());
}

function paint(id) {
  const found = DEMO_CASES.find((c) => c.id === id) || DEMO_CASES[0];

  tabs.querySelectorAll('[data-case]').forEach((btn) => {
    const on = btn.dataset.case === found.id;
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });

  out.innerHTML = renderResult(judge(found.bundle), 'quick');
  stripLiveParts(out);
  out.insertAdjacentHTML('beforeend', `
    <p class="demo-tail">
      실제 화면에는 여기에 인증 마크 내려받기와 아카이브 등록 결과가 붙습니다.
      둘 다 원본 파일이 있어야 하는 자리라 견본에서는 떼어 냈습니다.
      <a href="/verify">직접 파일을 올려 보시려면 검증 화면으로</a>.
    </p>`);
  paintIcons(out);

  if (window.location.hash.slice(1) !== found.id) {
    history.replaceState(null, '', `#${found.id}`);
  }
}

function mount() {
  if (!tabs || !out) return;

  tabs.innerHTML = DEMO_CASES.map((c) => `
    <button class="demo-tab" type="button" role="tab" aria-selected="false" data-case="${escapeHtml(c.id)}">
      <b>${escapeHtml(c.label)}</b>
      <span>${escapeHtml(c.note)}</span>
    </button>`).join('');

  tabs.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-case]');
    if (btn) paint(btn.dataset.case);
  });

  window.addEventListener('hashchange', () => paint(window.location.hash.slice(1)));
  paint(window.location.hash.slice(1) || DEMO_CASES[0].id);

  if (statusBox) {
    statusBox.innerHTML = renderStatus(DEMO_STATUS);
    paintIcons(statusBox);
  }
}

mount();
