// Issue #15 の残り（PR #16 のあと）の再現テスト
// - A-3 の積み残し: 重力を 0 にした瞬間に、画面の上の外を落ちていたボールが見えない所に残る
// - C のうち、手元で再現できたもの: DPR だけが変わる・Web フォントがあとから読み込まれる
// - D のうち、直したもの: 眠ったボールに重ねてブロックを置く・シンバルのノイズを毎回作り直す
// どれも、直す前のコードで失敗し、直したあとで通ることを確かめた。
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './helpers/load-app.mjs';

let app;
afterEach(() => {
  if (app) {
    assert.deepEqual(app.errors, [], 'ページ内で例外が起きていない');
    app.close();
    app = null;
  }
});

function setSlider(a, id, value) {
  const slider = a.document.getElementById(id);
  slider.value = String(value);
  slider.dispatchEvent(new a.window.Event('input'));
}

test('A-3 重力があるうちに出たボールも、重力を 0 にしたら見える所へ移って浮かぶ', () => {
  app = loadApp().start();
  app.g("switchMode('9-10'); stopBallTimer()");
  app.g('dropBall()'); // 重力 0.6 のうちは、画面の上の外（y=-20）から落とす
  const ball = app.g('activeBalls[0]');
  assert.ok(ball.position.y < 0, '出たばかりのボールは画面の上の外');
  setSlider(app, 'slider-gravity', 0);
  const ageBottom = app.document.getElementById('age-selector').getBoundingClientRect().bottom;
  const panelTop = app.size.height - app.document.getElementById('control-panel').offsetHeight;
  app.step(60);
  assert.ok(ball.position.y > ageBottom && ball.position.y < panelTop, `1 秒後の y=${ball.position.y.toFixed(1)}`);
});

test('A-3 重力を 0 にしても、もう見えている所にあるボールは動かさない', () => {
  app = loadApp().start();
  app.g("switchMode('9-10'); stopBallTimer()");
  app.g('dropBall()');
  const ball = app.g('activeBalls[0]');
  app.g('Body').setPosition(ball, { x: 400, y: 300 });
  app.g('Body').setVelocity(ball, { x: 0, y: 0 });
  setSlider(app, 'slider-gravity', 0);
  assert.equal(ball.position.x, 400);
  assert.equal(ball.position.y, 300);
});

test('C DPR だけが変わったとき（DPR の違うモニターへ移す）も、canvas を新しい DPR に合わせる', () => {
  app = loadApp();
  const listeners = [];
  app.window.matchMedia = (query) => ({
    media: query,
    matches: true,
    addEventListener: (type, fn) => listeners.push({ query, fn }),
    removeEventListener() {}
  });
  app.start();
  assert.equal(app.g('render.options.pixelRatio'), 1);
  assert.equal(listeners.length, 1);
  assert.match(listeners[0].query, /resolution: 1dppx/);

  // resize は来ずに、DPR だけが 2 になる
  Object.defineProperty(app.window, 'devicePixelRatio', { configurable: true, value: 2 });
  listeners[0].fn();
  assert.equal(app.g('render.options.pixelRatio'), 2);
  // 次の変化（2 → 1）も見張り直している
  assert.equal(listeners.length, 2);
  assert.match(listeners[1].query, /resolution: 2dppx/);
});

test('C Web フォントがあとから読み込まれたら、6〜8 歳のステージを今のパネルの高さで置き直す', async () => {
  let fontsLoaded;
  app = loadApp({ width: 375, height: 812 });
  Object.defineProperty(app.document, 'fonts', {
    configurable: true,
    value: { ready: new Promise((resolve) => { fontsLoaded = resolve; }) }
  });
  app.start();
  app.g("switchMode('6-8'); stopBallTimer()");
  const goalBefore = app.g('goalSensor').position.y;

  // フォントが読み終わり、文字の幅が変わって下のパネルが高くなった（resize は来ない）
  const panel = app.document.getElementById('control-panel');
  Object.defineProperty(panel, 'offsetHeight', { configurable: true, get: () => 183 });
  fontsLoaded();
  await new Promise((r) => setTimeout(r, 0));

  const goalAfter = app.g('goalSensor').position.y;
  assert.ok(goalAfter < goalBefore, `ゴールが上へ動く（${goalBefore} → ${goalAfter}）`);
  assert.ok(goalAfter + app.g('GOAL_RADIUS') <= 812 - 183, 'ゴールがパネルに隠れない');
});

test('D 眠っているボールに重ねてブロックを置くと、ボールが起きて押し出される（めり込んだまま残らない）', () => {
  app = loadApp().start();
  app.g("switchMode('9-10'); stopBallTimer(); currentShape = 'square'; createBlock(500, 500)");
  app.g('dropBall()');
  const ball = app.g('activeBalls[0]');
  app.g('Body').setPosition(ball, { x: 500, y: 440 });
  for (let i = 0; i < 400 && !ball.isSleeping; i++) app.step(1);
  assert.equal(ball.isSleeping, true, 'しかくの上で眠る');
  const before = { ...ball.position };

  app.g("currentShape = 'slope'; createBlock(500, 445)");
  assert.equal(ball.isSleeping, false, '置いたとたんに起きる');
  app.step(60);
  const moved = Math.hypot(ball.position.x - before.x, ball.position.y - before.y);
  assert.ok(moved > 20, `1 秒で ${moved.toFixed(1)}px 動く`);
});

test('D 離れた所にブロックを置いても、眠っているボールは起こさない', () => {
  app = loadApp().start();
  app.g("switchMode('9-10'); stopBallTimer(); currentShape = 'square'; createBlock(500, 500)");
  app.g('dropBall()');
  const ball = app.g('activeBalls[0]');
  app.g('Body').setPosition(ball, { x: 500, y: 440 });
  for (let i = 0; i < 400 && !ball.isSleeping; i++) app.step(1);
  assert.equal(ball.isSleeping, true);
  app.g("currentShape = 'square'; createBlock(150, 300)");
  assert.equal(ball.isSleeping, true);
});

test('D シンバルを何度鳴らしても、ノイズは 1 回だけ作って使い回す', () => {
  app = loadApp().start();
  const ctx = app.g('audioCtx');
  let created = 0;
  const original = ctx.createBuffer.bind(ctx);
  ctx.createBuffer = (...args) => { created++; return original(...args); };
  const sources = [];
  const originalSource = ctx.createBufferSource.bind(ctx);
  ctx.createBufferSource = () => { const s = originalSource(); sources.push(s); return s; };

  for (let i = 0; i < 5; i++) app.g("playDrum('snare', 0.8)");
  assert.equal(created, 1);
  assert.equal(sources.length, 5);
  assert.ok(sources.every((s) => s.buffer && s.buffer === sources[0].buffer), '同じノイズを使い回す');
  const length = sources[0].buffer.getChannelData(0).length;
  assert.equal(length, Math.floor(ctx.sampleRate * 0.15));
});
