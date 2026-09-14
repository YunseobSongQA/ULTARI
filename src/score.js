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
  const categories = ITEMS.map(({ key, label, run }) => {
    const weight = WEIGHTS[key];
    const { state, note } = run(bundle);
    return { key, label, weight, state, note, earned: pick(state, weight) };
  });

  const earned = categories.reduce((sum, c) => sum + c.earned, 0);
  const trace = Math.round(earned);

  return { trace, ai: 100 - trace, categories };
}
