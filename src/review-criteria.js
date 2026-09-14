/**
 * review-criteria.js — 사람이 상세 검사에서 무엇을 보는지.
 *
 * 심사 콘솔과 서버가 같은 목록을 씁니다(`functions/api/admin.js`). 두 곳이
 * 따로 갖고 있으면 화면에서 고른 기준이 서버에서 버려지는 일이 생깁니다.
 *
 * 이 목록은 신청자에게도 그대로 보입니다. 어떤 기준으로 봤고 무엇이
 * 확인됐는지 말하지 않으면, 등급은 근거 없는 숫자가 됩니다.
 */

export const REVIEW_CHECKS = [
  {
    id: 'original',
    label: '원본 제출',
    detail: '카메라나 갤러리에서 바로 꺼낸 파일인지. 메신저를 거치거나 다시 저장한 흔적이 없는지.',
  },
  {
    id: 'exif',
    label: '촬영 정보 정합',
    detail: '파일에 적힌 기기·렌즈·설정이 픽셀에서 측정한 값과 맞는지.',
  },
  {
    id: 'rephoto',
    label: '화면 재촬영 아님',
    detail: '모니터나 인쇄물을 다시 찍은 흔적(모아레, 화소 격자, 화면 반사)이 없는지.',
  },
  {
    id: 'light',
    label: '빛과 그림자 정합',
    detail: '광원 방향, 그림자 길이, 반사가 서로 맞는지.',
  },
  {
    id: 'geometry',
    label: '원근과 비례',
    detail: '기록된 초점거리와 원근이 맞는지, 경계선과 비례가 어색하지 않은지.',
  },
  {
    id: 'edit',
    label: '편집 흔적 없음',
    detail: '합성, 지우기, 생성 채우기의 흔적이 없는지.',
  },
  {
    id: 'story',
    label: '설명과 일치',
    detail: '적어 주신 촬영 상황이 사진과 파일 기록에 맞는지.',
  },
  {
    id: 'siblings',
    label: '같은 촬영의 다른 컷',
    detail: '연속 촬영된 다른 파일이 있고 서로 맞는지.',
  },
  {
    id: 'sensor',
    label: '센서 지문 대조',
    detail: '같은 기기의 다른 사진과 센서 노이즈 패턴이 일치하는지. 1등급의 조건입니다.',
  },
];

/** 기준별 판단. "확인 못 함"은 기록하지 않습니다 — 적지 않은 것과 같습니다. */
export const CHECK_STATES = {
  pass: { label: '확인됨', tone: 'ok' },
  fail: { label: '어긋남', tone: 'no' },
};

export const CHECK_LABEL = Object.fromEntries(REVIEW_CHECKS.map((c) => [c.id, c.label]));

/** 발급할 수 있는 등급. 자동 검증은 3등급까지, 사람 심사가 1·2등급을 냅니다. */
export const AWARDABLE = [3, 2, 1];

export const sanitizeGrade = (value) => {
  const n = Number(value);
  return AWARDABLE.includes(n) ? n : null;
};

/** 모르는 기준과 모르는 판단은 버립니다. 화면이 보낸 것을 그대로 믿지 않습니다. */
export function sanitizeChecks(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const check of REVIEW_CHECKS) {
    const state = input[check.id];
    if (Object.prototype.hasOwnProperty.call(CHECK_STATES, state)) out[check.id] = state;
  }
  return out;
}

export const tallyChecks = (checks) => {
  const t = { pass: 0, fail: 0 };
  for (const state of Object.values(checks || {})) if (t[state] !== undefined) t[state] += 1;
  return t;
};

/** 1등급은 센서 지문이 확인돼야 합니다. 막지는 않고 심사자에게 알립니다. */
export const needsSensor = (awarded, checks) =>
  awarded === 1 && (checks || {}).sensor !== 'pass';
