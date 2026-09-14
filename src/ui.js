/**
 * ui.js — 검증 도구 화면.
 *
 * 간단 검사는 파일을 읽기만 하고 어디로도 보내지 않습니다. 검사 코드에는
 * fetch, XMLHttpRequest, WebSocket, form action이 없습니다. 네트워크를 쓰는
 * 코드는 review.js 하나뿐이고, 사용자가 상세 검사 신청 버튼을 누른 뒤에만
 * 호출됩니다. 개발자 도구의 네트워크 탭을 켜고 확인해 보십시오.
 *
 * 투입구는 둘입니다.
 *   간단 검사 — 기계가 30초에 끝냅니다. 브라우저 안에서 끝납니다. 최대 3등급.
 *   상세 검사 — 같은 측정을 한 뒤 사진을 사람 심사로 올립니다. 최대 1등급.
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
import { CHECK_LABEL, CHECK_STATES } from './review-criteria.js';
import { escapeHtml, stripTags, fold } from './html.js';
import { readContainer } from './verify/container.js';
import { analyzeFrames } from './verify/frames.js';
import { analyzeSound } from './verify/sound.js';
import { gradeMedia, mediaScore } from './media.js';
import {
  MEDIA_STEPS, mediaKeyLines, mediaRows, mediaSummaryLines,
  renderMediaFacts, renderMediaScore,
} from './media-ui.js';
import { renderCertificate, certificateFilename } from './certificate.js';
import {
  submitApplication, fetchStatus, fetchStatusByContact, fetchQueue, listApplications,
  rememberApplication, formatDate, MAX_UPLOAD, MIN_PASSWORD,
} from './review.js';

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

/**
 * 무엇으로 온 파일인지 가립니다.
 *
 * MIME 형식을 먼저 믿고, 비어 있거나 엉뚱하면 확장자를 봅니다. 브라우저가
 * MOV에 빈 형식을 주는 경우가 있어서 확장자 갈래가 필요합니다.
 */
export function detectKind(file) {
  const type = (file.type || '').toLowerCase();
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';

  const ext = (file.name || '').toLowerCase().split('.').pop();
  if (/^(jpg|jpeg|png|webp|heic|heif|tif|tiff|gif|bmp|avif)$/.test(ext)) return 'image';
  if (/^(mp4|mov|m4v|webm|mkv|avi|3gp|mts|m2ts)$/.test(ext)) return 'video';
  if (/^(mp3|m4a|wav|flac|aac|ogg|opus|oga|aiff|aif|wma)$/.test(ext)) return 'audio';
  return 'unknown';
}

export const STEPS_FOR = (kind) => (kind === 'image' ? STEPS : MEDIA_STEPS[kind] || STEPS);

/**
 * 영상·음악 검사. 사진과 같은 순서로 진행을 알리고 같은 모양의 bundle을
 * 돌려줍니다 — 결과 화면과 접수, 인증서가 매체를 가리지 않게 하려는 것입니다.
 */
export async function verifyMedia(file, kind, onStep) {
  const labels = MEDIA_STEPS[kind];
  const step = async (index) => { onStep?.(index, labels[index]); await nextFrame(); };

  await step(0);
  const print = await fingerprintFile(file);
  await step(1);
  const container = await readContainer(file);
  await step(2);                               // 출처 표식은 컨테이너에서 함께 읽었습니다

  let frames = null;
  let sound = null;
  if (kind === 'video') {
    await step(3);
    frames = await analyzeFrames(file, (i) => onStep?.(3, `프레임 ${i + 1} 측정`));
    await step(4);
    await step(5);
    await step(6);
  } else {
    await step(3);
    sound = await analyzeSound(file, container.facts?.sampleRate || null);
    await step(4);
    await step(5);
    await step(6);
  }

  const bundle = { kind, print, container, frames, sound };
  return { ...bundle, result: gradeMedia(bundle) };
}

/** 어떤 파일이든 받아 매체에 맞는 검사로 보냅니다. */
export async function verifyAny(file, onStep) {
  const kind = detectKind(file);
  if (kind === 'video' || kind === 'audio') return verifyMedia(file, kind, onStep);
  if (kind === 'unknown') throw new Error('UNSUPPORTED_KIND');
  return verifyFile(file, onStep);
}

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

  const bundle = { kind: 'image', exif, consistency, optics, compression, rephoto, pixels, print, provenance, synthesis };
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
          ? '이 표식은 캡처하거나 다시 저장하면 사라집니다.'
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
             메신저를 거친 사진과 스크린샷에서도 같은 결과가 나옵니다.`
          : `카메라를 거친 흔적이 <strong>${tally.camera}건</strong> 잡혔습니다.
             ${tally.ai > 0 ? `다만 ${tally.ai}건은 반대 방향입니다.` : ''}`}
      </p>

      ${found.length ? `<ul class="sig">${found.map(sigRow).join('')}</ul>` : ''}
      ${quiet.length
        ? fold('판단이 서지 않은 기준', `${quiet.length}가지 · 이 파일에서는 잴 수 없었습니다`,
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

function renderResult(bundle, mode, openForm = false) {
  const { result, print } = bundle;
  const isImage = bundle.kind !== 'video' && bundle.kind !== 'audio';
  const rows = isImage ? buildRows(bundle) : mediaRows(bundle);
  const summary = isImage
    ? summaryLines(result, rows, print)
    : mediaSummaryLines(bundle);
  const isPass = result.verdict === VERDICT.PASS;
  const isDeclared = result.verdict === VERDICT.DECLARED_AI;
  const elig = eligibility(bundle);

  const certClass = isPass ? ''
    : (result.verdict === VERDICT.HOLD || result.verdict === VERDICT.DECLARED_AI)
      ? ' cert--hold' : ' cert--insufficient';

  const fingerprint = print.sha256
    ? `원본 파일 지문 <span class="hash">${escapeHtml(print.short)}…</span> · 이 기기에서만 계산됐고 어디로도 전송되지 않았습니다`
    : '파일 지문을 계산하지 못했습니다 — 브라우저가 보안 컨텍스트가 아닙니다';

  /* 영상과 음악에는 마크를 새겨 드릴 수 없습니다. 브라우저에서 영상을 다시
     인코딩할 수 없고, 소리에 그림을 얹는 것은 의미가 없습니다. 대신 마크만
     투명 PNG로 드리고 인증서로 사실을 적어 드립니다. */
  const markOnlyPanel = isPass && !isImage ? `
    <div class="panel wm-panel" data-watermark>
      <p class="panel-title">인증 마크 — 내려받기</p>
      <p class="wm-lead">
        ${bundle.kind === 'audio' ? '소리' : '영상'}에는 마크를 직접 새겨 드리지 않습니다.
        ${bundle.kind === 'audio'
          ? '소리 파일에 그림을 얹을 자리가 없습니다.'
          : '브라우저에서 영상을 다시 인코딩하면 화질이 떨어지고, 그러면 지문도 달라집니다.'}
        마크만 투명 PNG로 받아 표지나 자막에 직접 얹어 주십시오.
      </p>
      <div class="btn-row">
        <button class="btn" type="button" data-action="dl-mark">마크만 내려받기 (투명 PNG)</button>
      </div>
      <p class="btn-note">이 기기에서 만듭니다. 파일은 어디로도 가지 않습니다.</p>
    </div>` : '';

  // 통과하면 마크 패널을 바로 펼칩니다. 버튼 뒤에 숨기면 결과물이 있는 줄도 모릅니다.
  const markPanel = isPass && isImage ? `
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

  // 자격이 없으면 폼 대신 왜 안 되는지를 놓습니다. 상태는 이미 위에서 말했고,
  // 여기서는 그래서 무엇을 하면 되는지만 적습니다.
  const blockedPanel = `
    <div class="panel" data-apply>
      <p class="panel-title">신청할 수 없는 이유</p>
      <div class="apply-warn">
        ${elig.declared ? `
          <p><strong>파일이 스스로 AI 생성물이라고 기록하고 있습니다.</strong>${
            bundle.provenance?.generator || bundle.container?.generator
              ? ` 기록된 생성기는 ${escapeHtml(bundle.provenance?.generator || bundle.container.generator)}입니다.` : ''}
            이 기록은 생성한 쪽이 규격(C2PA)에 따라 서명해 남긴 것이라 사람이 다시 볼 여지가 없습니다.</p>
          <p>측정값 때문이 아니라 파일에 적힌 것 때문입니다. 촬영한 사진이 맞다면
            카메라나 갤러리에서 바로 꺼낸 원본으로 다시 시도해 주세요.</p>` : ''}
        ${elig.oversize ? `
          <p><strong>파일이 접수 상한 ${UPLOAD_MB}MB를 넘습니다.</strong>
            이 파일은 ${escapeHtml(formatBytes(bundle.print?.bytes) || '크기 미상')}입니다.</p>
          <p>줄여서 올리시면 원본이 아니어서 심사할 수 없습니다. 원본 그대로 맡기셔야 한다면
            <a href="mailto:${CONTACT}">${CONTACT}</a>로 연락해 주십시오.</p>` : ''}
      </div>
    </div>`;

  // 신청서는 눌러서 엽니다. 묻지도 않고 폼을 펼쳐 두면 읽을 것이 폼에 밀립니다.
  const deepPanel = `
    <div class="panel" data-apply${openForm ? '' : ' hidden'}>
      <p class="panel-title">신청서</p>
      <p class="apply-lead">
        상세 검사는 <strong>간단 검사를 먼저 자동으로 돌린 다음</strong>, 그 결과를 사람 심사로 넘깁니다.
        사람이 보는 것은 간단 검사가 끝난 뒤부터입니다 — 화면을 다시 찍은 것은 아닌지,
        그림자와 반사가 서로 맞는지, 같은 카메라에서 나온 다른 컷이 있는지.
      </p>

      <div class="apply-warn">
        <p><strong>이 버튼을 누르면 원본 파일이 서버로 올라갑니다.</strong></p>
        <p>간단 검사는 브라우저 안에서 끝나지만, 사람이 보려면 파일이 사람에게 가야 합니다.
           무엇을 보관하고 언제 지우는지는 <a href="/privacy">개인정보 처리방침</a>에 적어 두었습니다.</p>
      </div>

      <div class="apply-grid">
        <label class="fld">
          <span class="fld-label">신청 등급</span>
          <select data-apply-grade>
            <option value="2">2등급 — 사람이 사진을 봅니다</option>
            <option value="1">1등급 — 센서 지문까지 대조합니다</option>
          </select>
        </label>
        <label class="fld">
          <span class="fld-label">연락받을 곳 <em>필수 · 현황 조회에도 씁니다</em></span>
          <input type="text" data-apply-contact placeholder="메일 주소 또는 전화번호" maxlength="200" autocomplete="email">
        </label>
      </div>

      <div class="apply-grid">
        <label class="fld">
          <span class="fld-label">조회 비밀번호 <em>필수 · ${MIN_PASSWORD}자 이상</em></span>
          <input type="password" data-apply-pw maxlength="72" autocomplete="new-password">
        </label>
        <label class="fld">
          <span class="fld-label">비밀번호 확인</span>
          <input type="password" data-apply-pw2 maxlength="72" autocomplete="new-password">
        </label>
      </div>
      <p class="apply-hint">
        나중에 <strong>이 연락처와 비밀번호로</strong> 진행 현황을 보십니다.
        서버에는 비밀번호를 늘려 섞은 값만 남으므로 저희도 원문을 알지 못하고 다시 알려 드릴 수 없습니다.
      </p>
      <label class="fld">
        <span class="fld-label">촬영 상황 <em>있으면 심사가 빨라집니다</em></span>
        <textarea data-apply-note rows="3" maxlength="2000"
          placeholder="언제 어디서 무엇을 찍었는지, 어떤 장비를 쓰셨는지, 같은 촬영의 다른 컷이 있는지"></textarea>
      </label>

      <p class="apply-eta" data-apply-eta></p>

      <div class="btn-row">
        <button class="btn" type="button" data-action="apply-send">신청하고 파일 올리기</button>
        <button class="btn btn--ghost" type="button" data-action="apply-summary">보낼 측정 요약 보기</button>
      </div>
      <div class="apply-bar" data-apply-bar hidden>
        <span class="apply-pct" data-apply-pct>0<small>%</small></span>
        <div class="bar"><i data-apply-fill></i></div>
      </div>
      <p class="apply-msg" data-apply-msg hidden></p>
      <pre class="copybox" data-submission hidden>${escapeHtml(summary.join(String.fromCharCode(10)))}</pre>
      <div data-apply-done></div>
    </div>`;

  const hints = result.hints.length
    ? fold('함께 읽어 두실 것', `${result.hints.length}가지`, `
        <ul style="margin:0;padding-left:1.15em;font-size:14.5px;color:var(--ink-2);line-height:1.7">
          ${result.hints.map((h) => `<li>${escapeHtml(h)}</li>`).join('')}
        </ul>`)
    : '';

  /* 상세 검사 화면의 순서 — 자격 상태 → 안내와 신청서 → 간단 검사 결과.
     신청할 수 있는지를 먼저 알려 주고, 폼을 채우게 하고, 근거를 그 아래에 둡니다. */
  const deepHead = `
    ${renderEligibility(bundle, elig)}
    ${elig.ok ? deepPanel : blockedPanel}
    <div class="section-head">
      <h2>간단 검사 결과</h2>
      <p>${elig.ok
        ? '방금 이 기기에서 계산한 값입니다. 신청하시면 이 측정값이 신청서와 함께 올라갑니다.'
        : '방금 이 기기에서 계산한 값입니다. 접수되지 않으므로 어디로도 올라가지 않습니다.'}</p>
    </div>`;

  const quickHead = `
    <div class="top-actions">
      ${elig.ok ? `
        <button class="btn btn--mini" type="button" data-action="swap-mode">상세 검사 신청하기</button>` : ''}
      <button class="btn btn--mini btn--ghost" type="button" data-action="reset">다른 작업물 검사하기</button>
    </div>`;

  return `
    ${mode === 'deep' ? deepHead : quickHead}

    <section class="cert${certClass}">
      <div class="cert-top">
        <span class="cert-mark">${CERT_MARK}</span>
        ${stampFor(result)}
      </div>
      ${isPass ? '' : `<h2>${escapeHtml(result.headline)}</h2>`}
      <p class="statement">${result.statement.map((l) => `<span>${escapeHtml(l)}</span>`).join('')}</p>
      ${isImage ? renderProvenanceFacts(bundle.provenance) : renderMediaFacts(bundle)}
      ${isDeclared ? '' : renderKeyLines(isImage ? keyLines(bundle) : mediaKeyLines(bundle))}
      <p class="fingerprint-line">${fingerprint}</p>
    </section>

    ${isImage ? renderScorePanel(bundle) : renderMediaScore(bundle)}

    ${markPanel}
    ${markOnlyPanel}

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
      ${elig.ok ? `
        <button class="btn" type="button" data-action="${mode === 'quick' ? 'swap-mode' : 'apply-open'}">
          상세 검사 신청하기
        </button>` : ''}
      <button class="btn btn--ghost" type="button" data-action="reset">다른 작업물 검사하기</button>
      <p class="btn-note">${elig.ok
        ? '검사를 다시 돌리지 않습니다. 이미 계산한 측정값을 그대로 씁니다.'
        : elig.declared
          ? '이 파일은 AI 생성 기록이 있어 상세 검사를 신청할 수 없습니다.'
          : `이 파일은 ${UPLOAD_MB}MB를 넘어 화면에서 접수할 수 없습니다.`}</p>
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

const UPLOAD_MB = Math.round(MAX_UPLOAD / 1024 / 1024);

/**
 * 매체에 맞는 환산 수치. 사진용 scoreTraces는 EXIF를 읽으므로 영상·음악
 * bundle에 대면 터집니다 — 실제로 그렇게 깨졌고, 그래서 갈래를 한 곳에 둡니다.
 */
const traceOf = (bundle) =>
  (bundle.kind === 'video' || bundle.kind === 'audio' ? mediaScore(bundle) : scoreTraces(bundle));

/**
 * 신청서에 함께 올라가는 측정 요약. 매체마다 표가 다릅니다.
 * 사진용 buildRows는 exif를 구조 분해하므로 영상 bundle에 대면 터집니다 —
 * 실제로 접수가 "Cannot read properties of undefined" 로 실패했습니다.
 */
const summaryFor = (bundle) =>
  (bundle.kind === 'video' || bundle.kind === 'audio'
    ? mediaSummaryLines(bundle)
    : summaryLines(bundle.result, buildRows(bundle), bundle.print));

/**
 * 상세 검사를 신청할 수 있는 상태인지 판정합니다.
 *
 * 같은 조건을 서버도 다시 봅니다(functions/api/apply.js). 화면에서만 막으면
 * 요청을 직접 보내는 것으로 지나갈 수 있고, 그러면 막았다고 말할 수 없습니다.
 */
function eligibility(bundle) {
  const prov = bundle.provenance;
  const bytes = bundle.print?.bytes ?? 0;
  // 사진은 provenance, 영상·음악은 container가 선언을 읽습니다.
  const declared = Boolean(prov?.declaresAi || bundle.container?.declaresAi);
  const generator = prov?.generator || bundle.container?.generator || null;
  const oversize = bytes > MAX_UPLOAD;

  const checks = [
    {
      ok: true,
      label: '간단 검사',
      detail: `${STEPS_FOR(bundle.kind).length}단계 측정을 마쳤습니다`,
    },
    {
      ok: !declared,
      label: 'AI 생성 기록',
      detail: declared
        ? `파일이 스스로 AI 생성물이라고 적고 있습니다${generator ? ` — ${generator}` : ''}`
        : '파일에 AI 생성 선언이 없습니다',
    },
    {
      ok: !oversize,
      label: '파일 크기',
      detail: `${formatBytes(bytes) || '크기 미상'} · 접수 상한 ${UPLOAD_MB}MB`,
    },
  ];

  return { ok: !declared && !oversize, declared, oversize, checks };
}

/**
 * 신청 자격 상태 — 상세 검사 화면의 첫 칸.
 *
 * 폼을 먼저 보여 주면 다 채운 뒤에 안 된다는 말을 듣게 됩니다. 그래서
 * 되는지 안 되는지와 그 근거를 폼보다 위에 둡니다.
 */
function renderEligibility(bundle, elig) {
  const { result } = bundle;
  const { trace, ai } = traceOf(bundle);

  const verdict = result.verdict === VERDICT.PASS ? '3등급 발급'
    : result.verdict === VERDICT.HOLD ? '보류'
      : result.verdict === VERDICT.DECLARED_AI ? 'AI 생성 기록' : '판정 불가';

  return `
    <section class="elig${elig.ok ? '' : ' elig--no'}">
      <p class="elig-kicker">상세 검사 신청</p>
      <h2 class="elig-head">${elig.ok ? '신청하실 수 있습니다' : '이 파일로는 신청하실 수 없습니다'}</h2>

      <ul class="elig-checks">
        ${elig.checks.map((c) => `
          <li class="${c.ok ? 'is-ok' : 'is-no'}">
            <span class="elig-mark" data-icon="${c.ok ? 'check' : 'cross'}"></span>
            <span class="elig-label">${escapeHtml(c.label)}</span>
            <span class="elig-detail">${escapeHtml(c.detail)}</span>
          </li>`).join('')}
      </ul>

      <p class="elig-quick">
        간단 검사 판정 <b>${escapeHtml(verdict)}</b> ·
        촬영 흔적 <b>${trace}%</b> <span class="dim">AI 생성 환산 ${ai}%</span>
      </p>
      ${elig.ok ? `
        <p class="elig-note">판정이 보류나 판정 불가여도 신청하실 수 있습니다. 자동으로 가리지 못한 것을 사람이 다시 보는 것이 상세 검사입니다.</p>
        <p class="elig-note">아래 버튼을 누르면 신청서가 열립니다. 파일은 신청서 안의 전송 버튼을 누를 때 올라갑니다.</p>` : ''}

      <div class="top-actions">
        ${elig.ok ? `
          <button class="btn btn--mini" type="button" data-action="apply-open">상세 검사 신청</button>` : ''}
        <button class="btn btn--mini btn--ghost" type="button" data-action="reset">다른 작업물 검사하기</button>
      </div>
    </section>`;
}

/* ── 상세 검사 접수 ──────────────────────────────────── */

/**
 * 진행 단계. 신청한 사람이 지금 어디에 있는지만 보여 줍니다.
 * 사진은 다시 보여 주지 않습니다 — 서버도 조회에 사진을 돌려주지 않으므로
 * 조회 열쇠가 새도 사진까지 새지 않습니다(functions/api/status.js).
 */
const RAIL = ['신청', '심사 중', '결과 발표'];

const renderRail = (at) => `
  <ol class="status-rail">
    ${RAIL.map((label, i) => `
      <li class="${i <= at ? 'is-on' : ''}"><span class="dot"></span>${label}</li>`).join('')}
  </ol>`;

/** 접수증. 조회 열쇠는 여기서 한 번만 보여 줍니다. */
function renderReceipt(r) {
  return `
    <div class="receipt">
      <p class="receipt-top">신청이 접수됐습니다</p>
      ${renderRail(0)}
      <dl class="receipt-keys">
        <div><dt>접수번호</dt><dd class="big">${escapeHtml(r.id)}</dd></div>
        <div><dt>조회 방법</dt><dd>신청하실 때 적으신 <strong>연락처 + 비밀번호</strong></dd></div>
        <div><dt>예상 완료</dt><dd>${escapeHtml(formatDate(r.etaDate))} <span class="dim">· 영업일 ${r.etaDays}일</span></dd></div>
        <div><dt>앞선 대기</dt><dd>${r.queueAhead}건</dd></div>
      </dl>
      <p class="receipt-note">
        접수번호는 문의하실 때 쓰시면 빠릅니다. 현황은 번호 없이 연락처와 비밀번호만으로도 열립니다.
        이 브라우저에는 접수 기록을 적어 두어, 아래 목록에서 비밀번호 없이 바로 보실 수 있습니다.
      </p>
      <div class="btn-row">
        <button class="btn btn--mini" type="button" data-action="copy-receipt"
          data-id="${escapeHtml(r.id)}">접수번호 복사</button>
        <button class="btn btn--mini btn--ghost" type="button" data-action="check-status"
          data-id="${escapeHtml(r.id)}" data-token="${escapeHtml(r.token)}">현황 보기</button>
      </div>
    </div>`;
}

/**
 * 심사 결과 — 발급 등급과 사람이 본 기준.
 * 등급만 알려 주고 근거를 말하지 않으면 그냥 숫자입니다.
 */
function renderDecision(st) {
  const rows = Object.entries(st.checks || {})
    .filter(([id, state]) => CHECK_LABEL[id] && CHECK_STATES[state]);
  if (typeof st.awarded !== 'number' && !rows.length) return '';

  return `
    <div class="verdict">
      ${typeof st.awarded === 'number'
        ? `<p class="verdict-grade"><b>${st.awarded}등급</b> 발급</p>`
        : '<p class="verdict-grade verdict-grade--none">등급 없음</p>'}
      ${rows.length ? `
        <p class="verdict-top">사람이 본 기준 ${rows.length}가지</p>
        <ul class="verdict-checks">
          ${rows.map(([id, state]) => `
            <li class="is-${state}">
              <span class="verdict-mark" data-icon="${state === 'pass' ? 'check' : 'cross'}"></span>
              <span class="verdict-what">${escapeHtml(CHECK_LABEL[id])}</span>
              <span class="dim">${escapeHtml(CHECK_STATES[state].label)}</span>
            </li>`).join('')}
        </ul>` : ''}
    </div>`;
}

/**
 * 발급물 — 인증서와 인증 마크.
 *
 * 인증서는 조회 응답만으로 그립니다. 마크는 원본 파일이 있어야 새길 수 있어서
 * 여기서 파일을 한 번 더 받습니다. 그 파일은 서버로 가지 않고, 심사받은 파일과
 * 지문이 같은지 먼저 대조합니다 — 다른 사진에 마크를 새겨 주면 마크가 거짓이 됩니다.
 */
function renderAward(st) {
  if (!st.finished || typeof st.awarded !== 'number') return '';
  const pick = `award-file-${st.id}`;
  return `
    <div class="award" data-award="${escapeHtml(st.id)}">
      <p class="award-top">${st.awarded}등급 발급물</p>
      <div class="btn-row">
        <button class="btn btn--mini" type="button" data-action="cert-dl">
          <span data-icon="download"></span>인증서 내려받기
        </button>
      </div>
      <p class="award-note">
        인증 마크는 심사받은 원본에 새깁니다. 같은 파일을 골라 주시면
        지문 <span class="hash">${escapeHtml(st.fingerprint || '없음')}…</span>과 맞는지 대조한 뒤 새겨 드립니다.
        이 파일도 서버로 가지 않습니다.
      </p>
      <input id="${pick}" class="file-input" type="file" accept="image/*" data-award-file>
      <label class="drop drop--mini" for="${pick}">
        <span class="drop-main">심사받은 파일 고르기</span>
        <span class="drop-sub">지문이 다르면 새기지 않습니다</span>
      </label>
      <div data-award-out></div>
      <p class="award-msg" data-award-msg hidden></p>
    </div>`;
}

function renderStatus(st) {
  // waiting(추가 자료 대기)은 심사 중의 한 상태입니다. 레일은 세 칸으로 둡니다.
  const at = st.status === 'received' ? 0
    : st.status === 'done' || st.status === 'rejected' ? 2 : 1;
  return `
    <div class="status-box${st.finished ? ' is-done' : ''}">
      <p class="status-top">
        <span class="status-id">${escapeHtml(st.id)}</span>
        <span class="status-tag">${escapeHtml(st.statusLabel)}</span>
        <span class="dim">${st.grade}등급 신청</span>
      </p>
      ${renderRail(at)}
      <dl class="receipt-keys">
        <div><dt>예상 완료</dt><dd>${escapeHtml(formatDate(st.etaDate))}</dd></div>
        <div><dt>접수일</dt><dd>${escapeHtml(formatDate(st.createdAt))}</dd></div>
        <div><dt>마지막 변경</dt><dd>${escapeHtml(formatDate(st.updatedAt))}</dd></div>
      </dl>
      ${renderDecision(st)}
      ${st.result ? `<p class="status-result">${escapeHtml(st.result)}</p>` : ''}
      ${renderAward(st)}
      ${st.history?.length ? `<ul class="status-hist">${st.history.map((h) =>
        `<li><span class="dim">${escapeHtml(formatDate(h.at))}</span> ${escapeHtml(h.label)}${h.note ? ` — ${escapeHtml(h.note)}` : ''}</li>`).join('')}</ul>` : ''}
    </div>`;
}

/* ── 조립 ────────────────────────────────────────────── */

const MODE_LABEL = { quick: '간단 검사', deep: '상세 검사' };
const KIND_LABEL = { image: '사진', video: '영상', audio: '음악·소리', unknown: '알 수 없는 형식' };

export function mountVerifier(root) {
  if (!root) return;

  const lanes = root.querySelector('[data-lanes]');
  const runArea = root.querySelector('[data-run]');
  const fileLine = root.querySelector('[data-file-line]');
  const progress = root.querySelector('[data-progress]');
  const progressLabel = root.querySelector('[data-progress-label]');
  const progressBar = root.querySelector('[data-progress-bar]');
  const progressPct = root.querySelector('[data-progress-pct]');
  const output = root.querySelector('[data-output]');
  const readyBox = root.querySelector('[data-ready]');
  const readyNote = root.querySelector('[data-ready-note]');

  let previewUrl = null;
  let markUrl = null;
  let current = null;      // { file, mode, bundle } — 측정이 끝난 것
  let pending = null;      // { file, mode } — 받아 두고 시작을 기다리는 것
  let busy = false;
  /* 지금 돌리는 검사의 단계 이름. 매체마다 하는 일이 달라서 목록이 다릅니다. */
  let steps = STEPS;

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
  /** 신청서를 펼치고 그 자리로 옮겨 줍니다. 이미 펼쳐져 있으면 옮기기만 합니다. */
  const openApplyForm = () => {
    const panel = output.querySelector('[data-apply]');
    if (!panel) return;
    panel.hidden = false;
    if (current) current.applyOpen = true;
    panel.scrollIntoView({ block: 'start', behavior: 'smooth' });
    output.querySelector('[data-apply-contact]')?.focus({ preventScroll: true });
  };

  const swapMode = async () => {
    if (!current || busy) return;
    current.mode = current.mode === 'quick' ? 'deep' : 'quick';
    // 간단 검사 화면에서 "상세 검사 신청하기"를 눌러 온 것이므로 폼을 펼쳐 둡니다.
    if (current.mode === 'deep') current.applyOpen = true;
    const tag = fileLine.querySelector('.mode-tag');
    if (tag) tag.textContent = MODE_LABEL[current.mode];
    output.innerHTML = renderResult(current.bundle, current.mode, current.applyOpen === true);
    paintIcons(output);
    if (current.mode === 'deep') paintEta();
    if (current.bundle.result.grade) await refreshMarkPreview();
    output.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  const stepList = root.querySelector('[data-steps]');

  const drawSteps = (activeIndex, allDone = false) => {
    stepList.innerHTML = steps.map((label, i) => {
      const state = allDone || i < activeIndex ? 'is-done' : i === activeIndex ? 'is-active' : '';
      return `<li class="${state}"><span class="dot"></span><span>${escapeHtml(label)}</span></li>`;
    }).join('');
  };

  const setPct = (value) => {
    const pct = Math.max(0, Math.min(100, Math.round(value)));
    progressBar.style.width = `${pct}%`;
    if (progressPct) progressPct.innerHTML = `${pct}<small>%</small>`;
  };

  const showProgress = (index, label) => {
    progress.hidden = false;
    drawSteps(index);
    progressLabel.textContent = `${label}…`;
    setPct(((index + 1) / steps.length) * 100);
  };

  const runNote = root.querySelector('.run-note');

  const finishProgress = (elapsedMs) => {
    drawSteps(steps.length, true);
    setPct(100);
    progressLabel.textContent = `검사 완료 · ${steps.length}단계 · ${(elapsedMs / 1000).toFixed(1)}초`;
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
    setPct(0);

    const kind = detectKind(file);
    steps = STEPS_FOR(kind);
    previewUrl = URL.createObjectURL(file);

    /* 미리보기는 매체에 맞게 붙입니다. 영상은 첫 화면, 소리는 파형 대신
       재생기를 둡니다 — 소리는 들어 봐야 무엇인지 압니다. */
    const preview = kind === 'video'
      ? `<video src="${previewUrl}" muted playsinline preload="metadata"></video>`
      : kind === 'audio'
        ? '<span class="file-icon" data-icon="layers"></span>'
        : `<img src="${previewUrl}" alt="">`;

    fileLine.innerHTML = `
      ${preview}
      <div class="meta">
        <div class="name">${escapeHtml(file.name || '이름 없는 파일')}<span class="mode-tag">${MODE_LABEL[mode]}</span><span class="kind-tag">${KIND_LABEL[kind] || '알 수 없는 형식'}</span></div>
        <div>${escapeHtml(file.type || '형식 미상')} · ${escapeHtml(formatBytes(file.size) || '')}</div>
        ${kind === 'audio' ? `<audio controls src="${previewUrl}" style="margin-top:6px;max-width:280px"></audio>` : ''}
        <div style="color:var(--ink-3)">이 미리보기는 브라우저 메모리에만 있습니다.</div>
      </div>`;
    readyNote.textContent = kind === 'unknown'
      ? '이 형식은 검사하지 못합니다. 사진, 영상, 소리 파일을 올려 주십시오.'
      : `${KIND_LABEL[kind]} · ${MODE_LABEL[mode]}로 ${steps.length}단계를 잰 뒤 판정합니다.`;
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
    setPct(0);
    progressLabel.textContent = '시작하는 중…';
    if (runNote) runNote.textContent = '이 기기에서 계산 중입니다. 업로드가 아닙니다.';

    try {
      const bundle = await verifyAny(file, showProgress);
      current = { file, mode, bundle, position: DEFAULT_POSITION };
      finishProgress(performance.now() - startedAt);
      output.innerHTML = renderResult(bundle, mode);
      paintIcons(output);
      if (mode === 'deep') paintEta();
      if (bundle.result.grade) await refreshMarkPreview();
    } catch (err) {
      progress.hidden = true;
      // 무엇이 깨졌는지 남깁니다. 삼켜 버리면 원인을 찾을 수 없습니다.
      console.error('[ultari] 검증 실패', err);
      const why = err && err.message;
      output.innerHTML = why === 'UNSUPPORTED_KIND'
        ? renderError('이 형식은 검사하지 못합니다',
          '사진(JPEG·PNG·HEIC), 영상(MP4·MOV·WebM), 소리(MP3·M4A·WAV·FLAC)를 받습니다. 문서나 압축 파일은 받지 않습니다.')
        : why === 'AUDIO_UNSUPPORTED'
          ? renderError('이 브라우저는 소리를 디코딩하지 못합니다',
            'Web Audio를 지원하는 최신 브라우저에서 다시 시도해 주십시오.')
          : why === 'DECODE_FAILED'
            ? renderError('이 파일은 브라우저가 열지 못했습니다',
              'RAW(.cr3, .nef, .arw 등), 일부 HEIC, 그리고 브라우저가 코덱을 갖지 않은 영상(ProRes, HEVC 일부)은 직접 디코딩하지 못합니다. MP4(H.264)나 화질을 낮추지 않은 JPEG로 내보낸 파일로 시도해 주세요.')
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
      /* 마크만 담은 PNG의 크기. 사진은 원본 화소, 영상은 프레임 크기,
         소리는 얹을 그림이 없으니 표지에 쓰기 좋은 정사각형으로 만듭니다. */
      const b = current.bundle;
      const size = b.kind === 'video'
        ? { width: b.frames.width, height: b.frames.height }
        : b.kind === 'audio'
          ? { width: 1400, height: 1400 }
          : { width: b.pixels.width, height: b.pixels.height };
      const only = await renderMarkOnly({ ...size, ...markOptions() });
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

  /* ── 상세 검사 접수 동작 ─────────────────────────── */

  const applyEl = (sel) => output.querySelector(sel);

  const toggleSummary = () => {
    const box = applyEl('[data-submission]');
    if (box) box.hidden = !box.hidden;
  };

  /** 예상 완료일은 실제 대기 건수에서 나옵니다. 없는 속도를 적지 않습니다. */
  const paintEta = async () => {
    const line = applyEl('[data-apply-eta]');
    if (!line) return;
    line.textContent = '대기 건수를 확인하는 중…';
    const open = await fetchQueue();
    const grade = Number(applyEl('[data-apply-grade]')?.value || 2);
    const base = grade === 1 ? 15 : 4;
    if (open == null) {
      line.textContent = `${grade}등급은 영업일 ${base}일 정도 걸립니다. 접수하면 정확한 완료 예정일이 나옵니다.`;
      return;
    }
    const days = base + Math.floor(open / 5) * base;
    line.textContent = `현재 대기 ${open}건 · ${grade}등급 예상 소요 영업일 ${days}일. 접수하면 정확한 완료 예정일이 나옵니다.`;
  };

  const sendApplication = async (button) => {
    if (!current) return;
    const msg = applyEl('[data-apply-msg]');
    const bar = applyEl('[data-apply-bar]');
    const fill = applyEl('[data-apply-fill]');
    const pct = applyEl('[data-apply-pct]');
    const contact = applyEl('[data-apply-contact]')?.value?.trim() || '';
    const password = applyEl('[data-apply-pw]')?.value || '';
    const password2 = applyEl('[data-apply-pw2]')?.value || '';
    const note = applyEl('[data-apply-note]')?.value?.trim() || '';
    const grade = Number(applyEl('[data-apply-grade]')?.value || 2);

    const say = (text, bad = false) => {
      if (!msg) return;
      msg.hidden = false;
      msg.textContent = text;
      msg.classList.toggle('is-bad', bad);
    };

    if (contact.length < 5) { say('연락받을 메일 주소나 전화번호를 적어 주세요.', true); return; }
    if (password.length < MIN_PASSWORD) {
      say(`조회 비밀번호를 ${MIN_PASSWORD}자 이상으로 정해 주세요. 이 비밀번호로 현황을 보십니다.`, true);
      return;
    }
    if (password !== password2) { say('비밀번호 확인이 다릅니다.', true); return; }
    if (current.file.size > MAX_UPLOAD) {
      say(`파일이 ${Math.round(MAX_UPLOAD / 1024 / 1024)}MB를 넘습니다. 더 작은 파일로 신청해 주세요.`, true);
      return;
    }

    button.disabled = true;
    bar.hidden = false;
    say('파일을 올리고 있습니다. 이 창을 닫지 마세요.');

    try {
      const r = await submitApplication({
        file: current.file,
        grade,
        contact,
        password,
        note,
        summary: summaryFor(current.bundle).join(String.fromCharCode(10)),
        fingerprint: current.bundle.print?.short || '',
        onProgress: (v) => {
          const n = Math.round(v);
          fill.style.width = `${n}%`;
          pct.innerHTML = `${n}<small>%</small>`;
        },
      });
      // 비밀번호는 적지 않습니다. 이 브라우저용 열쇠만 적습니다.
      rememberApplication({ id: r.id, token: r.token, grade: r.grade, createdAt: r.createdAt, etaDate: r.etaDate });
      say('접수됐습니다.');
      applyEl('[data-apply-done]').innerHTML = renderReceipt(r);
      paintMine();
      applyEl('[data-apply-done]').scrollIntoView({ block: 'center', behavior: 'smooth' });
    } catch (err) {
      button.disabled = false;
      bar.hidden = true;
      say(err.message || '접수에 실패했습니다.', true);
    }
  };

  const copyReceipt = async (el) => {
    const text = `ULTARI 상세 검사 접수번호 ${el.dataset.id} (현황 조회는 신청 때 적은 연락처와 비밀번호로)`;
    const label = el.textContent;
    try {
      await navigator.clipboard.writeText(text);
      el.textContent = '복사했습니다';
    } catch {
      el.textContent = '복사하지 못했습니다';
    }
    setTimeout(() => { el.textContent = label; }, 2200);
  };

  /* 조회된 접수 — 발급물을 만들 때 쓰는 값과 고른 파일. */
  const awards = new Map();

  /** 조회 결과를 그립니다. 같은 연락처로 여러 건이면 모두 나옵니다. */
  const paintStatus = async (ask) => {
    const target = root.querySelector('[data-lookup-out]');
    if (!target) return;
    root.querySelector('[data-lookup]')?.setAttribute('open', '');
    target.innerHTML = '<p class="apply-msg">조회하는 중…</p>';
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    try {
      const data = await ask();
      const items = Array.isArray(data.items) && data.items.length ? data.items : [data];
      items.forEach((it) => awards.set(it.id, { ...(awards.get(it.id) || {}), st: it }));
      target.innerHTML = (items.length > 1
        ? `<p class="mine-title">맞는 접수 ${items.length}건</p>` : '')
        + items.map(renderStatus).join('');
      paintIcons(target);
    } catch (err) {
      target.innerHTML = `<p class="apply-msg is-bad">${escapeHtml(err.message)}</p>`;
    }
  };

  const showStatus = (id, token) => paintStatus(() => fetchStatus(id, token));

  const lookupFromForm = () => {
    const contact = root.querySelector('[data-lookup-contact]')?.value?.trim() || '';
    const password = root.querySelector('[data-lookup-pw]')?.value || '';
    if (contact.length < 5 || password.length < MIN_PASSWORD) {
      const target = root.querySelector('[data-lookup-out]');
      if (target) {
        target.innerHTML = '<p class="apply-msg is-bad">신청하실 때 적으신 연락처와 비밀번호를 넣어 주세요.</p>';
      }
      return;
    }
    paintStatus(() => fetchStatusByContact(contact, password));
  };

  /* ── 발급물 ─────────────────────────────────────── */

  const awardMsg = (box, text, bad = false) => {
    const p = box.querySelector('[data-award-msg]');
    if (!p) return;
    p.textContent = text;
    p.classList.toggle('is-bad', bad);
    p.hidden = !text;
  };

  /** 마크만 받는 경우를 위해 원본 크기를 읽습니다. 그림은 쓰지 않습니다. */
  const naturalSize = (file) => new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve({ width: img.naturalWidth, height: img.naturalHeight }); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('DECODE_FAILED')); };
    img.src = url;
  });

  const awardOptions = (entry) => ({
    grade: entry.st.awarded,
    shortHash: entry.st.fingerprint || '지문 없음',
    dateText: (entry.st.updatedAt || new Date().toISOString()).slice(0, 10),
    position: DEFAULT_POSITION,
  });

  const makeCertificate = async (box, button) => {
    const entry = awards.get(box.dataset.award);
    if (!entry?.st) return;
    const label = button.innerHTML;
    button.disabled = true;
    button.textContent = '인증서를 만드는 중…';
    try {
      const cert = await renderCertificate(entry.st);
      saveBlob(cert.url, certificateFilename(entry.st.id, entry.st.awarded));
      setTimeout(() => URL.revokeObjectURL(cert.url), 20000);
      awardMsg(box, '인증서를 내려받았습니다. 이 기기에서 만들었습니다.');
    } catch {
      awardMsg(box, '인증서를 만들지 못했습니다.', true);
    } finally {
      button.disabled = false;
      button.innerHTML = label;
      paintIcons(box);
    }
  };

  /** 심사받은 파일인지 지문으로 확인한 뒤에만 마크를 새깁니다. */
  const pickAwardPhoto = async (input) => {
    const box = input.closest('[data-award]');
    const entry = awards.get(box?.dataset.award);
    const file = input.files?.[0];
    const out = box?.querySelector('[data-award-out]');
    if (!box || !entry?.st || !file || !out) return;

    out.innerHTML = '';
    awardMsg(box, '지문을 대조하는 중…');

    const print = await fingerprintFile(file);
    if (!print.short) {
      awardMsg(box, '이 브라우저에서는 지문을 계산할 수 없습니다(보안 컨텍스트가 아닙니다).', true);
      return;
    }
    if (entry.st.fingerprint && print.short !== entry.st.fingerprint) {
      awardMsg(box, `심사받은 파일이 아닙니다. 고르신 파일의 지문은 ${print.short}…이고, 심사받은 파일은 ${entry.st.fingerprint}…입니다.`, true);
      return;
    }

    try {
      const size = await naturalSize(file);
      const preview = await renderMarkedImage(file, { ...awardOptions(entry), maxEdge: PREVIEW_EDGE });
      if (entry.markUrl) URL.revokeObjectURL(entry.markUrl);
      awards.set(box.dataset.award, { ...entry, file, size, markUrl: preview.url });
      out.innerHTML = `
        <figure class="wm-figure">
          <div class="wm-stage"><img src="${preview.url}" alt="인증 마크가 새겨진 사진 미리보기"></div>
          <figcaption>미리보기 ${preview.width}×${preview.height} · 내려받는 파일은 원본 ${size.width}×${size.height} 그대로입니다.</figcaption>
        </figure>
        <div class="btn-row">
          <button class="btn btn--mini" type="button" data-action="award-dl-photo">
            <span data-icon="download"></span>마크 넣은 사진 내려받기
          </button>
          <button class="btn btn--mini btn--ghost" type="button" data-action="award-dl-mark">마크만 내려받기 (투명 PNG)</button>
        </div>`;
      paintIcons(out);
      awardMsg(box, `지문이 맞습니다. ${entry.st.awarded}등급 마크를 새겼습니다.`);
    } catch {
      awardMsg(box, '이 파일을 브라우저가 열지 못했습니다. RAW와 일부 HEIC는 직접 디코딩되지 않습니다.', true);
    }
  };

  const downloadAward = async (box, button, markOnly) => {
    const entry = awards.get(box.dataset.award);
    if (!entry?.file) return;
    const label = button.innerHTML;
    button.disabled = true;
    button.textContent = '원본 해상도로 만드는 중…';
    try {
      const made = markOnly
        ? await renderMarkOnly({ width: entry.size.width, height: entry.size.height, ...awardOptions(entry) })
        : await renderMarkedImage(entry.file, awardOptions(entry));
      saveBlob(made.url, markOnly
        ? markOnlyFilename(entry.st.awarded)
        : markedFilename(entry.file.name, entry.st.awarded, made.type));
      setTimeout(() => URL.revokeObjectURL(made.url), 20000);
    } catch {
      awardMsg(box, '만들지 못했습니다.', true);
    } finally {
      button.disabled = false;
      button.innerHTML = label;
      paintIcons(box);
    }
  };

  /** 이 브라우저에 적어 둔 접수는 열쇠를 다시 치지 않아도 됩니다. */
  const paintMine = () => {
    const box = root.querySelector('[data-mine]');
    if (!box) return;
    const mine = listApplications();
    box.innerHTML = mine.length ? `
      <p class="mine-title">이 브라우저에 남아 있는 접수 ${mine.length}건 <span class="dim">비밀번호 없이 열립니다</span></p>
      <ul class="mine-list">${mine.map((a) => `
        <li>
          <span class="mine-id">${escapeHtml(a.id)}</span>
          <span class="dim">${a.grade}등급 · 예상 ${escapeHtml(formatDate(a.etaDate))}</span>
          <button class="btn btn--mini btn--ghost" type="button" data-action="check-status"
            data-id="${escapeHtml(a.id)}" data-token="${escapeHtml(a.token)}">조회</button>
        </li>`).join('')}</ul>` : '';
  };

  root.addEventListener('change', (e) => {
    if (e.target.matches('[data-apply-grade]')) paintEta();
    if (e.target.matches('[data-award-file]')) pickAwardPhoto(e.target);
  });

  root.addEventListener('click', (e) => {
    const pos = e.target.closest('.seg-btn');
    if (pos) { e.preventDefault(); choosePosition(pos); return; }
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const act = el.dataset.action;
    if (act === 'start') { e.preventDefault(); start(); }
    if (act === 'swap-mode') { e.preventDefault(); swapMode(); }
    if (act === 'apply-open') { e.preventDefault(); openApplyForm(); }
    if (act === 'apply-send') { e.preventDefault(); sendApplication(el); }
    if (act === 'apply-summary') { e.preventDefault(); toggleSummary(); }
    if (act === 'copy-receipt') { e.preventDefault(); copyReceipt(el); }
    if (act === 'check-status') { e.preventDefault(); showStatus(el.dataset.id, el.dataset.token); }
    if (act === 'lookup') { e.preventDefault(); lookupFromForm(); }
    if (act === 'lookup-open') {
      e.preventDefault();
      const fold = root.querySelector('[data-lookup]');
      if (!fold) return;
      // 이 브라우저에서 신청한 건이 있으면 번호를 적지 않아도 목록에 나옵니다.
      fold.open = true;
      fold.scrollIntoView({ block: 'start', behavior: 'smooth' });
      root.querySelector('[data-lookup-contact]')?.focus({ preventScroll: true });
    }
    if (act === 'reset') { e.preventDefault(); reset(); }
    if (act === 'dl-photo') { e.preventDefault(); downloadMarked(el); }
    if (act === 'dl-mark') { e.preventDefault(); downloadMarkOnly(el); }
    if (act === 'copy') { e.preventDefault(); copySubmission(el); }

    const box = el.closest('[data-award]');
    if (box) {
      if (act === 'cert-dl') { e.preventDefault(); makeCertificate(box, el); }
      if (act === 'award-dl-photo') { e.preventDefault(); downloadAward(box, el, false); }
      if (act === 'award-dl-mark') { e.preventDefault(); downloadAward(box, el, true); }
    }
  });

  /**
   * 상단 메뉴의 "현황 조회"는 /#lookup으로 옵니다. <details>는 앵커로
   * 이동해도 저절로 열리지 않아서 직접 엽니다. 다른 페이지에서 눌러 온
   * 경우와 이 페이지에서 다시 누른 경우 둘 다 받습니다.
   */
  const openLookupFromHash = () => {
    if (window.location.hash !== '#lookup') return;
    const box = root.querySelector('[data-lookup]');
    if (!box) return;
    box.open = true;
    box.scrollIntoView({ block: 'start', behavior: 'smooth' });
    // 펼쳐진 뒤에 포커스를 줍니다. 같은 틱에 주면 아직 숨어 있어 먹지 않습니다.
    setTimeout(() => root.querySelector('[data-lookup-contact]')?.focus({ preventScroll: true }), 60);
  };
  window.addEventListener('hashchange', openLookupFromHash);
  openLookupFromHash();

  paintIcons(root);
  paintMine();
}

mountVerifier(document.querySelector('[data-verifier]'));
