/**
 * synthesis.js — 생성물에서 어색해지는 자리를 픽셀에서 찾습니다.
 *
 * 표식(C2PA)은 지우면 그만이라 그것만으로는 판별이 서지 않습니다. 여기서는
 * 파일에 적힌 것이 아니라 화소 자체에서, 카메라를 거친 이미지에만 남는
 * 흔적 셋을 잽니다.
 *
 *   1. CFA(베이어) 디모자이크 흔적
 *      센서는 화소마다 색 하나만 받고 나머지는 이웃에서 보간합니다. 그래서
 *      측정된 화소와 보간된 화소의 거칠기가 다르고, 그 차이가 2×2 주기로
 *      반복됩니다. 생성물은 센서를 거치지 않아 네 위상이 모두 같습니다.
 *
 *   2. 스펙트럼 감쇠 기울기
 *      자연 영상의 힘 스펙트럼은 1/f^α를 따르고 α는 대개 1.8~2.4입니다.
 *      확산 모델 출력은 고주파가 덜 실려 더 가파르게 떨어지는 경향이 있습니다.
 *
 *   3. JPEG 양자화 테이블 출처
 *      카메라는 제조사 고유 테이블을 씁니다. 라이브러리(libjpeg/PIL)로 저장하면
 *      표준 Annex K 테이블을 품질값으로 비례한 값이 그대로 들어갑니다.
 *      후자가 나오면 카메라에서 바로 나온 파일이 아닙니다.
 *
 * 모두 한계가 분명합니다. 리사이즈하면 1이 사라지고, 강한 보정은 2를 흔들고,
 * 3은 JPEG에만 있습니다. 그래서 각 값은 혼자 판정하지 않습니다.
 */

import { fft } from './rephoto.js';

const T = {
  // 2×2 위상별 거칠기 비. 1에 가까우면 CFA 흔적이 없습니다.
  // 실측: GPT 생성물 1.023, 소니 원본 1.044. 간격이 좁아 단독 판정은 하지 않습니다.
  cfaPresent: 1.035,
  cfaAbsent: 1.015,
  /* 자연 영상의 스펙트럼 기울기. 피사체에 따라 크게 움직여 넓게 잡습니다.
     이 범위를 벗어날 때만 이상으로 봅니다. 안에 들면 아무 말도 하지 않습니다.

     상한을 3.2에서 4.6으로 올렸습니다. 3.2는 자연 영상 통계 문헌에서 온
     값인데, 카메라가 저장하는 JPEG은 그 문헌의 대상이 아닙니다 — 기기 안에서
     노이즈를 지우고 크기를 줄이면 고주파가 먼저 깎입니다.

     실측한 진짜 카메라 넉 장: 아이폰8 2.94, 삼성 3.24, 소니 3.86과 4.11.
     셋이 3.2를 넘어 "AI 쪽"으로 찍히고 있었습니다. 진짜 사진에 AI 딱지를
     붙이는 기준은 없느니만 못합니다.

     같은 자리에서 잰 AI 생성물은 3.83이었습니다 — 소니 두 장 사이입니다.
     그러니 이 기준은 그 파일을 가려내지 못합니다. 상한을 올린다고 잃는
     탐지력이 없고, 얻는 것은 오탐이 멈추는 것뿐입니다.

     표본이 넉 장이라 4.6이라는 값 자체는 잠정입니다. 사진이 더 모이면
     다시 잡아야 합니다. /limits에 그렇게 적어 두었습니다. */
  slopeNaturalLow: 1.4,
  slopeNaturalHigh: 4.6,
  // 기울기를 믿을 수 있는 최소 적합도.
  slopeMinFit: 0.80,
};

/** 합격선. 화면이 같은 값을 적어야 해서 내보냅니다 — 두 곳이 따로 들고
    있으면 기준을 고쳤을 때 화면만 옛 숫자를 적습니다. */
export const SYNTH_T = T;

/* ── 1. CFA 디모자이크 흔적 ──────────────────────────── */

/**
 * 녹색 평면의 고역 통과 잔차를 2×2 위상으로 나눠 거칠기를 비교합니다.
 * 센서를 거친 이미지에서는 보간된 위상이 더 매끄럽습니다.
 */
function cfaTrace(tiles) {
  const ratios = [];

  for (const t of tiles) {
    const { data } = t.image;
    const w = t.width;
    const h = t.height;
    if (w < 32 || h < 32) continue;

    // 위상별 잔차 제곱합
    const sum = [0, 0, 0, 0];
    const count = [0, 0, 0, 0];

    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const g = (yy, xx) => data[((yy * w) + xx) * 4 + 1];
        const r = 4 * g(y, x) - g(y - 1, x) - g(y + 1, x) - g(y, x - 1) - g(y, x + 1);
        const phase = ((y & 1) << 1) | (x & 1);
        sum[phase] += r * r;
        count[phase] += 1;
      }
    }

    const rms = sum.map((s, i) => (count[i] ? Math.sqrt(s / count[i]) : 0));
    const lo = Math.min(...rms);
    const hi = Math.max(...rms);
    // 평탄한 타일은 잔차가 0에 가까워 비가 폭발합니다. 버립니다.
    if (lo < 0.5) continue;
    ratios.push(hi / lo);
  }

  if (!ratios.length) return { ratio: null, measurable: false, detected: false };

  ratios.sort((a, b) => a - b);
  const ratio = ratios[ratios.length >> 1];
  return {
    ratio,
    measurable: true,
    detected: ratio >= T.cfaPresent,
    absent: ratio <= T.cfaAbsent,
    tileCount: ratios.length,
  };
}

/* ── 2. 스펙트럼 감쇠 기울기 ─────────────────────────── */

function hann(n) {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  return w;
}

const pow2Floor = (v) => 2 ** Math.floor(Math.log2(v));

/** 방사 평균 힘 스펙트럼의 log-log 기울기. 자연 영상은 -2 부근입니다. */
function spectralSlope(tiles) {
  const slopes = [];
  const fits = [];

  for (const t of tiles) {
    const n = pow2Floor(Math.min(t.width, t.height));
    if (n < 128) continue;

    const win = hann(n);
    const re = new Float64Array(n * n);
    const im = new Float64Array(n * n);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        re[y * n + x] = t.luma[y * t.width + x] * win[y] * win[x];
      }
    }

    const rowRe = new Float64Array(n);
    const rowIm = new Float64Array(n);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) { rowRe[x] = re[y * n + x]; rowIm[x] = im[y * n + x]; }
      fft(rowRe, rowIm);
      for (let x = 0; x < n; x++) { re[y * n + x] = rowRe[x]; im[y * n + x] = rowIm[x]; }
    }
    const colRe = new Float64Array(n);
    const colIm = new Float64Array(n);
    for (let x = 0; x < n; x++) {
      for (let y = 0; y < n; y++) { colRe[y] = re[y * n + x]; colIm[y] = im[y * n + x]; }
      fft(colRe, colIm);
      for (let y = 0; y < n; y++) { re[y * n + x] = colRe[y]; im[y * n + x] = colIm[y]; }
    }

    // 방사 구간별 평균 힘
    const bins = 48;
    const acc = new Float64Array(bins);
    const cnt = new Float64Array(bins);
    const half = n / 2;
    for (let y = 0; y < n; y++) {
      const fy = y > half ? y - n : y;
      for (let x = 0; x < n; x++) {
        const fx = x > half ? x - n : x;
        const rad = Math.hypot(fx, fy);
        if (rad < 1 || rad >= half) continue;
        const b = Math.floor((rad / half) * bins);
        if (b >= bins) continue;
        const i = y * n + x;
        acc[b] += re[i] * re[i] + im[i] * im[i];
        cnt[b] += 1;
      }
    }

    // 저주파 몇 칸과 나이퀴스트 근처는 빼고 중간 대역만 적합합니다.
    const xs = [];
    const ys = [];
    for (let b = 2; b < bins * 0.85; b++) {
      if (!cnt[b]) continue;
      const power = acc[b] / cnt[b];
      if (power <= 0) continue;
      xs.push(Math.log((b + 0.5) / bins));
      ys.push(Math.log(power));
    }
    if (xs.length < 12) continue;

    const mx = xs.reduce((a, v) => a + v, 0) / xs.length;
    const my = ys.reduce((a, v) => a + v, 0) / ys.length;
    let sxy = 0; let sxx = 0; let syy = 0;
    for (let i = 0; i < xs.length; i++) {
      sxy += (xs[i] - mx) * (ys[i] - my);
      sxx += (xs[i] - mx) ** 2;
      syy += (ys[i] - my) ** 2;
    }
    if (sxx === 0 || syy === 0) continue;
    slopes.push(-(sxy / sxx));
    fits.push((sxy * sxy) / (sxx * syy));   // 결정계수
  }

  if (!slopes.length) return { alpha: null, measurable: false };

  slopes.sort((a, b) => a - b);
  fits.sort((a, b) => a - b);
  const alpha = slopes[slopes.length >> 1];
  const fit = fits[fits.length >> 1];

  return {
    alpha,
    fit,
    measurable: fit >= T.slopeMinFit,
    natural: alpha >= T.slopeNaturalLow && alpha <= T.slopeNaturalHigh,
    tooSteep: alpha > T.slopeNaturalHigh,
    tooFlat: alpha < T.slopeNaturalLow,
  };
}

/* ── 3. JPEG 양자화 테이블 출처 ──────────────────────── */

/* JPEG 표준 부록 K의 휘도 테이블. 라이브러리 저장의 출발점입니다. */
const ANNEX_K = [
  16, 11, 10, 16, 24, 40, 51, 61,
  12, 12, 14, 19, 26, 58, 60, 55,
  14, 13, 16, 24, 40, 57, 69, 56,
  14, 17, 22, 29, 51, 87, 80, 62,
  18, 22, 37, 56, 68, 109, 103, 77,
  24, 35, 55, 64, 81, 104, 113, 92,
  49, 64, 78, 87, 103, 121, 120, 101,
  72, 92, 95, 98, 112, 100, 103, 99,
];

/** libjpeg의 품질 → 테이블 비례 규칙 그대로입니다. */
function annexKAt(quality) {
  const scale = quality < 50 ? 5000 / quality : 200 - 2 * quality;
  return ANNEX_K.map((v) => Math.min(255, Math.max(1, Math.floor((v * scale + 50) / 100))));
}

/** 첫 번째 휘도 양자화 테이블을 꺼냅니다. */
function readDqt(bytes) {
  if (!(bytes[0] === 0xff && bytes[1] === 0xd8)) return null;
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) { i += 1; continue; }
    const marker = bytes[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    if (marker === 0xda || marker === 0xd9) break;
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (len < 2) break;
    if (marker === 0xdb) {
      let p = i + 4;
      const end = i + 2 + len;
      while (p < end) {
        const pq = bytes[p] >> 4;      // 0 = 8비트 값
        const tq = bytes[p] & 0x0f;    // 0 = 휘도
        p += 1;
        const table = [];
        for (let k = 0; k < 64; k++) {
          table.push(pq ? (bytes[p] << 8) | bytes[p + 1] : bytes[p]);
          p += pq ? 2 : 1;
        }
        if (tq === 0) return table;
      }
    }
    i += 2 + len;
  }
  return null;
}

/** SOF에 적힌 성분별 샘플링 비. 카메라는 대개 4:2:0이나 4:2:2를 씁니다. */
function subsampling(bytes) {
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) { i += 1; continue; }
    const m = bytes[i + 1];
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    if (m === 0xda || m === 0xd9) break;
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (m === 0xc0 || m === 0xc1 || m === 0xc2) {
      const n = bytes[i + 9];
      if (n < 3) return '흑백';
      const hv = bytes[i + 11];
      const h = hv >> 4;
      const v = hv & 15;
      if (h === 1 && v === 1) return '4:4:4';
      if (h === 2 && v === 1) return '4:2:2';
      if (h === 2 && v === 2) return '4:2:0';
      return `${h}x${v}`;
    }
    i += 2 + len;
  }
  return null;
}

/**
 * PNG 인코더 지문.
 * 카메라는 PNG를 만들지 않습니다. 그래서 PNG라는 사실 자체가 이미 정보이고,
 * 어떤 프로그램이 썼는지는 IDAT를 끊은 크기와 zlib 머리, 보조 청크 구성으로 갈립니다.
 *   PIL(파이썬)  IDAT를 정확히 65536으로 끊고 보조 청크를 거의 넣지 않습니다.
 *   운영체제 캡처 pHYs·sRGB·iCCP 같은 청크를 함께 씁니다.
 */
function pngFingerprint(bytes) {
  let i = 8;
  const idat = [];
  const ancillary = [];
  let zlibHead = null;

  while (i + 8 <= bytes.length) {
    const len = (bytes[i] << 24 | bytes[i + 1] << 16 | bytes[i + 2] << 8 | bytes[i + 3]) >>> 0;
    const type = String.fromCharCode(bytes[i + 4], bytes[i + 5], bytes[i + 6], bytes[i + 7]);
    if (type === 'IEND') break;
    if (len > bytes.length) break;
    if (type === 'IDAT') {
      if (!idat.length) zlibHead = (bytes[i + 8] << 8) | bytes[i + 9];
      idat.push(len);
    } else if (type !== 'IHDR') {
      ancillary.push(type);
    }
    i += 12 + len;
  }
  if (!idat.length) return null;

  const blocky = idat.length > 1 && idat.slice(0, -1).every((v) => v === 65536);
  const decorated = ancillary.some((t) => ['pHYs', 'sRGB', 'gAMA', 'iCCP', 'cHRM'].includes(t));

  return {
    blocky,
    decorated,
    zlibHead,
    ancillary,
    tool: blocky && !decorated ? 'library' : decorated ? 'os' : 'unknown',
  };
}

function encoderFingerprint(bytes) {
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;

  if (isJpeg) {
    const table = readDqt(bytes);
    const chroma = subsampling(bytes);
    if (!table) return { kind: 'jpeg', chroma, quant: 'unknown' };
    for (let q = 1; q <= 100; q++) {
      if (annexKAt(q).every((v, k) => v === table[k])) {
        return { kind: 'jpeg', chroma, quant: 'standard', quality: q };
      }
    }
    return { kind: 'jpeg', chroma, quant: 'custom' };
  }

  if (isPng) return { kind: 'png', png: pngFingerprint(bytes) };
  return { kind: 'other' };
}

/* ── 4. 하이라이트 클리핑 ────────────────────────────────
   실제 장면에는 센서가 감당하지 못하는 밝기가 있습니다. 창문, 하늘, 금속
   반사에서 화소가 255에 붙습니다. 생성물은 그럴 물리적 이유가 없어
   순백에 거의 닿지 않습니다. 다만 어두운 실내 사진도 닿지 않으므로,
   있으면 카메라 쪽 근거로 세고 없으면 아무 말도 하지 않습니다. */
function clipping(tiles) {
  let hi = 0;
  let lo = 0;
  let total = 0;
  for (const t of tiles) {
    const d = t.image.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] === 255 && d[i + 1] === 255 && d[i + 2] === 255) hi += 1;
      else if (d[i] === 0 && d[i + 1] === 0 && d[i + 2] === 0) lo += 1;
      total += 1;
    }
  }
  if (!total) return { measurable: false };
  const white = hi / total;
  return {
    measurable: true,
    white,
    black: lo / total,
    // 실측: GPT 생성물 0.0001%, 소니 원본 0.0171%. 그 사이에 선을 둡니다.
    present: white >= 0.00005,
  };
}

/**
 * @param {object} pixels loadPixels 결과
 * @param {File} file 원본 파일 (JPEG 양자화 테이블을 읽습니다)
 */
export async function analyzeSynthesis(pixels, file) {
  const cfa = cfaTrace(pixels.tiles);
  const spectrum = spectralSlope(pixels.tiles);

  const clip = clipping(pixels.tiles);

  let encoder = { kind: 'other' };
  try {
    encoder = encoderFingerprint(new Uint8Array(await file.arrayBuffer()));
  } catch {
    /* 읽지 못하면 알 수 없는 것으로 둡니다. */
  }

  return { cfa, spectrum, encoder, clip };
}
