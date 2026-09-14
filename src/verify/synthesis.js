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
  // 자연 영상의 스펙트럼 기울기. 피사체에 따라 크게 움직여 넓게 잡습니다.
  // 이 범위를 벗어날 때만 이상으로 봅니다. 안에 들면 아무 말도 하지 않습니다.
  slopeNaturalLow: 1.4,
  slopeNaturalHigh: 3.2,
  // 기울기를 믿을 수 있는 최소 적합도.
  slopeMinFit: 0.80,
};

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

function quantSource(bytes) {
  const table = readDqt(bytes);
  if (!table) return { present: false };

  for (let q = 1; q <= 100; q++) {
    const ref = annexKAt(q);
    if (ref.every((v, k) => v === table[k])) {
      return { present: true, standard: true, quality: q };
    }
  }
  return { present: true, standard: false };
}

/**
 * @param {object} pixels loadPixels 결과
 * @param {File} file 원본 파일 (JPEG 양자화 테이블을 읽습니다)
 */
export async function analyzeSynthesis(pixels, file) {
  const cfa = cfaTrace(pixels.tiles);
  const spectrum = spectralSlope(pixels.tiles);

  let quant = { present: false };
  try {
    quant = quantSource(new Uint8Array(await file.arrayBuffer()));
  } catch {
    /* 읽지 못하면 없는 것으로 둡니다. */
  }

  return { cfa, spectrum, quant };
}
