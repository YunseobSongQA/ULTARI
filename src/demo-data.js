/**
 * demo-data.js — 심사·시연용 견본 측정값.
 *
 * 여기 있는 숫자는 파일을 재서 나온 값이 아닙니다. 실제 측정에서 나오는
 * 범위에 맞춰 손으로 적어 둔 견본입니다. 이 사실은 /demo 화면에도 그대로
 * 적혀 있습니다 — 진위를 파는 서비스가 견본을 실측인 척 보여 주면
 * 그 순간 파는 물건이 없어집니다.
 *
 * 판정만은 지어내지 않습니다. 아래 측정값을 실제 판정 함수(gradeResult,
 * gradeMedia)에 그대로 넣어 등급을 받습니다. 그래서 화면에 나오는 등급과
 * 근거는 이 측정값에서 실제로 나오는 결과입니다.
 *
 * 대기 건수와 보관 건수는 견본에도 넣지 않습니다. 그 숫자는 queue.js와
 * /api/admin에서만 옵니다.
 */

const hash = (seed) => seed.repeat(64 / seed.length).slice(0, 64);

/** 촬영 흔적이 없는 파일에도 지문은 계산됩니다. 같은 모양으로 만듭니다. */
const print = (name, bytes, mimeType, seed) => ({
  name,
  bytes,
  mimeType,
  recordedAt: new Date('2026-09-16T11:04:00+09:00'),
  timeIsTrusted: false,
  sha256: hash(seed),
  short: hash(seed).slice(0, 8),
  unavailableReason: null,
});

/** 출처 표식이 없는 파일. 사진 견본 대부분이 여기 해당합니다. */
const noProvenance = {
  present: false,
  declaresAi: false,
  sourceType: null,
  sourceLabel: null,
  sourceDetail: null,
  generator: null,
  signer: null,
  watermarked: false,
  createdAt: null,
  via: 'metadata',
  markers: [],
};

const noExif = {
  present: false,
  tagCount: 0,
  make: null,
  model: null,
  lensModel: null,
  software: null,
  editorNamed: false,
  fNumber: null,
  exposureTime: null,
  iso: null,
  focalLength: null,
  dateTimeOriginal: null,
  dateTimeOriginalRaw: null,
  hasGps: false,
  hasCameraId: false,
  hasCaptureTime: false,
  flags: { noCameraId: true, noCaptureTime: true, stripped: true },
};

/* ── 1. 사진 · 카메라 원본 (3등급이 나오는 값) ─────────── */

const photoPass = {
  kind: 'image',
  print: print('DEMO-01-camera-original.jpg', 8214536, 'image/jpeg', 'a3f9c1d2'),
  exif: {
    present: true,
    tagCount: 47,
    make: 'Canon',
    model: 'Canon EOS R6',
    lensModel: 'RF35mm F1.8 MACRO IS STM',
    software: null,
    editorNamed: false,
    fNumber: 1.8,
    exposureTime: 1 / 125,
    iso: 1600,
    focalLength: 35,
    dateTimeOriginal: new Date('2026-04-12T18:24:31'),
    dateTimeOriginalRaw: null,
    hasGps: true,
    hasCameraId: true,
    hasCaptureTime: true,
    flags: { noCameraId: false, noCaptureTime: false, stripped: false },
  },
  consistency: {
    iso: 1600,
    evaluated: true,
    measured: {
      patchCount: 1482,
      darkSigma: 4.21,
      darkPatchCount: 214,
      binSigma: [3.91, 4.24, 4.77, 5.28, 5.86, 6.41, 6.92, 7.34],
      binCount: [118, 176, 231, 258, 244, 197, 152, 106],
      slopeCorrelation: 0.93,
      relativeSpread: 0.61,
      overallSigma: 5.42,
    },
    flags: {
      isoNoiseMismatch: false,
      noiseSignalInverted: false,
      noiseSignalFlat: false,
      notMeasurable: false,
    },
  },
  optics: {
    vignetting: { ratio: 0.82, cornerAgreement: 0.06, detected: true },
    chromaticAberration: { shiftPx: 0.61, edgeCount: 186, measurable: true, detected: true },
    focus: {
      map: [], logRange: 1.42, neighborDelta: 0.18,
      abruptness: 0.21, uniformity: 0.58, discontinuous: false,
    },
    flags: { noOpticalTrace: false, focusDiscontinuity: false },
  },
  compression: {
    measurable: true,
    gridStrength: 0.34,
    secondaryStrength: 0.06,
    tileCount: 9,
    tileSpread: 0.05,
    weakTiles: 0,
    estimatedPasses: 1,
    flags: { recompressed: false, regionalBlockDeviation: false },
  },
  rephoto: {
    measurable: true,
    peakRatio: 2.1,
    peakCount: 0,
    windowSize: 256,
    focusUniformity: 0.58,
    flags: { moire: false, flatFocus: false },
    level: 'none',
  },
  pixels: { width: 6000, height: 4000, megapixels: 24 },
  provenance: noProvenance,
  synthesis: {
    cfa: { ratio: 1.18, measurable: true, detected: true, absent: false, tileCount: 9 },
    spectrum: { alpha: 2.14, fit: 0.96, measurable: true, natural: true, tooSteep: false, tooFlat: false },
    encoder: { kind: 'jpeg', chroma: '4:2:2', quant: 'custom' },
    clip: { measurable: true, white: 0.000171, black: 0.000204, present: true },
  },
};

/* ── 2. 사진 · 메신저를 거친 파일 (판정 불가가 나오는 값) ── */

const photoInsufficient = {
  kind: 'image',
  print: print('DEMO-02-messenger.jpg', 214883, 'image/jpeg', 'b71e4408'),
  exif: noExif,
  consistency: {
    iso: null,
    evaluated: true,
    measured: {
      patchCount: 312,
      darkSigma: 2.04,
      darkPatchCount: 41,
      binSigma: [1.92, 2.11, 2.38, 2.61, 2.74, 2.88, 3.02, null],
      binCount: [28, 44, 61, 58, 49, 38, 26, 8],
      slopeCorrelation: 0.79,
      relativeSpread: 0.42,
      overallSigma: 2.55,
    },
    flags: {
      isoNoiseMismatch: false,
      noiseSignalInverted: false,
      noiseSignalFlat: false,
      notMeasurable: false,
    },
  },
  optics: {
    vignetting: { ratio: 0.97, cornerAgreement: 0.03, detected: false },
    chromaticAberration: { shiftPx: 0.04, edgeCount: 88, measurable: true, detected: false },
    focus: {
      map: [], logRange: 1.08, neighborDelta: 0.22,
      abruptness: 0.24, uniformity: 0.62, discontinuous: false,
    },
    flags: { noOpticalTrace: true, focusDiscontinuity: false },
  },
  compression: {
    measurable: true,
    gridStrength: 0.41,
    secondaryStrength: 0.19,
    tileCount: 9,
    tileSpread: 0.07,
    weakTiles: 1,
    estimatedPasses: 2,
    flags: { recompressed: true, regionalBlockDeviation: false },
  },
  rephoto: {
    measurable: true,
    peakRatio: 1.8,
    peakCount: 0,
    windowSize: 256,
    focusUniformity: 0.62,
    flags: { moire: false, flatFocus: false },
    level: 'none',
  },
  pixels: { width: 1280, height: 960, megapixels: 1.2288 },
  provenance: noProvenance,
  synthesis: {
    cfa: { ratio: 1.01, measurable: true, detected: false, absent: true, tileCount: 9 },
    spectrum: { alpha: 2.42, fit: 0.94, measurable: true, natural: true, tooSteep: false, tooFlat: false },
    encoder: { kind: 'jpeg', chroma: '4:2:0', quant: 'standard', quality: 80 },
    clip: { measurable: true, white: 0.000021, black: 0.000102, present: false },
  },
};

/* ── 3. 사진 · 강한 보정을 거친 휴대폰 원본 (보류가 나오는 값) ── */

const photoHold = {
  kind: 'image',
  print: print('DEMO-03-phone-processed.jpg', 3944012, 'image/jpeg', 'c2d80f5a'),
  exif: {
    present: true,
    tagCount: 39,
    make: 'Apple',
    model: 'iPhone 15 Pro',
    lensModel: 'iPhone 15 Pro back triple camera 6.765mm f/1.78',
    software: '17.4.1',
    editorNamed: false,
    fNumber: 1.78,
    exposureTime: 1 / 30,
    iso: 3200,
    focalLength: 6.765,
    dateTimeOriginal: new Date('2026-02-08T21:47:02'),
    dateTimeOriginalRaw: null,
    hasGps: false,
    hasCameraId: true,
    hasCaptureTime: true,
    flags: { noCameraId: false, noCaptureTime: false, stripped: false },
  },
  consistency: {
    iso: 3200,
    evaluated: true,
    measured: {
      patchCount: 1104,
      darkSigma: 0.86,
      darkPatchCount: 168,
      binSigma: [0.84, 0.88, 0.91, 0.87, 0.9, 0.89, 0.92, 0.88],
      binCount: [96, 142, 188, 201, 176, 138, 98, 65],
      slopeCorrelation: 0.11,
      relativeSpread: 0.08,
      overallSigma: 0.89,
    },
    flags: {
      isoNoiseMismatch: true,
      noiseSignalInverted: false,
      noiseSignalFlat: true,
      notMeasurable: false,
    },
  },
  optics: {
    vignetting: { ratio: 0.91, cornerAgreement: 0.04, detected: true },
    chromaticAberration: { shiftPx: 0.07, edgeCount: 141, measurable: true, detected: false },
    focus: {
      map: [], logRange: 1.21, neighborDelta: 0.2,
      abruptness: 0.27, uniformity: 0.6, discontinuous: false,
    },
    flags: { noOpticalTrace: false, focusDiscontinuity: false },
  },
  compression: {
    measurable: true,
    gridStrength: 0.31,
    secondaryStrength: 0.05,
    tileCount: 9,
    tileSpread: 0.04,
    weakTiles: 0,
    estimatedPasses: 1,
    flags: { recompressed: false, regionalBlockDeviation: false },
  },
  rephoto: {
    measurable: true,
    peakRatio: 2.4,
    peakCount: 0,
    windowSize: 256,
    focusUniformity: 0.6,
    flags: { moire: false, flatFocus: false },
    level: 'none',
  },
  pixels: { width: 4032, height: 3024, megapixels: 12.19 },
  provenance: noProvenance,
  synthesis: {
    cfa: { ratio: 1.02, measurable: true, detected: false, absent: true, tileCount: 9 },
    spectrum: { alpha: 2.66, fit: 0.95, measurable: true, natural: true, tooSteep: false, tooFlat: false },
    encoder: { kind: 'jpeg', chroma: '4:2:0', quant: 'custom' },
    clip: { measurable: true, white: 0.000094, black: 0.000038, present: true },
  },
};

/* ── 4. 사진 · 파일이 스스로 AI라고 적어 둔 경우 ────────── */

const photoDeclared = {
  kind: 'image',
  print: print('DEMO-04-declared-ai.png', 1704388, 'image/png', 'd4a1b90e'),
  exif: noExif,
  consistency: {
    iso: null,
    evaluated: true,
    measured: {
      patchCount: 964,
      darkSigma: 0.42,
      darkPatchCount: 122,
      binSigma: [0.41, 0.44, 0.43, 0.46, 0.44, 0.45, 0.43, 0.42],
      binCount: [88, 124, 152, 168, 142, 118, 92, 80],
      slopeCorrelation: 0.05,
      relativeSpread: 0.06,
      overallSigma: 0.44,
    },
    flags: {
      isoNoiseMismatch: false,
      noiseSignalInverted: false,
      noiseSignalFlat: true,
      notMeasurable: false,
    },
  },
  optics: {
    vignetting: { ratio: 0.99, cornerAgreement: 0.02, detected: false },
    chromaticAberration: { shiftPx: 0.01, edgeCount: 203, measurable: true, detected: false },
    focus: {
      map: [], logRange: 0.38, neighborDelta: 0.09,
      abruptness: 0.14, uniformity: 0.91, discontinuous: false,
    },
    flags: { noOpticalTrace: true, focusDiscontinuity: false },
  },
  compression: {
    measurable: true,
    gridStrength: 0.02,
    secondaryStrength: 0.01,
    tileCount: 9,
    tileSpread: 0.01,
    weakTiles: 9,
    estimatedPasses: null,
    flags: { recompressed: false, regionalBlockDeviation: false },
  },
  rephoto: {
    measurable: true,
    peakRatio: 1.4,
    peakCount: 0,
    windowSize: 256,
    focusUniformity: 0.91,
    flags: { moire: false, flatFocus: true },
    level: 'weak',
  },
  pixels: { width: 1024, height: 1024, megapixels: 1.048576 },
  provenance: {
    present: true,
    declaresAi: true,
    sourceType: 'trainedAlgorithmicMedia',
    sourceLabel: 'AI 생성물',
    sourceDetail: '생성 모델이 만든 것으로 선언돼 있습니다',
    generator: 'Demo Diffusion 3',
    signer: 'Demo Labs (견본)',
    watermarked: true,
    createdAt: '2026-03-02T09:15:00Z',
    via: 'C2PA',
    markers: ['c2pa'],
  },
  synthesis: {
    cfa: { ratio: 1.0, measurable: true, detected: false, absent: true, tileCount: 9 },
    spectrum: { alpha: 3.41, fit: 0.97, measurable: true, natural: false, tooSteep: true, tooFlat: false },
    encoder: { kind: 'png', png: { blocky: true, decorated: false, zlibHead: '78 9c', ancillary: [], tool: 'library' } },
    clip: { measurable: true, white: 0.0000004, black: 0, present: false },
  },
};

/* ── 5. 영상 · 촬영 원본 (3등급이 나오는 값) ───────────── */

const videoPass = {
  kind: 'video',
  print: print('DEMO-05-camera-original.mov', 18874368, 'video/quicktime', 'e58c3271'),
  container: {
    format: 'mov',
    kind: 'video',
    facts: {
      bytes: 18874368,
      brand: 'qt  ',
      make: 'Apple',
      model: 'iPhone 15 Pro',
      software: '17.4.1',
      width: 3840,
      height: 2160,
      duration: 4.2,
      codec: 'hvc1 (HEVC)',
      audioCodec: 'mp4a (AAC)',
      tracks: ['video', 'audio', 'meta'],
      gpsPresent: true,
    },
    cameraSigns: ['촬영 기기 · Apple iPhone 15 Pro', '촬영 메타 트랙 · mebx'],
    toolSigns: [],
    releaseSigns: [],
    editSigns: [],
    distributor: null,
    editor: null,
    muxer: null,
    declaresAi: false,
    generator: null,
    c2pa: false,
    markers: [],
    gpsPresent: true,
  },
  frames: {
    width: 3840,
    height: 2160,
    duration: 4.2,
    frameCount: 5,
    frames: [],
    summary: {
      cfaRatio: 1.04, cfaFrames: 0,
      alpha: 2.31, alphaFit: 0.95, alphaNatural: 5,
      clipWhite: 0.00042, clipFrames: 5,
      vignetteRatio: 0.86, vignetteFrames: 4,
      caShiftPx: 0.44, caFrames: 3,
      focusUniformity: 0.52, noOpticalTrace: 0,
      gridStrength: 0.29, recompressed: 0,
      moireFrames: 0, flatFocusFrames: 0, peakRatio: 2.4,
      noiseFrames: 5, noiseRising: 4, noiseInverted: 0,
      noiseCorr: 0.88, noiseSpread: 0.55, noiseSigma: 3.1,
      deltaMean: 6.2, staticShare: 0.18,
    },
  },
  sound: null,
};

/* ── 6. 소리 · 녹음 원본 (3등급이 나오는 값) ───────────── */

const audioPass = {
  kind: 'audio',
  print: print('DEMO-06-field-recording.wav', 15925248, 'audio/wav', 'f0937ac6'),
  container: {
    format: 'wav',
    kind: 'audio',
    facts: {
      bytes: 15925248,
      sampleRate: 48000,
      bitDepth: 24,
      channels: 2,
      originator: 'Zoom F6',
      duration: 55.2,
    },
    cameraSigns: ['녹음기 · Zoom F6', 'bext 기록 · 2026-05-03 14:22'],
    toolSigns: [],
    releaseSigns: [],
    editSigns: [],
    distributor: null,
    editor: null,
    muxer: null,
    declaresAi: false,
    generator: null,
    c2pa: false,
    markers: [],
    gpsPresent: false,
  },
  frames: null,
  sound: {
    sampleRate: 48000,
    nativeRate: 48000,
    rateTrusted: true,
    channels: 2,
    duration: 55.2,
    measured: 55.2,
    band: { cutoffHz: 23400, nyquist: 24000, ratio: 0.975 },
    level: {
      peak: 0.89, peakDb: -1.01, rms: 0.089, rmsDb: -21.01, crestDb: 20.0,
      clipShare: 0, zeroShare: 0.0004, silenceRuns: 0, longestSilence: 0, dc: 0.00002,
    },
    floor: { floor: 0.0021, floorDb: -53.6, quietest: -58.2, median: -24.1, windows: 418, silentWindows: 0 },
    stereo: { correlation: 0.62, identicalShare: 0.0004 },
    lossless: true,
    roomTone: true,
    deadSilence: false,
    noQuietPart: false,
    fakeStereo: false,
    wideStereo: false,
    squashed: false,
    natural: true,
    clipping: false,
    dcShifted: false,
    paddingSilence: false,
  },
};

/**
 * 화면에 내놓는 차례. 통과 → 판정 불가 → AI 기록 순서입니다.
 * 통과부터 보여 주는 것은 무엇을 파는지가 먼저 보여야 하기 때문이고,
 * 나머지 셋을 뒤에 두는 것은 못 하는 것도 같은 화면에서 보이게 하려는 것입니다.
 */
export const DEMO_CASES = [
  {
    id: 'photo-pass',
    label: '사진 · 3등급',
    note: '카메라에서 바로 꺼낸 원본에서 나오는 값',
    bundle: photoPass,
  },
  {
    id: 'photo-insufficient',
    label: '사진 · 판정 불가',
    note: '메신저를 거쳐 촬영 정보가 지워진 파일',
    bundle: photoInsufficient,
  },
  {
    id: 'photo-hold',
    label: '사진 · 3등급',
    note: '휴대폰이 촬영 순간 노이즈를 지운 실제 사진도 통과합니다',
    bundle: photoHold,
  },
  {
    id: 'photo-declared',
    label: '사진 · AI 생성 기록',
    note: '파일이 C2PA로 스스로 생성물이라고 적어 둔 경우',
    bundle: photoDeclared,
  },
  {
    id: 'video-pass',
    label: '영상 · 3등급',
    note: '촬영 기기 기록이 살아 있는 MOV 원본',
    bundle: videoPass,
  },
  {
    id: 'audio-pass',
    label: '소리 · 3등급',
    note: '녹음기 기록과 방 소리가 남아 있는 WAV',
    bundle: audioPass,
  },
];

/**
 * 상세 검사 접수 뒤의 현황 조회 화면 견본.
 *
 * 실제 화면은 /api/status가 돌려주는 값으로 그립니다. 여기 있는 것은
 * 그 응답과 같은 모양으로 적어 둔 견본이고, 접수번호도 견본입니다.
 */
export const DEMO_STATUS = {
  id: 'DEMO-2026-0042',
  grade: 2,
  status: 'reviewing',
  statusLabel: '심사 중',
  finished: false,
  createdAt: '2026-09-09T02:11:00Z',
  updatedAt: '2026-09-14T06:40:00Z',
  etaDate: '2026-09-23T00:00:00Z',
  fingerprint: 'a3f9c1d2',
  checks: {},
  history: [
    { at: '2026-09-09T02:11:00Z', label: '접수됨' },
    { at: '2026-09-11T08:02:00Z', label: '심사 시작', note: '촬영 경위 확인 중' },
    { at: '2026-09-14T06:40:00Z', label: '자료 확인', note: '같은 촬영의 다른 컷 확인' },
  ],
};
