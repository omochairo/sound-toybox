import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './helpers/load-app.mjs';

// 各ステージに「実際にゴールまで運べる置き方」が少なくとも 1 つあることを確かめる（1024x768 の画面）。
// 置き方は物理シミュレーションの探索で見つけたもの。ステージや物理の調整で解けなくなったら、ここが落ちる。
// [形, x, y, 置いた後に足す角度]（さかみちは置いた時点で -π/8 傾いている）
const SOLUTIONS = {
  1: [['conveyor', 185, 255], ['conveyor', 325, 255], ['conveyor', 465, 255], ['bouncer', 575, 315]],
  2: [['slope', 452, 230, Math.PI / 4], ['slope', 632, 370]],
  3: [['conveyor', 134, 255], ['conveyor', 274, 255], ['conveyor', 414, 255], ['conveyor', 554, 255], ['bouncer', 664, 315]],
  4: [840, 760, 680, 600, 520, 440, 360, 280].map((x, i) => ['slope', x, 234 + i * 36]),
  5: [['conveyor', 134, 234], ['conveyor', 274, 234], ['conveyor', 414, 234], ['conveyor', 554, 234], ['bouncer', 664, 294]]
};

function playStage(stage, plan) {
  const app = loadApp({ width: 1024, height: 768 }).start();
  try {
    app.g("switchMode('6-8'); stopBallTimer()");
    let cleared = false;
    app.window.handleStageClear = () => { cleared = true; };
    app.g(`loadStage(${stage})`);
    for (const [shape, x, y, angle = 0] of plan) {
      app.g(`currentShape = '${shape}'; createBlock(${x}, ${y})`);
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

test('どのステージにも、ゴールまで運べる置き方がある', () => {
  const app = loadApp();
  const stageCount = app.g('STAGE_DATA.length');
  app.close();
  assert.equal(Object.keys(SOLUTIONS).length, stageCount);
  for (const [stage, plan] of Object.entries(SOLUTIONS)) {
    assert.equal(playStage(Number(stage), plan), true, `ステージ ${stage}`);
  }
});
