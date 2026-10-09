import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './helpers/load-app.mjs';

// 各ステージに「実際にゴールまで運べる置き方」があることを確かめる（1024x768、本番で実測したレイアウト）。
// 置き方は物理シミュレーションの探索で見つけたもの。子どもの置き方は数 px ずれるので、
// 全部品を上下左右に 5px ずらしても解けることまで確かめる（ジャンプ台は跳ぶ向きが一定なので、ずれに強い）。
// [形, 発射台からの x, 発射台からの y, 置いた後に足す角度]（さかみちは置いた時点で -π/8 傾いている。
// ジャンプ台は π/4 足すと、右上へ跳ばす向きになる = 2 回タップ 1 回ぶん）
const TILT = Math.PI / 4;
const SOLUTIONS = {
  1: [['conveyor', -20, 45], ['bouncer', 140, 80, TILT]],
  2: [['slope', -60, 60, Math.PI / 4], ['slope', 120, 140]],
  3: [['conveyor', -20, 45], ['conveyor', 120, 45], ['bouncer', 240, 80, TILT], ['bouncer', 440, 40, TILT]],
  4: Array.from({ length: 10 }, (_, i) => ['slope', -30 - i * 70, 45 + i * 28]),
  5: [['conveyor', -20, 45], ['conveyor', 120, 45], ['bouncer', 240, 80, TILT]]
};
const OFFSETS = [[0, 0], [-5, 0], [5, 0], [0, -5], [0, 5]];

function playStage(stage, plan, [ox, oy] = [0, 0]) {
  const app = loadApp({ width: 1024, height: 768 }).start();
  try {
    app.g("switchMode('6-8'); stopBallTimer()");
    let cleared = false;
    app.window.handleStageClear = () => { cleared = true; };
    app.g(`loadStage(${stage})`);
    const start = app.g('startSpawner').position;
    for (const [shape, dx, dy, angle = 0] of plan) {
      app.g(`currentShape = '${shape}'; createBlock(${start.x + dx + ox}, ${start.y + dy + oy})`);
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
  for (const stage of Object.keys(SOLUTIONS)) {
    assert.equal(playStage(Number(stage), []), false, `ステージ ${stage}`);
  }
});

test('どのステージにも、ゴールまで運べる置き方があり、置く位置が少しずれても解ける', () => {
  const app = loadApp();
  const stageCount = app.g('STAGE_DATA.length');
  app.close();
  assert.equal(Object.keys(SOLUTIONS).length, stageCount);
  for (const [stage, plan] of Object.entries(SOLUTIONS)) {
    for (const offset of OFFSETS) {
      assert.equal(playStage(Number(stage), plan, offset), true, `ステージ ${stage} ずらし ${offset}`);
    }
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
