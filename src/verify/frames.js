/**
 * frames.js — 영상에서 프레임을 떼어 사진과 같은 측정을 돌립니다.
 *
 * 컨테이너에 적힌 것은 지울 수 있습니다. 카카오톡을 거친 영상에서 기기 기록이
 * 전부 사라지는 것을 실측으로 확인했고, 화면 녹화 파일에는 처음부터 아무
 * 기록도 없었습니다. 지워도 남는 것은 화소뿐입니다.
 *
 * 측정 코드를 새로 만들지 않습니다. 사진 쪽 모듈을 그대로 씁니다 —
 * CFA 흔적, 주파수 감쇠, 광학 흔적, 화면 재촬영 신호, 압축 격자.
 * 프레임은 사진이고, 사진에 쓰던 자를 그대로 대는 것이 맞습니다.
 *
 * 프레임만 보는 이유
 *   브라우저는 영상을 디코딩해 화면에 그릴 수 있지만, 시간축 압축(움직임
 *   예측)의 내부 값은 꺼내 주지 않습니다. 그래서 프레임을 사진처럼 보고,
 *   프레임 사이의 차이는 화소로만 잽니다.
 *
 * 못 하는 것 — 중요합니다
 *   프레임 5장은 영상 전체가 아닙니다. 중간에 한 장면만 생성물을 끼워 넣은
 *   영상은 뽑은 자리에 걸리지 않으면 놓칩니다. 그래서 상세 검사가 있습니다.
 */

import { pixelsFromSource } from './pixels.js';
import { analyzeOptics } from './optics.js';
import { analyzeRephoto } from './rephoto.js';
import { analyzeCompression } from './compression.js';
import { analyzeSynthesis } from './synthesis.js';

const COUNT = 5;            // 뽑는 프레임 수
const EDGE = 0.06;          // 앞뒤 6%는 건너뜁니다 (검은 화면·페이드가 많습니다)
const SEEK_TIMEOUT = 12000;

const median = (values) => {
  const a = values.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

/** 주어진 시각으로 옮겨 그릴 준비가 될 때까지 기다립니다. */
function seek(video, time) {
  return new Promise((resolve, reject) => {
    const done = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(new Error('SEEK_FAILED')); };
    const timer = setTimeout(fail, SEEK_TIMEOUT);
    function cleanup() {
      clearTimeout(timer);
      video.removeEventListener('seeked', done);
      video.removeEventListener('error', fail);
    }
    video.addEventListener('seeked', done, { once: true });
    video.addEventListener('error', fail, { once: true });
    video.currentTime = time;
  });
}

function openVideo(url) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    // 소리를 내지 않고 화면에도 붙이지 않습니다. 재생이 아니라 측정입니다.
    const fail = () => reject(new Error('DECODE_FAILED'));
    const timer = setTimeout(fail, SEEK_TIMEOUT);
    video.addEventListener('loadedmetadata', () => {
      clearTimeout(timer);
      if (!video.videoWidth || !video.videoHeight) fail();
      else resolve(video);
    }, { once: true });
    video.addEventListener('error', () => { clearTimeout(timer); fail(); }, { once: true });
    video.src = url;
  });
}

/** 축소본 휘도를 견줘 두 프레임이 얼마나 다른지 봅니다. */
function frameDelta(a, b) {
  const la = a.medium.luma;
  const lb = b.medium.luma;
  const n = Math.min(la.length, lb.length);
  if (!n) return null;
  let sum = 0;
  let same = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.abs(la[i] - lb[i]);
    sum += d;
    if (d < 0.5) same += 1;
  }
  return { mean: sum / n, sameShare: same / n };
}

/**
 * 영상의 프레임을 떼어 사진과 같은 측정을 돌립니다.
 *
 * @param {File} file
 * @param {(index:number, label:string)=>void} [onFrame] 진행 알림
 * @returns {Promise<object>} 프레임별 측정과 요약
 */
export async function analyzeFrames(file, onFrame) {
  const url = URL.createObjectURL(file);
  let video;
  try {
    video = await openVideo(url);
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }

  const width = video.videoWidth;
  const height = video.videoHeight;
  const duration = Number.isFinite(video.duration) ? video.duration : 0;

  /* 뽑을 시각 — 앞뒤를 피해 고르게 나눕니다. */
  const times = [];
  if (duration > 0.2) {
    const from = duration * EDGE;
    const to = duration * (1 - EDGE);
    for (let i = 0; i < COUNT; i++) {
      times.push(from + ((to - from) * (i + 0.5)) / COUNT);
    }
  } else {
    times.push(0);
  }

  const frames = [];
  const pixelsList = [];
  try {
    for (let i = 0; i < times.length; i++) {
      onFrame?.(i, `프레임 ${i + 1}/${times.length}`);
      try {
        await seek(video, times[i]);
      } catch {
        continue;                        // 그 자리를 못 읽으면 건너뜁니다
      }
      let pixels;
      try {
        pixels = pixelsFromSource(video, width, height);
      } catch {
        continue;
      }
      pixelsList.push(pixels);

      const optics = analyzeOptics(pixels);
      const rephoto = analyzeRephoto(pixels, optics);
      const compression = analyzeCompression(pixels);
      // file을 넘기지 않습니다 — 영상 파일의 바이트는 JPEG 양자화 테이블이
      // 아니고, 컨테이너 쪽에서 이미 따로 읽습니다.
      const synthesis = await analyzeSynthesis(pixels, null);

      frames.push({
        at: times[i],
        optics,
        rephoto,
        compression,
        synthesis,
      });
    }
  } finally {
    video.removeAttribute('src');
    video.load?.();
    URL.revokeObjectURL(url);
  }

  if (!frames.length) throw new Error('DECODE_FAILED');

  /* 프레임 사이의 변화 — 같은 그림이 반복되면 보간이나 정지 화면입니다. */
  const deltas = [];
  for (let i = 1; i < pixelsList.length; i++) {
    const d = frameDelta(pixelsList[i - 1], pixelsList[i]);
    if (d) deltas.push(d);
  }

  const pick = (get) => median(frames.map(get));

  return {
    width,
    height,
    duration,
    frameCount: frames.length,
    frames,

    /* 요약 — 판정은 프레임별 값의 중앙값으로 합니다. 한 프레임이 어둡거나
       흔들렸다고 전체 판정이 흔들리지 않게 하려는 것입니다. */
    summary: {
      /* CFA(베이어) 흔적 — 센서를 거친 그림에만 남습니다. */
      cfaRatio: pick((f) => f.synthesis?.cfa?.ratio),
      cfaFrames: frames.filter((f) => f.synthesis?.cfa?.detected).length,

      /* 주파수 감쇠 — 자연 영상은 1/f^a 를 따릅니다. */
      alpha: pick((f) => f.synthesis?.spectrum?.alpha),
      alphaFit: pick((f) => f.synthesis?.spectrum?.fit),
      alphaNatural: frames.filter((f) => f.synthesis?.spectrum?.natural).length,

      /* 하이라이트 날림 — 실제 빛에서만 생깁니다. */
      clipWhite: pick((f) => f.synthesis?.clip?.white),
      clipFrames: frames.filter((f) => f.synthesis?.clip?.present).length,

      /* 렌즈 흔적 */
      vignetteRatio: pick((f) => f.optics?.vignetting?.ratio),
      vignetteFrames: frames.filter((f) => f.optics?.vignetting?.detected).length,
      caShiftPx: pick((f) => f.optics?.chromaticAberration?.shiftPx),
      caFrames: frames.filter((f) => f.optics?.chromaticAberration?.detected).length,
      focusUniformity: pick((f) => f.optics?.focus?.uniformity),
      noOpticalTrace: frames.filter((f) => f.optics?.flags?.noOpticalTrace).length,

      /* 압축 격자 — 두 번 인코딩되면 격자가 겹칩니다. */
      gridStrength: pick((f) => f.compression?.gridStrength),
      recompressed: frames.filter((f) => f.compression?.flags?.recompressed).length,

      /* 화면을 다시 찍은 신호 — 화면 녹화·재촬영 검출의 자리입니다. */
      moireFrames: frames.filter((f) => f.rephoto?.flags?.moire).length,
      flatFocusFrames: frames.filter((f) => f.rephoto?.flags?.flatFocus).length,
      peakRatio: pick((f) => f.rephoto?.peakRatio),

      /* 프레임 사이의 변화 */
      deltaMean: median(deltas.map((d) => d.mean)),
      staticShare: median(deltas.map((d) => d.sameShare)),
    },
  };
}
