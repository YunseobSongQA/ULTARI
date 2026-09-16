/**
 * score.js — 측정 결과를 하나의 수치로 환산합니다.
 *
 * ─────────────────────────────────────────────────────────────
 * 이 파일이 내는 숫자는 학습된 분류기의 출력이 아닙니다.
 * 아래 WEIGHTS는 사람이 정한 배점이고, 그 배점을 측정값에 곱해 더한 값입니다.
 * 같은 사진이라도 배점을 바꾸면 숫자가 바뀝니다. 화면에도 그렇게 적습니다.
 *
 * 재는 것은 "카메라 촬영 흔적이 얼마나 남아 있는가"입니다.
 * 흔적이 없다는 것과 AI가 만들었다는 것은 같은 말이 아닙니다.
 * 메신저를 거친 사진, 스크린샷, PNG로 내보낸 사진은 흔적이 지워진 실제 사진입니다.
 * ─────────────────────────────────────────────────────────────
 */

import { SYNTH_T } from './verify/synthesis.js';

/** 배점. 합이 100입니다. 여기만 고치면 전체 수치가 따라 바뀝니다. */
export const WEIGHTS = {
  exif: 25,          // 촬영 정보 — 기기와 시각이 남아 있는가
  isoNoise: 20,      // 기록된 ISO와 실측 노이즈가 맞는가
  noisePhysics: 20,  // 밝을수록 노이즈가 커지는가 (포아송)
  optics: 15,        // 렌즈를 지난 흔적 — 비네팅, 색수차
  focus: 10,         // 초점이 연속적인가
  compression: 10,   // 압축 격자가 한 번의 이력인가
};

/**
 * 각 항목은 세 상태 중 하나입니다.
 *   match   정합 — 촬영 흔적이 확인됨        배점 100%
 *   unknown 측정 불가 — 잴 수 없었음          배점 50% (없는 것은 증거가 아닙니다)
 *   against 모순 또는 미검출                  배점 0%
 */
const FACTOR = { match: 1, unknown: 0.5, against: 0 };

export const STATE_LABEL = {
  match: '정합',
  unknown: '측정 불가',
  against: '모순',
};

const pick = (state, weight) => Math.round(FACTOR[state] * weight * 10) / 10;

function scoreExif(exif) {
  if (!exif.present) return { state: 'against', note: '메타데이터가 전부 지워졌습니다' };
  if (!exif.hasCameraId) return { state: 'against', note: '제조사·모델이 지워졌습니다' };
  if (!exif.dateTimeOriginal && !exif.dateTimeOriginalRaw) {
    return { state: 'against', note: '촬영 시각이 없습니다' };
  }
  return { state: 'match', note: '기기와 촬영 시각이 남아 있습니다' };
}

function scoreIsoNoise(consistency) {
  const { darkSigma } = consistency.measured;
  if (consistency.flags.isoNoiseMismatch) {
    return { state: 'against', note: `ISO ${consistency.iso} 기록에 비해 노이즈가 없습니다` };
  }
  if (darkSigma == null) return { state: 'unknown', note: '잴 수 있는 어두운 영역이 모자랍니다' };
  if (consistency.iso == null) return { state: 'unknown', note: 'ISO 기록이 없어 대조하지 못했습니다' };
  return { state: 'match', note: `ISO ${consistency.iso}, 실측 σ=${darkSigma.toFixed(2)} — 서로 맞습니다` };
}

function scoreNoisePhysics(consistency) {
  const { slopeCorrelation } = consistency.measured;
  if (consistency.flags.noiseSignalInverted) {
    return { state: 'against', note: '밝을수록 노이즈가 줄어듭니다' };
  }
  if (consistency.flags.noiseSignalFlat) {
    return { state: 'against', note: '밝기와 무관하게 노이즈가 일정합니다' };
  }
  if (slopeCorrelation == null) return { state: 'unknown', note: '밝기 분포가 좁아 재지 못했습니다' };
  // 모순 플래그(상관 -0.7 이하)에는 못 미치지만 방향이 양수가 아니면 증거로 세지 않습니다.
  const corr = `${slopeCorrelation > 0 ? '+' : ''}${slopeCorrelation.toFixed(2)}`;
  if (slopeCorrelation <= 0) {
    return { state: 'unknown', note: `구간 상관 ${corr} — 방향이 뚜렷하지 않습니다` };
  }
  return { state: 'match', note: `구간 상관 ${corr} — 밝을수록 노이즈가 큽니다` };
}

function scoreOptics(optics) {
  const vig = optics.vignetting;
  const ca = optics.chromaticAberration;
  const found = [vig.detected && '비네팅', ca.detected && '색수차'].filter(Boolean);
  if (found.length === 2) return { state: 'match', note: '비네팅과 색수차가 둘 다 있습니다' };
  if (found.length === 1) return { state: 'unknown', note: `${found[0]}만 검출됐습니다` };
  if (vig.ratio == null && !ca.measurable) {
    return { state: 'unknown', note: '렌즈 흔적을 잴 표본이 모자랍니다' };
  }
  return { state: 'against', note: '비네팅도 색수차도 없습니다 — 보정이나 크롭으로도 지워집니다' };
}

function scoreFocus(optics) {
  if (optics.focus.discontinuous) {
    return { state: 'against', note: '선명도가 구역별로 끊깁니다' };
  }
  return { state: 'match', note: `그리드 편차 ${optics.focus.abruptness.toFixed(2)} — 연속적입니다` };
}

function scoreCompression(compression) {
  if (compression.flags.regionalBlockDeviation) {
    return { state: 'against', note: `${compression.weakTiles}개 구역에서 격자가 다릅니다` };
  }
  if (compression.flags.recompressed) {
    return { state: 'unknown', note: '자르거나 크기를 바꿔 다시 저장했습니다' };
  }
  if (compression.estimatedPasses == null) {
    return { state: 'unknown', note: '압축 격자를 읽지 못했습니다' };
  }
  return { state: 'match', note: '압축 격자가 한 벌입니다' };
}

const ITEMS = [
  { key: 'exif', label: '촬영 정보', run: (b) => scoreExif(b.exif) },
  { key: 'isoNoise', label: 'ISO 대 노이즈', run: (b) => scoreIsoNoise(b.consistency) },
  { key: 'noisePhysics', label: '노이즈-신호 물리', run: (b) => scoreNoisePhysics(b.consistency) },
  { key: 'optics', label: '렌즈 흔적', run: (b) => scoreOptics(b.optics) },
  { key: 'focus', label: '초점 연속성', run: (b) => scoreFocus(b.optics) },
  { key: 'compression', label: '압축 이력', run: (b) => scoreCompression(b.compression) },
];

/**
 * @param {object} bundle verifyFile이 모은 측정값
 * @returns {{trace:number, ai:number, categories:object[]}}
 *   trace 촬영 흔적 0~100 · ai 100 - trace
 */
export function scoreTraces(bundle) {
  // 파일이 스스로 AI 생성물이라고 밝혔다면 배점을 따질 일이 아닙니다.
  // 읽은 값이 재서 얻은 추정을 덮습니다.
  if (bundle.provenance?.declaresAi) {
    return {
      trace: 0,
      ai: 100,
      declared: true,
      categories: ITEMS.map(({ key, label }) => ({
        key, label, weight: WEIGHTS[key], state: 'against', earned: 0,
        note: '파일에 AI 생성 기록이 있어 촬영 흔적을 세지 않습니다',
      })),
    };
  }

  const categories = ITEMS.map(({ key, label, run }) => {
    const weight = WEIGHTS[key];
    const { state, note } = run(bundle);
    return { key, label, weight, state, note, earned: pick(state, weight) };
  });

  const earned = categories.reduce((sum, c) => sum + c.earned, 0);
  const trace = Math.round(earned);

  return { trace, ai: 100 - trace, declared: false, categories };
}

/* ── AI 판별 기준 ────────────────────────────────────────
   화소 하한이나 "약한 신호 n건" 같은 집계는 측정이 가능한지를 말할 뿐
   AI인지를 말하지 않습니다. 여기서는 카메라와 생성물이 실제로 갈리는
   자리만 세웁니다. 각 줄은 카메라 쪽 / 판단 보류 / AI 쪽 중 하나입니다. */

/** 생성 모델이 그대로 뱉는 규격 크기. 카메라 센서는 이런 값이 나오지 않습니다. */
const GENERATED_SIZES = [
  [1024, 1024], [1024, 1536], [1536, 1024], [1792, 1024], [1024, 1792],
  [512, 512], [768, 768], [1280, 1280], [2048, 2048],
  [832, 1216], [1216, 832], [896, 1152], [1152, 896],
  [1344, 768], [768, 1344], [1456, 816], [816, 1456],
];

export const SIDE = { camera: '카메라 쪽', unknown: '판단 보류', ai: 'AI 쪽' };

/**
 * @param {object} b verifyFile이 모은 측정값
 * @returns {object[]} 각 줄 { label, basis, got, side, note }
 */
export function aiSignals(b) {
  const { exif, consistency, optics, compression, rephoto, pixels, provenance: prov } = b;
  const rows = [];

  /* 발화율이 낮은 기준은 무언가를 잡았을 때만 줄을 냅니다.
     15장으로 재 보니 센서 노이즈 7%, 생성기 규격 해상도 7%, 압축 이력 13%로
     대부분 "판단 보류"만 찍고 있었습니다. 아무 말도 못 하는 줄이 늘어서 있으면
     읽는 쪽에서는 기준이 많은 것이 아니라 근거가 없는 것으로 보입니다.
     빼지 않고 숨기는 이유는, 드물게 잡을 때는 그 값이 진짜이기 때문입니다. */
  const push = (side, row) => {
    if (side !== 'unknown') rows.push({ ...row, side });
  };

  rows.push({
    label: 'AI 생성 표식',
    basis: '파일에 생성 선언이 없어야 함',
    got: prov?.declaresAi ? `있음${prov.generator ? ` · ${prov.generator}` : ''}` : '없음',
    side: prov?.declaresAi ? 'ai' : 'unknown',
    decisive: Boolean(prov?.declaresAi),
    note: prov?.present
      ? (prov.via === 'C2PA' ? 'C2PA 서명을 읽었습니다' : '파일 메타데이터를 읽었습니다')
      : 'C2PA 서명과 메타데이터에 없습니다. 표식은 저장·캡처로 지워집니다',
  });

  rows.push({
    label: '촬영 정보',
    basis: '제조사·모델·렌즈·촬영 시각',
    got: exif.hasCameraId ? '있음' : exif.present ? '일부만 남음' : '없음',
    side: exif.hasCameraId ? 'camera' : 'ai',
    note: exif.hasCameraId
      ? '생성물에는 촬영 기기가 적히지 않습니다'
      : '메신저를 거친 실제 사진도 이렇게 됩니다',
  });

  {
    const { darkSigma } = consistency.measured;
    const side = consistency.flags.isoNoiseMismatch ? 'ai'
      : darkSigma == null || consistency.iso == null ? 'unknown' : 'camera';
    push(side, {
      label: '센서 노이즈',
      basis: '기록된 ISO에 맞는 노이즈가 있어야 함',
      got: darkSigma == null ? '측정 불가'
        : `σ=${darkSigma.toFixed(2)}${consistency.iso != null ? ` / ISO ${consistency.iso}` : ' / ISO 기록 없음'}`,
      side,
      note: side === 'ai'
        ? '기록된 ISO라면 있어야 할 노이즈가 없습니다'
        : '생성 모델은 센서를 거치지 않아 ISO와 맞는 노이즈를 만들지 못합니다',
    });
  }

  {
    const { slopeCorrelation } = consistency.measured;
    const bad = consistency.flags.noiseSignalInverted || consistency.flags.noiseSignalFlat;
    const side = bad ? 'ai' : slopeCorrelation == null || slopeCorrelation <= 0 ? 'unknown' : 'camera';
    rows.push({
      label: '노이즈-신호 물리',
      basis: '밝을수록 노이즈가 커져야 함 (포아송)',
      got: slopeCorrelation == null ? '측정 불가'
        : `구간 상관 ${slopeCorrelation > 0 ? '+' : ''}${slopeCorrelation.toFixed(2)}`,
      side,
      note: '빛이 알갱이로 도착해 생기는 곡선입니다. 생성물에는 이유가 없어 잘 나타나지 않습니다',
    });
  }

  {
    const found = [optics.vignetting.detected && '비네팅', optics.chromaticAberration.detected && '색수차']
      .filter(Boolean);
    const side = found.length === 2 ? 'camera' : found.length === 1 ? 'unknown' : 'ai';
    rows.push({
      label: '렌즈 광학 흔적',
      basis: '비네팅과 색수차가 있어야 함',
      got: found.length ? `${found.join(' · ')} 검출` : '둘 다 없음',
      side,
      note: '유리를 지난 빛에만 생기는 결함입니다. 다만 카메라 내 보정과 크롭으로도 지워집니다',
    });
  }

  {
    const lossless = compression.estimatedPasses == null;
    const side = compression.flags.regionalBlockDeviation ? 'ai'
      : lossless ? 'unknown' : 'camera';
    push(side, {
      label: '압축 이력',
      basis: '카메라 JPEG의 8×8 격자가 있어야 함',
      got: compression.flags.regionalBlockDeviation ? `구역별로 다름 (${compression.weakTiles}개)`
        : lossless ? '격자 없음 — 무손실 저장' : `격자 검출 · ${compression.estimatedPasses}회`,
      side,
      note: lossless
        ? '생성 모델은 보통 PNG로 무손실 저장합니다. 카메라 원본은 JPEG 격자를 남깁니다'
        : '카메라가 저장할 때 남기는 격자입니다',
    });
  }

  {
    const [w, h] = [pixels.width, pixels.height];
    const hit = GENERATED_SIZES.some(([a, c]) => (a === w && c === h) || (a === h && c === w));
    push(hit ? 'ai' : 'unknown', {
      label: '생성기 규격 해상도',
      basis: '생성 모델의 표준 크기가 아니어야 함',
      got: `${w}×${h}${hit ? ' — 규격 일치' : ''}`,
      side: hit ? 'ai' : 'unknown',
      note: hit
        ? '생성 모델이 그대로 출력하는 크기입니다. 다만 사람이 이 크기로 자를 수도 있습니다'
        : '생성 모델이 쓰는 규격 크기가 아닙니다. 리사이즈하면 이 신호는 사라집니다',
    });
  }

  {
    const flat = rephoto.flags.flatFocus;
    const moire = rephoto.flags.moire;
    rows.push({
      label: '초점 분포',
      basis: '거리에 따라 선명도가 달라져야 함',
      got: moire ? '모아레 검출' : flat ? '화면 전체가 균일' : optics.focus.discontinuous ? '구역별로 끊김' : '연속적',
      side: flat || optics.focus.discontinuous ? 'ai' : moire ? 'unknown' : 'camera',
      note: '실제 장면은 거리가 있어 선명도가 이어집니다. 평면을 찍거나 생성한 이미지는 균일합니다',
    });
  }

  return rows;
}

/**
 * 픽셀에서 잰 생성물 흔적을 판별 기준 줄로 옮깁니다.
 * synthesis.js가 없는 옛 번들에서도 죽지 않도록 방어적으로 읽습니다.
 */
export function synthesisSignals(b) {
  const syn = b.synthesis;
  if (!syn) return [];
  const rows = [];

  {
    const e = syn.encoder;
    let side = 'unknown';
    let got = '알 수 없음';
    let note = '';

    if (e.kind === 'jpeg') {
      const chroma = e.chroma ? ` · ${e.chroma}` : '';
      if (e.quant === 'custom') {
        side = 'camera';
        got = `비표준 양자화표 — 제조사 고유${chroma}`;
        note = '카메라 제조사가 자기 표를 쓴 흔적입니다. 라이브러리로 다시 저장하면 사라집니다';
      } else if (e.quant === 'standard') {
        side = 'ai';
        got = `표준 라이브러리 표 (품질 ${e.quality})${chroma}`;
        note = 'libjpeg·PIL이 그대로 쓰는 표입니다. 카메라에서 바로 나온 파일이 아닙니다';
      } else {
        got = `양자화표를 읽지 못함${chroma}`;
        note = 'JPEG이지만 표를 꺼내지 못했습니다';
      }
    } else if (e.kind === 'png') {
      const f = e.png;
      side = f && f.tool === 'library' ? 'ai' : 'unknown';
      got = !f ? 'PNG — 구조를 읽지 못함'
        : f.tool === 'library' ? 'PNG — 라이브러리 저장 서명'
          : f.tool === 'os' ? 'PNG — 운영체제·편집기 저장' : 'PNG — 판별 불가';
      note = f && f.tool === 'library'
        ? 'IDAT를 정확히 65536으로 끊고 보조 청크를 넣지 않았습니다. 파이썬 계열(PIL)이 저장할 때의 모양이고, 생성 모델의 기본 출력 경로입니다'
        : '카메라는 PNG를 만들지 않습니다. 캡처·편집·생성 중 하나를 거친 파일입니다';
    }

    rows.push({ label: '저장 형식 지문', basis: '카메라가 직접 저장한 모양이어야 함', got, side, note });
  }

  {
    const c = syn.clip;
    const side = !c?.measurable ? 'unknown' : c.present ? 'camera' : 'unknown';
    rows.push({
      label: '하이라이트 클리핑',
      basis: '센서가 감당 못한 밝기가 255에 붙어야 함',
      got: !c?.measurable ? '측정 불가' : `순백 화소 ${(c.white * 100).toFixed(4)}%`,
      side,
      note: '창문·하늘·금속 반사에서 센서는 한계를 넘겨 순백으로 탑니다. 생성물은 그럴 이유가 없어 '
        + '거의 닿지 않습니다. 어두운 실내 사진도 닿지 않습니다',
    });
  }

  {
    const c = syn.cfa;
    const side = !c.measurable ? 'unknown'
      : c.detected ? 'camera' : c.absent ? 'ai' : 'unknown';
    rows.push({
      label: '센서 컬러필터 흔적',
      basis: '디모자이크가 남기는 2×2 주기가 있어야 함',
      got: c.ratio == null ? '측정 불가' : `위상비 ${c.ratio.toFixed(3)}`,
      side,
      note: '센서는 화소마다 색 하나만 받고 나머지를 이웃에서 보간합니다. 그 자국이 2×2로 반복됩니다. '
        + '생성물에는 없지만, 크기를 바꾸면 실제 사진에서도 지워집니다',
    });
  }

  {
    const sp = syn.spectrum;
    const odd = sp.measurable && !sp.natural;
    rows.push({
      label: '주파수 감쇠',
      basis: `자연 영상의 기울기 α ${SYNTH_T.slopeNaturalLow}~${SYNTH_T.slopeNaturalHigh}`,
      got: sp.alpha == null ? '측정 불가'
        : `α=${sp.alpha.toFixed(2)}${odd ? (sp.tooSteep ? ' — 고주파가 모자람' : ' — 고주파가 과함') : ''}`,
      side: odd ? 'ai' : 'unknown',
      note: '자연 영상은 1/f^α를 따릅니다. 확산 모델 출력은 고주파가 덜 실리는 경향이 있지만, '
        + '피사체에 따라 크게 움직여서 범위를 벗어날 때만 이상으로 봅니다',
    });
  }

  return rows;
}
