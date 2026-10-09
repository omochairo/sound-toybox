import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, sleep } from './helpers/load-app.mjs';

let app;
afterEach(() => {
  if (app) {
    assert.deepEqual(app.errors, [], 'ページ内で例外が起きていない');
    app.close();
    app = null;
  }
});

// -------------------------------------------------------------
// 起動・読み込み
// -------------------------------------------------------------
test('スタートボタンで 3〜5 歳モードが始まり、左右の壁だけがある', () => {
  app = loadApp().start();
  assert.equal(app.g('currentMode'), '3-5');
  assert.equal(app.g('isGameActive'), true);
  assert.ok(app.document.getElementById('start-screen').classList.contains('hidden'));
  assert.equal(app.bodies((b) => b.label === 'wall').length, 2);
});

test('Matter.js が読み込めないときはスタート画面で案内を出す', () => {
  app = loadApp({ withMatter: false });
  const button = app.document.getElementById('btn-start');
  assert.match(button.textContent, /もういちど/);
  assert.match(app.document.querySelector('#start-screen .subtitle').textContent, /しっぱい/);
});

// -------------------------------------------------------------
// 物理ループ
// -------------------------------------------------------------
test('画面のリフレッシュレートに関係なく、物理は 1 秒あたり約 60 ステップ', () => {
  app = loadApp().start();
  let steps = 0;
  app.g('Matter').Events.on(app.g('engine'), 'afterUpdate', () => steps++);
  for (const hz of [30, 60, 120, 144]) {
    steps = 0;
    app.g('lastPhysicsTime = null; physicsAccumulator = 0');
    app.step(1, hz); // 基準時刻
    app.step(hz, hz); // 1 秒
    assert.ok(steps >= 58 && steps <= 61, `${hz}Hz で ${steps} ステップ`);
  }
});

test('長い空白（タブ復帰など）の後でも、1 フレームに 4 ステップまでしか進めない', () => {
  app = loadApp().start();
  let steps = 0;
  app.g('Matter').Events.on(app.g('engine'), 'afterUpdate', () => steps++);
  const loop = app.g('physicsLoop');
  app.g('lastPhysicsTime = null');
  loop(10000);
  loop(15000);
  assert.equal(steps, 4);
});

// -------------------------------------------------------------
// ボールと音
// -------------------------------------------------------------
test('画面外へ落ちたボールは物理世界と管理配列の両方から消える', () => {
  app = loadApp().start();
  app.g('dropBall()');
  assert.equal(app.g('activeBalls.length'), 1);
  app.step(600);
  assert.equal(app.g('activeBalls.length'), 0);
  assert.equal(app.bodies((b) => b.label === 'ball').length, 0);
});

test('ボールは 120 個までで、古いものから消える', () => {
  app = loadApp().start();
  for (let i = 0; i < 130; i++) app.g('dropBall()');
  assert.equal(app.g('activeBalls.length'), 120);
  assert.equal(app.bodies((b) => b.label === 'ball').length, 120);
});

test('衝突音は間引かれ、当たった回数より少なく鳴る（跳ね上げは毎回効く）', () => {
  app = loadApp().start();
  app.g("switchMode('9-10'); stopBallTimer(); currentShape = 'square'");
  for (let x = 280; x <= 740; x += 72) app.g(`createBlock(${x}, 400)`);
  let hits = 0;
  app.g('Matter').Events.on(app.g('engine'), 'collisionStart', (e) => {
    e.pairs.forEach((p) => {
      const labels = [p.bodyA.label, p.bodyB.label];
      if (labels.includes('ball') && labels.includes('block')) hits++;
    });
  });
  let tones = 0;
  const original = app.window.playTone;
  app.window.playTone = (...args) => { tones++; return original(...args); };
  for (let i = 0; i < 60; i++) app.g('dropBall()');
  app.step(240); // 実時間はほぼ進まないので、間引きは最も強くかかる
  app.window.playTone = original;
  assert.ok(hits > 20, `衝突 ${hits} 回`);
  assert.ok(tones > 0 && tones < hits, `発音 ${tones} 回 / 衝突 ${hits} 回`);
});

test('allowHitSound: 同じブロックへの連続ヒットと、短時間の発音数を制限する', () => {
  app = loadApp().start();
  const allow = app.g('allowHitSound');
  const a = {};
  assert.equal(allow(a), true);
  assert.equal(allow(a), false, '同じブロックは 60ms 以内に鳴らさない');
  app.g('hitsInWindow = 0; hitWindowStart = performance.now()');
  const results = Array.from({ length: 12 }, () => allow({}));
  assert.equal(results.filter(Boolean).length, 8, '100ms に 8 音まで');
});

test('右端ぎりぎりのボールが当たっても音階の添字がはみ出さない', () => {
  app = loadApp().start();
  app.g("currentShape = 'square'; createBlock(1000, 400)");
  const block = app.blocks()[0];
  const ball = app.g('Bodies').circle(1024, 380, 12, { label: 'ball' });
  app.g('handleCollisionStart')({ bodyA: ball, bodyB: block, activeContacts: [] });
  const last = app.audio.frequencies[app.audio.frequencies.length - 1];
  assert.ok(Number.isFinite(last));
});

test('すべての音は 1 つのコンプレッサーを通る', () => {
  app = loadApp().start();
  assert.equal(app.audio.contexts.length, 1);
  assert.ok(app.g('masterBus'));
});

// -------------------------------------------------------------
// 操作
// -------------------------------------------------------------
test('何もない所をタップするとブロックを置き、ドラッグで動かせる', () => {
  app = loadApp().start();
  app.tap(400, 300);
  assert.equal(app.blocks().length, 1);
  app.mouse('mousedown', 400, 300);
  app.mouse('mousemove', 430, 300);
  app.mouse('mousemove', 480, 320);
  app.mouse('mouseup', 480, 320);
  const { x, y } = app.blocks()[0].position;
  assert.deepEqual([Math.round(x), Math.round(y)], [480, 320]);
});

test('指が 3px ぶれても長押しで削除できる', async () => {
  app = loadApp().start();
  app.tap(400, 300);
  await sleep(350); // ダブルタップ扱いにならないよう間をあける
  app.mouse('mousedown', 400, 300);
  app.mouse('mousemove', 403, 302);
  await sleep(700);
  app.mouse('mouseup', 403, 302);
  assert.equal(app.blocks().length, 0);
});

test('touchcancel で中断されたら長押し削除は起きない', async () => {
  app = loadApp().start();
  app.tap(400, 300);
  await sleep(350);
  app.mouse('mousedown', 400, 300);
  app.window.dispatchEvent(new app.window.Event('touchcancel'));
  await sleep(700);
  assert.equal(app.blocks().length, 1);
});

test('まる・さんかく・しかくは 2 回タップしても消えず、くるっと回る', () => {
  app = loadApp().start();
  app.g("currentShape = 'square'");
  app.tap(400, 300);
  doubleTap(app, 400, 300);
  const blocks = app.blocks();
  assert.equal(blocks.length, 1);
  assert.ok(Math.abs(blocks[0].angle - Math.PI / 4) < 1e-6);
});

function doubleTap(a, x, y) {
  // 1 回目のタップ（配置）の直後は lastTappedBody が null なので、2 回タップしてから判定させる
  a.g('lastTapTime = 0; lastTappedBody = null');
  a.tap(x, y);
  a.tap(x, y);
}

test('さかみちは 2 回タップで 45 度回る', () => {
  app = loadApp().start();
  app.g("switchMode('6-8'); stopBallTimer(); currentShape = 'slope'");
  app.tap(150, 250);
  const before = app.blocks()[0].angle;
  doubleTap(app, 150, 250);
  assert.ok(Math.abs(app.blocks()[0].angle - before - Math.PI / 4) < 1e-6);
});

test('ボールをタップすると、はじけて消える（ブロックは置かれない）', () => {
  app = loadApp().start();
  app.g('dropBall()');
  const ball = app.g('activeBalls[0]');
  app.g('Body').setPosition(ball, { x: 500, y: 300 });
  app.tap(508, 305); // 少しずれていても当たる
  assert.equal(app.g('activeBalls.length'), 0);
  assert.equal(app.bodies((b) => b.label === 'ball').length, 0);
  assert.equal(app.blocks().length, 0);
  assert.ok(app.bodies((b) => b.label === 'particle').length > 0);
});

test('おんぷ: タップで開き、もう一度タップで閉じ、鍵盤で音を変えられる', async () => {
  app = loadApp().start();
  app.g("switchMode('9-10'); stopBallTimer(); switchSubCategory('music'); currentShape = 'note'");
  const piano = app.document.getElementById('piano-keyboard');
  const isOpen = () => !piano.classList.contains('hidden');
  app.tap(200, 300);
  await sleep(320);
  app.tap(200, 300);
  assert.equal(isOpen(), true);
  await sleep(320);
  app.tap(200, 300);
  assert.equal(isOpen(), false);
  await sleep(320);
  app.tap(200, 300);
  app.document.querySelector('.piano-key[data-note="7"]').click();
  assert.equal(app.blocks()[0].toneIndex, 7);
  assert.equal(isOpen(), false);
});

test('歯車は長押しで、ピン留めの Constraint ごと消える', async () => {
  app = loadApp().start();
  app.g("switchMode('9-10'); stopBallTimer(); currentShape = 'gear'");
  app.tap(300, 300);
  assert.equal(app.g('Composite.allConstraints(engine.world).length'), 1);
  await sleep(350);
  app.mouse('mousedown', 300, 300);
  await sleep(700);
  app.mouse('mouseup', 300, 300);
  assert.equal(app.blocks().length, 0);
  assert.equal(app.g('Composite.allConstraints(engine.world).length'), 0);
});

test('「けす」でブロック・ボール・歯車のピンが消え、6〜8 歳のステージは残る', () => {
  app = loadApp().start();
  app.g("switchMode('6-8'); stopBallTimer(); currentShape = 'slope'; createBlock(150, 250); dropBall()");
  app.document.getElementById('btn-clear').click();
  assert.equal(app.blocks().length, 0);
  assert.equal(app.g('activeBalls.length'), 0);
  assert.ok(app.bodies((b) => b.label === 'goalSensor').length === 1);
  assert.ok(app.bodies((b) => b.label === 'obstacle').length >= 1);
});

// -------------------------------------------------------------
// モード・ステージ
// -------------------------------------------------------------
test('モードごとのボール落下間隔（9〜10 歳は BPM の 2 拍）', () => {
  app = loadApp().start();
  assert.equal(app.g('getBallInterval()'), 1800);
  app.g("switchMode('6-8')");
  assert.equal(app.g('getBallInterval()'), 4000);
  app.g("switchMode('9-10')");
  app.document.getElementById('slider-bpm').value = '60';
  assert.equal(app.g('getBallInterval()'), 2000);
});

test('9〜10 歳で変えた重力は、他のモードへ持ち越さない', () => {
  app = loadApp().start();
  app.g("switchMode('9-10')");
  const slider = app.document.getElementById('slider-gravity');
  slider.value = '1.5';
  slider.dispatchEvent(new app.window.Event('input'));
  assert.equal(app.g('engine.gravity.y'), 1.5);
  app.g("switchMode('3-5')");
  assert.equal(app.g('engine.gravity.y'), 0.6);
});

test('6〜8 歳: 画面サイズが変わっても置いたブロックは残り、ステージの部品だけ比率で動く', () => {
  app = loadApp().start();
  app.g("switchMode('6-8'); stopBallTimer(); currentShape = 'slope'; createBlock(150, 250)");
  app.resize(800, 500);
  assert.equal(app.blocks().length, 1);
  const expected = app.g('stagePoint(STAGE_DATA[currentStage - 1].goal, 800, getStageArea())');
  const goal = app.g('goalSensor').position;
  assert.ok(Math.abs(goal.x - expected.x) < 1e-6);
  assert.ok(Math.abs(goal.y - expected.y) < 1e-6);
  assert.ok(goal.y < 500, 'ゴールは画面の中');
  // 部品は作り直しても 1 組だけ
  assert.equal(app.bodies((b) => b.label === 'goalSensor').length, 1);
  assert.equal(app.bodies((b) => b.label === 'startSpawn').length, 1);
  const wall = app.bodies((b) => b.label === 'wall').find((b) => b.position.x > 0);
  assert.equal(wall.position.x, 800 + 30);
});

test('全ステージを読み込める（ボタンの数とステージデータが一致）', () => {
  app = loadApp().start();
  const buttons = app.document.querySelectorAll('.stage-btn');
  assert.equal(buttons.length, app.g('STAGE_DATA.length'));
  app.g("switchMode('6-8'); stopBallTimer()");
  buttons.forEach((btn) => {
    btn.click();
    assert.equal(app.g('currentStage'), Number(btn.dataset.stage));
    assert.ok(app.g('goalSensor') && app.g('startSpawner'));
  });
});

test('ステージはツールパネルより上・タブより下に収まり、狭い画面では障害物が縮む', () => {
  app = loadApp().start();
  const panel = app.document.getElementById('control-panel');
  Object.defineProperty(panel, 'offsetHeight', { configurable: true, get: () => 140 });
  app.g("switchMode('6-8'); stopBallTimer(); loadStage(2)");
  const area = app.g('getStageArea()');
  assert.equal(area.bottom, 768 - 140 - 40);
  const goal = app.g('goalSensor').position;
  assert.ok(goal.y <= area.bottom && goal.y >= area.top);
  // スマホ横向き相当
  app.resize(812, 375);
  app.g('loadStage(3)');
  const wall = app.bodies((b) => b.label === 'obstacle')[0];
  const wallHeight = wall.bounds.max.y - wall.bounds.min.y;
  assert.ok(wallHeight < 420, `壁の高さ ${wallHeight}`);
  assert.ok(wall.bounds.min.y > app.g('startSpawner').position.y - 60, '壁の上を越えられる余地がある');
});

test('ゴールに入るとクリア画面が出て、記録が保存されボタンに★が付く', () => {
  app = loadApp().start();
  app.g("switchMode('6-8'); stopBallTimer(); loadStage(2)");
  app.g('dropBall()');
  const ball = app.g('activeBalls[0]');
  app.g('handleCollisionStart')({ bodyA: ball, bodyB: app.g('goalSensor') });
  assert.equal(app.document.getElementById('clear-modal').classList.contains('hidden'), false);
  assert.deepEqual(JSON.parse(app.window.localStorage.getItem('sound-toybox:cleared-stages')), [2]);
  assert.ok(app.document.querySelector('.stage-btn[data-stage="2"]').classList.contains('cleared'));
  assert.equal(app.g('activeBalls.length'), 0);
  // 「つぎのステージへ」
  app.document.getElementById('btn-next-stage').click();
  assert.equal(app.g('currentStage'), 3);
});

test('最後のステージの次は 1 に戻り、全部クリアするとお祝いの文言になる', () => {
  app = loadApp({ storage: { 'sound-toybox:cleared-stages': '[1,2,3,4]' } }).start();
  app.g('switchMode(\'6-8\'); stopBallTimer(); loadStage(STAGE_DATA.length); dropBall()');
  app.g('handleCollisionStart')({ bodyA: app.g('activeBalls[0]'), bodyB: app.g('goalSensor') });
  assert.match(app.document.querySelector('#clear-modal .clear-message').textContent, /ぜんぶ/);
  app.document.getElementById('btn-next-stage').click();
  assert.equal(app.g('currentStage'), 1);
});

test('保存できない環境でも、開いている間はクリアした★が消えず、全部クリアも分かる', () => {
  app = loadApp().start();
  const storage = app.window.localStorage;
  const proto = Object.getPrototypeOf(storage);
  proto.setItem = () => { throw new Error('QuotaExceededError'); };
  proto.getItem = () => { throw new Error('SecurityError'); };
  app.g("switchMode('6-8'); stopBallTimer()");
  const stageCount = app.g('STAGE_DATA.length');
  for (let stage = 1; stage <= stageCount; stage++) {
    app.g(`loadStage(${stage}); dropBall()`);
    app.g('handleCollisionStart')({ bodyA: app.g('activeBalls[0]'), bodyB: app.g('goalSensor') });
    app.document.getElementById('clear-modal').classList.add('hidden');
  }
  assert.equal(app.document.querySelectorAll('.stage-btn.cleared').length, stageCount);
  assert.match(app.document.querySelector('#clear-modal .clear-message').textContent, /ぜんぶ/);
});

test('壊れた保存データがあっても起動できる', () => {
  app = loadApp({ storage: { 'sound-toybox:cleared-stages': '{broken' } }).start();
  assert.equal(app.g('loadClearedStages().length'), 0);
});

// -------------------------------------------------------------
// ページの表示・非表示
// -------------------------------------------------------------
test('裏に回るとボールの自動落下が止まり、戻ると再開する', () => {
  app = loadApp().start({ keepTimer: true });
  assert.ok(app.g('ballTimer'));
  app.setHidden(true);
  assert.equal(app.g('ballTimer'), null);
  app.setHidden(false);
  assert.ok(app.g('ballTimer'));
});

test('AudioContext が interrupted のときもタップで再開を試みる', () => {
  app = loadApp().start();
  const ctx = app.audio.contexts[0];
  ctx.state = 'interrupted';
  const before = app.audio.resumeCalls;
  app.document.getElementById('btn-ball-drop').click();
  assert.ok(app.audio.resumeCalls > before);
});
