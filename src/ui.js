/**
 * ui.js — 검증 도구 화면.
 *
 * 파일은 읽기만 하고 어디로도 보내지 않습니다.
 * 이 파일에 fetch, XMLHttpRequest, WebSocket, form action은 없습니다.
 * 확인하려면 브라우저 개발자 도구의 네트워크 탭을 켜고 검증해 보십시오.
 */

import { loadPixels } from './verify/pixels.js';
import { readExif, formatCamera, formatSettings } from './verify/exif.js';
import { analyzeConsistency } from './verify/consistency.js';
import { analyzeOptics } from './verify/optics.js';
import { analyzeCompression } from './verify/compression.js';
import { analyzeRephoto } from './verify/rephoto.js';
import { fingerprintFile, formatBytes } from './verify/fingerprint.js';
import { gradeResult, VERDICT } from './grade.js';
import { REVIEW_QUEUE, REVIEW_CONTACT, reviewMailto, queueLine } from './queue.js';

/* ── 아이콘 — 인라인 SVG. 이모지는 쓰지 않습니다. ────── */

const icon = (inner) =>
  `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
  `stroke-width="1.5" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">${inner}</svg>`;

const ICONS = {
  frame: icon('<rect x="3" y="5" width="18" height="14"/><path d="M3 16l5-5 4 4 3-3 6 6"/>'),
  lock: icon('<rect x="4" y="10.5" width="16" height="9.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>'),
};

/* ── 상태 표기 ───────────────────────────────────────── */

const STATE = {
  ok: (text) => ({ text, cls: 'state--ok' }),
  none: (text) => ({ text, cls: 'state--none' }),
  flag: (text) => ({ text, cls: 'state--flag' }),
  info: (text) => ({ text, cls: 'state--info' }),
};

const nf = (value, digits = 2) =>
  value == null || !Number.isFinite(value) ? '—' : value.toFixed(digits);

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

/* ── 측정 결과 → 표 ──────────────────────────────────── */

function buildRows({ exif, consistency, optics, compression, rephoto, pixels }) {
  const rows = [];

  // 1. 촬영 정보
  {
    const camera = formatCamera(exif);
    const label = [camera, exif.lensModel].filter(Boolean).join(' / ');
    const settings = formatSettings(exif);
    const when = exif.dateTimeOriginal
      ? exif.dateTimeOriginal.toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })
      : exif.dateTimeOriginalRaw;
    rows.push({
      item: '촬영 정보',
      state: camera ? STATE.ok('있음') : STATE.none('없음'),
      value: camera ? escapeHtml(label) : '메타데이터가 남아 있지 않습니다',
      sub: camera ? [settings, when].filter(Boolean).map(escapeHtml).join(' · ') : null,
    });
  }

  // 2. ISO 대 노이즈
  {
    const { darkSigma, darkPatchCount } = consistency.measured;
    let state;
    let value;
    if (darkSigma == null) {
      state = STATE.none('측정 불가');
      value = `휘도 40 이하 패치 ${darkPatchCount}개 — 잴 수 있는 어두운 영역이 모자랍니다`;
    } else if (consistency.flags.isoNoiseMismatch) {
      state = STATE.flag('모순');
      value = `ISO ${consistency.iso}, 측정 노이즈 σ=${nf(darkSigma)}`;
    } else if (consistency.iso == null) {
      // 대조할 주장이 없으면 "정합"이라고 쓸 수 없습니다. 잰 값만 적습니다.
      state = STATE.none('대조 불가');
      value = `ISO 기록 없음, 측정 노이즈 σ=${nf(darkSigma)}`;
    } else {
      state = STATE.ok('정합');
      value = `ISO ${consistency.iso}, 측정 노이즈 σ=${nf(darkSigma)}`;
    }
    rows.push({
      item: 'ISO 대 노이즈',
      state,
      value,
      sub: darkSigma == null ? null : `어두운 패치 ${darkPatchCount}개 기준`,
    });
  }

  // 3. 노이즈-신호 관계
  {
    const { slopeCorrelation, relativeSpread, binSigma } = consistency.measured;
    const populated = binSigma.filter((v) => v != null).length;
    let state;
    if (slopeCorrelation == null) state = STATE.none('측정 불가');
    else if (consistency.flags.noiseSignalInverted) state = STATE.flag('역전');
    else if (consistency.flags.noiseSignalFlat) state = STATE.flag('균일');
    else state = STATE.ok('정상');

    rows.push({
      item: '노이즈-신호 관계',
      state,
      value: slopeCorrelation == null
        ? `휘도 구간 ${populated}/8개 — 밝기 분포가 좁습니다`
        : `구간 상관 ${slopeCorrelation > 0 ? '+' : ''}${nf(slopeCorrelation)}, 상대 폭 ${nf(relativeSpread)}`,
      sub: slopeCorrelation == null ? null 
        : `휘도 8구간 중 ${populated}개에서 측정 · 실제 센서는 밝을수록 노이즈가 커집니다`,
    });
  }

  // 4. 비네팅
  {
    const { ratio, detected } = optics.vignetting;
    rows.push({
      item: '비네팅',
      state: ratio == null ? STATE.none('측정 불가') : detected ? STATE.ok('검출') : STATE.none('미검출'),
      value: ratio == null ? '—' : `코너 대비 중앙 ${nf(ratio)}`,
      sub: ratio == null ? null
        : detected ? null : '카메라 내 보정이나 크롭으로도 지워집니다',
    });
  }

  // 5. 색수차
  {
    const { shiftPx, edgeCount, measurable, detected } = optics.chromaticAberration;
    rows.push({
      item: '색수차',
      state: !measurable ? STATE.none('측정 불가') : detected ? STATE.ok('검출') : STATE.none('미검출'),
      value: !measurable
        ? `고대비 엣지 ${edgeCount}개 — 표본이 모자랍니다`
        : `엣지 편차 ${nf(shiftPx)}px`,
      sub: measurable ? `고대비 엣지 ${edgeCount}개에서 R·B 위치 비교` : null,
    });
  }

  // 6. 초점 연속성
  {
    const { abruptness, logRange, discontinuous } = optics.focus;
    rows.push({
      item: '초점 연속성',
      state: discontinuous ? STATE.flag('불연속') : STATE.ok('정상'),
      value: `그리드 편차 ${nf(abruptness)}`,
      sub: `8×8 선명도 지도 · 선명도 폭 ${nf(logRange)}`,
    });
  }

  // 7. 압축 이력
  {
    const { estimatedPasses, gridStrength, measurable } = compression;
    let state;
    let value;
    if (!measurable) {
      state = STATE.none('측정 불가');
      value = '판단할 수 있는 영역이 모자랍니다';
    } else if (estimatedPasses == null) {
      state = STATE.none('격자 없음');
      value = `격자 세기 ${nf(gridStrength)} — 무손실 저장이거나 리사이즈로 지워졌습니다`;
    } else if (estimatedPasses >= 2) {
      state = STATE.ok('2회 이상');
      value = `격자 세기 ${nf(gridStrength)}, 어긋난 두 번째 격자 검출`;
    } else {
      state = STATE.ok('1회');
      value = `격자 세기 ${nf(gridStrength)}`;
    }
    rows.push({ item: '압축 이력', state, value, sub: null });
  }

  // 8. 블록 경계 편차
  {
    const { tileSpread, tileCount, weakTiles, flags, measurable } = compression;
    rows.push({
      item: '블록 경계 편차',
      state: !measurable || tileSpread == null
        ? STATE.none('측정 불가')
        : flags.regionalBlockDeviation ? STATE.flag('불균일') : STATE.ok('균일'),
      value: tileSpread == null
        ? `구역 ${tileCount}개 — 격자가 보이지 않아 비교할 값이 없습니다`
        : `구역 ${tileCount}개 중 격자가 약한 구역 ${weakTiles}개`,
      sub: tileSpread == null ? null : `구역 간 편차 ${nf(tileSpread)}`,
    });
  }

  // 9. 화면 재촬영 신호
  {
    const { level, peakRatio, peakCount, focusUniformity, measurable } = rephoto;
    let state;
    if (!measurable) state = STATE.none('측정 불가');
    else if (level === 'present') state = STATE.info('검출');
    else if (level === 'weak') state = STATE.info('약함');
    else state = STATE.none('없음');

    rows.push({
      item: '화면 재촬영 신호',
      state,
      value: !measurable
        ? '주파수 분석에 필요한 크기가 안 됩니다'
        : level === 'present'
          ? `주파수 피크 ${nf(peakRatio, 1)}배, ${peakCount}개`
          : level === 'weak'
            ? `선명도 균일도 ${nf(focusUniformity)}`
            : `규칙적 피크 없음 (최대 ${nf(peakRatio, 1)}배)`,
      sub: level === 'none' ? null : '이 신호는 등급을 깎지 않습니다. 판단은 2등급 심사에서 합니다.',
    });
  }

  // 해상도
  rows.push({
    item: '해상도',
    state: STATE.ok(`${pixels.width}×${pixels.height}`),
    value: `${nf(pixels.megapixels, 1)}메가픽셀`,
    sub: null,
  });

  return rows;
}

function renderTable(rows) {
  const body = rows.map((row) => `
    <tr>
      <td class="col-item">${escapeHtml(row.item)}</td>
      <td class="col-state"><span class="state ${row.state.cls}">${escapeHtml(row.state.text)}</span></td>
      <td class="col-value">${row.value}${row.sub ? `<span class="sub">${row.sub}</span>` : ''}</td>
    </tr>`).join('');

  return `
    <table class="measure-table">
      <thead>
        <tr><th>측정 항목</th><th>판정</th><th>측정값</th></tr>
      </thead>
      <tbody>${body}</tbody>
    </table>`;
}

function summaryForReview(result, rows, print) {
  const lines = rows.map((row) => `${row.item}: ${row.state.text} — ${row.value.replace(/<[^>]+>/g, '')}`);
  return [
    `판정: ${result.headline}`,
    print.sha256 ? `파일 지문(SHA-256): ${print.sha256}` : '파일 지문: 계산 불가',
    print.bytes != null ? `파일 크기: ${print.bytes}바이트` : '',
    '',
    ...lines,
  ].filter(Boolean);
}

/* ── 파이프라인 ──────────────────────────────────────── */

const STEPS = [
  '파일 지문 계산',
  '촬영 정보 읽기',
  '픽셀 준비',
  'EXIF 대 픽셀 정합성',
  '광학 흔적',
  '압축 이력',
  '화면 재촬영 신호',
];

export async function verifyFile(file, onStep) {
  const step = async (index) => {
    onStep?.(index, STEPS[index]);
    await nextFrame();
  };

  await step(0);
  const print = await fingerprintFile(file);

  await step(1);
  const exif = await readExif(file);

  await step(2);
  const pixels = await loadPixels(file);

  await step(3);
  const consistency = analyzeConsistency(pixels, exif);

  await step(4);
  const optics = analyzeOptics(pixels);

  await step(5);
  const compression = analyzeCompression(pixels);

  await step(6);
  const rephoto = analyzeRephoto(pixels, optics);

  const bundle = { exif, consistency, optics, compression, rephoto, pixels, print };
  return { ...bundle, result: gradeResult(bundle) };
}

/* ── 화면 ────────────────────────────────────────────── */

function stampFor(result) {
  if (result.verdict === VERDICT.PASS) {
    return `<span class="grade-stamp"><span class="g">3</span><span>등급</span></span>`;
  }
  if (result.verdict === VERDICT.HOLD) {
    return `<span class="grade-stamp grade-stamp--hold">보류</span>`;
  }
  return `<span class="grade-stamp grade-stamp--insufficient">판정 불가</span>`;
}

function reasonBlock(title, items) {
  if (!items.length) return '';
  return `
    <div class="panel">
      <p class="panel-title">${escapeHtml(title)}</p>
      <dl class="def-list">
        ${items.map((item) => `
          <div><dt>${escapeHtml(item.title)}</dt><dd>${escapeHtml(item.detail)}</dd></div>`).join('')}
      </dl>
    </div>`;
}

function renderResult(bundle) {
  const { result, print } = bundle;
  const rows = buildRows(bundle);
  const summary = summaryForReview(result, rows, print);

  const verdictClass =
    result.verdict === VERDICT.PASS ? '' :
    result.verdict === VERDICT.HOLD ? ' verdict--hold' : ' verdict--insufficient';

  const statement = `<p class="statement">${
    result.statement.map((line) => `<span>${escapeHtml(line)}</span>`).join('')
  }</p>`;

  // 통과일 때는 도장이 제목 역할을 합니다. 아닐 때만 판정 문장을 제목으로 올립니다.
  const heading = result.verdict === VERDICT.PASS ? '' : `<h2>${escapeHtml(result.headline)}</h2>`;

  const fingerprintLine = print.sha256
    ? `<span class="hash">${escapeHtml(print.short)}…</span> <span class="sub">(이 기기에서만 계산됨)</span>`
    : `<span class="sub">계산할 수 없었습니다 — 브라우저가 보안 컨텍스트가 아닙니다</span>`;

  const hints = result.hints.length
    ? `<div class="panel"><p class="panel-title">함께 읽어 두실 것</p>
        <ul style="margin:0;padding-left:1.15em;font-size:14.5px;color:var(--ink-2)">
          ${result.hints.map((h) => `<li>${escapeHtml(h)}</li>`).join('')}
        </ul></div>`
    : '';

  const mailto = reviewMailto(2, summary);

  // 버튼은 판정이 제시한 다음 행동을 그대로 씁니다. 첫 번째가 권하는 행동입니다.
  const actions = result.next
    .map((item, i) => {
      const cls = i === 0 ? 'btn' : 'btn btn--ghost';
      return item.kind === 'review2'
        ? `<a class="${cls}" href="${mailto}">${escapeHtml(item.label)}</a>`
        : `<button class="${cls}" type="button" data-action="reset">${escapeHtml(item.label)}</button>`;
    })
    .join('\n        ');

  const nextIntro = {
    [VERDICT.PASS]: '2등급은 사람이 직접 심사합니다. 찍힌 대상이 실제인지, 화면을 다시 찍은 것은 아닌지를 봅니다. 며칠 걸립니다.',
    [VERDICT.INSUFFICIENT]: '원본은 카메라의 메모리카드나 휴대폰 갤러리에서 바로 꺼낸 파일을 말합니다. 원본으로도 같은 결과가 나오면 사람 심사로 넘기실 수 있습니다.',
    [VERDICT.HOLD]: '사람 심사에서는 기계가 확정할 수 없는 부분을 직접 봅니다. 며칠 걸립니다.',
  }[result.verdict];

  return `
    <section class="verdict${verdictClass}">
      ${stampFor(result)}
      ${heading}
      ${statement}
    </section>

    <div class="panel">
      <p class="panel-title">무엇을 재서 그렇게 판단했는지</p>
      ${renderTable(rows)}
      <p style="margin:18px 0 0;font-size:13px;color:var(--ink-3)">
        파일 지문 ${fingerprintLine}
      </p>
    </div>

    ${reasonBlock('자동 검증이 멈춘 이유', result.blockers)}
    ${reasonBlock('서로 맞지 않는 측정값', result.contradictions)}
    ${reasonBlock('약한 신호', result.softSignals)}
    ${hints}

    <div class="panel">
      <p class="panel-title">다음에 할 수 있는 일</p>
      <p style="font-size:14.5px;color:var(--ink-2);margin-bottom:4px">
        ${escapeHtml(nextIntro)} ${escapeHtml(queueLine(REVIEW_QUEUE.grade2))}
      </p>
      <p style="font-size:13px;color:var(--ink-3);margin:0">
        신청 메일에는 위 측정값만 들어갑니다. 이미지는 첨부되지 않습니다.
        원본은 담당자와 연락이 닿은 뒤 직접 전달하시면 됩니다.
      </p>
      <div class="btn-row">
        ${actions}
        <a class="btn btn--ghost" href="/limits">이 검증이 못 하는 것</a>
      </div>
    </div>`;
}

function renderError(message, detail) {
  return `
    <section class="verdict verdict--insufficient">
      <span class="grade-stamp grade-stamp--insufficient">판정 불가</span>
      <h2>${escapeHtml(message)}</h2>
      <p class="statement"><span>${escapeHtml(detail)}</span></p>
      <div class="btn-row">
        <button class="btn" type="button" data-action="reset">다시 시도</button>
        <a class="btn btn--ghost" href="/how">무엇을 측정하는지 보기</a>
      </div>
    </section>`;
}

/* ── 조립 ────────────────────────────────────────────── */

export function mountVerifier(root) {
  if (!root) return;

  const dropzone = root.querySelector('[data-dropzone]');
  const input = root.querySelector('input[type="file"]');
  const progress = root.querySelector('[data-progress]');
  const progressLabel = root.querySelector('[data-progress-label]');
  const progressBar = root.querySelector('[data-progress-bar]');
  const output = root.querySelector('[data-output]');
  const fileLine = root.querySelector('[data-file-line]');

  let objectUrl = null;
  let busy = false;

  const reset = () => {
    if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
    output.innerHTML = '';
    fileLine.innerHTML = '';
    fileLine.hidden = true;
    progress.hidden = true;
    dropzone.hidden = false;
    input.value = '';
    busy = false;
  };

  const showProgress = (index, label) => {
    progress.hidden = false;
    progressLabel.textContent = `${label}…`;
    progressBar.style.width = `${Math.round(((index + 1) / STEPS.length) * 100)}%`;
  };

  const showFileLine = (file) => {
    objectUrl = URL.createObjectURL(file);
    fileLine.hidden = false;
    fileLine.innerHTML = `
      <img src="${objectUrl}" alt="">
      <div class="meta">
        <div class="name">${escapeHtml(file.name || '이름 없는 파일')}</div>
        <div>${escapeHtml(file.type || '형식 미상')} · ${escapeHtml(formatBytes(file.size) || '')}</div>
        <div style="color:var(--ink-3)">이 미리보기는 브라우저 메모리에만 있습니다.</div>
      </div>`;
  };

  const run = async (file) => {
    if (busy || !file) return;
    busy = true;
    dropzone.hidden = true;
    output.innerHTML = '';
    showFileLine(file);

    try {
      const bundle = await verifyFile(file, showProgress);
      progress.hidden = true;
      output.innerHTML = renderResult(bundle);
    } catch (err) {
      progress.hidden = true;
      if (err && err.message === 'DECODE_FAILED') {
        output.innerHTML = renderError(
          '이 파일은 브라우저가 열지 못했습니다',
          'RAW(.cr3, .nef, .arw 등)와 일부 HEIC는 브라우저가 직접 디코딩하지 못합니다. 카메라나 편집 프로그램에서 JPEG로 내보낸 원본으로 시도해 주세요. 화질을 낮추거나 크기를 줄이지 않은 파일이어야 합니다.',
        );
      } else {
        output.innerHTML = renderError(
          '검증 도중 문제가 생겼습니다',
          '파일을 읽는 중에 예상하지 못한 오류가 났습니다. 다른 파일로 시도해 보시고, 계속 같은 문제가 나면 어떤 파일이었는지 알려 주십시오.',
        );
      }
    } finally {
      busy = false;
    }
  };

  dropzone.addEventListener('click', () => input.click());
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
  });
  input.addEventListener('change', () => run(input.files?.[0]));

  ['dragenter', 'dragover'].forEach((type) =>
    dropzone.addEventListener(type, (e) => { e.preventDefault(); dropzone.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach((type) =>
    dropzone.addEventListener(type, (e) => { e.preventDefault(); dropzone.classList.remove('is-over'); }));
  dropzone.addEventListener('drop', (e) => run(e.dataTransfer?.files?.[0]));

  root.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action="reset"]');
    if (action) { e.preventDefault(); reset(); }
  });

  // 아이콘과 접수처를 꽂아 둡니다.
  root.querySelectorAll('[data-icon]').forEach((el) => {
    el.innerHTML = ICONS[el.dataset.icon] || '';
  });
  document.querySelectorAll('[data-queue-grade2]').forEach((el) => {
    el.textContent = queueLine(REVIEW_QUEUE.grade2);
  });
  document.querySelectorAll('[data-queue-grade1]').forEach((el) => {
    el.textContent = queueLine(REVIEW_QUEUE.grade1);
  });
  document.querySelectorAll('[data-review-contact]').forEach((el) => {
    el.textContent = REVIEW_CONTACT;
    if (el.tagName === 'A') el.href = `mailto:${REVIEW_CONTACT}`;
  });
}

mountVerifier(document.querySelector('[data-verifier]'));
