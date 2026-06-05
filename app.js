// Matter.js モジュールのショートカット
const { Engine, Render, Runner, Bodies, Composite, Body, Events, Vector, Constraint } = Matter;

// グローバル変数
let engine;
let render;
let runner;
let audioCtx = null;
let currentMode = '3-5';      // '3-5', '6-8', '9-10'
let currentStage = 1;         // 6-8歳パズルモード用
let currentShape = 'circle';   // 選択中の配置オブジェクト
let currentSubCategory = 'shape'; // 9-10歳のサブカテゴリ ('shape', 'gimmick', 'music')
let isGameActive = false;
let isGuideOn = true;         // 9-10歳ガイド表示
let ballTimer = null;         // ボール自動落下タイマー
let selectedNoteBlock = null; // ピアノ鍵盤で編集中の音符ブロック
let activeBalls = [];         // 画面内に蓄積されているボールの追跡配列
let isDebugVisible = false;    // デバッグログパネルの表示状態
let lastFpsUpdateTime = 0;     // FPS更新用の最終時間
let frameCount = 0;            // FPSカウント用フレーム数
let currentFps = 60;           // 現在のFPS値
let debugLogs = [];            // デバッグログ履歴

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
    start: { x: 0.15, y: 0.25 },
    goal: { x: 0.85, y: 0.25 },
    obstacles: [
      { x: 0.5, y: 0.6, w: 30, h: 420, type: 'obstacle' }
    ]
  }
];

// 操作用変数
let draggedBody = null;
let dragOffset = { x: 0, y: 0 };
let lastTapTime = 0;
let pressTimer = null;
let blockRadius = 35;
let goalSensor = null;
let startSpawner = null;

// 衝突フィルタカテゴリ
const defaultCategory = 0x0001;
const particleCategory = 0x0002;
const gearCategory = 0x0004; // 歯車同士の物理衝突をオフにするためのカテゴリ

// -------------------------------------------------------------
// 0. デバッグログシステム
// -------------------------------------------------------------
function logDebug(text) {
  const now = new Date();
  const timeStr = now.toTimeString().split(' ')[0] + '.' + String(now.getMilliseconds()).padStart(3, '0');
  const logMsg = `[${timeStr}] ${text}`;
  
  debugLogs.unshift(logMsg); // 配列の先頭に追加
  if (debugLogs.length > 20) {
    debugLogs.pop(); // 最大20件
  }
  
  const logListEl = document.getElementById('debug-log-list');
  if (logListEl) {
    logListEl.innerHTML = debugLogs.map(log => `<div class="debug-log-item">${log}</div>`).join('');
  }
  console.log(logMsg);
}

function toggleDebugPanel(forceState) {
  if (forceState !== undefined) {
    isDebugVisible = forceState;
  } else {
    isDebugVisible = !isDebugVisible;
  }
  
  const panel = document.getElementById('debug-panel');
  if (panel) {
    if (isDebugVisible) {
      panel.classList.remove('hidden');
    } else {
      panel.classList.add('hidden');
    }
  }

  // 9-10歳モード用調整パネルのトグルボタンの見た目を同期
  const btn910 = document.getElementById('btn-toggle-debug-910');
  if (btn910) {
    if (isDebugVisible) {
      btn910.classList.add('active');
      btn910.innerText = 'デバッグ: ON';
    } else {
      btn910.classList.remove('active');
      btn910.innerText = 'デバッグ: OFF';
    }
  }

  // フローティングボタンの見た目を同期
  const btnFloat = document.getElementById('btn-debug-float');
  if (btnFloat) {
    if (isDebugVisible) {
      btnFloat.style.background = '#ffd166';
      btnFloat.style.borderColor = '#ffd166';
    } else {
      btnFloat.style.background = 'rgba(255, 255, 255, 0.85)';
      btnFloat.style.borderColor = '#e2dcd0';
    }
  }
}

// -------------------------------------------------------------
// 1. サウンドシステム（Web Audio API & ドラムシンセサイザー）
// -------------------------------------------------------------
function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
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
  gain1.connect(audioCtx.destination);
  
  osc2.connect(gain2);
  gain2.connect(audioCtx.destination);

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
    gain.connect(audioCtx.destination);
    
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
    gain.connect(audioCtx.destination);
    
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
    enableSleeping: false // スリープによるめり込み・一斉落下（ウエイクアップ時のすり抜け）を防ぐため無効化
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

  // タイムステップを固定化（isFixed: true）し、処理が重くなった際もすり抜けワープを完全に防止する
  runner = Runner.create({
    isFixed: true,
    delta: 1000 / 60
  });
  Runner.run(runner, engine);

  createWalls();

  window.addEventListener('resize', handleResize);
  setupCollisionHandler();
  setupCustomRenderer(); // Canvasカスタムテキスト描画

  Events.on(engine, 'beforeUpdate', updateLoop);
  Events.on(engine, 'collisionActive', handleActivePhysics);
}

function createWalls() {
  const container = document.getElementById('game-container');
  const width = container.clientWidth;
  const height = container.clientHeight;
  const wallThickness = 60;

  const leftWall = Bodies.rectangle(
    -wallThickness / 2,
    height / 2,
    wallThickness,
    height * 2,
    { isStatic: true, label: 'wall', render: { fillStyle: COLORS.walls } }
  );
  const rightWall = Bodies.rectangle(
    width + wallThickness / 2,
    height / 2,
    wallThickness,
    height * 2,
    { isStatic: true, label: 'wall', render: { fillStyle: COLORS.walls } }
  );

  Composite.add(engine.world, [leftWall, rightWall]);
}

// -------------------------------------------------------------
// 3. モード切替制御とテンポ変更
// -------------------------------------------------------------
function switchMode(mode) {
  currentMode = mode;
  logDebug(`【モード切替】${mode} 歳向けへ`);
  closePiano();

  // タイマーの停止
  stopBallTimer();

  // 物理世界クリアと壁再構築
  activeBalls = []; // ボール管理配列もリセット
  Composite.clear(engine.world, false);
  createWalls();

  // モードUI表示切り替え
  document.querySelectorAll('.mode-ui').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.age-tab').forEach(el => el.classList.remove('active'));
  document.querySelector(`.age-tab[data-mode="${mode}"]`).classList.add('active');

  if (mode === '3-5') {
    document.getElementById('tools-3-5').classList.remove('hidden');
    currentShape = 'circle';
    updateActiveToolButton();
    startBallTimer(1800); // 1.8秒ごと
  } 
  else if (mode === '6-8') {
    document.getElementById('tools-6-8').classList.remove('hidden');
    document.getElementById('stage-selector').classList.remove('hidden');
    currentShape = 'slope';
    updateActiveToolButton();
    loadStage(currentStage);
    startBallTimer(4000); // パズル用に4秒ごと
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
    const bpm = parseInt(document.getElementById('slider-bpm').value);
    const interval = (60 / bpm) * 1000 * 2; // 2拍ごと
    startBallTimer(interval);
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

  const container = document.getElementById('game-container');
  const width = container.clientWidth;
  const height = container.clientHeight;
  const stage = STAGE_DATA[stageNum - 1];

  // 🚀 スタート射出口
  const startX = width * stage.start.x;
  const startY = height * stage.start.y;
  startSpawner = Bodies.rectangle(startX, startY, 65, 15, {
    isStatic: true,
    label: 'startSpawn',
    render: { fillStyle: '#b39ddb', chamfer: { radius: 5 } }
  });
  Composite.add(engine.world, startSpawner);

  // ⭐ ゴール星
  const goalX = width * stage.goal.x;
  const goalY = height * stage.goal.y;
  goalSensor = Bodies.circle(goalX, goalY, 25, {
    isStatic: true,
    isSensor: true,
    label: 'goalSensor',
    render: {
      fillStyle: 'transparent',
      strokeStyle: '#ffd166',
      lineWidth: 3
    }
  });
  Composite.add(engine.world, goalSensor);

  // 固定障害物
  stage.obstacles.forEach(obs => {
    let obstacle;
    const obsX = width * obs.x;
    const obsY = height * obs.y;

    if (obs.type === 'triangle_obstacle') {
      obstacle = Bodies.polygon(obsX, obsY, 3, obs.w / 2, {
        isStatic: true,
        label: 'obstacle',
        angle: Math.PI,
        render: { fillStyle: '#e2dcd0' }
      });
    } else {
      obstacle = Bodies.rectangle(obsX, obsY, obs.w, obs.h, {
        isStatic: true,
        label: 'obstacle',
        render: { fillStyle: '#e2dcd0', chamfer: { radius: 8 } }
      });
    }
    Composite.add(engine.world, obstacle);
  });
}

function handleStageClear() {
  if (document.getElementById('clear-modal').classList.contains('hidden')) {
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
  left = Math.max(10, Math.min(left, width - 330));
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
    startY = startSpawner.position.y - 25;
  } else {
    startX = width / 2 + (Math.random() - 0.5) * (width * 0.4);
    startY = -20;
  }

  const radius = 12 + Math.random() * 5;
  const randomColor = COLORS.balls[Math.floor(Math.random() * COLORS.balls.length)];

  const ball = Bodies.circle(startX, startY, radius, {
    restitution: 0.4, // 反発を抑えて山積みを安定化（すり抜けを防止）
    friction: 0.05,    // 少し摩擦を増やして滑り落ちにくくする
    collisionFilter: {
      category: defaultCategory,
      mask: defaultCategory | gearCategory // ボールは壁、通常ブロック、はぐるま全てと衝突する
    },
    render: { fillStyle: randomColor },
    label: 'ball'
  });

  // 画面内のボール最大数を120個に制限し、最古のボールを順次消去する
  activeBalls.push(ball);
  logDebug(`【ボール追加】サイズ: ${Math.round(radius)}px, 配列ボール数: ${activeBalls.length}個`);

  if (activeBalls.length > 120) {
    const oldestBall = activeBalls.shift();
    // すでに画面外で消滅していないか確認して物理世界から削除
    if (Composite.allBodies(engine.world).includes(oldestBall)) {
      Composite.remove(engine.world, oldestBall);
      logDebug(`【上限消去】120個を超えたため最古ボールを物理世界から削除しました`);
    } else {
      logDebug(`【上限消去】120個を超えたため最古ボールを配列から削除しました（すでに消滅済み）`);
    }
  }

  Composite.add(engine.world, ball);
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
      logDebug(`【ゴール到達】ボールがゴールに入りました！ステージクリア`);
      handleStageClear();
      Composite.remove(engine.world, ball);
      const index = activeBalls.indexOf(ball);
      if (index > -1) activeBalls.splice(index, 1);
      return;
    }

    // ③ ブロック衝突発音
    if (target.label === 'block') {
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
        const toneIndex = Math.floor(ratio * TONES.length);
        freq = TONES[toneIndex];
        
        // ジャンプ台（バウンサー）のインパルス適用
        if (target.blockType === 'bouncer') {
          Body.setVelocity(ball, { x: ball.velocity.x * 1.2, y: -9.5 });
          freq = 659.25; // ミの音
        }
        playTone(freq, Math.min(Vector.magnitude(ball.velocity) / 8, 1.0));
      }

      // 衝突エフェクトの発生
      const contact = pair.activeContacts ? pair.activeContacts[0] : null;
      const contactPos = contact ? contact.vertex : ball.position;
      createSparkles(contactPos.x, contactPos.y, color);

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
  const width = container.clientWidth;

  // --- 自己修復同期ロジック ---
  // 物理世界に実在しないボールを activeBalls から除外
  activeBalls = activeBalls.filter(ball => bodies.includes(ball));

  // --- FPS計測 ＆ デバッグHUD定期更新 ---
  frameCount++;
  const now = performance.now();
  if (now - lastFpsUpdateTime >= 200) { // 200msごとに更新
    currentFps = Math.round((frameCount * 1000) / (now - lastFpsUpdateTime));
    frameCount = 0;
    lastFpsUpdateTime = now;

    // デバッグHUDの表示更新（パネルが表示されている場合のみ）
    if (isDebugVisible) {
      const activeBallCount = activeBalls.length;
      const worldBallCount = bodies.filter(b => b.label === 'ball').length;
      const sleepingBallCount = bodies.filter(b => b.label === 'ball' && b.isSleeping).length;

      const debugModeEl = document.getElementById('debug-mode');
      const debugArrBallsEl = document.getElementById('debug-arr-balls');
      const debugWorldBallsEl = document.getElementById('debug-world-balls');
      const debugSleepBallsEl = document.getElementById('debug-sleep-balls');
      const debugFpsEl = document.getElementById('debug-fps');

      if (debugModeEl) debugModeEl.innerText = currentMode;
      if (debugArrBallsEl) debugArrBallsEl.innerText = activeBallCount;
      if (debugWorldBallsEl) debugWorldBallsEl.innerText = worldBallCount;
      if (debugSleepBallsEl) debugSleepBallsEl.innerText = sleepingBallCount;
      if (debugFpsEl) debugFpsEl.innerText = currentFps;
    }
  }

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
    // Y方向の落下（height + 60）、X方向の左右はみ出し（<-100 または >width + 100）、上方向の吹き飛び（<-200）を検知
    if (body.label === 'ball' && (body.position.y > height + 60 || body.position.x < -100 || body.position.x > width + 100 || body.position.y < -200)) {
      Composite.remove(engine.world, body);
      const index = activeBalls.indexOf(body);
      if (index > -1) {
        activeBalls.splice(index, 1);
      }
      logDebug(`【画面外消去】位置: (${Math.round(body.position.x)}, ${Math.round(body.position.y)})`);
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
    closePiano(); // Canvas上をタッチしたらピアノを一旦閉じる

    const coords = getEventCoords(e);
    const bodies = Composite.allBodies(engine.world);

    // ブロックボディをタップしたか検出
    const clickedBody = Matter.Query.point(bodies, coords).find(body => body.label === 'block');

    // ① 長押し（600ms）による削除処理
    if (clickedBody) {
      pressTimer = setTimeout(() => {
        const type = clickedBody.blockType || '通常ブロック';
        Composite.remove(engine.world, clickedBody);
        
        // ギアの場合はConstraint（ピン留め）も削除
        if (clickedBody.blockType === 'gear' || clickedBody.blockType === 'motor-gear') {
          const constraints = Composite.allConstraints(engine.world);
          constraints.forEach(c => {
            if (c.bodyB === clickedBody) Composite.remove(engine.world, c);
          });
        }
        logDebug(`【ブロック削除】長押し消去: ${type}`);
        playTone(150, 0.2); // 消去音
        draggedBody = null;
      }, 600);
    }

    // ② ダブルタップ検知（45度回転、またはドラム切替）
    const now = Date.now();
    if (clickedBody) {
      if (now - lastTapTime < 280) {
        clearTimeout(pressTimer); // 長押しキャンセルの同期
        
        if (clickedBody.blockType === 'slope' || clickedBody.blockType === 'conveyor') {
          // 45度回転
          Body.setAngle(clickedBody, clickedBody.angle + Math.PI / 4);
          logDebug(`【ブロック回転】${clickedBody.blockType}: 角度: ${Math.round(clickedBody.angle * (180 / Math.PI))}度`);
          playTone(440, 0.4);
        } 
        else if (clickedBody.blockType === 'drum') {
          // ドラムの種類を切り替え (bass ➔ snare)
          clickedBody.drumType = clickedBody.drumType === 'bass' ? 'snare' : 'bass';
          clickedBody.render.fillStyle = clickedBody.drumType === 'bass' ? '#ffc6ff' : '#caffbf';
          logDebug(`【ドラム切替】種類: ${clickedBody.drumType}`);
          playDrum(clickedBody.drumType, 0.5);
        }
        else if (clickedBody.blockType === 'note') {
          // おんぷブロックの場合：ピアノキーボードをトグル表示
          logDebug(`【ピアノ表示】おんぷブロック音階選択`);
          openPiano(clickedBody, coords);
        }
        else {
          // 回転や切替がない形状は即削除
          Composite.remove(engine.world, clickedBody);
          logDebug(`【ブロック削除】ダブルタップ消去: ${clickedBody.blockType || '通常ブロック'}`);
          playTone(150, 0.2);
        }
        
        draggedBody = null;
        lastTapTime = 0;
        return;
      }
      lastTapTime = now;
    }

    if (clickedBody) {
      // はぐるま/モーターギアはドラッグ固定にする
      if (clickedBody.blockType !== 'gear' && clickedBody.blockType !== 'motor-gear') {
        draggedBody = clickedBody;
        dragOffset.x = coords.x - clickedBody.position.x;
        dragOffset.y = coords.y - clickedBody.position.y;
      } else if (clickedBody.blockType === 'note') {
        // おんぷブロックのシングルタップ：ピアノキーボードを表示
        openPiano(clickedBody, coords);
      }
    } else {
      // 何もない場所をタップ：新規配置
      createBlock(coords.x, coords.y);
      lastTapTime = now;
    }
  }

  function handleMove(e) {
    if (pressTimer) clearTimeout(pressTimer);
    if (!draggedBody) return;
    e.preventDefault();

    const coords = getEventCoords(e);
    Body.setPosition(draggedBody, {
      x: coords.x - dragOffset.x,
      y: coords.y - dragOffset.y
    });
  }

  function handleEnd(e) {
    if (pressTimer) clearTimeout(pressTimer);
    draggedBody = null;
  }

  container.addEventListener('mousedown', handleStart);
  container.addEventListener('mousemove', handleMove);
  window.addEventListener('mouseup', handleEnd);

  container.addEventListener('touchstart', handleStart, { passive: false });
  container.addEventListener('touchmove', handleMove, { passive: false });
  window.addEventListener('touchend', handleEnd);
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
    block = Bodies.circle(x, y, blockRadius - 5, {
      ...options,
      blockType: 'bouncer',
      restitution: 1.6,
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
    logDebug(`【ブロック配置】はぐるま: (${Math.round(x)}, ${Math.round(y)})`);
    playTone(392.00, 0.4);
    return;
  } else if (currentShape === 'motor-gear') {
    createGear(x, y, true);
    logDebug(`【ブロック配置】モーターギア: (${Math.round(x)}, ${Math.round(y)})`);
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

  logDebug(`【ブロック配置】${currentShape}: (${Math.round(x)}, ${Math.round(y)})`);
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

      // ③ ジャンプ台の★マーク
      if (body.label === 'block' && body.blockType === 'bouncer') {
        ctx.fillStyle = "white";
        ctx.font = "bold 18px 'M PLUS Rounded 1c', sans-serif";
        ctx.fillText("★", body.position.x, body.position.y);
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
    logDebug(`【全クリア】画面上のオブジェクトとボールをすべてクリアしました`);
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
    if (nextStage > 3) nextStage = 1;
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
    // テンポに合わせて落下間隔をミリ秒へマッピング (2拍ごと)
    const interval = (60 / bpm) * 1000 * 2;
    startBallTimer(interval);
  });

  // 9-10歳：ガイド切り替え
  const btnToggleGuide = document.getElementById('btn-toggle-guide');
  btnToggleGuide.addEventListener('click', () => {
    isGuideOn = !isGuideOn;
    btnToggleGuide.classList.toggle('active');
    btnToggleGuide.innerText = isGuideOn ? 'ガイド: ON' : 'ガイド: OFF';
    playTone(440, 0.3);
  });

  // デバッグ表示切り替えイベント
  const btnDebugFloat = document.getElementById('btn-debug-float');
  if (btnDebugFloat) {
    btnDebugFloat.addEventListener('click', () => {
      toggleDebugPanel();
      playTone(523.25, 0.3);
    });
  }

  const btnToggleDebug910 = document.getElementById('btn-toggle-debug-910');
  if (btnToggleDebug910) {
    btnToggleDebug910.addEventListener('click', () => {
      toggleDebugPanel();
      playTone(523.25, 0.3);
    });
  }

  const btnCloseDebug = document.getElementById('btn-close-debug');
  if (btnCloseDebug) {
    btnCloseDebug.addEventListener('click', () => {
      toggleDebugPanel(false);
      playTone(440, 0.3);
    });
  }
}

// 物理エンジンサイズのリサイズ処理
function handleResize() {
  const container = document.getElementById('game-container');
  if (!container || !render) return;

  const width = container.clientWidth;
  const height = container.clientHeight;

  render.canvas.width = width;
  render.canvas.height = height;
  render.options.width = width;
  render.options.height = height;

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

  if (currentMode === '6-8' && startSpawner && goalSensor) {
    loadStage(currentStage);
  }
}

// 起動処理
document.addEventListener('DOMContentLoaded', () => {
  setupUI();
});
