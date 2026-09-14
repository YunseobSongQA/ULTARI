/**
 * html.js — 화면을 만드는 코드가 함께 쓰는 것들.
 *
 * 사진 화면(ui.js)과 영상·음악 화면(media-ui.js)이 같은 도우미를 써야
 * 이스케이프 규칙이 갈리지 않습니다.
 */

export const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

export const stripTags = (html) => String(html).replace(/<[^>]+>/g, '');

/** 펼쳐 둘 만큼 새롭지 않은 것은 접어 둡니다. 내용은 그대로입니다. */
export function fold(summary, hint, body, open = false) {
  return `<details class="fold"${open ? ' open' : ''}>
      <summary>${escapeHtml(summary)}${hint ? `<span class="hint">${escapeHtml(hint)}</span>` : ''}</summary>
      <div class="fold-body">${body}</div>
    </details>`;
}
