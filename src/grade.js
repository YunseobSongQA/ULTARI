/**
 * grade.js — 측정 결과를 네 가지 판정 중 하나로 옮깁니다.
 *
 *   AI 생성 기록  파일이 스스로 AI 생성물이라고 밝힘 (읽은 값, 추정 아님)
 *   통과          3등급 발급
 *   판정 불가     자동 검증에 필요한 정보가 없음
 *   보류          측정값끼리 서로 맞지 않음
 *
 * 픽셀을 재서 "AI로 보인다"고 말하는 일은 여전히 하지 않습니다. AI라고 적는
 * 경우는 단 하나, 파일 자신이 C2PA 규격으로 그렇게 선언해 둔 때뿐입니다.
 * 자동 검증이 떨어뜨리는 사진의 대부분은 실제로 사람이 찍은 사진입니다.
 * 메신저를 한 번만 거쳐도 EXIF가 통째로 사라지고, 요즘 휴대폰은 촬영 순간
 * 강한 보정을 넣어 노이즈의 물리를 지웁니다. 오탐의 대가는 창작자를 모욕하는
 * 것이고, 그 대가가 미탐보다 훨씬 큽니다. 그래서 판정은 한쪽으로 기울어 있습니다.
 *
 * 아래 합격선과 조합 규칙은 코드에만 둡니다. 화면에는 측정값만 나갑니다.
 */

export const VERDICT = {
  PASS: 'pass',
  INSUFFICIENT: 'insufficient',
  HOLD: 'hold',
  DECLARED_AI: 'declared-ai',
};

/* 합격선. GATE로 내보내 결과 화면에 그대로 적습니다. */
const T = {
  // 이보다 작은 사진은 측정할 화소가 모자랍니다.
  minMegapixels: 0.3,
  // 약한 신호가 이만큼 겹치면 보류로 넘깁니다. 하나로는 넘기지 않습니다.
  softSignalsForHold: 2,
  // 메신저·소셜이 즐겨 쓰는 긴 변 상한.
  // 1920이나 2560처럼 카메라 원본에서도 흔한 값은 넣지 않습니다. 힌트가 소음이 됩니다.
  messengerLongEdges: [1280, 1440, 2048],
};

/** 마크 발급선을 화면에 적기 위해 내보냅니다. */
export const GATE = T;

export const STATEMENT_GRADE3 = [
  '이 사진은 실제 카메라로 촬영된 것으로 보입니다.',
  '무엇을 찍었는지는 확인하지 않았습니다.',
  '자동 검증은 우회 가능합니다. 확정 인증은 2등급부터입니다.',
];

/** 통과가 아닌 결과에도 할 말이 있어야 합니다. 결과만 던지고 끝내지 않습니다. */
export const STATEMENT = {
  [VERDICT.PASS]: STATEMENT_GRADE3,
  [VERDICT.INSUFFICIENT]: [
    '사진이 아니라 파일의 문제일 가능성이 큽니다.',
    '카메라나 갤러리에서 바로 꺼낸 원본에는 잴 것이 남아 있습니다.',
    '메신저로 받은 파일은 이미 다른 파일입니다.',
  ],
  [VERDICT.HOLD]: [
    '보류는 의심이 아닙니다. 기계가 답을 내지 못했다는 뜻입니다.',
    '보정을 강하게 건 실제 사진에서도 자주 나오는 결과입니다.',
    '사람 심사로 넘기면 기계가 보지 못하는 것까지 봅니다.',
  ],
  [VERDICT.DECLARED_AI]: [
    '이것은 픽셀을 재서 내린 추정이 아닙니다. 파일에 그렇게 적혀 있습니다.',
    '생성한 쪽이 규격(C2PA)에 따라 남긴 서명된 기록입니다.',
    '인증 마크는 발급하지 않습니다.',
  ],
};

export const HEADLINE = {
  [VERDICT.PASS]: '3등급 발급',
  [VERDICT.DECLARED_AI]: '이 파일은 스스로 AI 생성물이라고 기록하고 있습니다',
  [VERDICT.INSUFFICIENT]: '자동 검증에 필요한 정보가 부족합니다 — 원본 파일로 다시 시도해 주세요',
  [VERDICT.HOLD]: '자동 검증에서 모순이 발견됐습니다 — 사람 심사로 넘길 수 있습니다',
};

function collectBlockers({ exif, consistency, pixels }) {
  const blockers = [];

  if (pixels.megapixels < T.minMegapixels) {
    blockers.push({
      code: 'too-small',
      title: '화소가 모자랍니다',
      detail: `${pixels.width}×${pixels.height}는 노이즈와 압축 격자를 재기에 너무 작습니다. 축소되지 않은 원본이 필요합니다.`,
    });
  }

  if (!exif.present) {
    blockers.push({
      code: 'exif-absent',
      title: '촬영 정보가 없습니다',
      detail: '파일에 메타데이터가 하나도 남아 있지 않습니다. 메신저나 소셜 앱을 거치면 대부분 이렇게 됩니다.',
    });
  } else if (exif.flags.noCameraId) {
    blockers.push({
      code: 'no-camera-id',
      title: '촬영 기기가 적혀 있지 않습니다',
      detail: '메타데이터 일부는 남아 있지만 제조사와 모델이 지워졌습니다. 자동 검증은 이 값에서 출발합니다.',
    });
  } else if (exif.flags.noCaptureTime) {
    blockers.push({
      code: 'no-capture-time',
      title: '촬영 시각이 없습니다',
      detail: '촬영 시각이 지워진 파일은 편집본이거나 재저장본일 가능성이 큽니다. 카메라에서 바로 꺼낸 파일이 필요합니다.',
    });
  }

  if (consistency.flags.notMeasurable) {
    blockers.push({
      code: 'pixels-not-measurable',
      title: '노이즈를 잴 수 있는 영역이 없습니다',
      detail: '측정에 쓸 수 있는 패치가 모자랍니다. 화면 대부분이 날아갔거나 지나치게 작은 파일입니다.',
    });
  }

  return blockers;
}

function collectContradictions({ consistency }) {
  const hard = [];

  if (consistency.flags.isoNoiseMismatch) {
    hard.push({
      code: 'iso-noise-mismatch',
      title: 'ISO 기록과 실측 노이즈가 맞지 않습니다',
      detail: `메타데이터에는 ISO ${consistency.iso}로 적혀 있는데, 어두운 영역의 노이즈가 σ=${consistency.measured.darkSigma.toFixed(2)}로 거의 없습니다. 강한 노이즈 제거를 걸었거나, 기록된 ISO가 실제 촬영값이 아닙니다.`,
    });
  }

  if (consistency.flags.noiseSignalInverted) {
    hard.push({
      code: 'noise-signal-inverted',
      title: '밝을수록 노이즈가 줄어듭니다',
      detail: '빛은 알갱이로 도착하기 때문에 밝은 곳일수록 노이즈가 커집니다. 측정값은 그 반대 방향입니다.',
    });
  }

  if (consistency.flags.noiseSignalFlat) {
    hard.push({
      code: 'noise-signal-flat',
      title: '밝기와 무관하게 노이즈가 일정합니다',
      detail: '센서 노이즈는 밝기를 따라 변해야 합니다. 다만 휴대폰의 촬영 시 노이즈 제거도 똑같은 모양을 만듭니다. 실제로 찍으신 사진이라면 이 결과는 카메라가 후처리를 강하게 걸었다는 뜻일 가능성이 높습니다.',
    });
  }

  return hard;
}

function collectSoftSignals({ consistency, optics, compression }) {
  const soft = [];

  if (optics.flags.noOpticalTrace) {
    soft.push({
      code: 'no-optical-trace',
      title: '렌즈 흔적이 잡히지 않습니다',
      detail: '비네팅과 색수차가 둘 다 검출되지 않았습니다. 카메라 내 보정이나 크롭으로도 같은 결과가 나옵니다.',
    });
  }

  if (optics.flags.focusDiscontinuity) {
    soft.push({
      code: 'focus-discontinuity',
      title: '선명도가 구역별로 끊깁니다',
      detail: '초점은 보통 부드럽게 변합니다. 측정한 8×8 지도에서는 인접 칸끼리 급격하게 달라집니다.',
    });
  }

  if (compression.flags.regionalBlockDeviation) {
    soft.push({
      code: 'regional-block-deviation',
      title: '압축 격자가 영역마다 다릅니다',
      detail: `${compression.weakTiles}개 구역에서 8×8 격자가 거의 잡히지 않습니다. 일부만 다른 이력을 가졌을 때 나타나는 모양입니다.`,
    });
  }

  return soft;
}

function collectHints({ exif, compression, rephoto, pixels }) {
  const hints = [];

  // 메타데이터가 없고, 다시 압축된 흔적이 있고, 크기까지 딱 떨어질 때만 짚습니다.
  const longEdge = Math.max(pixels.width, pixels.height);
  if (!exif.hasCameraId && compression.estimatedPasses != null && T.messengerLongEdges.includes(longEdge)) {
    hints.push(`긴 변이 정확히 ${longEdge}픽셀이고 다시 압축된 흔적이 있습니다. 메신저나 소셜 앱이 자동으로 줄이는 크기와 일치합니다.`);
  }

  if (compression.flags.recompressed) {
    hints.push('서로 어긋난 두 개의 압축 격자가 보입니다. 자르거나 크기를 바꾼 뒤 다시 저장된 파일입니다.');
  }

  if (exif.editorNamed) {
    hints.push(`후보정 도구 기록이 있습니다(${exif.software}). 보정은 등급을 깎지 않습니다.`);
  }

  if (rephoto.flags.moire) {
    hints.push('규칙적인 주파수 피크가 있습니다. 화면을 다시 찍었을 때 나오는 모양이지만, 직물·벽돌·방충망 같은 피사체에서도 똑같이 나옵니다. 이 신호는 등급을 깎지 않으며 2등급 심사 대상입니다.');
  } else if (rephoto.flags.flatFocus) {
    hints.push('화면 전체의 선명도가 이상할 만큼 균일합니다. 평면을 찍었을 때의 특징입니다. 이 신호는 등급을 깎지 않으며 2등급 심사 대상입니다.');
  }

  if (exif.hasGps) {
    hints.push('위치 정보가 파일에 들어 있습니다. 좌표는 읽지도 보여 주지도 않았지만, 이 파일을 남에게 보낼 때는 알고 계시는 편이 좋습니다.');
  }

  return hints;
}

/**
 * @param {object} input 각 verify 모듈의 반환값
 * @returns {{verdict:string, grade:number|null, headline:string, statement:string[],
 *            blockers:object[], contradictions:object[], softSignals:object[],
 *            hints:string[], next:object[]}}
 */
export function gradeResult(input) {
  const blockers = collectBlockers(input);
  const contradictions = collectContradictions(input);
  const softSignals = collectSoftSignals(input);
  const hints = collectHints(input);

  let verdict;
  if (input.provenance?.declaresAi) {
    // 파일이 스스로 밝힌 것은 재서 얻은 추정보다 앞섭니다.
    verdict = VERDICT.DECLARED_AI;
  } else if (blockers.length > 0) {
    verdict = VERDICT.INSUFFICIENT;
  } else if (contradictions.length > 0 || softSignals.length >= T.softSignalsForHold) {
    verdict = VERDICT.HOLD;
  } else {
    verdict = VERDICT.PASS;
  }

  // 어떤 결과에서도 다음 행동이 있어야 합니다. 막다른 길을 만들지 않습니다.
  const next = {
    [VERDICT.DECLARED_AI]: [
      { kind: 'retry', label: '다른 사진 검증' },
    ],
    [VERDICT.PASS]: [
      { kind: 'review2', label: '2등급 심사 신청' },
      { kind: 'retry', label: '다른 사진 검증' },
    ],
    [VERDICT.INSUFFICIENT]: [
      { kind: 'retry', label: '원본 파일로 다시 시도' },
      { kind: 'review2', label: '사람 심사 신청' },
    ],
    [VERDICT.HOLD]: [
      { kind: 'review2', label: '사람 심사 신청' },
      { kind: 'retry', label: '원본 파일로 다시 시도' },
    ],
  }[verdict];

  return {
    verdict,
    grade: verdict === VERDICT.PASS ? 3 : null,
    headline: HEADLINE[verdict],
    statement: STATEMENT[verdict],
    blockers,
    contradictions,
    softSignals,
    hints,
    next,
  };
}
