/**
 * consistency.js — EXIF의 주장과 픽셀의 물리가 맞는지 봅니다.
 *
 * 이 서비스의 핵심입니다. EXIF는 고쳐 쓸 수 있지만,
 * "ISO 6400으로 찍었다"는 주장에 맞는 노이즈를 픽셀에 심어 넣는 일은
 * 텍스트 한 줄 고치는 것보다 훨씬 번거롭습니다.
 * 그래서 EXIF를 믿는 대신, EXIF와 픽셀이 서로를 지지하는지만 봅니다.
 *
 * 두 가지를 잽니다.
 *   1. ISO 대 실측 노이즈 — 어두운 영역의 노이즈 크기
 *   2. 노이즈-신호 관계  — 밝기에 따라 노이즈가 커지는가 (포아송)
 *
 * 노이즈 추정은 Immerkaer 방식을 씁니다. 3x3 라플라시안 마스크의 절대 응답
 * 평균으로 표준편차를 추정하는 방법이라, 단순 표준편차와 달리 피사체의
 * 질감을 노이즈로 착각하는 정도가 덜합니다. 그래도 완전히 분리되지는 않아서,
 * 구간별 대표값은 평균이 아니라 낮은 분위수를 씁니다.
 * 질감은 노이즈를 키우는 방향으로만 오염시키기 때문입니다.
 */

import { percentile, median } from './pixels.js';

const PATCH = 16;            // 패치 한 변
const DARK_LUMA = 40;        // "어두운 패치"의 기준 (명세)
const BINS = 8;              // 휘도 구간 수 (명세)
const MIN_PATCHES_PER_BIN = 12;
const MIN_DARK_PATCHES = 24;

/* 합격선 — 화면에 노출하지 않습니다. */
const T = {
  // ISO가 이 이상인데
  isoHigh: 3200,
  // 어두운 영역 노이즈가 이보다 작으면 모순으로 봅니다.
  // 8비트 JPEG에서 sigma 1.0은 사실상 "노이즈가 없다"는 뜻입니다.
  darkSigmaFloor: 1.0,
  // 밝기와 노이즈가 뒤집힌 정도 (스피어만 상관)
  invertedCorr: -0.7,
  // 구간별 노이즈가 이 정도로 균일하면 센서 출력으로 보기 어렵습니다.
  flatSpread: 0.1,
  flatSigmaCeiling: 1.6,
};

/** 패치 하나의 Immerkaer 노이즈 추정 + 평균 휘도 + 포화 비율 */
function patchStats(luma, stride, x0, y0, size) {
  let sum = 0;
  let saturated = 0;
  for (let y = 0; y < size; y++) {
    const row = (y0 + y) * stride + x0;
    for (let x = 0; x < size; x++) {
      const v = luma[row + x];
      sum += v;
      if (v >= 252 || v <= 3) saturated++;
    }
  }
  const n = size * size;
  const meanLuma = sum / n;

  // 마스크: [[1,-2,1],[-2,4,-2],[1,-2,1]]
  let absSum = 0;
  let count = 0;
  for (let y = 1; y < size - 1; y++) {
    const r0 = (y0 + y - 1) * stride + x0;
    const r1 = (y0 + y) * stride + x0;
    const r2 = (y0 + y + 1) * stride + x0;
    for (let x = 1; x < size - 1; x++) {
      const response =
        luma[r0 + x - 1] - 2 * luma[r0 + x] + luma[r0 + x + 1] +
        -2 * luma[r1 + x - 1] + 4 * luma[r1 + x] - 2 * luma[r1 + x + 1] +
        luma[r2 + x - 1] - 2 * luma[r2 + x] + luma[r2 + x + 1];
      absSum += Math.abs(response);
      count++;
    }
  }
  // sqrt(pi/2) / 6 — 마스크의 정규화 상수
  const sigma = count ? (Math.sqrt(Math.PI / 2) / 6) * (absSum / count) : NaN;

  return { meanLuma, sigma, saturation: saturated / n };
}

function spearman(xs, ys) {
  const n = xs.length;
  if (n < 3) return NaN;
  const rank = (arr) => {
    const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const r = new Array(n);
    for (let i = 0; i < n; i++) r[idx[i][1]] = i + 1;
    return r;
  };
  const rx = rank(xs);
  const ry = rank(ys);
  let d2 = 0;
  for (let i = 0; i < n; i++) d2 += (rx[i] - ry[i]) ** 2;
  return 1 - (6 * d2) / (n * (n * n - 1));
}

export function analyzeConsistency(pixels, exif) {
  const patches = [];
  for (const tile of pixels.tiles) {
    const { luma, width, height } = tile;
    for (let y = 0; y + PATCH <= height; y += PATCH) {
      for (let x = 0; x + PATCH <= width; x += PATCH) {
        const stat = patchStats(luma, width, x, y, PATCH);
        // 포화된 패치는 노이즈가 클리핑으로 깎여 있어 쓸 수 없습니다.
        if (stat.saturation > 0.05) continue;
        if (!Number.isFinite(stat.sigma)) continue;
        patches.push(stat);
      }
    }
  }

  const measured = {
    patchCount: patches.length,
    darkSigma: null,
    darkPatchCount: 0,
    binSigma: new Array(BINS).fill(null),
    binCount: new Array(BINS).fill(0),
    slopeCorrelation: null,
    relativeSpread: null,
    overallSigma: null,
  };

  const flags = {
    isoNoiseMismatch: false,
    noiseSignalInverted: false,
    noiseSignalFlat: false,
    notMeasurable: patches.length < 60,
  };

  if (flags.notMeasurable) {
    return { measured, flags, iso: exif.iso ?? null, evaluated: false };
  }

  // 1. 어두운 패치의 노이즈
  const darkSigmas = patches.filter((p) => p.meanLuma <= DARK_LUMA).map((p) => p.sigma);
  measured.darkPatchCount = darkSigmas.length;
  if (darkSigmas.length >= MIN_DARK_PATCHES) {
    measured.darkSigma = percentile(darkSigmas, 0.3);
  }
  measured.overallSigma = percentile(patches.map((p) => p.sigma), 0.3);

  // 2. 휘도 8구간별 노이즈
  const buckets = Array.from({ length: BINS }, () => []);
  for (const p of patches) {
    const bin = Math.min(BINS - 1, Math.floor((p.meanLuma / 256) * BINS));
    buckets[bin].push(p.sigma);
  }
  const xs = [];
  const ys = [];
  buckets.forEach((bucket, i) => {
    measured.binCount[i] = bucket.length;
    if (bucket.length < MIN_PATCHES_PER_BIN) return;
    const value = percentile(bucket, 0.3);
    measured.binSigma[i] = value;
    xs.push(i);
    ys.push(value);
  });

  if (xs.length >= 4) {
    measured.slopeCorrelation = spearman(xs, ys);
    const lo = Math.min(...ys);
    const hi = Math.max(...ys);
    const mid = median(ys);
    measured.relativeSpread = mid > 0 ? (hi - lo) / mid : null;
  }

  // ── 모순 판정 ─────────────────────────────────────────
  // ISO가 높다고 적혀 있는데 어두운 부분이 매끈한 경우.
  if (
    exif.iso != null &&
    exif.iso >= T.isoHigh &&
    measured.darkSigma != null &&
    measured.darkSigma < T.darkSigmaFloor
  ) {
    flags.isoNoiseMismatch = true;
  }

  // 밝을수록 노이즈가 줄어드는 경우. 실제 센서에서는 일어나지 않습니다.
  if (xs.length >= 5 && measured.slopeCorrelation != null && measured.slopeCorrelation <= T.invertedCorr) {
    flags.noiseSignalInverted = true;
  }

  // 밝기와 무관하게 노이즈가 똑같은 경우.
  // 노이즈 제거를 강하게 건 실제 사진에서도 나타나므로 단독으로는 보류 사유가 아닙니다.
  if (
    xs.length >= 6 &&
    measured.relativeSpread != null &&
    measured.relativeSpread < T.flatSpread &&
    measured.overallSigma != null &&
    measured.overallSigma < T.flatSigmaCeiling
  ) {
    flags.noiseSignalFlat = true;
  }

  return { measured, flags, iso: exif.iso ?? null, evaluated: true };
}
