/**
 * sound.js — 파형에서 녹음 흔적을 잽니다.
 *
 * 사진에서 화소를 재는 자리와 같습니다. 컨테이너에 적힌 것은 지울 수 있으니,
 * 지워도 남는 것을 봐야 합니다.
 *
 * 재는 것
 *   1. 대역 한계    — 어느 주파수에서 에너지가 끊기는가. 손실 압축의 흔적입니다.
 *   2. 디지털 무음  — 정확히 0인 표본. 마이크는 0을 만들지 않습니다.
 *   3. 노이즈 플로어— 가장 조용한 구간의 크기. 방과 마이크의 소리입니다.
 *   4. 스테레오     — 두 채널이 얼마나 다른가. 같으면 진짜 스테레오가 아닙니다.
 *   5. 크레스트     — 가장 큰 소리와 평균의 비. 마스터링의 압축 정도입니다.
 *   6. 클리핑       — 최대치에 붙은 표본. 과입력이나 리마스터의 흔적입니다.
 *   7. DC 오프셋    — 0 기준선이 치우쳤는가. 아날로그 단의 흔적입니다.
 *
 * 못 하는 것 — 중요합니다
 *   이 값들은 "사람이 마이크로 녹음했다"를 증명하지 않습니다. 잘 만든 생성
 *   음원은 노이즈 플로어까지 흉내 낼 수 있고, 실제 녹음도 마스터링을 거치면
 *   생성물과 구별되지 않는 값이 나옵니다. 그래서 한 값으로 판정하지 않고,
 *   서로 맞지 않는 조합을 찾습니다.
 */

const T = {
  /* 대역 한계 — 표본율의 절반(나이퀴스트)까지 에너지가 있으면 손실 압축을
     거치지 않은 것입니다. MP3 320kbps는 20kHz 안쪽에서 끊고, 128kbps는
     16kHz 안쪽에서 끊습니다. 실측으로 정한 값입니다(아래 measure 주석). */
  cutoffFloorDb: -72,          // 이 아래는 에너지가 없다고 봅니다
  fullBandRatio: 0.92,         // 나이퀴스트의 92% 이상까지 살아 있으면 무손실급

  /* 디지털 무음 — 정확히 0.0인 표본이 이만큼 이어지면 사람이 만든 무음입니다.
     마이크는 절대 0을 연속으로 내지 않습니다(전기 잡음이 있습니다). */
  silenceRun: 2048,            // 표본 수 (44.1kHz에서 약 46ms)
  silenceShare: 0.002,         // 전체의 0.2% 이상이면 표시합니다

  /* 노이즈 플로어 — 조용한 구간의 RMS를 10번째 백분위로 잡습니다.
     "가장 조용한 구간"을 쓰면 곡 앞뒤의 디지털 무음을 재게 됩니다. 실측에서
     실제 음원의 최소 구간이 -141dB, -Infinity로 나왔습니다 — 그건 방 소리가
     아니라 패딩입니다. 무음 창은 빼고 백분위로 잡습니다. */
  floorQuietDb: -75,           // 이보다 조용하면 잡음이 지워진 것
  floorRoomDb: -55,            // 이보다 크면 방 소리가 남은 것

  /* 스테레오 — 두 채널의 상관. 1.0이면 완전히 같습니다. */
  stereoSameLimit: 0.9995,     // 이 위는 사실상 모노를 두 채널에 복사한 것
  stereoWideBelow: 0.98,       // 이 아래면 채널이 서로 다릅니다

  /* 크레스트 팩터 = 피크 / RMS (dB). 잘 압축된 상업 음원은 낮습니다. */
  crestSquashedDb: 10,         // 이 아래는 심하게 압축된 마스터
  crestLiveDb: 16,             // 이 위는 손대지 않은 녹음에 가깝습니다

  clipLimit: 0.9995,           // 이 위 표본은 최대치에 붙은 것으로 봅니다
  clipShare: 0.0002,           // 전체의 0.02% 이상이면 클리핑 있음
  dcOffset: 0.002,             // 이 위면 기준선이 치우친 것
};

export const SOUND_GATE = T;

const db = (amp) => (amp > 0 ? 20 * Math.log10(amp) : -Infinity);

/* ── FFT ───────────────────────────────────────────── */

/** 제자리 기수-2 FFT. 이미지 쪽 rephoto.js와 같은 방식입니다. */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k];
        const ai = im[i + k];
        const br = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const bi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ar + br;
        im[i + k] = ai + bi;
        re[i + k + len / 2] = ar - br;
        im[i + k + len / 2] = ai - bi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

const SIZE = 8192;   // 44.1kHz에서 약 5.4Hz 해상도

/**
 * 평균 스펙트럼. 파일 전체에서 고르게 구간을 뽑아 평균합니다.
 * 한 구간만 보면 그 순간 조용한 악기 때문에 대역이 좁아 보입니다.
 */
function meanSpectrum(samples, windows = 24) {
  const mag = new Float64Array(SIZE / 2);
  const step = Math.max(SIZE, Math.floor((samples.length - SIZE) / windows));
  let used = 0;
  const win = new Float64Array(SIZE);
  for (let i = 0; i < SIZE; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (SIZE - 1));

  for (let at = 0; at + SIZE <= samples.length && used < windows; at += step) {
    const re = new Float64Array(SIZE);
    const im = new Float64Array(SIZE);
    let energy = 0;
    for (let i = 0; i < SIZE; i++) {
      const v = samples[at + i];
      energy += v * v;
      re[i] = v * win[i];
    }
    if (energy / SIZE < 1e-9) continue;          // 무음 구간은 평균에 넣지 않습니다
    fft(re, im);
    for (let k = 0; k < SIZE / 2; k++) mag[k] += Math.hypot(re[k], im[k]);
    used += 1;
  }
  if (!used) return null;
  for (let k = 0; k < mag.length; k++) mag[k] /= used;
  return mag;
}

/**
 * 대역 한계. 최대 에너지 기준으로 몇 dB 아래로 떨어진 뒤 다시 올라오지 않는
 * 지점을 찾습니다. 위에서부터 내려오며 찾아야 중간의 골짜기에 속지 않습니다.
 */
function bandLimit(mag, sampleRate) {
  let peak = 0;
  for (let k = 1; k < mag.length; k++) peak = Math.max(peak, mag[k]);
  if (peak <= 0) return null;

  const floor = peak * Math.pow(10, T.cutoffFloorDb / 20);
  let last = 0;
  for (let k = mag.length - 1; k > 1; k--) {
    if (mag[k] > floor) { last = k; break; }
  }
  const nyquist = sampleRate / 2;
  const cutoff = (last / (mag.length - 1)) * nyquist;
  return { cutoffHz: Math.round(cutoff), nyquist, ratio: cutoff / nyquist };
}

/* ── 표본 통계 ─────────────────────────────────────── */

function levels(samples) {
  let peak = 0;
  let sumSq = 0;
  let sum = 0;
  let clipped = 0;
  let zeros = 0;
  let run = 0;
  let longestRun = 0;
  let runs = 0;

  for (let i = 0; i < samples.length; i++) {
    const v = samples[i];
    const a = Math.abs(v);
    if (a > peak) peak = a;
    sumSq += v * v;
    sum += v;
    if (a >= T.clipLimit) clipped += 1;
    if (v === 0) {
      zeros += 1;
      run += 1;
      if (run === T.silenceRun) runs += 1;
      if (run > longestRun) longestRun = run;
    } else {
      run = 0;
    }
  }
  const n = samples.length || 1;
  const rms = Math.sqrt(sumSq / n);
  return {
    peak,
    peakDb: db(peak),
    rms,
    rmsDb: db(rms),
    crestDb: db(peak) - db(rms),
    clipShare: clipped / n,
    zeroShare: zeros / n,
    silenceRuns: runs,
    longestSilence: longestRun,
    dc: sum / n,
  };
}

/**
 * 조용한 구간의 RMS. 100ms 창의 값을 모아 10번째 백분위를 씁니다.
 *
 * 최솟값을 쓰면 곡 앞뒤의 디지털 무음이 잡혀 실제 음원이 -Infinity로 나옵니다
 * (실측). 무음 창을 빼고 백분위로 잡으면 방 소리와 프리앰프 잡음이 남습니다.
 */
function noiseFloor(samples, sampleRate) {
  const win = Math.max(1024, Math.floor(sampleRate * 0.1));
  const hop = Math.max(win, Math.floor(samples.length / 600));
  const values = [];
  let silentWindows = 0;

  for (let at = 0; at + win <= samples.length; at += hop) {
    let sq = 0;
    let zeros = 0;
    for (let i = at; i < at + win; i++) {
      sq += samples[i] * samples[i];
      if (samples[i] === 0) zeros += 1;
    }
    if (zeros > win / 2) { silentWindows += 1; continue; }   // 패딩은 방 소리가 아닙니다
    values.push(Math.sqrt(sq / win));
  }
  if (!values.length) return null;
  values.sort((a, b) => a - b);
  const pick = (q) => values[Math.min(values.length - 1, Math.floor(values.length * q))];
  const floor = pick(0.1);
  return {
    floor,
    floorDb: db(floor),
    quietest: db(values[0]),
    median: db(pick(0.5)),
    windows: values.length,
    silentWindows,
  };
}

/** 두 채널의 상관. 1에 가까우면 같은 소리입니다. */
function stereoMatch(left, right) {
  const n = Math.min(left.length, right.length);
  if (!n) return null;
  let sl = 0;
  let sr = 0;
  for (let i = 0; i < n; i++) { sl += left[i]; sr += right[i]; }
  const ml = sl / n;
  const mr = sr / n;
  let num = 0;
  let dl = 0;
  let dr = 0;
  let identical = 0;
  for (let i = 0; i < n; i++) {
    const a = left[i] - ml;
    const b = right[i] - mr;
    num += a * b;
    dl += a * a;
    dr += b * b;
    if (left[i] === right[i]) identical += 1;
  }
  const denom = Math.sqrt(dl * dr);
  return {
    correlation: denom > 0 ? num / denom : 1,
    identicalShare: identical / n,
  };
}

/* ── 조립 ──────────────────────────────────────────── */

const MAX_SECONDS = 300;   // 5분까지만 잽니다. 더 길어도 값은 달라지지 않습니다

/**
 * 브라우저가 디코딩한 소리를 잽니다. 디코딩만 브라우저에 맡기고 계산은
 * 여기서 합니다 — 어디로도 보내지 않습니다.
 *
 * 표본율을 반드시 넘겨 주십시오. AudioContext는 기기 출력 속도(보통 48kHz)로
 * 리샘플하므로, 44.1kHz 파일을 그냥 디코딩하면 나이퀴스트가 24kHz로 바뀌어
 * 대역 한계 비율이 무의미해집니다 — 실측에서 44.1kHz MP3가 모두 48kHz로
 * 보고됐습니다. 컨테이너가 읽어 둔 값을 씁니다.
 *
 * @param {File} file
 * @param {number|null} nativeRate 컨테이너에서 읽은 표본율
 * @returns {Promise<object>} 측정값
 */
export async function analyzeSound(file, nativeRate = null) {
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx && !Offline) throw new Error('AUDIO_UNSUPPORTED');

  const bytes = await file.arrayBuffer();
  const wanted = nativeRate >= 8000 && nativeRate <= 192000 ? nativeRate : null;

  /* 파일의 표본율로 디코딩합니다. 그 속도를 지원하지 않는 브라우저에서는
     기기 속도로 떨어지고, 그때는 대역 비율을 믿을 수 없다고 표시합니다. */
  let ctx = null;
  if (wanted && Offline) {
    try { ctx = new Offline(2, Math.ceil(wanted), wanted); } catch { ctx = null; }
  }
  if (!ctx) ctx = new (AudioCtx || Offline)();

  let buffer;
  try {
    buffer = await ctx.decodeAudioData(bytes);
  } catch {
    throw new Error('DECODE_FAILED');
  } finally {
    if (ctx.close) try { ctx.close(); } catch { /* OfflineAudioContext에는 없습니다 */ }
  }

  const sampleRate = buffer.sampleRate;
  const rateTrusted = !wanted || Math.abs(sampleRate - wanted) < 1;
  const channels = buffer.numberOfChannels;
  const limit = Math.min(buffer.length, Math.floor(sampleRate * MAX_SECONDS));

  const left = buffer.getChannelData(0).subarray(0, limit);
  const right = channels > 1 ? buffer.getChannelData(1).subarray(0, limit) : null;

  /* 모노로 합쳐 스펙트럼과 준위를 잽니다. 채널 비교는 따로 합니다. */
  let mono = left;
  if (right) {
    mono = new Float32Array(limit);
    for (let i = 0; i < limit; i++) mono[i] = (left[i] + right[i]) / 2;
  }

  const mag = meanSpectrum(mono);
  const band = mag ? bandLimit(mag, sampleRate) : null;
  const level = levels(mono);
  const floor = noiseFloor(mono, sampleRate);
  const stereo = right ? stereoMatch(left, right) : null;

  return {
    sampleRate,
    nativeRate: wanted,
    rateTrusted,
    channels,
    duration: buffer.duration,
    measured: limit / sampleRate,
    band,
    level,
    floor,
    stereo,

    /* 판정에 쓰는 요약 — grade 쪽에서 읽습니다. */
    lossless: Boolean(rateTrusted && band && band.ratio >= T.fullBandRatio),
    roomTone: Boolean(floor && floor.floorDb > T.floorRoomDb),
    deadSilence: Boolean(floor && floor.floorDb < T.floorQuietDb),
    fakeStereo: Boolean(stereo && stereo.correlation >= T.stereoSameLimit),
    wideStereo: Boolean(stereo && stereo.correlation < T.stereoWideBelow),
    squashed: level.crestDb < T.crestSquashedDb,
    natural: level.crestDb > T.crestLiveDb,
    clipping: level.clipShare >= T.clipShare,
    dcShifted: Math.abs(level.dc) > T.dcOffset,

    /* 사실로만 적는 것 — 판정에 쓰지 않습니다.
       곡 앞뒤의 디지털 무음은 실제 상업 음원에서도 나옵니다(실측: 1.3%, 2.3%).
       그래서 "사람이 만들지 않았다"는 근거가 될 수 없습니다. */
    paddingSilence: level.silenceRuns > 0 && level.zeroShare >= T.silenceShare,
  };
}
