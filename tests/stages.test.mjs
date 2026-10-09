import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './helpers/load-app.mjs';

// 各ステージに「実際にゴールまで運べる置き方」があることを確かめる（1024x768、本番で実測したレイアウト）。
// ジャンプ台は丸く、当たる位置で跳ねる向きが変わるため、物理の結果は 1px 未満の差でも分かれることがある。
// そこで 1 つの解に頼らず、子どもが試しそうな「近い置き方」の候補のどれかでゴールできればよいとする。
// 候補は物理シミュレーションの探索で解が見つかった置き方の周辺。ステージや物理の調整で解けなくなったら、ここが落ちる。
// [形, 発射台からの x, 発射台からの y, 置いた後に足す角度]（さかみちは置いた時点で -π/8 傾いている）
const range = (from, to, step) => Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step);
const conveyorRow = (count, dy) => Array.from({ length: count }, (_, i) => ['conveyor', -20 + i * 140, dy]);
const jumpAfterRow = (count, dy) => range(40, 180, 20).flatMap((jx) => range(10, 60, 10).map((jy) =>
  [...conveyorRow(count, dy), ['bouncer', -20 + (count - 1) * 140 + 70 + jx, dy + jy]]));

const CANDIDATES = {
  // ベルトを並べて、最後にジャンプ台
  1: jumpAfterRow(3, 50),
  // 1 本目を回して左へ、2 本目で右へ返す
  2: range(120, 220, 20).map((by) => [['slope', -60, 60, Math.PI / 4], ['slope', 120, by]]),
  // ベルト → ジャンプで壁越え → ベルト → ジャンプでゴール
  3: range(400, 480, 20).flatMap((cx) => [80, 100].flatMap((cy) => range(40, 120, 20).flatMap((jx) => [0, 20, 40].map((jy) => [
    ['conveyor', -20, 45], ['conveyor', 120, 45], ['bouncer', 290, 120], ['conveyor', cx, cy], ['bouncer', cx + 70 + jx, cy + jy]
  ])))),
  // さかみちを階段のように並べる
  4: [80, 85].flatMap((dx) => [28, 32].flatMap((dy) => [8, 9].map((count) =>
    Array.from({ length: count }, (_, i) => ['slope', -30 - i * dx, 45 + i * dy])))),
  5: jumpAfterRow(4, 50)
};

function playStage(stage, plan) {
  const app = loadApp({ width: 1024, height: 768 }).start();
  try {
    app.g("switchMode('6-8'); stopBallTimer()");
    let cleared = false;
    app.window.handleStageClear = () => { cleared = true; };
    app.g(`loadStage(${stage})`);
    const start = app.g('startSpawner').position;
    for (const [shape, dx, dy, angle = 0] of plan) {
      app.g(`currentShape = '${shape}'; createBlock(${start.x + dx}, ${start.y + dy})`);
      const block = app.blocks().filter((b) => b.blockType === shape).pop();
      app.g('Body').setAngle(block, block.angle + angle);
    }
    app.g('dropBall()');
    const engine = app.g('engine');
    const Engine = app.g('Engine');
    for (let i = 0; i < 900 && !cleared; i++) Engine.update(engine, 1000 / 60);
    return cleared;
  } finally {
    app.close();
  }
}

test('6〜8 歳のボールは大きさが一定（同じ置き方なら毎回同じ結果になる）', () => {
  const app = loadApp().start();
  app.g("switchMode('6-8'); stopBallTimer()");
  for (let i = 0; i < 5; i++) app.g('dropBall()');
  const radii = new Set(app.g('activeBalls').map((b) => b.circleRadius));
  app.close();
  assert.equal(radii.size, 1);
});

test('ブロックを置かなければ、どのステージもゴールに入らない', () => {
  for (const stage of Object.keys(CANDIDATES)) {
    assert.equal(playStage(Number(stage), []), false, `ステージ ${stage}`);
  }
});

test('どのステージにも、ゴールまで運べる置き方がある', () => {
  const app = loadApp();
  const stageCount = app.g('STAGE_DATA.length');
  app.close();
  assert.equal(Object.keys(CANDIDATES).length, stageCount);
  for (const [stage, plans] of Object.entries(CANDIDATES)) {
    const solved = plans.filter((plan) => playStage(Number(stage), plan)).length;
    assert.ok(solved > 0, `ステージ ${stage}: ${plans.length} 通りの置き方のどれでもゴールできない`);
  }
});

test('スマホ縦・横・タブレットのどの画面でも、障害物がゴールや発射台に重ならない', () => {
  const overlaps = (a, b) => a.min.x < b.max.x && a.max.x > b.min.x && a.min.y < b.max.y && a.max.y > b.min.y;
  for (const [width, height] of [[375, 812], [812, 375], [768, 1024], [1024, 768]]) {
    const app = loadApp({ width, height }).start();
    try {
      app.g("switchMode('6-8'); stopBallTimer()");
      const stageCount = app.g('STAGE_DATA.length');
      for (let stage = 1; stage <= stageCount; stage++) {
        app.g(`loadStage(${stage})`);
        const goal = app.g('goalSensor').bounds;
        const start = app.g('startSpawner').bounds;
        for (const obstacle of app.bodies((b) => b.label === 'obstacle')) {
          assert.ok(!overlaps(obstacle.bounds, goal), `${width}x${height} ステージ ${stage}: ゴールに重なる`);
          assert.ok(!overlaps(obstacle.bounds, start), `${width}x${height} ステージ ${stage}: 発射台に重なる`);
        }
        assert.ok(goal.max.x <= width && goal.min.x >= 0, `${width}x${height} ステージ ${stage}: ゴールが画面からはみ出す`);
      }
    } finally {
      app.close();
    }
  }
});
