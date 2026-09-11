/**
 * queue.js — 사람이 하는 일의 현재 상태.
 *
 * 여기 적힌 숫자는 실제로 접수된 건수입니다. 0이면 0이라고 씁니다.
 * 진위를 파는 서비스가 대기열을 부풀리면 그 순간 파는 물건이 없어집니다.
 *
 * 서버가 없으므로 접수함을 확인하고 손으로 갱신합니다.
 */

/** 배포 전에 실제로 받을 수 있는 주소로 바꾸십시오. */
export const CONTACT = 'hello@ultari.kr';

export const REVIEW_QUEUE = {
  updatedAt: '2026-09-11',
  grade2: 0,     // 2등급 심사 대기
  grade1: 0,     // 1등급 심사 대기
  archive: 0,    // 오리지널 아카이브 보관 건수
};

export function queueLine(count) {
  return `현재 대기 ${count}건.`;
}

/** 메일 초안을 엽니다. 이미지는 첨부하지 않습니다. 전송 전에 직접 고칠 수 있습니다. */
export function mailtoLink(subject, lines = []) {
  const body = lines.join('\n');
  return `mailto:${CONTACT}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export const MAIL = {
  deepReview: (summaryLines) => mailtoLink('ULTARI 상세 검사 신청', [
    '상세 검사를 신청합니다.',
    '',
    '— 이 기기에서 계산된 자동 검증 요약 —',
    ...summaryLines,
    '',
    '원본 파일은 담당자와 연락이 닿은 뒤 직접 전달하겠습니다.',
    '연락 가능한 시간:',
  ]),
  archive: () => mailtoLink('ULTARI 오리지널 아카이브 접수', [
    '오리지널 아카이브에 작업물을 맡기고 싶습니다.',
    '',
    '작업 분야:',
    '보관을 원하는 분량(대략):',
    '촬영 장비:',
    '연락 가능한 시간:',
  ]),
  feedback: () => mailtoLink('ULTARI 피드백', [
    '무엇이 불편했는지 / 무엇이 있었으면 하는지:',
    '',
    '',
    '사용한 브라우저와 기기(있으면 적어 주세요):',
  ]),
};
