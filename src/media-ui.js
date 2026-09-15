/**
 * media-ui.js — 영상·음악 결과 화면의 조각들.
 *
 * 사진 화면(ui.js)과 같은 껍데기를 씁니다. 증서, 접수, 조회, 발급물은 모두
 * 공유하고 여기서는 매체마다 다른 것만 그립니다 — 사실 목록, 환산 수치,
 * 측정값 표.
 *
 * 클래스 이름도 사진 쪽과 같은 것을 씁니다. 같은 모양이면 같은 스타일을
 * 써야 하고, 매체마다 다른 디자인을 만들 이유가 없습니다.
 */

import { escapeHtml, fold, stripTags } from './html.js';
import { mediaScore, mediaSignals, MEDIA_GATE, RECORD_SLOT } from './media.js';
import { VERDICT } from './grade.js';
import { formatBytes } from './verify/fingerprint.js';

/* 진행 단계 — 매체마다 실제로 하는 일이 다릅니다. */
export const MEDIA_STEPS = {
  video: [
    '파일 지문 계산',
    '컨테이너 기록 읽기',
    '출처 표식 읽기',
    '프레임 떼어내기',
    '광학 흔적',
    '압축 이력',
    '생성물 흔적',
  ],
  audio: [
    '파일 지문 계산',
    '태그 기록 읽기',
    '출처 표식 읽기',
    '파형 디코딩',
    '대역 한계',
    '노이즈 플로어',
    '다이내믹과 스테레오',
  ],
};

const SIDE_LABEL = { camera: '촬영·녹음 쪽', ai: '반대쪽', unknown: '판단 보류' };

const ok = { cls: 'is-ok', text: '확인' };
const no = { cls: 'is-bad', text: '어긋남' };
const meh = { cls: 'is-none', text: '판단 보류' };

const num = (v, digits = 2, unit = '') =>
  (v == null || Number.isNaN(v) ? '—' : `${v.toFixed(digits)}${unit}`);

/* ── 증서 안의 요약 줄 ──────────────────────────────── */

export function mediaKeyLines(bundle) {
  const c = bundle.container || {};
  const fa = c.facts || {};
  const lines = [];

  if (bundle.kind === 'video') {
    lines.push({
      label: '기록된 기기',
      state: fa.make || fa.model ? ok : no,
      value: [fa.make, fa.model].filter(Boolean).join(' ') || '기록 없음',
    });
    lines.push({
      label: '영상',
      state: meh,
      value: `${fa.width || bundle.frames?.width || '?'}×${fa.height || bundle.frames?.height || '?'} · ${
        fa.duration ? `${fa.duration.toFixed(0)}초` : '길이 미상'} · ${fa.codec || '코덱 미상'}${
        fa.audioCodec ? ` · 소리 ${fa.audioCodec}` : ''}`,
    });
    const s = bundle.frames?.summary || {};
    const n = bundle.frames?.frameCount || 0;
    lines.push({
      label: '광학 흔적',
      state: (s.vignetteFrames || 0) + (s.caFrames || 0) >= 3 ? ok
        : (s.noOpticalTrace || 0) >= n && n > 0 ? no : meh,
      value: `비네팅 ${s.vignetteFrames || 0}/${n} · 색수차 ${s.caFrames || 0}/${n}`,
    });
    lines.push({
      label: '노이즈-밝기 곡선',
      state: (s.noiseRising || 0) >= Math.ceil(n / 2) && n > 0 ? ok
        : (s.noiseInverted || 0) >= Math.ceil(n / 2) && n > 0 ? no : meh,
      value: s.noiseFrames
        ? `오르는 프레임 ${s.noiseRising || 0}/${n} · 상관 ${s.noiseCorr != null ? s.noiseCorr.toFixed(2) : '—'}`
        : '재지 못했습니다',
    });
  } else {
    /* 기기 이름이 비어도 녹음기 흔적이 있을 수 있습니다(예: 음성 메모 태그).
       그때 "확인 · 기록 없음"이라고 적으면 서로 어긋나 보입니다. */
    const named = [fa.make, fa.model].filter(Boolean).join(' ') || fa.originator;
    /* mp3에는 녹음기 이름을 적을 자리가 없습니다. 없는 것을 "어긋남"이라고
       적으면 파일에 문제가 있는 것처럼 읽힙니다. */
    const slot = RECORD_SLOT.test(c.format || '');
    lines.push({
      label: '기록된 기기',
      state: named ? ok : c.cameraSigns?.length ? meh : slot ? no : meh,
      value: named || (c.cameraSigns?.length ? c.cameraSigns[0]
        : slot ? '기록 없음' : '이 형식에는 적을 자리가 없습니다'),
    });
    const a = bundle.sound || {};
    lines.push({
      label: '형식',
      state: meh,
      value: `${a.sampleRate ? `${(a.sampleRate / 1000).toFixed(1)}kHz` : '표본율 미상'} · ${
        a.channels === 1 ? '모노' : `${a.channels}채널`} · ${
        a.duration ? `${a.duration.toFixed(0)}초` : '길이 미상'}${
        fa.bitrate ? ` · ${fa.bitrate}kbps` : ''}`,
    });
    if (c.releaseSigns?.length) {
      lines.push({
        label: '발매 등록',
        state: meh,
        value: c.releaseSigns.join(' · '),
      });
    }
    lines.push({
      label: '대역 한계',
      state: a.lossless ? ok : a.band && a.band.cutoffHz < 15000 ? no : meh,
      value: a.band ? `${(a.band.cutoffHz / 1000).toFixed(1)}kHz까지 살아 있음` : '재지 못함',
    });
    lines.push({
      label: '노이즈 플로어',
      state: a.roomTone ? ok : a.deadSilence ? no : meh,
      value: a.floor ? `${a.floor.floorDb.toFixed(1)}dB` : '재지 못함',
    });
  }
  return lines;
}

/* ── 파일이 밝힌 사실 ──────────────────────────────── */

export function renderMediaFacts(bundle) {
  const c = bundle.container || {};
  const fa = c.facts || {};
  if (!c.markers?.length && !c.cameraSigns?.length && !c.toolSigns?.length) return '';

  const facts = [
    c.sourceType && ['선언된 출처', c.sourceType],
    c.generator && ['생성기', c.generator],
    fa.createdText && ['기록된 촬영 시각', fa.createdText],
    fa.software && ['기록된 소프트웨어', fa.software],
    fa.tool && ['기록된 도구', fa.tool],
    fa.lens && ['렌즈', fa.lens],
    fa.gpsPresent && ['촬영 위치', '기록돼 있습니다 (좌표는 읽지 않습니다)'],
  ].filter(Boolean);

  if (!facts.length) return '';

  return `
    <div class="prov-block${c.declaresAi ? ' prov-block--ai' : ''}">
      <p class="prov-src">${escapeHtml(c.format.toUpperCase())} 컨테이너에서 읽음 — 측정한 값이 아니라 파일에 적힌 값입니다</p>
      <dl class="prov-facts">
        ${facts.map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}
      </dl>
      <p class="prov-note">
        ${c.declaresAi
          ? '이 기록은 만든 쪽이 규격에 따라 남긴 것입니다.'
          : '적힌 것은 고칠 수 있고 지울 수 있습니다. 메신저를 거치면 대부분 사라집니다.'}
      </p>
    </div>`;
}

/* ── 환산 수치 ─────────────────────────────────────── */

const CATEGORY_LABEL = {
  record: '기록된 흔적',
  optics: '광학 흔적',
  light: '빛의 흔적',
  history: '압축 이력',
  floor: '노이즈 플로어',
  band: '대역 한계',
  dynamics: '다이내믹',
};

const STATE_TEXT = { match: '촬영·녹음 쪽', against: '반대쪽', unknown: '판단 보류' };

export function renderMediaScore(bundle) {
  const { result } = bundle;
  const { trace, ai, categories, weights, declared } = mediaScore(bundle);
  const signals = mediaSignals(bundle);
  const tally = { camera: 0, unknown: 0, ai: 0 };
  signals.forEach((r) => { tally[r.side] += 1; });

  const bars = Object.entries(weights).map(([key, weight]) => {
    const state = categories[key];
    const earned = Math.round(weight * (state === 'match' ? 1 : state === 'unknown' ? 0.5 : 0));
    return `
      <div class="cat" data-state="${state === 'match' ? 'match' : state === 'against' ? 'against' : 'unknown'}">
        <div class="cat-head">
          <span class="cat-name">${escapeHtml(CATEGORY_LABEL[key] || key)}</span>
          <span class="cat-state">${escapeHtml(STATE_TEXT[state])}</span>
          <span class="cat-num">${earned} <span class="cat-den">/ ${weight}</span></span>
        </div>
        <div class="cat-track"><i style="width:${Math.round((earned / weight) * 100)}%"></i></div>
      </div>`;
  }).join('');

  const sigRow = (r) => `
    <li class="sig-row sig-row--${r.side}">
      <div class="sig-top">
        <span class="sig-name">${escapeHtml(r.title)}</span>
        <span class="sig-side">${escapeHtml(SIDE_LABEL[r.side])}</span>
      </div>
      <p class="sig-note">${escapeHtml(r.detail)}</p>
    </li>`;

  const what = bundle.kind === 'audio' ? '녹음' : '촬영';
  const eligible = result.verdict === VERDICT.PASS;
  /* 가릴 수 없다고 해 놓고 "AI 생성 환산 40%"를 크게 적으면, 읽는 사람에게는
     40%만 남습니다. 판정하지 않은 화면에서는 숫자를 내걸지 않습니다.
     항목별 배점은 그대로 펼쳐 볼 수 있게 둡니다. */
  const noNumber = result.verdict === VERDICT.INSUFFICIENT;

  return `
    <div class="panel score-panel">
      <p class="panel-title">환산 수치</p>

      ${noNumber ? `
      <p class="sig-lead">숫자를 내지 않았습니다.</p>
      <p class="score-caveat">
        이 파일에서는 잴 수 있는 항목이 모자랍니다. 그 상태로 백분율을 적으면
        재지 못한 것이 ${what}이 아닌 쪽으로 세어집니다. 무엇을 쟀고 무엇을
        재지 못했는지는 아래에 그대로 적어 두었습니다.
      </p>` : `
      <div class="score-hero">
        <div class="score-figure">
          <span class="score-num score-num--trace">${trace}<small>%</small></span>
          <span class="score-cap">${what} 흔적</span>
        </div>
        <div class="score-figure score-figure--end">
          <span class="score-num score-num--ai">${ai}<small>%</small></span>
          <span class="score-cap">AI 생성 환산</span>
        </div>
      </div>
      <div class="sbar" role="img" aria-label="${what} 흔적 ${trace}%, AI 생성 환산 ${ai}%">
        <span class="sbar-seg sbar-seg--trace" style="width:${trace}%"></span>
        <span class="sbar-seg sbar-seg--ai" style="width:${ai}%"></span>
      </div>
      <p class="score-caveat">
        ${declared
          ? '파일에 AI 생성 기록이 적혀 있어 흔적을 세지 않았습니다. 배점을 계산한 값이 아닙니다.'
          : '학습된 분류기의 판단이 아닙니다. 아래 항목에 사람이 정한 배점을 곱해 더한 값이라 배점을 바꾸면 숫자도 바뀝니다.'}
      </p>`}

      <p class="panel-title score-sub">판별 근거</p>
      <p class="sig-lead">
        ${signals.length
          ? `<strong>${signals.length}가지</strong> 근거가 나왔습니다.`
          : '근거가 하나도 나오지 않았습니다.'}
      </p>

      ${signals.length ? `
        <div class="sigbar" role="img"
             aria-label="${what} 쪽 ${tally.camera}건, 반대쪽 ${tally.ai}건, 판단 보류 ${tally.unknown}건">
          ${tally.camera ? `<span class="sigbar-seg sigbar-seg--camera" style="flex:${tally.camera}"></span>` : ''}
          ${tally.ai ? `<span class="sigbar-seg sigbar-seg--ai" style="flex:${tally.ai}"></span>` : ''}
          ${tally.unknown ? `<span class="sigbar-seg sigbar-seg--none" style="flex:${tally.unknown}"></span>` : ''}
        </div>
        <ul class="sigkey">
          <li><i class="k k--camera"></i>${what} 쪽 <b>${tally.camera}</b></li>
          <li><i class="k k--ai"></i>반대쪽 <b>${tally.ai}</b></li>
          <li><i class="k k--none"></i>판단 보류 <b>${tally.unknown}</b></li>
        </ul>
        <ul class="sig">${signals.map(sigRow).join('')}</ul>` : ''}

      ${declared ? '' : fold('환산 수치는 어떻게 나왔나', `${Object.keys(weights).length}항목의 배점`,
        `<div class="cats">${bars}</div>`)}

      <p class="panel-title score-sub">인증 마크</p>
      <p class="gate-verdict${eligible ? ' is-ok' : ''}">
        ${eligible
          ? '발급했습니다. 발급 조건을 모두 충족합니다.'
          : `발급하지 않습니다. ${escapeHtml(result.blockers.map((b) => b.title).join(', ') || '조건 미달')}`}
      </p>
      <p class="score-caveat">
        발급 조건은 넷입니다 — AI 생성 기록 없음 · ${bundle.kind === 'audio' ? '녹음기·기기' : '촬영 기기'} 기록 있음 ·
        ${what} 쪽 근거 ${MEDIA_GATE.signs}건 이상 · 환산 수치 ${MEDIA_GATE.trace}% 이상.
      </p>
    </div>`;
}

/* ── 측정값 표 ─────────────────────────────────────── */

export function mediaRows(bundle) {
  const rows = [];
  const c = bundle.container || {};
  const fa = c.facts || {};

  rows.push({ item: '형식', state: meh, value: `${escapeHtml(c.format)} · ${escapeHtml(c.kind)}` });
  if (fa.brand) rows.push({ item: '컨테이너 브랜드', state: meh, value: escapeHtml(fa.brand) });
  rows.push({
    item: '기록된 기기',
    state: fa.make || fa.model ? ok : RECORD_SLOT.test(c.format || '') ? no : meh,
    value: escapeHtml([fa.make, fa.model].filter(Boolean).join(' ')
      || (RECORD_SLOT.test(c.format || '') ? '없음' : '이 형식에는 적을 자리가 없습니다')),
  });
  if (fa.software || fa.tool) {
    rows.push({ item: '기록된 소프트웨어', state: meh, value: escapeHtml(fa.software || fa.tool) });
  }
  rows.push({ item: '촬영 위치 기록', state: fa.gpsPresent ? ok : meh, value: fa.gpsPresent ? '있음 (좌표는 읽지 않음)' : '없음' });

  if (bundle.kind === 'video') {
    const s = bundle.frames?.summary || {};
    const n = bundle.frames?.frameCount || 0;
    rows.push({ item: '뽑은 프레임', state: n >= 3 ? ok : meh, value: `${n}장` });
    rows.push({ item: '해상도', state: meh, value: `${bundle.frames?.width}×${bundle.frames?.height}` });
    rows.push({ item: '트랙', state: meh, value: escapeHtml((fa.tracks || []).join(', ') || '미상') });
    rows.push({
      item: '비네팅',
      state: (s.vignetteFrames || 0) > 0 ? ok : meh,
      value: `${s.vignetteFrames || 0}/${n} 프레임`,
      sub: `모서리/중심 밝기 ${num(s.vignetteRatio)}`,
    });
    rows.push({
      item: '색수차',
      state: (s.caFrames || 0) > 0 ? ok : meh,
      value: `${s.caFrames || 0}/${n} 프레임`,
      sub: `어긋남 ${num(s.caShiftPx)}화소`,
    });
    rows.push({
      item: '하이라이트 날림',
      state: (s.clipFrames || 0) > 0 ? ok : meh,
      value: `${s.clipFrames || 0}/${n} 프레임`,
      sub: s.clipWhite != null ? `흰색 ${(s.clipWhite * 100).toFixed(4)}%` : '',
    });
    rows.push({
      item: '주파수 감쇠',
      state: (s.alphaNatural || 0) > 0 ? ok : meh,
      value: `기울기 ${num(s.alpha)}`,
      sub: `자연 범위 ${s.alphaNatural || 0}/${n} 프레임`,
    });
    rows.push({
      item: '압축 격자',
      state: (s.recompressed || 0) > 0 ? no : meh,
      value: `강도 ${num(s.gridStrength)}`,
      sub: (s.recompressed || 0) > 0 ? `두 번 인코딩 ${s.recompressed}프레임` : '겹친 격자 없음',
    });
    rows.push({
      item: '노이즈-밝기 곡선',
      state: (s.noiseRising || 0) >= Math.ceil(n / 2) && n > 0 ? ok
        : (s.noiseInverted || 0) >= Math.ceil(n / 2) && n > 0 ? no : meh,
      value: s.noiseCorr != null ? `상관 ${s.noiseCorr.toFixed(2)}` : '재지 못함',
      sub: s.noiseFrames
        ? `퍼짐 ${s.noiseSpread != null ? s.noiseSpread.toFixed(2) : '—'} · 시그마 ${
          s.noiseSigma != null ? s.noiseSigma.toFixed(2) : '—'} · 잰 프레임 ${s.noiseFrames}/${n}`
        : '잴 만한 구간이 모자랐습니다',
    });
    rows.push({
      item: '프레임 간 변화',
      state: meh,
      value: num(s.deltaMean, 1),
      sub: s.staticShare != null ? `같은 화소 ${(s.staticShare * 100).toFixed(0)}%` : '',
    });
  } else {
    const a = bundle.sound || {};
    rows.push({
      item: '표본율',
      state: a.rateTrusted ? ok : meh,
      value: a.sampleRate ? `${a.sampleRate}Hz` : '미상',
      sub: a.rateTrusted ? '' : '브라우저가 다시 표본화했습니다',
    });
    rows.push({ item: '채널', state: meh, value: a.channels === 1 ? '모노' : `${a.channels}채널` });
    if (a.band) {
      rows.push({
        item: '대역 한계',
        state: a.lossless ? ok : a.band.cutoffHz < 15000 ? no : meh,
        value: `${(a.band.cutoffHz / 1000).toFixed(1)}kHz`,
        sub: `나이퀴스트의 ${(a.band.ratio * 100).toFixed(1)}%`,
      });
    }
    if (a.floor) {
      rows.push({
        item: '노이즈 플로어',
        state: a.roomTone ? ok : a.deadSilence ? no : meh,
        value: `${a.floor.floorDb.toFixed(1)}dB`,
        sub: `창 ${a.floor.windows}개 중 10번째 백분위 · 무음 창 ${a.floor.silentWindows}개 제외`,
      });
    }
    if (fa.encoderTag) {
      rows.push({
        item: '인코더 기록',
        state: meh,
        value: escapeHtml(fa.encoderTag),
        sub: [fa.vbrMethod, fa.encStereoMode, fa.preset ? `프리셋 ${fa.preset}` : '']
          .filter(Boolean).join(' · '),
      });
    }
    if (fa.lowpassHz) {
      rows.push({
        item: '인코더 로우패스',
        state: meh,
        value: `${(fa.lowpassHz / 1000).toFixed(1)}kHz`,
        sub: '파일에 적힌 설정값입니다 — 잰 값이 아닙니다',
      });
    }
    if (fa.encDelay != null) {
      rows.push({
        item: '인코더 지연',
        state: meh,
        value: `${fa.encDelay} / ${fa.encPadding} 표본`,
        sub: fa.sourceRate ? `원본 표본율 ${fa.sourceRate}` : '',
      });
    }
    if (fa.musicCrc) {
      rows.push({
        item: '소리 CRC',
        state: meh,
        value: escapeHtml(fa.musicCrc),
        sub: '태그를 고쳐도 바뀌지 않는 값입니다',
      });
    }
    if (fa.isrc) rows.push({ item: 'ISRC', state: meh, value: escapeHtml(fa.isrc) });
    if (c.distributor) rows.push({ item: '배급사', state: meh, value: escapeHtml(c.distributor) });
    rows.push({
      item: '크레스트 팩터',
      state: a.natural ? ok : a.squashed ? no : meh,
      value: `${a.level.crestDb.toFixed(1)}dB`,
      sub: `피크 ${a.level.peakDb.toFixed(1)}dB · RMS ${a.level.rmsDb.toFixed(1)}dB`,
    });
    if (a.stereo) {
      rows.push({
        item: '스테레오 상관',
        // 채널이 서로 다른 것은 녹음의 근거가 아닙니다. 가짜 스테레오만 표시합니다.
        state: a.fakeStereo ? no : meh,
        value: a.stereo.correlation.toFixed(4),
        sub: `두 채널이 같은 표본 ${(a.stereo.identicalShare * 100).toFixed(1)}%`,
      });
    }
    rows.push({
      item: '클리핑',
      state: a.clipping ? ok : meh,
      value: `${(a.level.clipShare * 100).toFixed(3)}%`,
    });
    rows.push({
      item: 'DC 오프셋',
      state: a.dcShifted ? ok : meh,
      value: a.level.dc.toExponential(1),
    });
    rows.push({
      item: '앞뒤 디지털 무음',
      state: meh,
      value: `${(a.level.zeroShare * 100).toFixed(2)}%`,
      sub: '실제 음원에서도 나옵니다. 판정에 쓰지 않습니다.',
    });
  }

  if (fa.bytes) rows.push({ item: '파일 크기', state: meh, value: escapeHtml(formatBytes(fa.bytes) || '') });
  return rows;
}

/** 상세 검사 신청서에 함께 올라가는 요약. 사진 쪽과 같은 모양입니다. */
export function mediaSummaryLines(bundle) {
  const { result, print } = bundle;
  const rows = mediaRows(bundle);
  return [
    `매체: ${bundle.kind === 'audio' ? '음악·소리' : '영상'}`,
    `판정: ${result.headline}`,
    print?.sha256 ? `원본 지문(SHA-256): ${print.sha256}` : '원본 지문: 계산 불가',
    print?.bytes != null ? `파일 크기: ${print.bytes}바이트` : '',
    '',
    ...rows.map((row) => `${row.item}: ${row.state.text} — ${stripTags(row.value)}`),
  ].filter(Boolean);
}
