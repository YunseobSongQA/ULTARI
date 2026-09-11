/**
 * fingerprint.js — 이 파일이 "그 파일"인지 나중에 대조할 수 있게 지문을 남깁니다.
 *
 * 계산은 Web Crypto로 브라우저 안에서 합니다. 파일도 지문도 밖으로 나가지 않습니다.
 * 지문은 "이 바이트 배열"을 가리킬 뿐, 사진의 내용이나 출처를 증명하지 않습니다.
 *
 * 등록 시각은 사용자 기기의 시계를 읽은 값입니다. 기기 시계는 바꿀 수 있습니다.
 * 신뢰할 수 있는 시각 증명은 서버 없이는 불가능하고, 이 서비스에는 서버가 없습니다.
 */

function toHex(buffer) {
  const bytes = new Uint8Array(buffer);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return null;
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export async function fingerprintFile(file) {
  const base = {
    name: file.name || null,
    bytes: file.size,
    mimeType: file.type || null,
    // 클라이언트 시계. 신뢰할 수 없습니다.
    recordedAt: new Date(),
    timeIsTrusted: false,
  };

  if (!globalThis.crypto?.subtle) {
    // Web Crypto는 보안 컨텍스트(https 또는 localhost)에서만 동작합니다.
    return { ...base, sha256: null, short: null, unavailableReason: 'INSECURE_CONTEXT' };
  }

  try {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    const sha256 = toHex(digest);
    return { ...base, sha256, short: sha256.slice(0, 8), unavailableReason: null };
  } catch {
    return { ...base, sha256: null, short: null, unavailableReason: 'DIGEST_FAILED' };
  }
}
