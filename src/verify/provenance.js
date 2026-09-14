/**
 * provenance.js — 파일이 스스로 밝힌 출처를 읽습니다.
 *
 * 이 모듈만 추측을 하지 않습니다. 픽셀을 재는 다른 모듈과 달리, 여기서는
 * 파일에 적힌 문장을 그대로 읽어 옮깁니다. C2PA 매니페스트에
 * digitalSourceType=trainedAlgorithmicMedia 가 적혀 있으면 그 파일은
 * 스스로 AI 생성물이라고 말하고 있는 것입니다. 해석의 여지가 없습니다.
 *
 * 읽는 곳
 *   PNG  caBX 청크(C2PA), tEXt/iTXt/zTXt 청크(생성기 파라미터)
 *   JPEG APP11 세그먼트(JUMBF/C2PA), APP1 세그먼트(XMP)
 *
 * 못 하는 것 — 중요합니다
 *   표식은 지울 수 있습니다. 스크린샷을 찍거나 다시 저장하면 사라집니다.
 *   그래서 "표식 있음"은 강한 증거지만 "표식 없음"은 아무 증거도 아닙니다.
 *   픽셀에 심는 보이지 않는 워터마크(SynthID 등)는 발행사의 검출기가 있어야
 *   읽을 수 있고, 서버가 없는 이 사이트에서는 확인할 방법이 없습니다.
 */

/* IPTC digitalsourcetype 용어집. 표준 값이라 그대로 대조합니다. */
const SOURCE_TYPE = {
  trainedAlgorithmicMedia: {
    ai: true,
    label: 'AI 생성',
    detail: '학습된 모델이 만들어 낸 이미지라고 파일에 적혀 있습니다.',
  },
  compositeWithTrainedAlgorithmicMedia: {
    ai: true,
    label: 'AI 합성 포함',
    detail: 'AI가 만든 요소가 합성돼 있다고 파일에 적혀 있습니다.',
  },
  algorithmicMedia: {
    ai: true,
    label: '알고리즘 생성',
    detail: '사람이 찍은 것이 아니라 프로그램이 만들어 낸 이미지라고 적혀 있습니다.',
  },
  digitalCapture: {
    ai: false,
    label: '카메라 촬영',
    detail: '카메라로 촬영됐다고 파일이 서명과 함께 밝히고 있습니다.',
  },
  softwareImage: {
    ai: false,
    label: '소프트웨어 생성',
    detail: '그래픽 도구로 만든 이미지라고 적혀 있습니다.',
  },
};

/* 생성기 이름이 그대로 박히는 자리들. 있으면 근거로 씁니다. */
const GENERATORS = [
  { re: /gpt-image/i, name: 'OpenAI gpt-image' },
  { re: /dall[\s._-]?e/i, name: 'OpenAI DALL·E' },
  { re: /OpenAI/i, name: 'OpenAI' },
  { re: /Midjourney/i, name: 'Midjourney' },
  { re: /Stable\s?Diffusion/i, name: 'Stable Diffusion' },
  { re: /ComfyUI/i, name: 'ComfyUI' },
  { re: /Adobe\s?Firefly/i, name: 'Adobe Firefly' },
  { re: /Imagen|Gemini/i, name: 'Google Imagen/Gemini' },
  { re: /Grok|xAI/i, name: 'xAI Grok' },
  { re: /Flux/i, name: 'Black Forest Labs FLUX' },
  { re: /NovelAI/i, name: 'NovelAI' },
];

const latin1 = (bytes) => {
  let out = '';
  const step = 8192;
  for (let i = 0; i < bytes.length; i += step) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
  }
  return out;
};

const u32 = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;

const isPng = (b) =>
  b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
const isJpeg = (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8;

/** PNG 청크를 훑어 C2PA 상자와 텍스트 청크만 걷어 옵니다. */
function collectPng(bytes) {
  const parts = [];
  let i = 8;
  while (i + 8 <= bytes.length) {
    const len = u32(bytes, i);
    const type = latin1(bytes.subarray(i + 4, i + 8));
    if (type === 'IEND') break;
    if (len > bytes.length) break;
    if (type === 'caBX' || type === 'tEXt' || type === 'iTXt' || type === 'zTXt') {
      parts.push(latin1(bytes.subarray(i + 8, i + 8 + len)));
    }
    i += 12 + len;
  }
  return parts;
}

/** JPEG APP 세그먼트에서 JUMBF(APP11)와 XMP(APP1)만 걷어 옵니다. */
function collectJpeg(bytes) {
  const parts = [];
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) { i += 1; continue; }
    const marker = bytes[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    if (marker === 0xda || marker === 0xd9) break;   // 여기부터는 압축된 화소입니다
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (len < 2) break;
    if (marker === 0xeb || marker === 0xe1) {
      parts.push(latin1(bytes.subarray(i + 4, i + 2 + len)));
    }
    i += 2 + len;
  }
  return parts;
}

/**
 * CBOR 텍스트 문자열을 길이대로 끊어 읽습니다.
 * 머리 바이트가 0x60~0x77이면 길이가 그 안에 들어 있고,
 * 0x78이면 다음 1바이트, 0x79면 다음 2바이트가 길이입니다.
 * 길이를 안 보고 읽으면 뒤에 붙은 다른 필드까지 딸려 옵니다.
 */
function cborText(hay, at) {
  const head = hay.charCodeAt(at);
  let len;
  let from = at + 1;
  if (head >= 0x60 && head <= 0x77) len = head - 0x60;
  else if (head === 0x78) { len = hay.charCodeAt(at + 1); from = at + 2; }
  else if (head === 0x79) { len = (hay.charCodeAt(at + 1) << 8) | hay.charCodeAt(at + 2); from = at + 3; }
  else return null;
  if (!len || len > 120) return null;
  const out = hay.slice(from, from + len);
  return /^[\x20-\x7e]+$/.test(out) ? out : null;
}

/** `key` 뒤에 이어지는 CBOR 맵에서 `name` 항목의 값을 읽습니다. */
function nameAfter(hay, key, span = 400) {
  const at = hay.indexOf(key);
  if (at < 0) return null;
  const nm = hay.indexOf('name', at + key.length);
  if (nm < 0 || nm > at + key.length + span) return null;
  return cborText(hay, nm + 4);
}

/**
 * 인증서 체인에 적힌 법인명 중 서명 주체를 고릅니다.
 *
 * 체인에는 발급 CA와 주체가 번갈아 들어 있어서 첫 번째도 마지막도 답이 아닙니다
 * (앞은 중간 CA, 뒤는 루트 CA가 잡힙니다). 주체는 잎 인증서의 subject와
 * SAN 등 여러 자리에 반복해 나오므로, 가장 많이 등장하는 이름을 씁니다.
 */
function signerFrom(hay) {
  const at = hay.indexOf('c2pa.signature');
  const tail = at < 0 ? hay : hay.slice(at);
  const re = /([A-Z][A-Za-z0-9 .,&'-]{2,40}?(?:LLC|L\.L\.C\.|Inc\.?|Ltd\.?|Limited|Corp\.?|Corporation|GmbH|S\.A\.|Pte\.? Ltd\.?))/g;
  const tally = new Map();
  for (const m of tail.matchAll(re)) {
    const name = m[1].trim();
    if (/\bCA\b|Certificate|Signing Authority/i.test(name)) continue;
    tally.set(name, (tally.get(name) || 0) + 1);
  }
  let best = null;
  for (const [name, n] of tally) if (!best || n > best[1]) best = [name, n];
  return best ? best[0] : null;
}

const EMPTY = {
  present: false, declaresAi: false, sourceType: null, sourceLabel: null,
  sourceDetail: null, generator: null, signer: null, watermarked: false,
  createdAt: null, via: null, markers: [],
};

/**
 * 바이트만 보고 판단합니다. DOM을 쓰지 않으므로 브라우저와 서버(Workers)가
 * 같은 코드로 같은 답을 냅니다.
 *
 * 신청을 막는 판단은 서버에서도 해야 합니다. 화면에서만 막으면 요청을 직접
 * 보내는 것으로 지나갈 수 있고, 그러면 막았다고 말할 수 없습니다.
 *
 * @param {Uint8Array} bytes
 * @returns {object} 파일이 밝힌 출처
 */
export function scanProvenance(bytes) {
  if (!bytes || !bytes.length) return EMPTY;

  const parts = isPng(bytes) ? collectPng(bytes)
    : isJpeg(bytes) ? collectJpeg(bytes)
      : [latin1(bytes.subarray(0, Math.min(bytes.length, 2 << 20)))];

  const hay = parts.join('\n');
  if (!hay) return EMPTY;

  const markers = [];

  /* 1. C2PA / JUMBF 매니페스트 */
  const hasC2pa = hay.includes('c2pa') || hay.includes('jumb');
  if (hasC2pa) markers.push('C2PA 매니페스트');

  /* 2. IPTC digitalSourceType — 표준 선언 */
  let sourceType = null;
  const st = hay.match(/digitalsourcetype\/([A-Za-z]+)/);
  if (st) sourceType = st[1];
  else if (/trainedAlgorithmicMedia/.test(hay)) sourceType = 'trainedAlgorithmicMedia';

  const known = sourceType ? SOURCE_TYPE[sourceType] : null;
  if (known) markers.push(`digitalSourceType · ${sourceType}`);

  /* 3. 생성기 이름 */
  const named = GENERATORS.find((g) => g.re.test(hay));
  let generator = nameAfter(hay, 'softwareAgent')
    || nameAfter(hay, 'claim_generator_info')
    || (named ? named.name : null);
  if (generator) {
    const ver = (hay.match(/version([\x60-\x77])/) || [])[0];
    if (ver) {
      const v = cborText(hay, hay.indexOf(ver) + 7);
      if (v && /^[\d.]+$/.test(v)) generator = `${generator} ${v}`;
    }
    markers.push(`생성기 · ${generator}`);
  }

  /* 4. 보이지 않는 워터마크를 넣었다는 기록 */
  const watermarked = /c2pa\.watermarked/.test(hay);
  if (watermarked) markers.push('보이지 않는 워터마크 기록');

  /* 5. 서명한 주체 — 인증서 주체의 법인명 */
  const signer = hasC2pa ? signerFrom(hay) : null;
  if (signer) markers.push(`서명 · ${signer}`);

  /* 6. 생성기 파라미터가 통째로 남은 경우 (로컬 생성 도구) */
  if (/\bparameters\b/.test(hay) && /(Steps|Sampler|CFG scale|Seed)/i.test(hay)) {
    markers.push('생성 파라미터 텍스트');
  }
  if (/"class_type"|"ckpt_name"/.test(hay)) markers.push('ComfyUI 워크플로');

  const createdAt = (hay.match(/(20\d\d-\d\d-\d\dT\d\d:\d\d:\d\dZ)/) || [])[1] || null;

  const declaresAi = Boolean(known && known.ai)
    || markers.includes('생성 파라미터 텍스트')
    || markers.includes('ComfyUI 워크플로');

  return {
    present: markers.length > 0,
    declaresAi,
    sourceType,
    sourceLabel: known ? known.label : null,
    sourceDetail: known ? known.detail : null,
    generator,
    signer,
    watermarked,
    createdAt,
    via: hasC2pa ? 'C2PA' : 'metadata',
    markers,
  };
}

/**
 * @param {File} file
 * @returns {Promise<object>} 파일이 밝힌 출처
 */
export async function readProvenance(file) {
  try {
    return scanProvenance(new Uint8Array(await file.arrayBuffer()));
  } catch {
    return EMPTY;
  }
}
