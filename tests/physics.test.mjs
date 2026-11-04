// 物理と描画の系統（app.js の physicsLoop・dropBall・popBall・ベルトコンベアなど）の再現テスト
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

// ボールが 1 列に積み重なる細い筒（床つき）を x の位置に作る
function addTube(x) {
  const { Bodies, Composite } = app.g('Matter');
  Composite.add(app.g('engine.world'), [
    Bodies.rectangle(x, 520, 200, 20, { isStatic: true, label: 'block' }),
    Bodies.rectangle(x - 22, 400, 4, 260, { isStatic: true, label: 'block' }),
    Bodies.rectangle(x + 22, 400, 4, 260, { isStatic: true, label: 'block' })
  ]);
}

// 筒の中に 2 個積んで眠らせ、[下, 上] を返す
function stackTwoSleepingBalls(x) {
  addTube(x);
  const balls = [0, 1].map((i) => {
    app.g('dropBall()');
    const ball = app.g('activeBalls[activeBalls.length - 1]');
    app.g('Body').setPosition(ball, { x, y: 490 - i * 40 });
    return ball;
  });
  app.step(400);
  assert.ok(balls[0].isSleeping && balls[1].isSleeping, '積んだボールが眠っている');
  return balls;
}

test('下のボールをはじくと、その上で眠っていたボールが落ちる', () => {
  app = loadApp().start();
  app.g("switchMode('9-10'); stopBallTimer()");
  const [bottom, top] = stackTwoSleepingBalls(500);
  const yBefore = top.position.y;
  app.g('popBall')(bottom);
  app.step(120);
  assert.ok(top.position.y > yBefore + 10, `上のボールが落ちた（${yBefore} → ${top.position.y}）`);
});

test('ボールが 120 個を超えて一番古いボールが消えたら、その上で眠っていたボールが落ちる', () => {
  app = loadApp().start();
  app.g("switchMode('9-10'); stopBallTimer()");
  // 自動で落ちてくるボール（画面中央付近）が入らないよう、筒は左端に置く
  const [, top] = stackTwoSleepingBalls(100);
  const yBefore = top.position.y;
  for (let i = 0; i < 119; i++) app.g('dropBall()'); // 121 個目で一番古い（下の）ボールが消える
  assert.equal(app.g('activeBalls.length'), 120);
  app.step(60);
  assert.ok(top.position.y > yBefore + 10, `上のボールが落ちた（${yBefore} → ${top.position.y}）`);
});

test('はじいたボールから離れて眠っているボールは起こさない', () => {
  app = loadApp().start();
  app.g("switchMode('9-10'); stopBallTimer()");
  const [, far] = stackTwoSleepingBalls(100);
  app.g('dropBall()');
  const other = app.g('activeBalls[activeBalls.length - 1]');
  app.g('Body').setPosition(other, { x: 800, y: 300 });
  app.g('popBall')(other);
  assert.equal(far.isSleeping, true);
});

test('ベルトコンベアは矢印（➔）の向きへ運ぶ。回して左向きにしたら左へ運ぶ', () => {
  app = loadApp().start();
  app.g("switchMode('9-10'); stopBallTimer(); currentShape = 'conveyor'; createBlock(500, 400)");
  const belt = app.blocks()[0];
  const cases = [
    { turns: 0, dir: 1 },
    { turns: 1, dir: 1 },   // 45 度（右下へ）
    { turns: 3, dir: -1 },  // 135 度（左下へ）
    { turns: 4, dir: -1 },  // 180 度（左へ）
    { turns: 5, dir: -1 },  // 225 度（左上へ）
    { turns: 7, dir: 1 },   // 315 度（右上へ）
    { turns: 8, dir: 1 }    // 一周
  ];
  for (const { turns, dir } of cases) {
    app.g('Body').setAngle(belt, turns * Math.PI / 4);
    app.g('Body').setVelocity(belt, { x: 0, y: 0 });
    // コンベアの処理だけを直接確かめる（実際に落とす場合は下のテスト）
    const ball = app.g('Bodies').circle(500, 380, 14, { label: 'ball' });
    app.g('handleConveyorBeltPhysics')({ bodyA: belt, bodyB: ball });
    assert.equal(Math.sign(ball.velocity.x), dir, `${turns * 45} 度`);
    assert.equal(Math.abs(ball.velocity.x), 3.5, '運ぶ速さは変えない');
  }
});

test('左向きに回したベルトコンベアに落ちたボールは、左へ運ばれる', () => {
  app = loadApp().start();
  app.g("switchMode('9-10'); stopBallTimer(); currentShape = 'conveyor'; createBlock(500, 400)");
  app.g('Body').setAngle(app.blocks()[0], Math.PI);
  app.g('dropBall()');
  const ball = app.g('activeBalls[0]');
  app.g('Body').setPosition(ball, { x: 500, y: 370 });
  app.step(20);
  assert.ok(ball.position.x < 480, `左へ運ばれた（x = ${ball.position.x}）`);
});
