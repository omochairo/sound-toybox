// Matter.js モジュールのショートカット
const { Engine, Render, Runner, Bodies, Composite, Body, Events, Vector } = Matter;

// グローバル変数
let engine;
let render;
let runner;
let audioCtx = null;
let currentShape = 'circle'; // デフォルトで「まる」を選択
let isGameActive = false;

// 色パレット（パステル調）
const COLORS = {
  bg: '#f7f3e9',
  circle: '#ff6f61',      // パステルレッド
  triangle: '#4ea8de',    // パステルブルー
  square: '#ffd166',      // パステルイエロー
  walls: '#e2dcd0',
  balls: ['#ffadad', '#ffd6a5', '#fdffb6', '#caffbf', '#9bf6ff', '#a0c4ff', '#bdb2ff', '#ffc6ff'] // カラフルなボール
};

// ペンタトニックスケールの周波数（C3〜A5）
const TONES = [
  130.81, 146.83, 164.81, 196.00, 220.00, // C3, D3, E3, G3, A3
  261.63, 293.66, 329.63, 392.00, 440.00, // C4, D4, E4, G4, A4
  523.25, 587.33, 659.25, 783.99, 880.00  // C5, D5, E5, G5, A5
];

// ドラッグ操作用の状態管理
let draggedBody = null;
let dragOffset = { x: 0, y: 0 };
let lastTapTime = 0; // ダブルタップ削除用
let blockRadius = 35; // スマホでタップしやすい標準的なブロックサイズ

// 衝突カテゴリ設定（パーティクルがボールやブロックに衝突しないようにする）
const defaultCategory = 0x0001;
const particleCategory = 0x0002;

// -------------------------------------------------------------
// 1. Web Audio API による音源合成
// -------------------------------------------------------------
function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

// 鉄琴風サウンドを合成して再生する関数
function playTone(freq, velocity = 0.5) {
  if (!audioCtx) return;

  const now = audioCtx.currentTime;
  
  // 1. 基本波形（三角波：柔らかい木琴・鉄琴風の響き）
  const osc1 = audioCtx.createOscillator();
  const gain1 = audioCtx.createGain();
  osc1.type = 'triangle';
  osc1.frequency.value = freq;
  
  // 2. 金属的なアタック音（サイン波・高周波非整数倍音：鉄琴の「ちーん」という金属音）
  const osc2 = audioCtx.createOscillator();
  const gain2 = audioCtx.createGain();
  osc2.type = 'sine';
  osc2.frequency.value = freq * 2.76; // 鉄琴特有の倍音比

  // 音量の減衰設定（エンベロープ）
  const volume = Math.min(Math.max(velocity, 0.1), 1.0) * 0.3; // 音量上限を制限
  
  // 基本音の減衰（ゆっくり消える）
  gain1.gain.setValueAtTime(0, now);
  gain1.gain.linearRampToValueAtTime(volume, now + 0.005);
  gain1.gain.exponentialRampToValueAtTime(0.0001, now + 0.6); // 0.6秒かけて減衰

  // 金属音の減衰（一瞬で消える）
  gain2.gain.setValueAtTime(0, now);
  gain2.gain.linearRampToValueAtTime(volume * 0.4, now + 0.002);
  gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.04); // 0.04秒で消す

  // 接続
  osc1.connect(gain1);
  gain1.connect(audioCtx.destination);
  
  osc2.connect(gain2);
  gain2.connect(audioCtx.destination);

  // 再生開始と停止
  osc1.start(now);
  osc1.stop(now + 0.7);
  
  osc2.start(now);
  osc2.stop(now + 0.1);
}

// -------------------------------------------------------------
// 2. Matter.js 物理エンジンの初期化
// -------------------------------------------------------------
function initPhysics() {
  const container = document.getElementById('game-container');
  const width = container.clientWidth;
  const height = container.clientHeight;

  // 物理エンジン作成
  engine = Engine.create({
    gravity: { y: 0.6 } // スマホ画面用に少しゆったりした重力
  });

  // レンダラー作成（透過背景でCSSの色を生かす）
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

  // ランナー作成
  runner = Runner.create();
  Runner.run(runner, engine);

  // 境界壁の作成（左右のみ。底面はボールが落ちて消えるように作らない）
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

  // レレスポンシブ対応（画面回転・サイズ変更時）
  window.addEventListener('resize', handleResize);

  // 衝突検知イベントの登録
  setupCollisionHandler();

  // 更新ループごとの処理（画面外ボールの削除、パーティクルのフェードアウト）
  Events.on(engine, 'beforeUpdate', updateLoop);
}

// -------------------------------------------------------------
// 3. ボールの落下処理とパーティクルエフェクト
// -------------------------------------------------------------

// ボールを1つ落とす
function dropBall() {
  if (!isGameActive) return;

  const container = document.getElementById('game-container');
  const width = container.clientWidth;
  
  // 画面上部の中央付近からランダムに少しずらして落とす
  const startX = width / 2 + (Math.random() - 0.5) * (width * 0.4);
  const startY = -20;
  const radius = 12 + Math.random() * 6; // 12px〜18pxのランダムなサイズ
  const randomColor = COLORS.balls[Math.floor(Math.random() * COLORS.balls.length)];

  const ball = Bodies.circle(startX, startY, radius, {
    restitution: 0.85, // 跳ね返りやすくする
    friction: 0.02,
    collisionFilter: {
      category: defaultCategory,
      mask: defaultCategory
    },
    render: {
      fillStyle: randomColor
    },
    label: 'ball'
  });

  Composite.add(engine.world, ball);
}

// 衝突時のきらきら星パーティクルエフェクト
function createSparkles(x, y, color) {
  const sparkleCount = 6;
  const sparkles = [];

  for (let i = 0; i < sparkleCount; i++) {
    const angle = (i / sparkleCount) * Math.PI * 2 + Math.random() * 0.5;
    const speed = 2 + Math.random() * 3;
    const radius = 3 + Math.random() * 3;

    const sparkle = Bodies.circle(x, y, radius, {
      collisionFilter: {
        category: particleCategory,
        mask: 0 // 何とも衝突しない
      },
      render: {
        fillStyle: color,
        opacity: 1.0
      },
      label: 'particle'
    });

    // 放射状の初速を与える
    Body.setVelocity(sparkle, {
      x: Math.cos(angle) * speed,
      y: Math.sin(angle) * speed - 2 // 少し上に飛び散りやすくする
    });

    // カスタム属性として生存時間（ライフ）を設定
    sparkle.lifespan = 30; // 30フレーム

    sparkles.push(sparkle);
  }

  Composite.add(engine.world, sparkles);
}

// -------------------------------------------------------------
// 4. イベントハンドラーとゲームループ
// -------------------------------------------------------------

// 衝突イベント
function setupCollisionHandler() {
  Events.on(engine, 'collisionStart', (event) => {
    event.pairs.forEach((pair) => {
      const bodyA = pair.bodyA;
      const bodyB = pair.bodyB;

      // どちらかがボールで、もう一方がブロック（または壁）の場合
      const isBallA = bodyA.label === 'ball';
      const isBallB = bodyB.label === 'ball';

      if (isBallA || isBallB) {
        const ball = isBallA ? bodyA : bodyB;
        const target = isBallA ? bodyB : bodyA;

        // 壁以外のブロックに当たったときだけ音を鳴らす＆エフェクト
        if (target.label === 'block') {
          // 衝突点から周波数を決定（X座標ベースでマッピング）
          const containerWidth = document.getElementById('game-container').clientWidth;
          const ratio = Math.min(Math.max(ball.position.x / containerWidth, 0), 1);
          const toneIndex = Math.floor(ratio * TONES.length);
          const freq = TONES[toneIndex];

          // 衝突速度（強さ）で音量を変化させる
          const speed = Vector.magnitude(ball.velocity);
          const velocity = Math.min(speed / 10, 1.0);

          playTone(freq, velocity);

          // きらきら星エフェクトの発生
          const contact = pair.activeContacts ? pair.activeContacts[0] : null;
          const contactPos = contact ? contact.vertex : ball.position;
          createSparkles(contactPos.x, contactPos.y, target.render.fillStyle);

          // ブロックが一瞬ぷるんと動く（微小な力を加えて揺らす）
          Body.applyForce(target, target.position, {
            x: (Math.random() - 0.5) * 0.05,
            y: 0.02
          });
        }
      }
    });
  });
}

// 毎フレームの更新処理
function updateLoop() {
  const bodies = Composite.allBodies(engine.world);
  const container = document.getElementById('game-container');
  const height = container.clientHeight;

  bodies.forEach((body) => {
    // 1. 画面下に落ちたボールの削除
    if (body.label === 'ball' && body.position.y > height + 50) {
      Composite.remove(engine.world, body);
    }

    // 2. パーティクルのフェードアウトと削除
    if (body.label === 'particle') {
      body.lifespan--;
      if (body.lifespan <= 0) {
        Composite.remove(engine.world, body);
      } else {
        // 徐々に透明にする
        body.render.opacity = body.lifespan / 30;
      }
    }
  });
}

// リサイズ対応
function handleResize() {
  const container = document.getElementById('game-container');
  if (!container) return;

  const width = container.clientWidth;
  const height = container.clientHeight;

  // レンダラーサイズ更新
  render.canvas.width = width;
  render.canvas.height = height;
  render.options.width = width;
  render.options.height = height;

  // 左右の壁の位置を再調整
  const wallThickness = 60;
  const bodies = Composite.allBodies(engine.world);
  
  // 最初に追加した左右の壁を特定して再配置
  let wallIndex = 0;
  bodies.forEach((body) => {
    if (body.label === 'wall') {
      if (wallIndex === 0) {
        // 左壁
        Body.setPosition(body, { x: -wallThickness / 2, y: height / 2 });
        wallIndex++;
      } else if (wallIndex === 1) {
        // 右壁
        Body.setPosition(body, { x: width + wallThickness / 2, y: height / 2 });
        wallIndex++;
      }
    }
  });
}

// -------------------------------------------------------------
// 5. タッチ / マウスによるブロック操作
// -------------------------------------------------------------

function setupInteraction() {
  const container = document.getElementById('game-container');

  // タッチ座標の取得ユーティリティ
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

  // 操作開始 (mousedown / touchstart)
  function handleStart(e) {
    // 下部のコントロールパネルをタップした場合は処理を抜ける
    if (e.target.closest('#control-panel')) return;
    
    // スクロールやバウンスなどのデフォルト動作を無効化
    e.preventDefault();

    const coords = getEventCoords(e);
    const bodies = Composite.allBodies(engine.world);

    // タップ位置にあるブロックを検出
    const clickedBody = Matter.Query.point(bodies, coords)[0];

    // ダブルタップの検知 (300ms以内の同一ブロックのタップで削除)
    const now = Date.now();
    if (clickedBody && clickedBody.label === 'block') {
      if (now - lastTapTime < 300) {
        // 削除
        Composite.remove(engine.world, clickedBody);
        playTone(150, 0.2); // ポフッという消滅音の代わり
        draggedBody = null;
        return;
      }
      lastTapTime = now;
    }

    if (clickedBody && clickedBody.label === 'block') {
      // 既存ブロックのドラッグ開始
      draggedBody = clickedBody;
      dragOffset.x = coords.x - clickedBody.position.x;
      dragOffset.y = coords.y - clickedBody.position.y;
      
      // ドラッグ中も完全に固定するために isStatic: true のまま座標を追従させる
    } else {
      // 空き地をタップした場合は新規ブロック作成
      createBlock(coords.x, coords.y);
      lastTapTime = now;
    }
  }

  // ドラッグ中 (mousemove / touchmove)
  function handleMove(e) {
    if (!draggedBody) return;
    e.preventDefault();

    const coords = getEventCoords(e);
    
    // ドラッグ中のブロックの位置をマウス座標に同期
    Body.setPosition(draggedBody, {
      x: coords.x - dragOffset.x,
      y: coords.y - dragOffset.y
    });
  }

  // 操作終了 (mouseup / touchend)
  function handleEnd(e) {
    draggedBody = null;
  }

  // イベントリスナーの紐付け
  container.addEventListener('mousedown', handleStart);
  container.addEventListener('mousemove', handleMove);
  window.addEventListener('mouseup', handleEnd);

  container.addEventListener('touchstart', handleStart, { passive: false });
  container.addEventListener('touchmove', handleMove, { passive: false });
  window.addEventListener('touchend', handleEnd);
}

// 新規ブロック（丸・三角・四角）の作成
function createBlock(x, y) {
  let block;

  const options = {
    isStatic: true, // ボールが当たっても動かない壁にする
    label: 'block',
    friction: 0.1
  };

  if (currentShape === 'circle') {
    block = Bodies.circle(x, y, blockRadius, {
      ...options,
      render: { fillStyle: COLORS.circle }
    });
  } else if (currentShape === 'triangle') {
    // 三角形の頂点を上向きにするため角度を -Math.PI / 6 (30度) 回転させる
    block = Bodies.polygon(x, y, 3, blockRadius + 5, {
      ...options,
      angle: -Math.PI / 6,
      render: { fillStyle: COLORS.triangle }
    });
  } else if (currentShape === 'square') {
    // 角丸の四角形にする (chamfer)
    block = Bodies.rectangle(x, y, blockRadius * 2, blockRadius * 2, {
      ...options,
      chamfer: { radius: 10 },
      render: { fillStyle: COLORS.square }
    });
  }

  // ブロックを配置したときにも軽いフィードバック音を鳴らす
  playTone(392.00, 0.4); // 「ソ」の音

  Composite.add(engine.world, block);
}

// -------------------------------------------------------------
// 6. UI操作の設定と初期起動イベント
// -------------------------------------------------------------

function setupUI() {
  // スタートボタン
  const btnStart = document.getElementById('btn-start');
  const startScreen = document.getElementById('start-screen');

  btnStart.addEventListener('click', () => {
    initAudio();
    initPhysics();
    setupInteraction();
    
    isGameActive = true;
    startScreen.classList.add('hidden');

    // 最初のボール落下タイマー始動 (1.8秒ごと)
    setInterval(dropBall, 1800);
  });

  // ブロック形状選択ボタンの切り替え
  const toolButtons = document.querySelectorAll('.tool-btn');
  toolButtons.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      toolButtons.forEach((b) => b.classList.remove('active'));
      const targetBtn = e.currentTarget;
      targetBtn.classList.add('active');
      currentShape = targetBtn.dataset.shape;

      // タップ効果音
      playTone(523.25, 0.3); // 「ド」の音
    });
  });

  // 手動でボールを落とすボタン
  const btnBallDrop = document.getElementById('btn-ball-drop');
  btnBallDrop.addEventListener('click', () => {
    dropBall();
    playTone(587.33, 0.3); // 「レ」の音
  });

  // 全部消すボタン
  const btnClear = document.getElementById('btn-clear');
  btnClear.addEventListener('click', () => {
    // 配置したブロックと落下中のボールをすべてクリア
    const bodies = Composite.allBodies(engine.world);
    bodies.forEach((body) => {
      if (body.label === 'block' || body.label === 'ball' || body.label === 'particle') {
        Composite.remove(engine.world, body);
      }
    });

    // クリア効果音（少し悲しい下下降の音階）
    if (audioCtx) {
      const now = audioCtx.currentTime;
      playTone(440, 0.3);
      setTimeout(() => playTone(330, 0.3), 100);
      setTimeout(() => playTone(220, 0.3), 200);
    }
  });
}

// 起動処理
document.addEventListener('DOMContentLoaded', () => {
  setupUI();
});
