/**
 * queue.js — 2등급·1등급 심사 대기 건수.
 *
 * 여기 적힌 숫자는 실제로 접수된 건수입니다. 0이면 0이라고 씁니다.
 * 진위를 파는 서비스가 대기열을 부풀리면 그 순간 파는 물건이 없어집니다.
 *
 * 서버가 없으므로 이 값은 접수함을 확인하고 손으로 갱신합니다.
 * 갱신할 때 접수함의 실제 건수 외의 숫자를 넣지 마십시오.
 */

export const REVIEW_QUEUE = {
  // 마지막으로 접수함을 확인한 시각
  updatedAt: '2026-09-11',
  grade2: 0,
  grade1: 0,
};

/**
 * 심사 접수처.
 * 배포 전에 실제로 받을 수 있는 주소로 바꾸십시오.
 */
export const REVIEW_CONTACT = 'review@ultari.kr';

export function queueLine(count) {
  return `현재 대기 ${count}건.`;
}

/** 측정 요약을 심사 신청 메일 본문으로 옮깁니다. 이미지는 첨부하지 않습니다. */
export function reviewMailto(grade, summaryLines = []) {
  const subject = `ULTARI ${grade}등급 심사 신청`;
  const body = [
    `${grade}등급 심사를 신청합니다.`,
    '',
    '— 자동 검증 요약 (이 기기에서 계산된 값) —',
    ...summaryLines,
    '',
    '원본 파일은 심사 담당자와 연락이 닿은 뒤 직접 전달하겠습니다.',
  ].join('\n');
  return `mailto:${REVIEW_CONTACT}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
