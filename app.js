// Matter.js モジュールのショートカット
const { Engine, Render, Runner, Bodies, Composite, Body, Events, Vector, Constraint } = Matter;

// グローバル変数
let engine;
let render;
let runner;
let audioCtx = null;
let currentMode = '3-5'; // '3-5', '6-8', '9-10'
let currentStage = 1;    // 6-8歳パズルモード用
let currentShape = 'circle'; // 選択中の配置オブジェクト
let isGameActive = false;
let isGuideOn = true;    // 9-10歳ガイド表示フラグ
let ballTimer = null;    // ボール自動落下タイマー

// 音色・色設定
const COLORS = {
  bg: '#f7f3e9',
  circle: '#ff6f61',      // パステルレッド
  triangle: '#4ea8de',    // パステルブルー
  square: '#ffd166',      // パステルイエロー
  slope: '#a0c4ff',       // パステルブルー（坂道）
  bouncer: '#ffadad',     // パステルピンク（ジャンプ台）
  conveyor: '#caffbf',    // パステルグリーン（ベルトコンベア）
  note: '#b39ddb',        // パステルパープル
  gear: '#a8dadc',        // パステルシアン
  walls: '#e2dcd0',
  balls: ['#ffadad', '#ffd6a5', '#fdffb6', '#caffbf', '#9bf6ff', '#a0c4ff', '#bdb2ff', '#ffc6ff']
};

// 3-5歳モード等の衝突音高用（C3〜A5ペンタトニックスケール）
const TONES = [
  130.81, 146.83, 164.81, 196.00, 220.00,
  261.63, 293.66, 329.63, 392.00, 440.00,
  523.25, 587.33, 659.25, 783.99, 880.00
];

// 9-10歳おんぷブロック用（ドレミソラド）
const NOTE_TONES = [
  { name: 'ド', freq: 261.63, color: '#ff6f61' }, // C4
  { name: 'レ', freq: 293.66, color: '#f77f00' }, // D4
  { name: 'ミ', freq: 329.63, color: '#ffd166' }, // E4
  { name: 'ソ', freq: 392.00, color: '#06d6a0' }, // G4
  { name: 'ラ', freq: 440.00, color: '#118ab2' }, // A4
  { name: 'ど', freq: 523.25, color: '#8338ec' }  // C5
];

// 6-8歳パズルモード用ステージデータ（画面比率で座標を定義）
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
    goal: { x: 0.5, y: 0.8 },
    obstacles: [
      { x: 0.5, y: 0.45, w: 100, h: 100, type: 'triangle_obstacle' } // 中央の三角障害物
    ]
  },
  {
    start: { x: 0.15, y: 0.25 },
    goal: { x: 0.85, y: 0.25 },
    obstacles: [
      { x: 0.5, y: 0.6, w: 30, h: 400, type: 'obstacle' } // 中央を遮る縦の壁
    ]
  }
];

// 操作用変数
let draggedBody = null;
let dragOffset = { x: 0, y: 0 };
let lastTapTime = 0;
let pressTimer = null; // 長押し削除用
let blockRadius = 35;  // 基準ブロック半径
let goalSensor = null;
let startSpawner = null;
const defaultCategory = 0x0001;
const particleCategory = 0x0002;

// -------------------------------------------------------------
// 1. サウンドシステム（Web Audio API）
// -------------------------------------------------------------
function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

// 鉄琴風シンセサイズ音再生
function playTone(freq, velocity = 0.5) {
  if (!audioCtx) return;

  const now = audioCtx.currentTime;
  
  // 基本音（三角波）
  const osc1 = audioCtx.createOscillator();
  const gain1 = audioCtx.createGain();
  osc1.type = 'triangle';
  osc1.frequency.value = freq;
  
  // 金属的なアタック音（サイン波高周波倍音）
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

// -------------------------------------------------------------
// 2. 物理エンジンセットアップ
// -------------------------------------------------------------
function initPhysics() {
  const container = document.getElementById('game-container');
  const width = container.clientWidth;
  const height = container.clientHeight;

  engine = Engine.create({
    gravity: { y: 0.6 }
  });

  render = Render.create({
    element: container,
    engine: engine,
    options: {
      width: width,
      height: height,
      wireframes: false,
      background: 'transparent',
      pixelRatio: window.devicePixelRatio || 1
    }
  });

  Render.run(render);

  runner = Runner.create();
  Runner.run(runner, engine);

  createWalls();

  window.addEventListener('resize', handleResize);
  setupCollisionHandler();
  setupCustomRenderer(); // Canvas上のテキスト等描画用

  Events.on(engine, 'beforeUpdate', updateLoop);
  Events.on(engine, 'collisionActive', handleConveyorBeltPhysics);
}

// 壁の作成（左右のみ）
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
// 3. モード切替制御
// -------------------------------------------------------------
function switchMode(mode) {
  currentMode = mode;
  
  // タイマー停止
  if (ballTimer) {
    clearInterval(ballTimer);
    ballTimer = null;
  }

  // 物理世界のリセット（壁も含めて一掃し、壁を再作成）
  Composite.clear(engine.world, false);
  createWalls();

  // モードUIの表示非表示切り替え
  document.querySelectorAll('.mode-ui').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.age-tab').forEach(el => el.classList.remove('active'));
  document.querySelector(`.age-tab[data-mode="${mode}"]`).classList.add('active');

  // 各モードのセットアップ
  if (mode === '3-5') {
    document.getElementById('tools-3-5').classList.remove('hidden');
    currentShape = 'circle';
    updateActiveToolButton();
    
    // ボール自動落下始動 (1.8秒ごと)
    ballTimer = setInterval(dropBall, 1800);
  } 
  else if (mode === '6-8') {
    document.getElementById('tools-6-8').classList.remove('hidden');
    document.getElementById('stage-selector').classList.remove('hidden');
    currentShape = 'slope';
    updateActiveToolButton();
    
    // ステージ読み込み
    loadStage(currentStage);
    
    // パズルを妨げないようにゆっくり自動落下 (4秒ごと)
    ballTimer = setInterval(dropBall, 4000);
  } 
  else if (mode === '9-10') {
    document.getElementById('tools-9-10').classList.remove('hidden');
    document.getElementById('physics-panel').classList.remove('hidden');
    currentShape = 'note';
    updateActiveToolButton();
    
    // スライダーの値と同期
    applyPhysicsSliders();
    
    // 自動落下 (2秒ごと)
    ballTimer = setInterval(dropBall, 2000);
  }

  // モード切替のチャイム音
  playTone(329.63, 0.4); // ミ
  setTimeout(() => playTone(392.00, 0.4), 100); // ソ
}

function updateActiveToolButton() {
  const currentToolsId = `tools-${currentMode}`;
  document.querySelectorAll(`#${currentToolsId} .tool-btn`).forEach(btn => {
    btn.classList.remove('active');
    if (btn.dataset.shape === currentShape) {
      btn.classList.add('active');
    }
  });
}

// -------------------------------------------------------------
// 4. 6-8歳パズルモードの実装
// -------------------------------------------------------------
function loadStage(stageNum) {
  currentStage = stageNum;
  
  // 壁以外のブロック・ゴールなどを一斉削除
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

  // 1. スタート発射台（ボールはここから生まれる）
  const startX = width * stage.start.x;
  const startY = height * stage.start.y;
  startSpawner = Bodies.rectangle(startX, startY, 65, 15, {
    isStatic: true,
    label: 'startSpawn',
    render: { fillStyle: '#b39ddb', chamfer: { radius: 5 } }
  });
  Composite.add(engine.world, startSpawner);

  // 2. ゴール（星センサー）
  const goalX = width * stage.goal.x;
  const goalY = height * stage.goal.y;
  goalSensor = Bodies.circle(goalX, goalY, 25, {
    isStatic: true,
    isSensor: true, // 衝突はするが跳ね返らない
    label: 'goalSensor',
    render: {
      fillStyle: 'transparent',
      strokeStyle: '#ffd166',
      lineWidth: 3
    }
  });
  Composite.add(engine.world, goalSensor);

  // 3. 固定障害物の配置
  stage.obstacles.forEach(obs => {
    let obstacle;
    const obsX = width * obs.x;
    const obsY = height * obs.y;

    if (obs.type === 'triangle_obstacle') {
      obstacle = Bodies.polygon(obsX, obsY, 3, obs.w / 2, {
        isStatic: true,
        label: 'obstacle',
        angle: Math.PI, // 下向きの三角にする
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

// パズルクリア処理
function handleStageClear() {
  if (document.getElementById('clear-modal').classList.contains('hidden')) {
    document.getElementById('clear-modal').classList.remove('hidden');
    // クリアお祝い音（ファンファーレ風）
    playTone(523.25, 0.5); // ド
    setTimeout(() => playTone(659.25, 0.5), 120); // ミ
    setTimeout(() => playTone(783.99, 0.5), 240); // ソ
    setTimeout(() => playTone(1046.50, 0.6), 360); // 高いド
  }
}

// -------------------------------------------------------------
// 5. 9-10歳物理・作曲モード
// -------------------------------------------------------------
function applyPhysicsSliders() {
  if (currentMode !== '9-10') return;

  const gravVal = parseFloat(document.getElementById('slider-gravity').value);
  const fricVal = parseFloat(document.getElementById('slider-friction').value);

  // 重力の適用
  engine.gravity.y = gravVal;
  document.getElementById('val-gravity').innerText = gravVal.toFixed(1);
  document.getElementById('val-friction').innerText = fricVal.toFixed(2);

  // 摩擦力の適用（世界の中のブロック全て）
  const bodies = Composite.allBodies(engine.world);
  bodies.forEach(body => {
    if (body.label === 'block') {
      Body.set(body, 'friction', fricVal);
    }
  });
}

// 十字はぐるま（水車）ギミックの作成
function createGear(x, y) {
  const width = 110;
  const height = 14;

  const partA = Bodies.rectangle(x, y, width, height, {
    render: { fillStyle: COLORS.gear, chamfer: { radius: 4 } }
  });
  const partB = Bodies.rectangle(x, y, height, width, {
    render: { fillStyle: COLORS.gear, chamfer: { radius: 4 } }
  });

  const gearBody = Body.create({
    parts: [partA, partB],
    label: 'block',
    blockType: 'gear',
    frictionAir: 0.015
  });

  // 中心をピン留めするConstraint
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

// -------------------------------------------------------------
// 6. ボール落下・衝突・物理ループ
// -------------------------------------------------------------
function dropBall() {
  if (!isGameActive) return;

  const container = document.getElementById('game-container');
  const width = container.clientWidth;
  
  let startX, startY;

  if (currentMode === '6-8' && startSpawner) {
    // パズルモード時は発射台のすぐ上から落とす
    startX = startSpawner.position.x;
    startY = startSpawner.position.y - 25;
  } else {
    // それ以外のモードは画面上部からランダム
    startX = width / 2 + (Math.random() - 0.5) * (width * 0.4);
    startY = -20;
  }

  const radius = 12 + Math.random() * 5;
  const randomColor = COLORS.balls[Math.floor(Math.random() * COLORS.balls.length)];

  const ball = Bodies.circle(startX, startY, radius, {
    restitution: 0.85,
    friction: 0.02,
    collisionFilter: {
      category: defaultCategory,
      mask: defaultCategory
    },
    render: { fillStyle: randomColor },
    label: 'ball'
  });

  Composite.add(engine.world, ball);
}

// ベルトコンベア床の物理（乗っているボールを加速）
function handleConveyorBeltPhysics(event) {
  event.pairs.forEach(pair => {
    const bodyA = pair.bodyA;
    const bodyB = pair.bodyB;
    const isBallA = bodyA.label === 'ball';
    const isBallB = bodyB.label === 'ball';

    if (isBallA || isBallB) {
      const ball = isBallA ? bodyA : bodyB;
      const block = isBallA ? bodyB : bodyA;

      if (block.blockType === 'conveyor') {
        // 右方向への搬送速度を上書き
        Body.setVelocity(ball, { x: 3.5, y: ball.velocity.y });
      }
    }
  });
}

// 衝突検知（音とエフェクト）
function setupCollisionHandler() {
  Events.on(engine, 'collisionStart', (event) => {
    event.pairs.forEach((pair) => {
      const bodyA = pair.bodyA;
      const bodyB = pair.bodyB;

      const isBallA = bodyA.label === 'ball';
      const isBallB = bodyB.label === 'ball';

      if (isBallA || isBallB) {
        const ball = isBallA ? bodyA : bodyB;
        const target = isBallA ? bodyB : bodyA;

        // 6-8歳パズルモード：ゴール到達判定
        if (currentMode === '6-8' && target === goalSensor) {
          handleStageClear();
          Composite.remove(engine.world, ball);
          return;
        }

        // ブロック衝突音
        if (target.label === 'block') {
          let freq;
          let color = target.render.fillStyle;

          if (target.blockType === 'note') {
            // おんぷブロックの場合：ブロックが持つ特定の音階
            const note = NOTE_TONES[target.toneIndex];
            freq = note.freq;
            color = note.color;
          } else {
            // 通常ブロック：X座標によるマッピング音
            const containerWidth = document.getElementById('game-container').clientWidth;
            const ratio = Math.min(Math.max(ball.position.x / containerWidth, 0), 1);
            const toneIndex = Math.floor(ratio * TONES.length);
            freq = TONES[toneIndex];
          }

          // ジャンプ台（バウンサー）に当たったら、ボールに上方向のインパルスを与える
          if (target.blockType === 'bouncer') {
            Body.setVelocity(ball, { x: ball.velocity.x * 1.2, y: -9.5 });
            freq = 659.25; // ジャンプ時は少し高めのミの音で固定
          }

          const speed = Vector.magnitude(ball.velocity);
          const velocity = Math.min(speed / 8, 1.0);
          playTone(freq, velocity);

          // パーティクル発生
          const contact = pair.activeContacts ? pair.activeContacts[0] : null;
          const contactPos = contact ? contact.vertex : ball.position;
          createSparkles(contactPos.x, contactPos.y, color);

          // ブロック振動エフェクト
          if (target.blockType !== 'gear') {
            Body.applyForce(target, target.position, {
              x: (Math.random() - 0.5) * 0.05,
              y: 0.02
            });
          }
        }
      }
    });
  });
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

// 毎フレームの更新ループ
function updateLoop() {
  const bodies = Composite.allBodies(engine.world);
  const container = document.getElementById('game-container');
  const height = container.clientHeight;

  bodies.forEach((body) => {
    // 画面外ボールの削除
    if (body.label === 'ball' && body.position.y > height + 60) {
      Composite.remove(engine.world, body);
    }

    // パーティクルのフェードアウト
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
    if (e.target.closest('#control-panel') || e.target.closest('#age-selector') || e.target.closest('#stage-selector') || e.target.closest('#physics-panel')) return;
    e.preventDefault();

    const coords = getEventCoords(e);
    const bodies = Composite.allBodies(engine.world);

    // タップ位置のオブジェクト検出
    const clickedBody = Matter.Query.point(bodies, coords).find(body => body.label === 'block');

    // 長押し削除用タイマー起動 (500ms長押しで削除)
    if (clickedBody) {
      pressTimer = setTimeout(() => {
        Composite.remove(engine.world, clickedBody);
        // はぐるまの場合は紐づくConstraintも削除
        if (clickedBody.blockType === 'gear') {
          const constraints = Composite.allConstraints(engine.world);
          constraints.forEach(c => {
            if (c.bodyB === clickedBody) Composite.remove(engine.world, c);
          });
        }
        playTone(150, 0.2); // 消滅音
        draggedBody = null;
      }, 600);
    }

    // ダブルタップ検知
    const now = Date.now();
    if (clickedBody) {
      if (now - lastTapTime < 280) {
        clearTimeout(pressTimer); // 長押しタイマーをキャンセル
        
        // ダブルタップアクション：ブロック回転、またはおんぷ切替
        if (clickedBody.blockType === 'slope' || clickedBody.blockType === 'conveyor') {
          // 45度ずつ回転
          Body.setAngle(clickedBody, clickedBody.angle + Math.PI / 4);
          playTone(440, 0.4);
        } else if (clickedBody.blockType === 'note') {
          // おんぷブロックの音階を切り替え
          clickedBody.toneIndex = (clickedBody.toneIndex + 1) % NOTE_TONES.length;
          clickedBody.render.fillStyle = NOTE_TONES[clickedBody.toneIndex].color;
          playTone(NOTE_TONES[clickedBody.toneIndex].freq, 0.5);
        } else {
          // 回転しても意味がない物（丸等）は即削除
          Composite.remove(engine.world, clickedBody);
          playTone(150, 0.2);
        }
        
        draggedBody = null;
        lastTapTime = 0;
        return;
      }
      lastTapTime = now;
    }

    if (clickedBody) {
      // ギアはドラッグ不可にする（Constraintで固定されているため）
      if (clickedBody.blockType !== 'gear') {
        draggedBody = clickedBody;
        dragOffset.x = coords.x - clickedBody.position.x;
        dragOffset.y = coords.y - clickedBody.position.y;
      }
    } else {
      // 空き地をタップした場合は新規配置
      createBlock(coords.x, coords.y);
      lastTapTime = now;
    }
  }

  function handleMove(e) {
    if (pressTimer) clearTimeout(pressTimer); // 動かしたら長押しキャンセル
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

// 新規ブロック生成
function createBlock(x, y) {
  let block;
  const options = {
    isStatic: true,
    label: 'block',
    friction: parseFloat(document.getElementById('slider-friction').value) || 0.1
  };

  // 1. 3〜5さい用おもちゃ
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
  // 2. 6〜8さい用パズルギミック
  else if (currentShape === 'slope') {
    block = Bodies.rectangle(x, y, 120, 18, {
      ...options,
      blockType: 'slope',
      angle: -Math.PI / 8, // 初期設定で少し傾ける
      render: { fillStyle: COLORS.slope, chamfer: { radius: 4 } }
    });
  } else if (currentShape === 'bouncer') {
    block = Bodies.circle(x, y, blockRadius - 5, {
      ...options,
      blockType: 'bouncer',
      restitution: 1.6, // 超反発
      render: {
        fillStyle: COLORS.bouncer,
        strokeStyle: '#ffffff',
        lineWidth: 3
      }
    });
  } else if (currentShape === 'conveyor') {
    block = Bodies.rectangle(x, y, 140, 20, {
      ...options,
      blockType: 'conveyor',
      render: { fillStyle: COLORS.conveyor, chamfer: { radius: 4 } }
    });
  }
  // 3. 9〜10さい用ピタゴラ作曲
  else if (currentShape === 'note') {
    block = Bodies.rectangle(x, y, 65, 36, {
      ...options,
      blockType: 'note',
      toneIndex: 0, // 初期は「ド」
      chamfer: { radius: 8 },
      render: { fillStyle: NOTE_TONES[0].color }
    });
  } else if (currentShape === 'gear') {
    createGear(x, y);
    playTone(392.00, 0.4);
    return; // 複合体とConstraint追加のためここで早期リターン
  }

  playTone(392.00, 0.4); // 配置チャイム
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
      // ① おんぷブロックの文字（「ド」「レ」など）描画
      if (body.label === 'block' && body.blockType === 'note') {
        const note = NOTE_TONES[body.toneIndex];
        ctx.fillStyle = "white";
        ctx.fillText(note.name, body.position.x, body.position.y);
      }

      // ② ジャンプ台の星マーク描画
      if (body.label === 'block' && body.blockType === 'bouncer') {
        ctx.fillStyle = "white";
        ctx.font = "bold 18px 'M PLUS Rounded 1c', sans-serif";
        ctx.fillText("★", body.position.x, body.position.y);
      }

      // ③ ベルトコンベアの矢印描画
      if (body.label === 'block' && body.blockType === 'conveyor') {
        ctx.fillStyle = "#3b8a3b";
        ctx.font = "14px 'M PLUS Rounded 1c', sans-serif";
        // 角度を適用して矢印を描く
        ctx.save();
        ctx.translate(body.position.x, body.position.y);
        ctx.rotate(body.angle);
        ctx.fillText("➔ ➔ ➔", 0, 0);
        ctx.restore();
      }

      // ④ 6-8歳：スタート発射口の装飾
      if (body.label === 'startSpawn') {
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 10px 'M PLUS Rounded 1c', sans-serif";
        ctx.fillText("★はっしゃ★", body.position.x, body.position.y);
        ctx.fillStyle = "#7d7568";
        ctx.font = "bold 12px 'M PLUS Rounded 1c', sans-serif";
        ctx.fillText("🚀 スタート", body.position.x, body.position.y - 20);
      }

      // ⑤ 6-8歳：ゴール星センサーの装飾
      if (body.label === 'goalSensor') {
        // 回転させて星を描画
        ctx.save();
        ctx.translate(body.position.x, body.position.y);
        // 現在のフレーム時間で少し回転させる
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

  // 下部コントロールの形状選択ボタン
  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const targetBtn = e.currentTarget;
      // アクティブツール切り替え
      targetBtn.parentElement.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
      targetBtn.classList.add('active');
      currentShape = targetBtn.dataset.shape;

      playTone(523.25, 0.3); // タップ音 (ド)
    });
  });

  // ボール手動落下
  document.getElementById('btn-ball-drop').addEventListener('click', () => {
    dropBall();
    playTone(587.33, 0.3); // レ
  });

  // 全部けすボタン
  document.getElementById('btn-clear').addEventListener('click', () => {
    const bodies = Composite.allBodies(engine.world);
    bodies.forEach((body) => {
      // 壁・スタート台・ゴール以外を一斉削除
      if (body.label === 'block' || body.label === 'ball' || body.label === 'particle') {
        Composite.remove(engine.world, body);
      }
    });
    // ギアのConstraintも一掃
    const constraints = Composite.allConstraints(engine.world);
    constraints.forEach(c => {
      if (c.label !== 'wall') Composite.remove(engine.world, c);
    });

    // 消去音（悲しいアルペジオ）
    if (audioCtx) {
      playTone(440, 0.3);
      setTimeout(() => playTone(330, 0.3), 100);
      setTimeout(() => playTone(220, 0.3), 200);
    }
  });

  // 6-8歳：ステージ選択
  document.querySelectorAll('.stage-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const stage = parseInt(e.currentTarget.dataset.stage);
      loadStage(stage);
      playTone(392.00, 0.3);
    });
  });

  // 6-8歳：クリア画面の「つぎのステージへ」
  document.getElementById('btn-next-stage').addEventListener('click', () => {
    document.getElementById('clear-modal').classList.add('hidden');
    let nextStage = currentStage + 1;
    if (nextStage > 3) nextStage = 1; // ループ
    loadStage(nextStage);
  });

  // 9-10歳：物理調整スライダー
  document.getElementById('slider-gravity').addEventListener('input', applyPhysicsSliders);
  document.getElementById('slider-friction').addEventListener('input', applyPhysicsSliders);

  // 9-10歳：ガイド表示切り替え
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

  render.canvas.width = width;
  render.canvas.height = height;
  render.options.width = width;
  render.options.height = height;

  // 壁の再配置
  const wallThickness = 60;
  const bodies = Composite.allBodies(engine.world);
  let wallIndex = 0;
  bodies.forEach((body) => {
    if (body.label === 'wall') {
      if (wallIndex === 0) {
        // 左
        Body.setPosition(body, { x: -wallThickness / 2, y: height / 2 });
        wallIndex++;
      } else if (wallIndex === 1) {
        // 右
        Body.setPosition(body, { x: width + wallThickness / 2, y: height / 2 });
        wallIndex++;
      }
    }
  });

  // パズルモード時はスタート・ゴールを再配置
  if (currentMode === '6-8' && startSpawner && goalSensor) {
    loadStage(currentStage);
  }
}

// 起動処理
document.addEventListener('DOMContentLoaded', () => {
  setupUI();
});
