/**
 * ui.js — 검증 도구 화면.
 *
 * 파일은 읽기만 하고 어디로도 보내지 않습니다.
 * 이 파일에 fetch, XMLHttpRequest, WebSocket, form action은 없습니다.
 * 확인하려면 브라우저 개발자 도구의 네트워크 탭을 켜고 검증해 보십시오.
 *
 * 투입구는 둘입니다.
 *   간단 검사 — 기계가 30초에 끝냅니다. 최대 3등급.
 *   상세 검사 — 같은 측정을 하고, 그 결과를 사람 심사로 넘깁니다. 최대 1등급.
 */

import { loadPixels } from './verify/pixels.js';
import { readExif, formatCamera, formatSettings } from './verify/exif.js';
import { analyzeConsistency } from './verify/consistency.js';
import { analyzeOptics } from './verify/optics.js';
import { analyzeCompression } from './verify/compression.js';
import { analyzeRephoto } from './verify/rephoto.js';
import { fingerprintFile, formatBytes } from './verify/fingerprint.js';
import { readProvenance } from './verify/provenance.js';
import { analyzeSynthesis } from './verify/synthesis.js';
import { gradeResult, VERDICT, GATE } from './grade.js';
import { scoreTraces, STATE_LABEL, aiSignals, synthesisSignals, SIDE } from './score.js';
import { REVIEW_QUEUE, CONTACT, MAIL, queueLine } from './queue.js';
import {
  renderMarkedImage, renderMarkOnly, markedFilename, markOnlyFilename,
  POSITIONS, DEFAULT_POSITION,
} from './watermark.js';
import { paintIcons } from './site.js';

/* 증서에 찍히는 울타리 마크 — public/favicon.svg와 같은 도형 */
const CERT_MARK = `<svg viewBox="1 4 30 24.6" width="38" height="31" fill="currentColor" aria-hidden="true"><path d="M3.4 27.6 L3.4 11 Q3.4 9.8 4.6 9.8 Q5.8 9.8 5.8 11 L5.8 27.6 Z" transform="rotate(-1 4.6 27.6)"/><path d="M9.2 27.6 L9.2 6.3 Q9.2 5.2 10.3 5.2 Q11.4 5.2 11.4 6.3 L11.4 27.6 Z" transform="rotate(0.7 10.3 27.6)"/><path d="M15 27.6 L15 13.65 Q15 12.4 16.25 12.4 Q17.5 12.4 17.5 13.65 L17.5 27.6 Z" transform="rotate(-0.5 16.25 27.6)"/><path d="M20.8 27.6 L20.8 7.7 Q20.8 6.6 21.9 6.6 Q23 6.6 23 7.7 L23 27.6 Z" transform="rotate(1.1 21.9 27.6)"/><path d="M26.6 27.6 L26.6 11.6 Q26.6 10.4 27.8 10.4 Q29 10.4 29 11.6 L29 27.6 Z" transform="rotate(-0.8 27.8 27.6)"/><rect x="2.3" y="17.3" width="27.3" height="1.9" rx="0.55" transform="rotate(-1.2 16 18.25)"/></svg>`;

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

const stripTags = (html) => String(html).replace(/<[^>]+>/g, '');
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

/* ── 측정 결과 → 표 ──────────────────────────────────── */

function buildRows({ exif, consistency, optics, compression, rephoto, pixels }) {
  const rows = [];

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
      state = STATE.none('대조 불가');
      value = `ISO 기록 없음, 측정 노이즈 σ=${nf(darkSigma)}`;
    } else {
      state = STATE.ok('정합');
      value = `ISO ${consistency.iso}, 측정 노이즈 σ=${nf(darkSigma)}`;
    }
    rows.push({
      item: 'ISO 대 노이즈', state, value,
      sub: darkSigma == null ? null : `어두운 패치 ${darkPatchCount}개 기준`,
    });
  }

  {
    const { slopeCorrelation, relativeSpread, binSigma } = consistency.measured;
    const populated = binSigma.filter((v) => v != null).length;
    let state;
    if (slopeCorrelation == null) state = STATE.none('측정 불가');
    else if (consistency.flags.noiseSignalInverted) state = STATE.flag('역전');
    else if (consistency.flags.noiseSignalFlat) state = STATE.flag('균일');
    else state = STATE.ok('정상');

    rows.push({
      item: '노이즈-신호 관계', state,
      value: slopeCorrelation == null
        ? `휘도 구간 ${populated}/8개 — 밝기 분포가 좁습니다`
        : `구간 상관 ${slopeCorrelation > 0 ? '+' : ''}${nf(slopeCorrelation)}, 상대 폭 ${nf(relativeSpread)}`,
      sub: slopeCorrelation == null ? null
        : `휘도 8구간 중 ${populated}개에서 측정 · 실제 센서는 밝을수록 노이즈가 커집니다`,
    });
  }

  {
    const { ratio, detected } = optics.vignetting;
    rows.push({
      item: '비네팅',
      state: ratio == null ? STATE.none('측정 불가') : detected ? STATE.ok('검출') : STATE.none('미검출'),
      value: ratio == null ? '—' : `코너 대비 중앙 ${nf(ratio)}`,
      sub: ratio == null || detected ? null : '카메라 내 보정이나 크롭으로도 지워집니다',
    });
  }

  {
    const { shiftPx, edgeCount, measurable, detected } = optics.chromaticAberration;
    rows.push({
      item: '색수차',
      state: !measurable ? STATE.none('측정 불가') : detected ? STATE.ok('검출') : STATE.none('미검출'),
      value: !measurable ? `고대비 엣지 ${edgeCount}개 — 표본이 모자랍니다` : `엣지 편차 ${nf(shiftPx)}px`,
      sub: measurable ? `고대비 엣지 ${edgeCount}개에서 R·B 위치 비교` : null,
    });
  }

  {
    const { abruptness, logRange, discontinuous } = optics.focus;
    rows.push({
      item: '초점 연속성',
      state: discontinuous ? STATE.flag('불연속') : STATE.ok('정상'),
      value: `그리드 편차 ${nf(abruptness)}`,
      sub: `8×8 선명도 지도 · 선명도 폭 ${nf(logRange)}`,
    });
  }

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

  {
    const { level, peakRatio, peakCount, focusUniformity, measurable } = rephoto;
    let state;
    if (!measurable) state = STATE.none('측정 불가');
    else if (level === 'present') state = STATE.info('검출');
    else if (level === 'weak') state = STATE.info('약함');
    else state = STATE.none('없음');

    rows.push({
      item: '화면 재촬영 신호', state,
      value: !measurable
        ? '주파수 분석에 필요한 크기가 안 됩니다'
        : level === 'present'
          ? `주파수 피크 ${nf(peakRatio, 1)}배, ${peakCount}개`
          : level === 'weak'
            ? `선명도 균일도 ${nf(focusUniformity)}`
            : `규칙적 피크 없음 (최대 ${nf(peakRatio, 1)}배)`,
      sub: level === 'none' ? null : '이 신호는 등급을 깎지 않습니다. 판단은 사람 심사에서 합니다.',
    });
  }

  rows.push({
    item: '해상도',
    state: STATE.ok(`${pixels.width}×${pixels.height}`),
    value: `${nf(pixels.megapixels, 1)}메가픽셀`,
    sub: null,
  });

  return rows;
}

/** 결과를 열자마자 보이는 세 줄. 나머지는 접어 둡니다. */
function keyLines({ exif, consistency, optics }) {
  const camera = formatCamera(exif);
  const lines = [];

  lines.push({
    label: '촬영 정보',
    state: camera ? STATE.ok('있음') : STATE.none('없음'),
    value: camera ? [camera, exif.lensModel].filter(Boolean).join(' / ') : '메타데이터가 남아 있지 않습니다',
  });

  const { darkSigma } = consistency.measured;
  lines.push({
    label: 'ISO 대 노이즈',
    state: consistency.flags.isoNoiseMismatch ? STATE.flag('모순')
      : darkSigma == null ? STATE.none('측정 불가')
        : consistency.iso == null ? STATE.none('대조 불가') : STATE.ok('정합'),
    value: darkSigma == null
      ? '잴 수 있는 어두운 영역이 모자랍니다'
      : `${consistency.iso ? `ISO ${consistency.iso}, ` : ''}측정 노이즈 σ=${nf(darkSigma)}`,
  });

  const v = optics.vignetting;
  const ca = optics.chromaticAberration;
  const found = [v.detected && '비네팅', ca.detected && '색수차'].filter(Boolean);
  lines.push({
    label: '렌즈 흔적',
    state: found.length ? STATE.ok(`${found.length}종 검출`) : STATE.none('미검출'),
    value: found.length
      ? `${found.join(' · ')} · 코너 대비 중앙 ${nf(v.ratio)}${ca.detected ? `, 엣지 편차 ${nf(ca.shiftPx)}px` : ''}`
      : '보정이나 크롭으로도 지워집니다. 감점 사유가 아닙니다.',
  });

  return lines;
}

function renderKeyLines(lines) {
  return `<dl class="keyline">${lines.map((l) => `
    <div>
      <dt>${escapeHtml(l.label)}</dt>
      <dd><span class="state ${l.state.cls}">${escapeHtml(l.state.text)}</span><span class="val">${escapeHtml(l.value)}</span></dd>
    </div>`).join('')}</dl>`;
}

function renderTable(rows) {
  const body = rows.map((row) => `
    <tr>
      <td class="col-item">${escapeHtml(row.item)}</td>
      <td class="col-state"><span class="state ${row.state.cls}">${escapeHtml(row.state.text)}</span></td>
      <td class="col-value">${row.value}${row.sub ? `<span class="sub">${row.sub}</span>` : ''}</td>
    </tr>`).join('');
  return `<table class="measure-table">
      <thead><tr><th>측정 항목</th><th>판정</th><th>측정값</th></tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}

function summaryLines(result, rows, print) {
  return [
    `판정: ${result.headline}`,
    print.sha256 ? `원본 지문(SHA-256): ${print.sha256}` : '원본 지문: 계산 불가',
    print.bytes != null ? `파일 크기: ${print.bytes}바이트` : '',
    '',
    ...rows.map((row) => `${row.item}: ${row.state.text} — ${stripTags(row.value)}`),
  ].filter(Boolean);
}

/* ── 파이프라인 ──────────────────────────────────────── */

const STEPS = [
  '파일 지문 계산',
  '촬영 정보 읽기',
  '출처 표식 읽기',
  '픽셀 준비',
  'EXIF 대 픽셀 정합성',
  '광학 흔적',
  '압축 이력',
  '화면 재촬영 신호',
  '생성물 흔적',
];

export async function verifyFile(file, onStep) {
  const step = async (index) => { onStep?.(index, STEPS[index]); await nextFrame(); };

  await step(0);
  const print = await fingerprintFile(file);
  await step(1);
  const exif = await readExif(file);
  await step(2);
  const provenance = await readProvenance(file);
  await step(3);
  const pixels = await loadPixels(file);
  await step(4);
  const consistency = analyzeConsistency(pixels, exif);
  await step(5);
  const optics = analyzeOptics(pixels);
  await step(6);
  const compression = analyzeCompression(pixels);
  await step(7);
  const rephoto = analyzeRephoto(pixels, optics);
  await step(8);
  const synthesis = await analyzeSynthesis(pixels, file);

  const bundle = { exif, consistency, optics, compression, rephoto, pixels, print, provenance, synthesis };
  return { ...bundle, result: gradeResult(bundle) };
}

/* ── 결과 화면 ───────────────────────────────────────── */

function stampFor(result) {
  if (result.verdict === VERDICT.PASS) {
    return `<span class="cert-stamp"><span class="g">3</span><span>등급</span></span>`;
  }
  if (result.verdict === VERDICT.DECLARED_AI) {
    return `<span class="cert-stamp cert-stamp--hold">AI 생성 기록</span>`;
  }
  if (result.verdict === VERDICT.HOLD) return `<span class="cert-stamp cert-stamp--hold">보류</span>`;
  return `<span class="cert-stamp cert-stamp--insufficient">판정 불가</span>`;
}

function reasonList(title, items) {
  if (!items.length) return '';
  return `<div class="panel">
      <p class="panel-title">${escapeHtml(title)}</p>
      <dl class="def-list">
        ${items.map((i) => `<div><dt>${escapeHtml(i.title)}</dt><dd>${escapeHtml(i.detail)}</dd></div>`).join('')}
      </dl>
    </div>`;
}

function fold(summary, hint, body, open = false) {
  return `<details class="fold"${open ? ' open' : ''}>
      <summary>${escapeHtml(summary)}${hint ? `<span class="hint">${escapeHtml(hint)}</span>` : ''}</summary>
      <div class="fold-body">${body}</div>
    </details>`;
}

const NO_GUARANTEE = `
  <ul style="margin:0;padding-left:1.15em;font-size:14.5px;color:var(--ink-2);line-height:1.7">
    <li>무엇이 찍혔는지 — 피사체가 실제로 존재했는지는 확인하지 않았습니다.</li>
    <li>누가 찍었는지 — 촬영자와 제출자가 같은 사람인지 확인하지 않았습니다.</li>
    <li>언제 찍었는지 — 촬영 시각은 파일에 적힌 주장이고, 기기 시계는 바꿀 수 있습니다.</li>
    <li>화면을 다시 찍은 경우 — 잘 찍으면 이 검사를 통과합니다. 그래서 상세 검사가 있습니다.</li>
  </ul>
  <p style="margin:14px 0 0;font-size:13.5px;color:var(--ink-3)">
    자동 검증이 놓치는 경우를 <a href="/limits">전부 적어 둔 페이지</a>가 따로 있습니다.
  </p>`;

/* ── 환산 수치 화면 ──────────────────────────────────── */

/**
 * 두 값이 100을 나눠 갖는 막대. 조각 사이는 2px 띄우고, 바깥쪽 끝만 둥글게.
 * 색만으로 구분하지 않도록 양쪽에 직접 라벨을 답니다.
 */
function splitBar(trace, ai) {
  return `
    <div class="sbar" role="img" aria-label="촬영 흔적 ${trace}%, AI 생성 환산 ${ai}%">
      <span class="sbar-seg sbar-seg--trace" style="width:${trace}%"></span>
      <span class="sbar-seg sbar-seg--ai" style="width:${ai}%"></span>
    </div>`;
}

/**
 * 파일이 스스로 밝힌 출처.
 * 증서가 이미 같은 문장을 헤드라인으로 달고 있어서, 별도 상자를 만들지 않고
 * 증서 안에 사실 목록만 넣습니다. 같은 말을 두 상자에 적지 않습니다.
 */
function renderProvenanceFacts(prov) {
  if (!prov?.present) return '';

  const facts = [
    prov.sourceLabel && ['선언된 출처', `${prov.sourceLabel} (${prov.sourceType})`],
    prov.generator && ['생성기', prov.generator],
    prov.signer && ['서명', prov.signer],
    prov.createdAt && ['기록된 시각', prov.createdAt.replace('T', ' ').replace('Z', ' UTC')],
    prov.watermarked && ['워터마크', '보이지 않는 워터마크를 넣었다고 기록돼 있습니다'],
  ].filter(Boolean);

  return `
    <div class="prov-block${prov.declaresAi ? ' prov-block--ai' : ''}">
      <p class="prov-src">${escapeHtml(prov.via)} 표식에서 읽음 — 픽셀을 잰 값이 아니라 파일에 적힌 값입니다</p>
      <dl class="prov-facts">
        ${facts.map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}
      </dl>
      <p class="prov-note">
        ${prov.declaresAi
          ? '이 표식은 지울 수 있습니다. 화면을 캡처하거나 다시 저장하면 사라지므로, 표식이 없다고 해서 AI가 아니라는 뜻은 되지 않습니다.'
          : '표식은 위조와 삭제가 모두 가능하므로, 이것만으로 진위가 확정되지는 않습니다.'}
      </p>
    </div>`;
}

function renderScorePanel(bundle) {
  const { trace, ai, categories, declared } = scoreTraces(bundle);
  const { result, pixels } = bundle;

  const bars = categories.map((c) => {
    const pct = Math.round((c.earned / c.weight) * 100);
    return `
      <div class="cat" data-state="${c.state}">
        <div class="cat-head">
          <span class="cat-name">${escapeHtml(c.label)}</span>
          <span class="cat-state">${escapeHtml(STATE_LABEL[c.state])}</span>
          <span class="cat-num">${c.earned} <span class="cat-den">/ ${c.weight}</span></span>
        </div>
        <div class="cat-track"><i style="width:${pct}%"></i></div>
        <p class="cat-note">${escapeHtml(c.note)}</p>
      </div>`;
  }).join('');

  /* AI 판별 기준. 화소 하한이나 "약한 신호 n건" 같은 집계는 여기 넣지 않습니다.
     측정이 가능한지를 말할 뿐 AI인지를 말하지 않기 때문입니다.
     접어 두지 않습니다 — 판별 근거는 눌러야 나오면 근거 구실을 못 합니다. */
  const prov = bundle.provenance;
  const signals = [...aiSignals(bundle), ...synthesisSignals(bundle)];
  const tally = { camera: 0, unknown: 0, ai: 0 };
  signals.forEach((r) => { tally[r.side] += 1; });

  // 근거가 나온 기준은 펼쳐 두고, 잴 수 없었던 기준은 접어 둡니다.
  const found = signals.filter((r) => r.side !== 'unknown');
  const quiet = signals.filter((r) => r.side === 'unknown');

  const sigRow = (r) => `
    <li class="sig-row sig-row--${r.side}${r.decisive ? ' is-decisive' : ''}">
      <div class="sig-top">
        <span class="sig-name">${escapeHtml(r.label)}</span>
        ${r.decisive ? '<span class="sig-decisive">결정적</span>' : ''}
        <span class="sig-side">${escapeHtml(SIDE[r.side])}</span>
        <span class="sig-got">${escapeHtml(r.got)}</span>
      </div>
      <p class="sig-basis">기준 — ${escapeHtml(r.basis)}</p>
      <p class="sig-note">${escapeHtml(r.note)}</p>
    </li>`;

  const eligible = result.verdict === VERDICT.PASS;
  const mp = pixels.megapixels;
  const blockers = [
    prov?.declaresAi && 'AI 생성 표식 있음',
    !bundle.exif.hasCameraId && '촬영 정보 없음',
    result.contradictions.length > 0 && `정합성 모순 ${result.contradictions.length}건`,
    result.softSignals.length >= GATE.softSignalsForHold && `약한 신호 ${result.softSignals.length}건`,
    mp < GATE.minMegapixels && `화소 ${mp.toFixed(1)}MP`,
  ].filter(Boolean);

  return `
    <div class="panel score-panel">
      <p class="panel-title">환산 수치</p>

      <div class="score-hero">
        <div class="score-figure">
          <span class="score-num score-num--trace">${trace}<small>%</small></span>
          <span class="score-cap">촬영 흔적</span>
        </div>
        <div class="score-figure score-figure--end">
          <span class="score-num score-num--ai">${ai}<small>%</small></span>
          <span class="score-cap">AI 생성 환산</span>
        </div>
      </div>
      ${splitBar(trace, ai)}
      <p class="score-caveat">
        ${declared
          ? '파일에 AI 생성 기록이 적혀 있어 촬영 흔적을 세지 않았습니다. 배점을 계산한 값이 아닙니다.'
          : `학습된 분류기의 판단이 아닙니다. 아래 항목에 사람이 정한 배점을 곱해 더한 값이라
             배점을 바꾸면 숫자도 바뀝니다.`}
      </p>

      <p class="panel-title score-sub">AI 판별 기준</p>

      <p class="sig-lead">
        아래 <strong>${signals.length}가지</strong> 기준으로 검사했고,
        그중 <strong>${found.length}가지</strong>에서 근거가 나왔습니다.
      </p>
      <p class="sig-list">${signals.map((r) => escapeHtml(r.label)).join(' · ')}</p>

      <div class="sigbar" role="img"
           aria-label="카메라 쪽 ${tally.camera}건, AI 쪽 ${tally.ai}건, 판단 보류 ${tally.unknown}건">
        ${tally.camera ? `<span class="sigbar-seg sigbar-seg--camera" style="flex:${tally.camera}"></span>` : ''}
        ${tally.ai ? `<span class="sigbar-seg sigbar-seg--ai" style="flex:${tally.ai}"></span>` : ''}
        ${tally.unknown ? `<span class="sigbar-seg sigbar-seg--none" style="flex:${tally.unknown}"></span>` : ''}
      </div>
      <ul class="sigkey">
        <li><i class="k k--camera"></i>카메라 쪽 <b>${tally.camera}</b></li>
        <li><i class="k k--ai"></i>AI 쪽 <b>${tally.ai}</b></li>
        <li><i class="k k--none"></i>판단 보류 <b>${tally.unknown}</b></li>
      </ul>

      <p class="tally-read${tally.camera === 0 ? ' is-none' : ''}">
        ${tally.camera === 0
          ? `카메라를 거친 흔적이 <strong>한 건도</strong> 잡히지 않았습니다.
             다만 흔적이 지워진 실제 사진에서도 같은 결과가 나옵니다 — AI라는 단정이 아닙니다.`
          : `카메라를 거친 흔적이 <strong>${tally.camera}건</strong> 잡혔습니다.
             ${tally.ai > 0 ? `다만 ${tally.ai}건은 반대 방향입니다.` : ''}`}
      </p>

      ${found.length ? `<ul class="sig">${found.map(sigRow).join('')}</ul>` : ''}
      ${quiet.length
        ? fold('판단이 서지 않은 기준', `${quiet.length}가지 · 이 사진에서는 잴 수 없었습니다`,
          `<ul class="sig sig--quiet">${quiet.map(sigRow).join('')}</ul>`)
        : ''}

      ${declared ? '' : fold('환산 수치는 어떻게 나왔나', '여섯 항목의 배점',
        `<div class="cats">${bars}</div>`)}

      <p class="panel-title score-sub">인증 마크</p>
      <p class="gate-verdict${eligible ? ' is-ok' : ''}">
        ${eligible
          ? '발급했습니다. 발급 조건을 모두 충족합니다.'
          : `발급하지 않습니다. 막은 조건 — ${escapeHtml(blockers.join(', '))}`}
      </p>
      <p class="score-caveat">
        발급 조건은 다섯입니다 — AI 생성 표식 없음 · 촬영 정보(제조사·모델 + 촬영 시각) 있음 ·
        정합성 모순 0건 · 약한 신호 ${GATE.softSignalsForHold}건 미만 · 화소 ${GATE.minMegapixels}MP 이상.
        환산 수치(${trace}%)는 발급 근거가 아니라 표시용입니다.
      </p>
    </div>`;
}

function renderResult(bundle, mode) {
  const { result, print } = bundle;
  const rows = buildRows(bundle);
  const summary = summaryLines(result, rows, print);
  const isPass = result.verdict === VERDICT.PASS;
  const isDeclared = result.verdict === VERDICT.DECLARED_AI;

  const certClass = isPass ? ''
    : (result.verdict === VERDICT.HOLD || result.verdict === VERDICT.DECLARED_AI)
      ? ' cert--hold' : ' cert--insufficient';

  const fingerprint = print.sha256
    ? `원본 파일 지문 <span class="hash">${escapeHtml(print.short)}…</span> · 이 기기에서만 계산됐고 어디로도 전송되지 않았습니다`
    : '파일 지문을 계산하지 못했습니다 — 브라우저가 보안 컨텍스트가 아닙니다';

  // 통과하면 마크 패널을 바로 펼칩니다. 버튼 뒤에 숨기면 결과물이 있는 줄도 모릅니다.
  const markPanel = isPass ? `
    <div class="panel wm-panel" data-watermark>
      <p class="panel-title">인증 마크 — 내려받기</p>
      <p class="wm-lead">사진에 마크를 새겨 받거나, 마크만 따로 받아 직접 배치하실 수 있습니다.</p>
      <div class="wm-controls">
        <span class="wm-label">마크 위치</span>
        <div class="seg" role="radiogroup" aria-label="마크 위치">
          ${POSITIONS.map((p) => `<button type="button" role="radio" class="seg-btn${p.id === DEFAULT_POSITION ? ' is-on' : ''}" aria-checked="${p.id === DEFAULT_POSITION}" data-pos="${p.id}">${escapeHtml(p.label)}</button>`).join('')}
        </div>
      </div>
      <figure class="wm-figure">
        <div class="wm-stage" data-wm-stage><span class="wm-loading">마크 새기는 중…</span></div>
        <figcaption data-wm-caption>미리보기입니다. 내려받는 파일은 원본 해상도 그대로입니다.</figcaption>
      </figure>
      <div class="btn-row">
        <button class="btn" type="button" data-action="dl-photo"><span data-icon="download"></span>마크 넣은 사진 내려받기</button>
        <button class="btn btn--ghost" type="button" data-action="dl-mark">마크만 내려받기 (투명 PNG)</button>
      </div>
      <p class="btn-note">브라우저의 기본 다운로드 폴더에 저장됩니다. 파일을 만드는 것도 저장하는 것도 이 기기에서만 일어납니다.</p>
    </div>` : '';

  const deepPanel = mode === 'deep' ? `
    <div class="panel">
      <p class="panel-title">상세 검사 접수</p>
      <p style="font-size:15px;margin-bottom:6px">
        여기부터는 사람이 봅니다. 화면을 다시 찍은 것은 아닌지, 그림자와 반사가 서로 맞는지,
        같은 카메라에서 나온 다른 컷이 있는지. 2등급은 며칠, 센서 지문까지 대조하는 1등급은 몇 주 걸립니다.
      </p>
      <p style="font-size:13.5px;color:var(--ink-3);margin-bottom:16px">
        2등급 ${escapeHtml(queueLine(REVIEW_QUEUE.grade2))} 1등급 ${escapeHtml(queueLine(REVIEW_QUEUE.grade1))}
        접수처 ${escapeHtml(CONTACT)}
      </p>
      <p class="panel-title" style="margin-bottom:8px">보낼 내용 — 이미지는 들어가지 않습니다</p>
      <pre class="copybox" data-submission>${escapeHtml(summary.join('\n'))}</pre>
      <div class="btn-row">
        <a class="btn" href="${MAIL.deepReview(summary)}">메일로 신청서 열기</a>
        <button class="btn btn--ghost" type="button" data-action="copy">신청서 복사</button>
        <button class="btn btn--ghost" type="button" data-action="reset">다른 사진</button>
      </div>
      <p class="btn-note">원본 파일은 담당자와 연락이 닿은 뒤 직접 전달하시면 됩니다. 지금 보내지 않습니다.</p>
    </div>` : '';

  const hints = result.hints.length
    ? fold('함께 읽어 두실 것', `${result.hints.length}가지`, `
        <ul style="margin:0;padding-left:1.15em;font-size:14.5px;color:var(--ink-2);line-height:1.7">
          ${result.hints.map((h) => `<li>${escapeHtml(h)}</li>`).join('')}
        </ul>`)
    : '';

  return `
    <section class="cert${certClass}">
      <div class="cert-top">
        <span class="cert-mark">${CERT_MARK}</span>
        ${stampFor(result)}
      </div>
      ${isPass ? '' : `<h2>${escapeHtml(result.headline)}</h2>`}
      <p class="statement">${result.statement.map((l) => `<span>${escapeHtml(l)}</span>`).join('')}</p>
      ${renderProvenanceFacts(bundle.provenance)}
      ${isDeclared ? '' : renderKeyLines(keyLines(bundle))}
      <p class="fingerprint-line">${fingerprint}</p>
    </section>

    ${renderScorePanel(bundle)}

    ${markPanel}
    ${deepPanel}

    <div class="folds">
      ${reasonFold('자동 검증이 멈춘 이유', result.blockers)}
      ${reasonFold('서로 맞지 않는 측정값', result.contradictions)}
      ${fold('측정값 전체 보기', `${rows.length}개 항목`, renderTable(rows))}
      ${result.softSignals.length
        ? fold('약한 신호', `${result.softSignals.length}가지 · 단독으로는 판정을 바꾸지 않습니다`, `
            <dl class="def-list">${result.softSignals.map((i) =>
              `<div><dt>${escapeHtml(i.title)}</dt><dd>${escapeHtml(i.detail)}</dd></div>`).join('')}</dl>`)
        : ''}
      ${hints}
      ${fold('이 등급이 보장하지 않는 것', null, NO_GUARANTEE)}
    </div>

    <div class="end-actions">
      <button class="btn" type="button" data-action="reset">다른 사진 검사하기</button>
      <button class="btn btn--ghost" type="button" data-action="swap-mode">
        이 사진으로 ${mode === 'quick' ? '상세 검사' : '간단 검사'}
      </button>
      <p class="btn-note">다시 재지 않습니다. 이미 계산한 측정값을 그대로 씁니다.</p>
    </div>`;
}

/** 펼쳐 둘 만큼 새롭지 않은 설명은 접어 둡니다. 내용은 그대로입니다. */
function reasonFold(title, items) {
  if (!items.length) return '';
  return fold(title, `${items.length}가지`, `
    <dl class="def-list">${items.map((i) =>
      `<div><dt>${escapeHtml(i.title)}</dt><dd>${escapeHtml(i.detail)}</dd></div>`).join('')}</dl>`);
}

function renderError(message, detail) {
  return `<section class="cert cert--insufficient">
      <div class="cert-top"><span class="cert-mark">${CERT_MARK}</span>
        <span class="cert-stamp cert-stamp--insufficient">판정 불가</span></div>
      <h2>${escapeHtml(message)}</h2>
      <p class="statement"><span>${escapeHtml(detail)}</span></p>
      <div class="btn-row">
        <button class="btn" type="button" data-action="reset">다시 시도</button>
        <a class="btn btn--ghost" href="/how">무엇을 측정하는지 보기</a>
      </div>
    </section>`;
}

/* ── 조립 ────────────────────────────────────────────── */

const MODE_LABEL = { quick: '간단 검사', deep: '상세 검사' };

export function mountVerifier(root) {
  if (!root) return;

  const lanes = root.querySelector('[data-lanes]');
  const runArea = root.querySelector('[data-run]');
  const fileLine = root.querySelector('[data-file-line]');
  const progress = root.querySelector('[data-progress]');
  const progressLabel = root.querySelector('[data-progress-label]');
  const progressBar = root.querySelector('[data-progress-bar]');
  const output = root.querySelector('[data-output]');
  const readyBox = root.querySelector('[data-ready]');
  const readyNote = root.querySelector('[data-ready-note]');

  let previewUrl = null;
  let markUrl = null;
  let current = null;      // { file, mode, bundle } — 측정이 끝난 것
  let pending = null;      // { file, mode } — 받아 두고 시작을 기다리는 것
  let busy = false;

  const revoke = () => {
    if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
    if (markUrl) { URL.revokeObjectURL(markUrl); markUrl = null; }
  };

  const reset = () => {
    revoke();
    current = null;
    pending = null;
    busy = false;
    output.innerHTML = '';
    fileLine.innerHTML = '';
    runArea.hidden = true;
    readyBox.hidden = true;
    progress.hidden = true;
    if (stepList) stepList.innerHTML = '';
    lanes.hidden = false;
    root.querySelectorAll('input[type="file"]').forEach((i) => { i.value = ''; });
    lanes.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  /** 같은 사진을 다른 검사 방식으로 다시 봅니다. 측정은 다시 하지 않습니다. */
  const swapMode = async () => {
    if (!current || busy) return;
    current.mode = current.mode === 'quick' ? 'deep' : 'quick';
    const tag = fileLine.querySelector('.mode-tag');
    if (tag) tag.textContent = MODE_LABEL[current.mode];
    output.innerHTML = renderResult(current.bundle, current.mode);
    paintIcons(output);
    if (current.bundle.result.grade) await refreshMarkPreview();
    output.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  const stepList = root.querySelector('[data-steps]');

  const drawSteps = (activeIndex, allDone = false) => {
    stepList.innerHTML = STEPS.map((label, i) => {
      const state = allDone || i < activeIndex ? 'is-done' : i === activeIndex ? 'is-active' : '';
      return `<li class="${state}"><span class="dot"></span><span>${escapeHtml(label)}</span></li>`;
    }).join('');
  };

  const showProgress = (index, label) => {
    progress.hidden = false;
    drawSteps(index);
    progressLabel.textContent = `${label}…`;
    progressBar.style.width = `${Math.round(((index + 1) / STEPS.length) * 100)}%`;
  };

  const runNote = root.querySelector('.run-note');

  const finishProgress = (elapsedMs) => {
    drawSteps(STEPS.length, true);
    progressBar.style.width = '100%';
    progressLabel.textContent = `검사 완료 · ${STEPS.length}단계 · ${(elapsedMs / 1000).toFixed(1)}초`;
    if (runNote) runNote.textContent = '이 기기에서만 계산했습니다. 어디로도 전송하지 않았습니다.';
  };

  /* 1단계 — 받았다는 사실만 알립니다. 측정은 사용자가 누를 때 시작합니다.
     파일이 들어왔는지 모르는 채로 기다리게 하지 않기 위한 단계입니다. */
  const stage = (file, mode) => {
    if (busy || !file) return;
    revoke();
    pending = { file, mode };
    current = null;
    lanes.hidden = true;
    runArea.hidden = false;
    output.innerHTML = '';
    progress.hidden = true;
    if (stepList) stepList.innerHTML = '';
    progressBar.style.width = '0%';

    previewUrl = URL.createObjectURL(file);
    fileLine.innerHTML = `
      <img src="${previewUrl}" alt="">
      <div class="meta">
        <div class="name">${escapeHtml(file.name || '이름 없는 파일')}<span class="mode-tag">${MODE_LABEL[mode]}</span></div>
        <div>${escapeHtml(file.type || '형식 미상')} · ${escapeHtml(formatBytes(file.size) || '')}</div>
        <div style="color:var(--ink-3)">이 미리보기는 브라우저 메모리에만 있습니다.</div>
      </div>`;
    readyNote.textContent = `${MODE_LABEL[mode]}로 ${STEPS.length}단계를 잰 뒤 판정합니다.`;
    readyBox.hidden = false;
    paintIcons(runArea);
    runArea.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  /* 2단계 — 실제 측정. 진행이 보이고, 끝나면 결과가 남습니다. */
  const start = async () => {
    if (busy || !pending) return;
    const { file, mode } = pending;
    busy = true;
    readyBox.hidden = true;
    output.innerHTML = '';

    const startedAt = performance.now();
    drawSteps(0);
    progress.hidden = false;
    progressBar.style.width = '0%';
    progressLabel.textContent = '시작하는 중…';
    if (runNote) runNote.textContent = '이 기기에서 계산 중입니다. 업로드가 아닙니다.';

    try {
      const bundle = await verifyFile(file, showProgress);
      current = { file, mode, bundle, position: DEFAULT_POSITION };
      finishProgress(performance.now() - startedAt);
      output.innerHTML = renderResult(bundle, mode);
      paintIcons(output);
      if (bundle.result.grade) await refreshMarkPreview();
    } catch (err) {
      progress.hidden = true;
      output.innerHTML = err && err.message === 'DECODE_FAILED'
        ? renderError('이 파일은 브라우저가 열지 못했습니다',
          'RAW(.cr3, .nef, .arw 등)와 일부 HEIC는 브라우저가 직접 디코딩하지 못합니다. 카메라나 편집 프로그램에서 화질을 낮추지 않고 JPEG로 내보낸 파일로 시도해 주세요.')
        : renderError('검증 도중 문제가 생겼습니다',
          '파일을 읽는 중에 예상하지 못한 오류가 났습니다. 다른 파일로 시도해 보시고, 계속 같은 문제가 나면 어떤 파일이었는지 알려 주십시오.');
    } finally {
      busy = false;
    }
  };

  // 파일 선택은 label의 기본 동작에 맡깁니다. input.click()을 부르지 않습니다.
  root.querySelectorAll('input[type="file"][data-mode]').forEach((input) => {
    input.addEventListener('change', () => stage(input.files?.[0], input.dataset.mode));
  });

  root.querySelectorAll('[data-dropzone]').forEach((zone) => {
    const mode = zone.dataset.dropzone;
    ['dragenter', 'dragover'].forEach((type) =>
      zone.addEventListener(type, (e) => { e.preventDefault(); zone.classList.add('is-over'); }));
    ['dragleave', 'drop'].forEach((type) =>
      zone.addEventListener(type, (e) => { e.preventDefault(); zone.classList.remove('is-over'); }));
    zone.addEventListener('drop', (e) => stage(e.dataTransfer?.files?.[0], mode));
  });

  const PREVIEW_EDGE = 1100;   // 미리보기는 이 크기로 줄여 그립니다. 비율은 같습니다.

  const markOptions = () => ({
    grade: current.bundle.result.grade,
    shortHash: current.bundle.print.short || '지문 없음',
    dateText: new Date().toISOString().slice(0, 10),
    position: current.position,
  });

  const refreshMarkPreview = async () => {
    if (!current) return;
    const stage = output.querySelector('[data-wm-stage]');
    const caption = output.querySelector('[data-wm-caption]');
    if (!stage) return;
    stage.innerHTML = '<span class="wm-loading">마크 새기는 중…</span>';
    try {
      const preview = await renderMarkedImage(current.file, { ...markOptions(), maxEdge: PREVIEW_EDGE });
      if (markUrl) URL.revokeObjectURL(markUrl);
      markUrl = preview.url;
      stage.innerHTML = `<img src="${markUrl}" alt="인증 마크가 새겨진 사진 미리보기">`;
      caption.textContent =
        `미리보기 ${preview.width}×${preview.height} · 내려받는 파일은 원본 ${current.bundle.pixels.width}×${current.bundle.pixels.height} 그대로입니다.`;
    } catch {
      stage.innerHTML = '<span class="wm-loading">미리보기를 만들지 못했습니다. 내려받기는 시도해 보실 수 있습니다.</span>';
    }
  };

  const saveBlob = (url, filename) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  /** 내려받기는 원본 해상도로 그때 만듭니다. 미리보기용 축소본을 주지 않습니다. */
  const downloadMarked = async (button) => {
    if (!current) return;
    const label = button.innerHTML;
    button.disabled = true;
    button.textContent = '원본 해상도로 만드는 중…';
    try {
      const full = await renderMarkedImage(current.file, markOptions());
      saveBlob(full.url, markedFilename(current.file.name, current.bundle.result.grade, full.type));
      setTimeout(() => URL.revokeObjectURL(full.url), 20000);
      button.innerHTML = label;
      paintIcons(output);
    } catch {
      button.textContent = '만들지 못했습니다';
      setTimeout(() => { button.innerHTML = label; paintIcons(output); }, 2400);
    } finally {
      button.disabled = false;
    }
  };

  const downloadMarkOnly = async (button) => {
    if (!current) return;
    const label = button.textContent;
    button.disabled = true;
    button.textContent = '만드는 중…';
    try {
      const only = await renderMarkOnly({
        width: current.bundle.pixels.width,
        height: current.bundle.pixels.height,
        ...markOptions(),
      });
      saveBlob(only.url, markOnlyFilename(current.bundle.result.grade));
      setTimeout(() => URL.revokeObjectURL(only.url), 20000);
      button.textContent = label;
    } catch {
      button.textContent = '만들지 못했습니다';
      setTimeout(() => { button.textContent = label; }, 2400);
    } finally {
      button.disabled = false;
    }
  };

  const choosePosition = (button) => {
    if (!current) return;
    current.position = button.dataset.pos;
    output.querySelectorAll('.seg-btn').forEach((b) => {
      const on = b === button;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-checked', String(on));
    });
    refreshMarkPreview();
  };

  const copySubmission = async (button) => {
    const box = output.querySelector('[data-submission]');
    if (!box) return;
    const text = box.textContent;
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = '복사됨';
    } catch {
      const range = document.createRange();
      range.selectNodeContents(box);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      button.textContent = '직접 복사해 주세요';
    }
    setTimeout(() => { button.textContent = '신청서 복사'; }, 2200);
  };

  root.addEventListener('click', (e) => {
    const pos = e.target.closest('.seg-btn');
    if (pos) { e.preventDefault(); choosePosition(pos); return; }
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const act = el.dataset.action;
    if (act === 'start') { e.preventDefault(); start(); }
    if (act === 'swap-mode') { e.preventDefault(); swapMode(); }
    if (act === 'reset') { e.preventDefault(); reset(); }
    if (act === 'dl-photo') { e.preventDefault(); downloadMarked(el); }
    if (act === 'dl-mark') { e.preventDefault(); downloadMarkOnly(el); }
    if (act === 'copy') { e.preventDefault(); copySubmission(el); }
  });

  paintIcons(root);
}

mountVerifier(document.querySelector('[data-verifier]'));
