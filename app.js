// Matter.js モジュールのショートカット
// （CDN の読み込みに失敗しても、ここで止まらずにスタート画面で案内を出せるようにする）
const { Engine, Render, Bodies, Composite, Body, Events, Vector, Constraint, Sleeping } = window.Matter || {};

// グローバル変数
let engine;
let render;
let audioCtx = null;
let masterBus = null;         // すべての音が通るマスター（音量の上限をかける）
let currentMode = '3-5';      // '3-5', '6-8', '9-10'
let currentStage = 1;         // 6-8歳パズルモード用
let currentShape = 'circle';   // 選択中の配置オブジェクト
let currentSubCategory = 'shape'; // 9-10歳のサブカテゴリ ('shape', 'gimmick', 'music')
let isGameActive = false;
let isGuideOn = true;         // 9-10歳ガイド表示
let ballTimer = null;         // ボール自動落下タイマー
let selectedNoteBlock = null; // ピアノ鍵盤で編集中の音符ブロック
let activeBalls = [];         // 画面内に蓄積されているボールの追跡配列

// 色パレット
const COLORS = {
  bg: '#f7f3e9',
  circle: '#ff6f61',
  triangle: '#4ea8de',
  square: '#ffd166',
  slope: '#a0c4ff',
  bouncer: '#ffadad',
  conveyor: '#caffbf',
  note: '#b39ddb',
  gear: '#a8dadc',
  motorGear: '#ffa6c9',   // モーターギア：ピンクがかったシアン
  drum: '#ffc6ff',        // ドラムブロック
  walls: '#e2dcd0',
  balls: ['#ffadad', '#ffd6a5', '#fdffb6', '#caffbf', '#9bf6ff', '#a0c4ff', '#bdb2ff', '#ffc6ff']
};

// 3-5歳モード等の衝突音高（C3〜A5ペンタトニックスケール）
const TONES = [
  130.81, 146.83, 164.81, 196.00, 220.00,
  261.63, 293.66, 329.63, 392.00, 440.00,
  523.25, 587.33, 659.25, 783.99, 880.00
];

// 9-10歳おんぷブロック用（C4〜C5 1オクターブ全半音階）
const NOTE_TONES = [
  { name: 'ド', freq: 261.63, color: '#ff6f61' },   // 0: C4
  { name: 'ド#', freq: 277.18, color: '#e63946' },  // 1: C#4 (黒鍵)
  { name: 'レ', freq: 293.66, color: '#f77f00' },   // 2: D4
  { name: 'レ#', freq: 311.13, color: '#fcbf49' },  // 3: D#4 (黒鍵)
  { name: 'ミ', freq: 329.63, color: '#ffd166' },   // 4: E4
  { name: 'ファ', freq: 349.23, color: '#eae2b7' },  // 5: F4
  { name: 'ファ#', freq: 369.99, color: '#8ac926' }, // 6: F#4 (黒鍵)
  { name: 'ソ', freq: 392.00, color: '#06d6a0' },   // 7: G4
  { name: 'ソ#', freq: 415.30, color: '#118ab2' },  // 8: G#4 (黒鍵)
  { name: 'ラ', freq: 440.00, color: '#0077b6' },   // 9: A4
  { name: 'ラ#', freq: 466.16, color: '#0096c7' },  // 10: A#4 (黒鍵)
  { name: 'シ', freq: 493.88, color: '#8338ec' },   // 11: B4
  { name: 'ど', freq: 523.25, color: '#b5179e' }    // 12: C5 (オクターブ上のド)
];

// 6-8歳パズルモード用ステージデータ
let STAGE_DATA = [
  {
    start: { x: 0.2, y: 0.25 },
    goal: { x: 0.8, y: 0.65 },
    obstacles: [
      { x: 0.5, y: 0.45, w: 180, h: 25, type: 'obstacle' }
    ]
  },
  {
    start: { x: 0.5, y: 0.2 },
    goal: { x: 0.5, y: 0.85 },
    obstacles: [
      { x: 0.5, y: 0.45, w: 100, h: 100, type: 'triangle_obstacle' }
    ]
  },
  {
    // かべごえ：ジャンプ台で かべを飛びこえる
    start: { x: 0.15, y: 0.25 },
    goal: { x: 0.85, y: 0.25 },
    obstacles: [
      { x: 0.5, y: 0.6, w: 30, h: 420, type: 'obstacle' }
    ]
  },
  {
    // かいだん：右上から左下へ。そのまま落とすと棚に乗って止まるので、さかみちを階段のように並べて運ぶ
    start: { x: 0.85, y: 0.22 },
    goal: { x: 0.15, y: 0.8 },
    obstacles: [
      { x: 0.85, y: 0.55, w: 220, h: 22, type: 'obstacle' },
      { x: 0.45, y: 0.78, w: 260, h: 22, type: 'obstacle' }
    ]
  },
  {
    // ベルトとジャンプ台：かべの向こうの、少し低いゴールへ運ぶ
    start: { x: 0.15, y: 0.22 },
    goal: { x: 0.85, y: 0.5 },
    obstacles: [
      { x: 0.6, y: 0.85, w: 30, h: 300, type: 'obstacle' }
    ]
  }
];

// 6-8歳：クリアしたステージの記録（端末のブラウザにだけ保存する。使えない環境でも遊べるようにする）
const PUZZLE_BALL_RADIUS = 14;
const GOAL_RADIUS = 32;
const CLEARED_STORAGE_KEY = 'sound-toybox:cleared-stages';

let clearedStagesThisSession = []; // 保存できない環境（プライベートブラウズ等）でも、開いている間は覚えておく

function loadClearedStages() {
  let saved = [];
  try {
    const parsed = JSON.parse(localStorage.getItem(CLEARED_STORAGE_KEY) || '[]');
    if (Array.isArray(parsed)) saved = parsed.filter(n => Number.isInteger(n));
  } catch (e) {
    // 読めないときは、この回の記録だけを使う
  }
  return [...new Set([...saved, ...clearedStagesThisSession])];
}

function saveClearedStage(stageNum) {
  if (!clearedStagesThisSession.includes(stageNum)) clearedStagesThisSession.push(stageNum);
  const cleared = loadClearedStages();
  try {
    localStorage.setItem(CLEARED_STORAGE_KEY, JSON.stringify(cleared));
  } catch (e) {
    // 保存できなくても、この回の表示には反映する
  }
  updateClearedMarks(cleared);
  return cleared;
}

function updateClearedMarks(cleared = loadClearedStages()) {
  document.querySelectorAll('.stage-btn').forEach(btn => {
    btn.classList.toggle('cleared', cleared.includes(parseInt(btn.dataset.stage)));
  });
}

// 操作用変数
let draggedBody = null;
let dragOffset = { x: 0, y: 0 };
let lastTapTime = 0;
let lastTappedBody = null;
let pressTimer = null;
let pressStartCoords = null;    // 押し始めた位置（押していない間は null）
let hasMovedSincePress = false; // 押してから DRAG_THRESHOLD_PX 以上動いたか
let tappedNoteBody = null;      // 動かさずに離したらピアノを開くおんぷブロック
const DRAG_THRESHOLD_PX = 8;
let blockRadius = 35;
let goalSensor = null;
let startSpawner = null;

// 衝突フィルタカテゴリ
const defaultCategory = 0x0001;
const particleCategory = 0x0002;
const gearCategory = 0x0004; // 歯車同士の物理衝突をオフにするためのカテゴリ

// -------------------------------------------------------------
// 1. サウンドシステム（Web Audio API & ドラムシンセサイザー）
// -------------------------------------------------------------
function initAudio() {
  if (!audioCtx) {
    // iOS 17 以降: 消音スイッチが入っていても、このアプリの音は鳴らす（音を出して遊ぶおもちゃのため）
    if (navigator.audioSession) {
      try { navigator.audioSession.type = 'playback'; } catch (e) { /* 未対応の端末では何もしない */ }
    }
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    // ボールが一斉に当たって音が重なっても耳に痛い音量にならないよう、コンプレッサーで頭を抑える
    const compressor = audioCtx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 12;
    compressor.ratio.value = 8;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.25;
    compressor.connect(audioCtx.destination);

    masterBus = audioCtx.createGain();
    masterBus.gain.value = 0.8;
    masterBus.connect(compressor);
  }
  // iOS Safari は着信や画面ロックの後に 'interrupted' になることがあるため、'running' 以外はすべて再開を試みる
  if (audioCtx.state !== 'running' && audioCtx.state !== 'closed') {
    const resumed = audioCtx.resume();
    if (resumed && resumed.catch) resumed.catch(() => {}); // 古い Safari の resume は Promise を返さない
  }
}

// ボールの衝突音を間引く（同じブロックへの連続ヒットと、短時間に鳴る数の上限）
const HIT_COOLDOWN_MS = 60;
const MAX_HITS_PER_WINDOW = 8;
const HIT_WINDOW_MS = 100;
let hitWindowStart = 0;
let hitsInWindow = 0;

function allowHitSound(target) {
  const now = performance.now();
  if (target.lastHitSoundTime !== undefined && now - target.lastHitSoundTime < HIT_COOLDOWN_MS) return false;
  if (now - hitWindowStart > HIT_WINDOW_MS) {
    hitWindowStart = now;
    hitsInWindow = 0;
  }
  if (hitsInWindow >= MAX_HITS_PER_WINDOW) return false;
  hitsInWindow++;
  target.lastHitSoundTime = now;
  return true;
}

// 鉄琴音再生
function playTone(freq, velocity = 0.5) {
  if (!audioCtx) return;

  const now = audioCtx.currentTime;
  const osc1 = audioCtx.createOscillator();
  const gain1 = audioCtx.createGain();
  osc1.type = 'triangle';
  osc1.frequency.value = freq;
  
  const osc2 = audioCtx.createOscillator();
  const gain2 = audioCtx.createGain();
  osc2.type = 'sine';
  osc2.frequency.value = freq * 2.76;

  const volume = Math.min(Math.max(velocity, 0.1), 1.0) * 0.35;
  
  gain1.gain.setValueAtTime(0, now);
  gain1.gain.linearRampToValueAtTime(volume, now + 0.005);
  gain1.gain.exponentialRampToValueAtTime(0.0001, now + 0.7);

  gain2.gain.setValueAtTime(0, now);
  gain2.gain.linearRampToValueAtTime(volume * 0.5, now + 0.002);
  gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);

  osc1.connect(gain1);
  gain1.connect(masterBus);
  
  osc2.connect(gain2);
  gain2.connect(masterBus);

  osc1.start(now);
  osc1.stop(now + 0.8);
  
  osc2.start(now);
  osc2.stop(now + 0.1);
}

// 打楽器（ドラム）音再生
function playDrum(type, velocity = 0.5) {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;

  if (type === 'bass') {
    // 和太鼓風の「ドン」：サイン波の急激なピッチ低下
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    
    osc.frequency.setValueAtTime(150, now);
    osc.frequency.exponentialRampToValueAtTime(0.01, now + 0.12);
    
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(velocity * 0.7, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
    
    osc.connect(gain);
    gain.connect(masterBus);
    
    osc.start(now);
    osc.stop(now + 0.22);
  } 
  else if (type === 'snare') {
    // シンバルの「シャン」：ホワイトノイズ＋ハイパスフィルタ
    const bufferSize = audioCtx.sampleRate * 0.15;
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    
    const noise = audioCtx.createBufferSource();
    noise.buffer = buffer;
    
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 7500; // 7.5kHz以上の金属音を抽出
    
    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(velocity * 0.35, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);
    
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(masterBus);
    
    noise.start(now);
    noise.stop(now + 0.18);
  }
}

// -------------------------------------------------------------
// 2. 物理エンジン初期化
// -------------------------------------------------------------
function initPhysics() {
  const container = document.getElementById('game-container');
  const width = container.clientWidth;
  const height = container.clientHeight;

  engine = Engine.create({
    gravity: { y: 0.6 },
    enableSleeping: true // スリープ機能有効化（溜まったボールの自重によるすり抜けを防止）
  });

  // 計算精度を最大設定（スリープにより負荷が下がったため、めり込みを完全に防ぐ）
  engine.positionIterations = 16;
  engine.velocityIterations = 16;

  render = Render.create({
    element: container,
    engine: engine,
    options: {
      width: width,
      height: height,
      wireframes: false,
      background: 'transparent',
      pixelRatio: window.devicePixelRatio || 1,
      showSleeping: false // スリープしたボールの色が薄くなるのを防ぐ
    }
  });

  Render.run(render);

  // タイムステップは 1/60 秒で固定（すり抜けワープ防止）。
  // Matter.js 0.19 の Runner は isFixed だと 1 フレーム 1 ステップ進めるため、120Hz の画面では 2 倍速になる。
  // 経過時間ぶんだけステップを進める自前のループで、画面のリフレッシュレートに関係なく同じ速さにする
  requestAnimationFrame(physicsLoop);

  createWalls();

  window.addEventListener('resize', handleResize);
  setupCollisionHandler();
  setupCustomRenderer(); // Canvasカスタムテキスト描画

  Events.on(engine, 'beforeUpdate', updateLoop);
  Events.on(engine, 'collisionActive', handleActivePhysics);
  Events.on(engine, 'afterUpdate', applyPendingLaunches);
}

const WALL_LENGTH = 6000;
const PHYSICS_STEP_MS = 1000 / 60;
const MAX_STEPS_PER_FRAME = 4; // 処理落ちしたときに追いつこうとして余計に重くならないよう上限を設ける
let physicsAccumulator = 0;
let lastPhysicsTime = null;

function physicsLoop(time) {
  requestAnimationFrame(physicsLoop);
  if (lastPhysicsTime === null) lastPhysicsTime = time;
  // タブを裏に回して戻った直後などの長い空白は、まとめて進めずに捨てる
  physicsAccumulator += Math.min(time - lastPhysicsTime, 100);
  lastPhysicsTime = time;

  let steps = 0;
  while (physicsAccumulator >= PHYSICS_STEP_MS && steps < MAX_STEPS_PER_FRAME) {
    Engine.update(engine, PHYSICS_STEP_MS);
    physicsAccumulator -= PHYSICS_STEP_MS;
    steps++;
  }
  if (steps === MAX_STEPS_PER_FRAME) physicsAccumulator = 0;
}

function createWalls() {
  const container = document.getElementById('game-container');
  const width = container.clientWidth;
  const height = container.clientHeight;
  const wallThickness = 60;
  // 端末を回転して画面が縦に伸びても壁が足りなくならないよう、十分に長くしておく
  const wallLength = WALL_LENGTH;

  const leftWall = Bodies.rectangle(
    -wallThickness / 2,
    height / 2,
    wallThickness,
    wallLength,
    { isStatic: true, label: 'wall', render: { fillStyle: COLORS.walls } }
  );
  const rightWall = Bodies.rectangle(
    width + wallThickness / 2,
    height / 2,
    wallThickness,
    wallLength,
    { isStatic: true, label: 'wall', render: { fillStyle: COLORS.walls } }
  );

  Composite.add(engine.world, [leftWall, rightWall]);
}

// -------------------------------------------------------------
// 3. モード切替制御とテンポ変更
// -------------------------------------------------------------
function switchMode(mode) {
  currentMode = mode;
  closePiano();

  // タイマーの停止
  stopBallTimer();

  // 物理世界クリアと壁再構築
  activeBalls = []; // ボール管理配列もリセット
  Composite.clear(engine.world, false);
  createWalls();
  engine.gravity.y = 0.6; // 9-10歳のスライダーで変えた重力を他モードへ持ち越さない

  // モードUI表示切り替え
  document.querySelectorAll('.mode-ui').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.age-tab').forEach(el => el.classList.remove('active'));
  document.querySelector(`.age-tab[data-mode="${mode}"]`).classList.add('active');

  if (mode === '3-5') {
    document.getElementById('tools-3-5').classList.remove('hidden');
    currentShape = 'circle';
    updateActiveToolButton();
    startBallTimer(getBallInterval());
  } 
  else if (mode === '6-8') {
    document.getElementById('tools-6-8').classList.remove('hidden');
    document.getElementById('stage-selector').classList.remove('hidden');
    currentShape = 'slope';
    updateActiveToolButton();
    loadStage(currentStage);
    startBallTimer(getBallInterval());
  } 
  else if (mode === '9-10') {
    document.getElementById('tools-9-10').classList.remove('hidden');
    document.getElementById('physics-panel').classList.remove('hidden');
    
    // ガイドの初期状態を確実にONにする
    isGuideOn = true;
    const btnToggleGuide = document.getElementById('btn-toggle-guide');
    if (btnToggleGuide) {
      btnToggleGuide.classList.add('active');
      btnToggleGuide.innerText = 'ガイド: ON';
    }

    // サブカテゴリ初期化
    switchSubCategory('shape');
    applyPhysicsSliders();
    
    // テンポに合わせて自動落下タイマー開始
    startBallTimer(getBallInterval());
  }

  playTone(329.63, 0.4); // 切替チャイム (ミ)
  setTimeout(() => playTone(392.00, 0.4), 100); // (ソ)
}

function switchSubCategory(subCat) {
  currentSubCategory = subCat;
  
  // サブタブボタンのアクティブ状態切り替え
  document.querySelectorAll('.sub-tab').forEach(tab => {
    tab.classList.remove('active');
    if (tab.dataset.sub === subCat) tab.classList.add('active');
  });

  // サブツールパネルの表示切り替え
  document.querySelectorAll('.sub-tool-panel').forEach(p => p.classList.add('hidden'));
  document.getElementById(`sub-${subCat}`).classList.remove('hidden');

  // カテゴリごとの最初のアクティブツールを選択
  const activeBtn = document.querySelector(`#sub-${subCat} .tool-btn.active`);
  if (activeBtn) {
    currentShape = activeBtn.dataset.shape;
  } else {
    // なければ最初のボタンを選択状態にする
    const firstBtn = document.querySelector(`#sub-${subCat} .tool-btn`);
    if (firstBtn) {
      document.querySelectorAll(`#sub-${subCat} .tool-btn`).forEach(b => b.classList.remove('active'));
      firstBtn.classList.add('active');
      currentShape = firstBtn.dataset.shape;
    }
  }
}

function updateActiveToolButton() {
  const currentToolsId = `tools-${currentMode}`;
  if (currentMode === '9-10') {
    // 9-10歳はサブカテゴリ内のアクティブを更新
    document.querySelectorAll('#tools-9-10 .tool-btn').forEach(btn => {
      btn.classList.remove('active');
      if (btn.dataset.shape === currentShape) btn.classList.add('active');
    });
  } else {
    document.querySelectorAll(`#${currentToolsId} .tool-btn`).forEach(btn => {
      btn.classList.remove('active');
      if (btn.dataset.shape === currentShape) btn.classList.add('active');
    });
  }
}

// モードごとのボール自動落下の間隔（ミリ秒）
function getBallInterval() {
  if (currentMode === '6-8') return 4000; // パズル用に4秒ごと
  if (currentMode === '9-10') {
    // テンポに合わせて 2 拍ごと
    const bpm = parseInt(document.getElementById('slider-bpm').value);
    return (60 / bpm) * 1000 * 2;
  }
  return 1800; // 1.8秒ごと
}

function startBallTimer(ms) {
  stopBallTimer();
  ballTimer = setInterval(dropBall, ms);
}

function stopBallTimer() {
  if (ballTimer) {
    clearInterval(ballTimer);
    ballTimer = null;
  }
}

// -------------------------------------------------------------
// 4. 6-8歳パズルモードの実装
// -------------------------------------------------------------
function loadStage(stageNum) {
  currentStage = stageNum;
  closePiano();

  activeBalls = []; // 下で消すボールの参照を管理配列に残さない
  const bodies = Composite.allBodies(engine.world);
  bodies.forEach(body => {
    if (body.label !== 'wall') {
      Composite.remove(engine.world, body);
    }
  });

  document.querySelectorAll('.stage-btn').forEach(btn => {
    btn.classList.remove('active');
    if (parseInt(btn.dataset.stage) === stageNum) {
      btn.classList.add('active');
    }
  });

  addStageParts(STAGE_DATA[stageNum - 1]);
}

// ステージを置ける範囲（上のタブ・ステージ選択と、下のツールパネルの間）
// 画面全体の比率で置くと、スマホではゴールが下のパネルの裏に隠れてしまうため
const STAGE_REFERENCE_WIDTH = 1024; // 障害物の大きさを決めたときの画面幅（タブレット横）
const STAGE_REFERENCE_HEIGHT = 520; // 同じく、置ける範囲の高さ
function getStageArea() {
  const container = document.getElementById('game-container');
  const height = container.clientHeight;
  const containerTop = container.getBoundingClientRect().top;
  let top = 0;
  ['age-selector', 'stage-selector'].forEach(id => {
    const el = document.getElementById(id);
    if (el && !el.classList.contains('hidden')) {
      top = Math.max(top, el.getBoundingClientRect().bottom - containerTop);
    }
  });
  const panel = document.getElementById('control-panel');
  const bottom = height - (panel ? panel.offsetHeight : 0);
  // スタートの文字（上）とゴールの文字（下）が隠れないよう余白をとる
  const area = { top: top + 30, bottom: bottom - 40 };
  // レイアウトが取れないときは画面全体を使う
  if (!(area.bottom - area.top > 80)) return { top: 0, bottom: height };
  return area;
}

function stagePoint(pos, width, area) {
  return { x: width * pos.x, y: area.top + (area.bottom - area.top) * pos.y };
}

// スタート・ゴール・障害物を置く（子どもが置いたブロックやボールには触らない）
function addStageParts(stage) {
  const container = document.getElementById('game-container');
  const width = container.clientWidth;
  const area = getStageArea();
  // 狭い画面（スマホの縦・横）では障害物を縮めて、通り道が無くなったりゴールに重なったりしないようにする
  const scaleX = Math.min(1, width / STAGE_REFERENCE_WIDTH);
  const scaleY = Math.min(1, (area.bottom - area.top) / STAGE_REFERENCE_HEIGHT);
  const MIN_OBSTACLE_THICKNESS = 14;

  // 🚀 スタート射出口
  const start = stagePoint(stage.start, width, area);
  startSpawner = Bodies.rectangle(start.x, start.y, 65, 15, {
    isStatic: true,
    label: 'startSpawn',
    render: { fillStyle: '#b39ddb', chamfer: { radius: 5 } }
  });
  startSpawner.isStagePart = true;
  Composite.add(engine.world, startSpawner);

  // ⭐ ゴール星
  const goal = stagePoint(stage.goal, width, area);
  // 当たり判定は表示の⭐（34px）と同じくらいの大きさにする
  goalSensor = Bodies.circle(goal.x, goal.y, GOAL_RADIUS, {
    isStatic: true,
    isSensor: true,
    label: 'goalSensor',
    render: {
      fillStyle: 'transparent',
      strokeStyle: '#ffd166',
      lineWidth: 3
    }
  });
  goalSensor.isStagePart = true;
  Composite.add(engine.world, goalSensor);

  // 固定障害物
  stage.obstacles.forEach(obs => {
    let obstacle;
    const pos = stagePoint(obs, width, area);

    if (obs.type === 'triangle_obstacle') {
      obstacle = Bodies.polygon(pos.x, pos.y, 3, (obs.w * Math.min(scaleX, scaleY)) / 2, {
        isStatic: true,
        label: 'obstacle',
        angle: Math.PI,
        render: { fillStyle: '#e2dcd0' }
      });
    } else {
      const w = Math.max(MIN_OBSTACLE_THICKNESS, obs.w * scaleX);
      const h = Math.max(MIN_OBSTACLE_THICKNESS, obs.h * scaleY);
      obstacle = Bodies.rectangle(pos.x, pos.y, w, h, {
        isStatic: true,
        label: 'obstacle',
        render: { fillStyle: '#e2dcd0', chamfer: { radius: 8 } }
      });
    }
    obstacle.isStagePart = true;
    Composite.add(engine.world, obstacle);
  });
}

function handleStageClear() {
  if (document.getElementById('clear-modal').classList.contains('hidden')) {
    const cleared = saveClearedStage(currentStage);
    const allCleared = STAGE_DATA.every((_, i) => cleared.includes(i + 1));
    document.querySelector('#clear-modal .clear-message').textContent = allCleared
      ? 'ぜんぶの ステージを クリアしたよ！ すごい！'
      : 'じょうずに ボールを はこべたね！';
    document.getElementById('clear-modal').classList.remove('hidden');
    playTone(523.25, 0.5); // ド
    setTimeout(() => playTone(659.25, 0.5), 120); // ミ
    setTimeout(() => playTone(783.99, 0.5), 240); // ソ
    setTimeout(() => playTone(1046.50, 0.6), 360); // 高いド
  }
}

// -------------------------------------------------------------
// 5. 9-10歳モードの物理連動・ポップアップピアノ
// -------------------------------------------------------------
function applyPhysicsSliders() {
  if (currentMode !== '9-10') return;

  const gravVal = parseFloat(document.getElementById('slider-gravity').value);
  const fricVal = parseFloat(document.getElementById('slider-friction').value);

  engine.gravity.y = gravVal;
  document.getElementById('val-gravity').innerText = gravVal.toFixed(1);
  document.getElementById('val-friction').innerText = fricVal.toFixed(2);

  const bodies = Composite.allBodies(engine.world);
  bodies.forEach(body => {
    if (body.label === 'block') {
      Body.set(body, 'friction', fricVal);
    }
  });
  wakeBalls(); // 眠ったボールにも新しい重力を効かせる
}

// はぐるまギミックの生成
function createGear(x, y, isMotor = false) {
  const width = 110;
  const height = 14;

  const partA = Bodies.rectangle(x, y, width, height, {
    render: { fillStyle: isMotor ? COLORS.motorGear : COLORS.gear, chamfer: { radius: 4 } }
  });
  const partB = Bodies.rectangle(x, y, height, width, {
    render: { fillStyle: isMotor ? COLORS.motorGear : COLORS.gear, chamfer: { radius: 4 } }
  });

  const gearBody = Body.create({
    parts: [partA, partB],
    label: 'block',
    blockType: isMotor ? 'motor-gear' : 'gear',
    frictionAir: 0.015,
    // 歯車同士の物理衝突をオフにする設定（カテゴリ4）
    collisionFilter: {
      category: gearCategory,
      mask: defaultCategory // ボールや壁（カテゴリ1）とのみ衝突する
    }
  });
  // 歯車は眠らせない（モーターの角速度 0.038 はスリープ判定のしきい値を下回り、1 秒ほどで止まってしまう）
  gearBody.sleepThreshold = -1;

  const pin = Constraint.create({
    pointA: { x: x, y: y },
    bodyB: gearBody,
    pointB: { x: 0, y: 0 },
    stiffness: 1.0,
    length: 0,
    render: {
      visible: true,
      strokeStyle: '#7d7568',
      lineWidth: 5
    }
  });

  Composite.add(engine.world, [gearBody, pin]);
}

// 背景ガイド（きらきら星の最初の3音目安）の描画
function drawMelodyGuide(ctx) {
  const container = document.getElementById('game-container');
  const width = container.clientWidth;
  const height = container.clientHeight;

  const guidePoints = [
    { x: width * 0.25, y: height * 0.35, note: 'ド' },
    { x: width * 0.5, y: height * 0.45, note: 'ミ' },
    { x: width * 0.75, y: height * 0.55, note: 'ソ' }
  ];

  ctx.strokeStyle = 'rgba(179, 157, 219, 0.4)';
  ctx.lineWidth = 3;
  ctx.setLineDash([8, 8]); // 点線

  // ガイド線を引く
  ctx.beginPath();
  ctx.moveTo(width / 2, 40);
  guidePoints.forEach(pt => {
    ctx.lineTo(pt.x, pt.y);
  });
  ctx.stroke();
  ctx.setLineDash([]); // リセット

  // ガイドマークを描く
  guidePoints.forEach(pt => {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.strokeStyle = 'rgba(179, 157, 219, 0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 28, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#7d7568';
    ctx.font = "bold 12px 'M PLUS Rounded 1c', sans-serif";
    ctx.fillText(`ここに [${pt.note}]`, pt.x, pt.y);
  });
}

// ブロックを削除する（はぐるまはピン留めの Constraint も一緒に消す）
function removeBlock(block) {
  Composite.remove(engine.world, block);
  if (block.blockType === 'gear' || block.blockType === 'motor-gear') {
    Composite.allConstraints(engine.world).forEach(c => {
      if (c.bodyB === block) Composite.remove(engine.world, c);
    });
  }
  wakeBalls();
}

// 眠っているボールを起こす
// （静的ブロックとの接触ではスリープが解除されないため、ブロックの削除・移動や重力変更の後に呼ぶ）
function wakeBalls() {
  activeBalls.forEach(ball => Sleeping.set(ball, false));
}

// ピアノ鍵盤を開く
function openPiano(block, eventCoords) {
  selectedNoteBlock = block;
  const keyboard = document.getElementById('piano-keyboard');

  // ポップアップ位置の設定（ブロックの直上中央）
  const container = document.getElementById('game-container');
  const width = container.clientWidth;
  
  let left = block.position.x - 160; // ピアノの幅320pxの中央
  let top = block.position.y - 125;

  // 画面左右のはみ出し防止
  // （幅 340px 未満の画面では余白を削って、右端の鍵盤が切れないようにする）
  left = Math.max(Math.min(10, (width - 320) / 2), Math.min(left, width - 330));
  top = Math.max(70, top); // 上部年齢タブなどと重ね合わせを回避

  keyboard.style.left = `${left}px`;
  keyboard.style.top = `${top}px`;
  keyboard.classList.remove('hidden');

  // アクティブキーのハイライト
  const keys = keyboard.querySelectorAll('.piano-key');
  keys.forEach(k => {
    k.classList.remove('active-key');
    if (parseInt(k.dataset.note) === block.toneIndex) {
      k.classList.add('active-key');
    }
  });
}

// ピアノ鍵盤を閉じる
function closePiano() {
  document.getElementById('piano-keyboard').classList.add('hidden');
  selectedNoteBlock = null;
}

// -------------------------------------------------------------
// 6. ボール落下・衝突・物理判定ループ
// -------------------------------------------------------------
function dropBall() {
  if (!isGameActive) return;

  const container = document.getElementById('game-container');
  const width = container.clientWidth;
  
  let startX, startY;

  if (currentMode === '6-8' && startSpawner) {
    startX = startSpawner.position.x;
    // 発射台の真下から落とす（上に出すと、平らな発射台に乗ったまま止まってしまい、ゴールへ運べなかった）
    startY = startSpawner.position.y + 25;
  } else {
    startX = width / 2 + (Math.random() - 0.5) * (width * 0.4);
    startY = -20;
  }

  // パズル（6-8歳）は同じ置き方なら毎回同じ結果になるよう、ボールの大きさを固定する
  const radius = currentMode === '6-8' ? PUZZLE_BALL_RADIUS : 12 + Math.random() * 5;
  const randomColor = COLORS.balls[Math.floor(Math.random() * COLORS.balls.length)];

  const ball = Bodies.circle(startX, startY, radius, {
    restitution: 0.85,
    friction: 0.02,
    collisionFilter: {
      category: defaultCategory,
      mask: defaultCategory | gearCategory // ボールは壁、通常ブロック、はぐるま全てと衝突する
    },
    render: { fillStyle: randomColor },
    label: 'ball'
  });

  // 画面内のボール最大数を120個に制限し、最古のボールを順次消去する
  activeBalls.push(ball);
  if (activeBalls.length > 120) {
    const oldestBall = activeBalls.shift();
    // すでに画面外で消滅していないか確認して物理世界から削除
    if (Composite.allBodies(engine.world).includes(oldestBall)) {
      Composite.remove(engine.world, oldestBall);
    }
  }

  Composite.add(engine.world, ball);
}

// きらきら星パーティクルエフェクト
function createSparkles(x, y, color) {
  const sparkleCount = 6;
  const sparkles = [];

  for (let i = 0; i < sparkleCount; i++) {
    const angle = (i / sparkleCount) * Math.PI * 2 + Math.random() * 0.5;
    const speed = 2.5 + Math.random() * 2.5;
    const radius = 3 + Math.random() * 3;

    const sparkle = Bodies.circle(x, y, radius, {
      collisionFilter: {
        category: particleCategory,
        mask: 0
      },
      render: { fillStyle: color, opacity: 1.0 },
      label: 'particle'
    });

    Body.setVelocity(sparkle, {
      x: Math.cos(angle) * speed,
      y: Math.sin(angle) * speed - 2.5
    });

    sparkle.lifespan = 30;
    sparkles.push(sparkle);
  }

  Composite.add(engine.world, sparkles);
}

// タップ位置の近くにあるボールを探す（ボールは小さいので、指の太さぶん当たり判定を広げる）
const BALL_TAP_SLOP_PX = 12;
function findBallNear(coords) {
  let nearest = null;
  let nearestDist = Infinity;
  activeBalls.forEach(ball => {
    const dist = Vector.magnitude(Vector.sub(ball.position, coords));
    if (dist <= ball.circleRadius + BALL_TAP_SLOP_PX && dist < nearestDist) {
      nearest = ball;
      nearestDist = dist;
    }
  });
  return nearest;
}

// ボールを はじけさせる
function popBall(ball) {
  Composite.remove(engine.world, ball);
  const index = activeBalls.indexOf(ball);
  if (index > -1) activeBalls.splice(index, 1);
  createSparkles(ball.position.x, ball.position.y, ball.render.fillStyle);
  createSparkles(ball.position.x, ball.position.y, '#ffd166');
  // 高い音域のペンタトニックから選ぶので、どれを鳴らしても濁らない
  const highTones = TONES.slice(-5);
  playTone(highTones[Math.floor(Math.random() * highTones.length)], 0.5);
}

// ブロックを一瞬光らせる（当たった・回したことが目で分かるように）
const BLOCK_FLASH_MS = 220;
function flashBlock(block) {
  block.flashStartTime = performance.now();
}

function drawBlockFlashes(ctx, bodies) {
  const now = performance.now();
  bodies.forEach(body => {
    if (body.label !== 'block' || !body.flashStartTime) return;
    const elapsed = now - body.flashStartTime;
    if (elapsed >= BLOCK_FLASH_MS) {
      body.flashStartTime = 0;
      return;
    }
    const progress = elapsed / BLOCK_FLASH_MS;
    const size = Math.max(body.bounds.max.x - body.bounds.min.x, body.bounds.max.y - body.bounds.min.y);
    ctx.save();
    ctx.globalAlpha = 1 - progress;
    ctx.strokeStyle = body.render.fillStyle || COLORS.square;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(body.position.x, body.position.y, size / 2 + 4 + progress * 14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  });
}

// ジャンプ台で跳ねたあとの速度
// ジャンプ台は平らな板で、板の面に垂直な向きへ必ず同じ強さで跳ね上げる（板を回すと、跳ぶ向きも変わる）。
// 板に沿った向きの勢いは少し強めて残す。当たった位置や角度で跳ぶ向きが変わらないので、狙って置ける
const BOUNCER_LAUNCH_SPEED = 9.5;
const BOUNCER_TANGENT_BOOST = 1.2;
function getBouncerLaunchVelocity(ball, bouncer) {
  const tangent = { x: Math.cos(bouncer.angle), y: Math.sin(bouncer.angle) };
  let normal = { x: Math.sin(bouncer.angle), y: -Math.cos(bouncer.angle) };
  // ボールがいる側の面へ跳ね返す
  if (Vector.dot(Vector.sub(ball.position, bouncer.position), normal) < 0) {
    normal = Vector.neg(normal);
  }
  const along = Vector.dot(ball.velocity, tangent) * BOUNCER_TANGENT_BOOST;
  return Vector.add(Vector.mult(normal, BOUNCER_LAUNCH_SPEED), Vector.mult(tangent, along));
}

// 跳ね上げは衝突の計算（めり込みの押し戻し・反発）が終わったあとに上書きする
// （衝突の開始時に速度を入れても、そのあとの反発計算で向きが変わってしまうため）
function applyPendingLaunches() {
  activeBalls.forEach(ball => {
    if (ball.pendingLaunch) {
      Body.setVelocity(ball, ball.pendingLaunch);
      ball.pendingLaunch = null;
    }
  });
}

// 接触物体の継続的な物理判定（ベルトコンベア用）
function handleConveyorBeltPhysics(pair) {
  const bodyA = pair.bodyA;
  const bodyB = pair.bodyB;
  const isBallA = bodyA.label === 'ball';
  const isBallB = bodyB.label === 'ball';

  if (isBallA || isBallB) {
    const ball = isBallA ? bodyA : bodyB;
    const block = isBallA ? bodyB : bodyA;

    if (block.blockType === 'conveyor') {
      // 搬送対象をボールのみに限定し、速度を上書き
      Body.setVelocity(ball, { x: 3.5, y: ball.velocity.y });
    }
  }
}

// ループゲートのテレポート判定とドラムの発音
function handleCollisionStart(pair) {
  const bodyA = pair.bodyA;
  const bodyB = pair.bodyB;
  const isBallA = bodyA.label === 'ball';
  const isBallB = bodyB.label === 'ball';

  if (isBallA || isBallB) {
    const ball = isBallA ? bodyA : bodyB;
    const target = isBallA ? bodyB : bodyA;

    // ① 6-8歳パズル：ゴール到達判定
    if (currentMode === '6-8' && target === goalSensor) {
      handleStageClear();
      Composite.remove(engine.world, ball);
      const index = activeBalls.indexOf(ball);
      if (index > -1) activeBalls.splice(index, 1);
      return;
    }

    // ③ ブロック衝突発音
    if (target.label === 'block') {
      // ジャンプ台（バウンサー）の跳ね上げ（音を間引いても跳ね上げは毎回行う）
      if (target.blockType === 'bouncer') {
        ball.pendingLaunch = getBouncerLaunchVelocity(ball, target);
      }

      // 音とエフェクトは間引く（ボールが溜まると同じ所で何度も当たり、音が割れて重くなるため）
      if (!allowHitSound(target)) return;

      let freq;
      let color = target.render.fillStyle;

      if (target.blockType === 'note') {
        const note = NOTE_TONES[target.toneIndex];
        freq = note.freq;
        color = note.color;
        playTone(freq, Math.min(Vector.magnitude(ball.velocity) / 8, 1.0));
      }
      else if (target.blockType === 'drum') {
        // ドラムブロック：太鼓（bass）またはシンバル（snare）
        playDrum(target.drumType, Math.min(Vector.magnitude(ball.velocity) / 6, 1.0));
      }
      else {
        // 通常ブロック：X座標マッピング音
        const containerWidth = document.getElementById('game-container').clientWidth;
        const ratio = Math.min(Math.max(ball.position.x / containerWidth, 0), 1);
        const toneIndex = Math.min(Math.floor(ratio * TONES.length), TONES.length - 1);
        freq = TONES[toneIndex];

        if (target.blockType === 'bouncer') {
          freq = 659.25; // ミの音
        }
        playTone(freq, Math.min(Vector.magnitude(ball.velocity) / 8, 1.0));
      }

      // 衝突エフェクトの発生
      const contact = pair.activeContacts ? pair.activeContacts[0] : null;
      const contactPos = contact ? contact.vertex : ball.position;
      createSparkles(contactPos.x, contactPos.y, color);
      flashBlock(target);

      // 振動エフェクト
      if (target.blockType !== 'gear' && target.blockType !== 'motor-gear') {
        Body.applyForce(target, target.position, {
          x: (Math.random() - 0.5) * 0.05,
          y: 0.02
        });
      }
    }
  }
}

// アクティブ衝突イベント（コンベア処理など）
function handleActivePhysics(event) {
  event.pairs.forEach(pair => {
    handleConveyorBeltPhysics(pair);
  });
}

// 衝突開始イベント
function setupCollisionHandler() {
  Events.on(engine, 'collisionStart', (event) => {
    event.pairs.forEach((pair) => {
      handleCollisionStart(pair);
    });
  });
}

// 毎フレームのループ処理（画面外ボールの削除、はぐるま同期、モーター回転）
function updateLoop() {
  const bodies = Composite.allBodies(engine.world);
  const container = document.getElementById('game-container');
  const height = container.clientHeight;

  // はぐるま/モーターギアの一覧を抽出
  const gears = bodies.filter(b => b.label === 'block' && (b.blockType === 'gear' || b.blockType === 'motor-gear'));

  // 1. モーターギアの自転駆動
  gears.forEach(g => {
    if (g.blockType === 'motor-gear') {
      Body.setAngularVelocity(g, 0.038); // 毎フレーム一定の角速度で強制回転
    }
  });

  // 2. 歯車同士のプログラム同期連動
  // 歯車同士の距離が 112px 未満（接触距離）であるペアに対して、角速度を逆方向に代入同期する
  for (let i = 0; i < gears.length; i++) {
    for (let j = i + 1; j < gears.length; j++) {
      const gA = gears[i];
      const gB = gears[j];
      
      const dist = Vector.magnitude(Vector.sub(gA.position, gB.position));
      if (dist < 112) {
        // 回転が速い方（主導権を持つギア）から遅い方へ伝達
        const speedA = Math.abs(gA.angularVelocity);
        const speedB = Math.abs(gB.angularVelocity);
        
        if (speedA > speedB && speedA > 0.002) {
          Body.setAngularVelocity(gB, -gA.angularVelocity);
        } else if (speedB > speedA && speedB > 0.002) {
          Body.setAngularVelocity(gA, -gB.angularVelocity);
        }
      }
    }
  }

  // 3. ボールの削除、パーティクルのフェードアウト
  bodies.forEach((body) => {
    // 画面外ボールの削除（管理配列からも取り除く）
    if (body.label === 'ball' && body.position.y > height + 60) {
      Composite.remove(engine.world, body);
      const index = activeBalls.indexOf(body);
      if (index > -1) {
        activeBalls.splice(index, 1);
      }
    }

    if (body.label === 'particle') {
      body.lifespan--;
      if (body.lifespan <= 0) {
        Composite.remove(engine.world, body);
      } else {
        body.render.opacity = body.lifespan / 30;
      }
    }
  });
}

// -------------------------------------------------------------
// 7. タッチ＆マウス操作
// -------------------------------------------------------------
function setupInteraction() {
  const container = document.getElementById('game-container');

  function getEventCoords(e) {
    const rect = container.getBoundingClientRect();
    let clientX, clientY;

    if (e.touches && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  }

  function handleStart(e) {
    // UIパーツ上でのタッチは無効化
    if (e.target.closest('#control-panel') || e.target.closest('#age-selector') || e.target.closest('#stage-selector') || e.target.closest('#physics-panel') || e.target.closest('#piano-keyboard')) return;
    
    e.preventDefault();
    initAudio(); // iOS でバックグラウンド復帰後に suspended へ戻った AudioContext を再開する
    const pianoOpenedFor = selectedNoteBlock; // ピアノを開いていたおんぷを再タップしたら、閉じたままにする（トグル）
    closePiano(); // Canvas上をタッチしたらピアノを一旦閉じる

    const coords = getEventCoords(e);
    const bodies = Composite.allBodies(engine.world);

    // ブロックボディをタップしたか検出
    const clickedBody = Matter.Query.point(bodies, coords).find(body => body.label === 'block');

    // ボールをタップしたら、ぱちんと はじける（ブロックの上でなければ）
    if (!clickedBody) {
      const tappedBall = findBallNear(coords);
      if (tappedBall) {
        popBall(tappedBall);
        lastTappedBody = null;
        return;
      }
    }

    pressStartCoords = coords;
    hasMovedSincePress = false;
    tappedNoteBody = null;

    // ① 長押し（600ms）による削除処理
    if (clickedBody) {
      if (pressTimer) clearTimeout(pressTimer); // 前のタップのタイマーを取り残さない
      pressTimer = setTimeout(() => {
        pressTimer = null;
        removeBlock(clickedBody);
        playTone(150, 0.2); // 消去音
        draggedBody = null;
        tappedNoteBody = null;
      }, 600);
    }

    // ② ダブルタップ検知（45度回転、またはドラム切替）
    const now = Date.now();
    if (clickedBody) {
      // 同じブロックを続けてタップしたときだけダブルタップとみなす
      if (clickedBody === lastTappedBody && now - lastTapTime < 280) {
        clearTimeout(pressTimer); // 長押しキャンセルの同期
        
        if (clickedBody.blockType === 'slope' || clickedBody.blockType === 'conveyor') {
          // 45度回転
          Body.setAngle(clickedBody, clickedBody.angle + Math.PI / 4);
          playTone(440, 0.4);
        } 
        else if (clickedBody.blockType === 'drum') {
          // ドラムの種類を切り替え (bass ➔ snare)
          clickedBody.drumType = clickedBody.drumType === 'bass' ? 'snare' : 'bass';
          clickedBody.render.fillStyle = clickedBody.drumType === 'bass' ? '#ffc6ff' : '#caffbf';
          playDrum(clickedBody.drumType, 0.5);
        }
        else if (clickedBody.blockType === 'note') {
          // おんぷブロックの場合：ピアノキーボードをトグル表示
          openPiano(clickedBody, coords);
        }
        else {
          // それ以外の形はくるっと回す（小さい子が連打しても、置いたものが消えてしまわないようにする。消すのは長押しか「けす」）
          Body.setAngle(clickedBody, clickedBody.angle + Math.PI / 4);
          flashBlock(clickedBody);
          playTone(523.25, 0.4);
        }

        wakeBalls(); // 回転で支えが変わったボールを落とす
        draggedBody = null;
        lastTapTime = 0;
        lastTappedBody = null;
        return;
      }
      lastTapTime = now;
      lastTappedBody = clickedBody;
    }

    if (clickedBody) {
      // はぐるま/モーターギアはドラッグ固定にする
      if (clickedBody.blockType !== 'gear' && clickedBody.blockType !== 'motor-gear') {
        draggedBody = clickedBody;
        dragOffset.x = coords.x - clickedBody.position.x;
        dragOffset.y = coords.y - clickedBody.position.y;
      }
      if (clickedBody.blockType === 'note') {
        // おんぷブロックのシングルタップ：動かさずに指を離したらピアノキーボードを表示（handleEnd）
        if (clickedBody !== pianoOpenedFor) tappedNoteBody = clickedBody;
      }
    } else {
      // 何もない場所をタップ：新規配置
      createBlock(coords.x, coords.y);
      lastTapTime = now;
      lastTappedBody = null;
    }
  }

  function handleMove(e) {
    if (!pressStartCoords) return; // 押していない間のマウス移動は無視
    const coords = getEventCoords(e);

    // 指はじっとしていても少しずつ動くので、一定距離を超えるまではドラッグとみなさない
    // （超えないうちに長押しを取り消すと、タッチ端末で長押し削除がほぼ成功しない）
    if (!hasMovedSincePress) {
      const dx = coords.x - pressStartCoords.x;
      const dy = coords.y - pressStartCoords.y;
      if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) {
        if (draggedBody) e.preventDefault();
        return;
      }
      hasMovedSincePress = true;
      tappedNoteBody = null;
      if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
    }

    if (!draggedBody) return;
    e.preventDefault();

    Body.setPosition(draggedBody, {
      x: coords.x - dragOffset.x,
      y: coords.y - dragOffset.y
    });
    wakeBalls(); // 動かしたブロックの上で眠っていたボールを落とす
    lastTappedBody = null; // ドラッグ直後に掴み直してもダブルタップ扱いにしない
  }

  function handleEnd(e) {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
    if (tappedNoteBody && e.type !== 'touchcancel' && Composite.allBodies(engine.world).includes(tappedNoteBody)) {
      openPiano(tappedNoteBody);
    }
    tappedNoteBody = null;
    pressStartCoords = null;
    draggedBody = null;
  }

  container.addEventListener('mousedown', handleStart);
  container.addEventListener('mousemove', handleMove);
  window.addEventListener('mouseup', handleEnd);

  container.addEventListener('touchstart', handleStart, { passive: false });
  container.addEventListener('touchmove', handleMove, { passive: false });
  window.addEventListener('touchend', handleEnd);
  // 着信やシステムジェスチャーでタッチが中断されたときも、長押しタイマーとドラッグ状態を片づける
  window.addEventListener('touchcancel', handleEnd);
}

// 各種ギミックの物理定義と配置
function createBlock(x, y) {
  let block;
  const options = {
    isStatic: true,
    label: 'block',
    friction: parseFloat(document.getElementById('slider-friction').value) || 0.1
  };

  // 1. 基本図形
  if (currentShape === 'circle') {
    block = Bodies.circle(x, y, blockRadius, {
      ...options,
      render: { fillStyle: COLORS.circle }
    });
  } else if (currentShape === 'triangle') {
    block = Bodies.polygon(x, y, 3, blockRadius + 5, {
      ...options,
      angle: -Math.PI / 6,
      render: { fillStyle: COLORS.triangle }
    });
  } else if (currentShape === 'square') {
    block = Bodies.rectangle(x, y, blockRadius * 2, blockRadius * 2, {
      ...options,
      chamfer: { radius: 10 },
      render: { fillStyle: COLORS.square }
    });
  }
  // 2. 物理ギミック
  else if (currentShape === 'slope') {
    block = Bodies.rectangle(x, y, 120, 30, {
      ...options,
      blockType: 'slope',
      angle: -Math.PI / 8,
      render: { fillStyle: COLORS.slope, chamfer: { radius: 6 } }
    });
  } else if (currentShape === 'bouncer') {
    // 平らな板（トランポリン）。2 回タップで 45 度ずつ回すと、跳ぶ向きを変えられる
    block = Bodies.rectangle(x, y, 90, 20, {
      ...options,
      blockType: 'bouncer',
      chamfer: { radius: 8 },
      render: {
        fillStyle: COLORS.bouncer,
        strokeStyle: '#ffffff',
        lineWidth: 3
      }
    });
  } else if (currentShape === 'conveyor') {
    block = Bodies.rectangle(x, y, 140, 30, {
      ...options,
      blockType: 'conveyor',
      render: { fillStyle: COLORS.conveyor, chamfer: { radius: 6 } }
    });
  }
  // 3. はぐるま類
  else if (currentShape === 'gear') {
    createGear(x, y, false);
    playTone(392.00, 0.4);
    return;
  } else if (currentShape === 'motor-gear') {
    createGear(x, y, true);
    playTone(392.00, 0.4);
    return;
  } 
  // 4. 音楽・ループギミック
  else if (currentShape === 'note') {
    block = Bodies.rectangle(x, y, 65, 36, {
      ...options,
      blockType: 'note',
      toneIndex: 0,
      chamfer: { radius: 8 },
      render: { fillStyle: NOTE_TONES[0].color }
    });
  } else if (currentShape === 'drum') {
    block = Bodies.circle(x, y, blockRadius - 2, {
      ...options,
      blockType: 'drum',
      drumType: 'bass', // 'bass'＝ドン, 'snare'＝シャン
      render: { fillStyle: '#ffc6ff' }
    });
  }

  playTone(392.00, 0.4); // 配置音
  Composite.add(engine.world, block);
}

// -------------------------------------------------------------
// 8. キャンバス上のテキスト・絵文字カスタム描画 (afterRender)
// -------------------------------------------------------------
function setupCustomRenderer() {
  Events.on(render, 'afterRender', () => {
    const ctx = render.context;
    const bodies = Composite.allBodies(engine.world);

    ctx.save();
    ctx.font = "bold 13px 'M PLUS Rounded 1c', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // 9-10歳：メロディガイド描画
    if (currentMode === '9-10' && isGuideOn) {
      drawMelodyGuide(ctx);
    }

    bodies.forEach(body => {
      // ① おんぷブロックの文字（「ド」「ミ#」など）
      if (body.label === 'block' && body.blockType === 'note') {
        const note = NOTE_TONES[body.toneIndex];
        ctx.fillStyle = "white";
        ctx.fillText(note.name, body.position.x, body.position.y);
      }

      // ② ドラムブロックの文字（「ドン」「シャン」）
      if (body.label === 'block' && body.blockType === 'drum') {
        ctx.fillStyle = "#4a4a4a";
        ctx.font = "bold 11px 'M PLUS Rounded 1c', sans-serif";
        ctx.fillText(body.drumType === 'bass' ? "🥁 ドン" : "🔔 シャン", body.position.x, body.position.y);
      }

      // ③ ジャンプ台の矢印（跳ぶ向き。板と一緒に回る）
      if (body.label === 'block' && body.blockType === 'bouncer') {
        ctx.save();
        ctx.translate(body.position.x, body.position.y);
        ctx.rotate(body.angle);
        ctx.fillStyle = "white";
        ctx.font = "bold 13px 'M PLUS Rounded 1c', sans-serif";
        ctx.fillText("▲ ▲ ▲", 0, 1);
        ctx.restore();
      }

      // ④ ベルトコンベアの矢印
      if (body.label === 'block' && body.blockType === 'conveyor') {
        ctx.fillStyle = "#3b8a3b";
        ctx.font = "14px 'M PLUS Rounded 1c', sans-serif";
        ctx.save();
        ctx.translate(body.position.x, body.position.y);
        ctx.rotate(body.angle);
        ctx.fillText("➔ ➔ ➔", 0, 0);
        ctx.restore();
      }



      // ⑥ はぐるま・モーターギアのピン留めの装飾
      if (body.label === 'block' && (body.blockType === 'gear' || body.blockType === 'motor-gear')) {
        ctx.fillStyle = "#7d7568";
        ctx.font = "12px 'M PLUS Rounded 1c', sans-serif";
        ctx.fillText(body.blockType === 'motor-gear' ? "⚡" : "・", body.position.x, body.position.y);
      }

      // ⑦ 6-8歳：スタート発射台
      if (body.label === 'startSpawn') {
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 10px 'M PLUS Rounded 1c', sans-serif";
        ctx.fillText("はっしゃ", body.position.x, body.position.y);
        ctx.fillStyle = "#7d7568";
        ctx.font = "bold 12px 'M PLUS Rounded 1c', sans-serif";
        ctx.fillText("🚀 スタート", body.position.x, body.position.y - 20);
      }

      // ⑧ 6-8歳：ゴール星
      if (body.label === 'goalSensor') {
        ctx.save();
        ctx.translate(body.position.x, body.position.y);
        ctx.rotate(Date.now() * 0.002);
        ctx.fillStyle = "#ff9f43";
        ctx.font = "34px 'M PLUS Rounded 1c', sans-serif";
        ctx.fillText("⭐", 0, 0);
        ctx.restore();
        
        ctx.fillStyle = "#7d7568";
        ctx.font = "bold 12px 'M PLUS Rounded 1c', sans-serif";
        ctx.fillText("ゴール", body.position.x, body.position.y + 35);
      }
    });

    drawBlockFlashes(ctx, bodies);

    ctx.restore();
  });
}

// -------------------------------------------------------------
// 9. UIイベントバインド
// -------------------------------------------------------------
function setupUI() {
  // スタートボタン
  const btnStart = document.getElementById('btn-start');
  const startScreen = document.getElementById('start-screen');
  const ageSelector = document.getElementById('age-selector');

  btnStart.addEventListener('click', () => {
    initAudio();
    initPhysics();
    setupInteraction();
    
    isGameActive = true;
    startScreen.classList.add('hidden');
    ageSelector.classList.remove('hidden-ui');

    switchMode('3-5');
  });

  // 年齢切り替えタブ
  document.querySelectorAll('.age-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      const mode = e.currentTarget.dataset.mode;
      switchMode(mode);
    });
  });

  // 9-10歳用：サブカテゴリタブの切り替え
  document.querySelectorAll('.sub-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      const sub = e.currentTarget.dataset.sub;
      switchSubCategory(sub);
      playTone(523.25, 0.2); // ド
    });
  });

  // 形状選択ツールボタン
  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const targetBtn = e.currentTarget;
      // すべてのツールボタンからアクティブ状態を除去し、クリックしたものに付与
      targetBtn.parentElement.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
      targetBtn.classList.add('active');
      currentShape = targetBtn.dataset.shape;

      playTone(523.25, 0.3); // タップ音 (ド)
    });
  });

  // ピアノ鍵盤の各キーのイベント登録
  document.querySelectorAll('.piano-key').forEach(key => {
    key.addEventListener('click', (e) => {
      e.stopPropagation(); // バブリングを防ぐ
      if (!selectedNoteBlock) return;

      const noteIndex = parseInt(e.currentTarget.dataset.note);
      
      // おんぷブロックの音高・色の同期
      selectedNoteBlock.toneIndex = noteIndex;
      selectedNoteBlock.render.fillStyle = NOTE_TONES[noteIndex].color;

      // プレビュー再生
      playTone(NOTE_TONES[noteIndex].freq, 0.6);

      // ピアノ鍵盤を閉じる
      closePiano();
    });
  });

  // ボール手動落下
  document.getElementById('btn-ball-drop').addEventListener('click', () => {
    dropBall();
    playTone(587.33, 0.3); // レ
  });

  // 全部けす
  document.getElementById('btn-clear').addEventListener('click', () => {
    closePiano();
    activeBalls = []; // ボール管理配列も完全にクリア
    const bodies = Composite.allBodies(engine.world);
    bodies.forEach((body) => {
      if (body.label === 'block' || body.label === 'ball' || body.label === 'particle') {
        Composite.remove(engine.world, body);
      }
    });
    
    // ギアのConstraintも一掃
    const constraints = Composite.allConstraints(engine.world);
    constraints.forEach(c => {
      if (c.label !== 'wall') Composite.remove(engine.world, c);
    });

    playTone(440, 0.3);
    setTimeout(() => playTone(330, 0.3), 100);
    setTimeout(() => playTone(220, 0.3), 200);
  });

  // 6-8歳：ステージ選択
  document.querySelectorAll('.stage-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const stage = parseInt(e.currentTarget.dataset.stage);
      loadStage(stage);
      playTone(392.00, 0.3);
    });
  });

  // 6-8歳：クリア画面「つぎのステージへ」
  document.getElementById('btn-next-stage').addEventListener('click', () => {
    document.getElementById('clear-modal').classList.add('hidden');
    let nextStage = currentStage + 1;
    if (nextStage > STAGE_DATA.length) nextStage = 1;
    loadStage(nextStage);
  });

  // 9-10歳：物理調整スライダー
  document.getElementById('slider-gravity').addEventListener('input', applyPhysicsSliders);
  document.getElementById('slider-friction').addEventListener('input', applyPhysicsSliders);
  
  // 9-10歳：BPMスライダーと自動落下の同期
  const sliderBpm = document.getElementById('slider-bpm');
  sliderBpm.addEventListener('input', () => {
    const bpm = parseInt(sliderBpm.value);
    document.getElementById('val-bpm').innerText = bpm;
    if (!document.hidden) startBallTimer(getBallInterval());
  });

  // 9-10歳：ガイド切り替え
  const btnToggleGuide = document.getElementById('btn-toggle-guide');
  btnToggleGuide.addEventListener('click', () => {
    isGuideOn = !isGuideOn;
    btnToggleGuide.classList.toggle('active');
    btnToggleGuide.innerText = isGuideOn ? 'ガイド: ON' : 'ガイド: OFF';
    playTone(440, 0.3);
  });
}

// 物理エンジンサイズのリサイズ処理
function handleResize() {
  const container = document.getElementById('game-container');
  if (!container || !render) return;

  const width = container.clientWidth;
  const height = container.clientHeight;

  // Render.world は毎フレーム pixelRatio 倍で描くので、canvas の実寸も pixelRatio 倍に合わせる
  render.options.width = width;
  render.options.height = height;
  Render.setPixelRatio(render, window.devicePixelRatio || 1);

  const wallThickness = 60;
  const bodies = Composite.allBodies(engine.world);
  let wallIndex = 0;
  bodies.forEach((body) => {
    if (body.label === 'wall') {
      if (wallIndex === 0) {
        Body.setPosition(body, { x: -wallThickness / 2, y: height / 2 });
        wallIndex++;
      } else if (wallIndex === 1) {
        Body.setPosition(body, { x: width + wallThickness / 2, y: height / 2 });
        wallIndex++;
      }
    }
  });

  // 6-8歳：ステージの部品だけを今の画面に合わせて作り直す
  // （loadStage で作り直すと、子どもが置いたブロックまで消えてしまう。スマホではアドレスバーの出入りでも resize が来る）
  if (currentMode === '6-8' && goalSensor) {
    bodies.forEach((body) => {
      if (body.isStagePart) Composite.remove(engine.world, body);
    });
    addStageParts(STAGE_DATA[currentStage - 1]);
    wakeBalls();
  }
}

// ページが裏に回っている間はボールを落とさない
// （setInterval は裏でも動き続けるため、戻ったときにボールが溜まっていて一斉に鳴る）
function handleVisibilityChange() {
  if (!isGameActive) return;
  if (document.hidden) {
    stopBallTimer();
  } else {
    lastPhysicsTime = null;
    startBallTimer(getBallInterval());
  }
}

// Matter.js（CDN）の読み込みに失敗したときの案内
function showLoadError() {
  const subtitle = document.querySelector('#start-screen .subtitle');
  const btnStart = document.getElementById('btn-start');
  subtitle.textContent = 'よみこみに しっぱいしました。インターネットに つないでから もういちど ためしてね';
  btnStart.textContent = 'もういちど よみこむ ↻';
  btnStart.classList.remove('pulse-animation');
  btnStart.addEventListener('click', () => location.reload());
}

// 起動処理
document.addEventListener('DOMContentLoaded', () => {
  if (!window.Matter) {
    showLoadError();
    return;
  }
  setupUI();
  updateClearedMarks();
  document.addEventListener('visibilitychange', handleVisibilityChange);
  // ボタン操作でも止まった AudioContext を再開できるようにする（iOS はユーザー操作の中でしか再開できない）
  document.addEventListener('touchend', () => { if (audioCtx) initAudio(); }, true);
  document.addEventListener('click', () => { if (audioCtx) initAudio(); }, true);
});
