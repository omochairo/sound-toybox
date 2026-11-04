// 音の系統（initAudio / playTone / playDrum / ピアノ鍵盤）の再現テスト
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

// ボールをブロックに当てたことにする（間引きに引っかからないよう、毎回別のブロックに当てる）
function hitNewBlocks(count) {
  for (let i = 0; i < count; i++) {
    app.g("currentShape = 'square'");
    app.g(`createBlock(${100 + i * 80}, 400)`);
    const blocks = app.blocks();
    const block = blocks[blocks.length - 1];
    const ball = app.g('Bodies').circle(block.position.x, 360, 12, { label: 'ball' });
    app.g('hitsInWindow = 0');
    app.g('handleCollisionStart')({ bodyA: ball, bodyB: block, activeContacts: [] });
  }
}

// -------------------------------------------------------------
// Web Audio が使えない環境
// -------------------------------------------------------------
test('Web Audio が無いブラウザでも、スタートボタンで遊び始められる（音なし）', () => {
  app = loadApp();
  app.window.AudioContext = undefined;
  app.window.webkitAudioContext = undefined;
  app.start();
  assert.equal(app.g('isGameActive'), true);
  assert.equal(app.g('currentMode'), '3-5');
  assert.equal(app.g('audioCtx'), null);

  // 置く・当てる・ドラムを鳴らすも例外にならない
  app.tap(300, 400);
  assert.equal(app.blocks().length, 1);
  hitNewBlocks(1);
  app.g("playDrum('snare', 0.5)");
});

test('AudioContext の作成が失敗しても（端末の音声が使えない等）、遊び始められる', () => {
  app = loadApp();
  app.window.AudioContext = function () { throw new Error('NotSupportedError'); };
  app.start();
  assert.equal(app.g('isGameActive'), true);
  assert.equal(app.g('audioCtx'), null);
  app.tap(300, 400);
  assert.equal(app.blocks().length, 1);
});

// -------------------------------------------------------------
// 止まっている AudioContext に音をためこまない
// -------------------------------------------------------------
test('AudioContext が止まっている間の衝突音はためこまず、再開したときに一斉に鳴らない', () => {
  app = loadApp().start();
  const ctx = app.audio.contexts[0];
  // iOS でバックグラウンドから戻った直後など：止まったまま、物理とボールだけ動いている
  ctx.state = 'suspended';
  ctx.resume = () => new Promise(() => {}); // 端末側の都合でまだ再開できない
  app.g('lastResumeRequestTime = -Infinity');

  const before = app.audio.frequencies.length;
  hitNewBlocks(20);
  assert.equal(app.audio.frequencies.length, before, '止まっている間は音を予約しない');
});

test('止まった AudioContext を再開させたタップの音は、そのまま鳴らす', () => {
  app = loadApp().start();
  const ctx = app.audio.contexts[0];
  ctx.state = 'suspended';
  ctx.resume = () => new Promise(() => {}); // 再開の完了は少し後になる
  const before = app.audio.frequencies.length;
  app.document.querySelector('#tools-3-5 .tool-btn').click(); // タップ音（ド）
  assert.ok(app.audio.frequencies.length > before, 'タップの音は再開後に鳴るよう予約される');
});

test('interrupted（着信など）の間の衝突音もためこまない', () => {
  app = loadApp().start();
  const ctx = app.audio.contexts[0];
  ctx.state = 'interrupted';
  app.g('lastResumeRequestTime = -Infinity');
  const before = app.audio.frequencies.length;
  hitNewBlocks(5);
  app.g("playDrum('bass', 0.5)");
  assert.equal(app.audio.frequencies.length, before);
});

test('動いている AudioContext では、衝突音とドラムが鳴る', () => {
  app = loadApp().start();
  const before = app.audio.frequencies.length;
  hitNewBlocks(3);
  app.g("playDrum('bass', 0.5)");
  assert.ok(app.audio.frequencies.length >= before + 3 * 2, 'ブロック 3 つ分の音（2 つの発振器ずつ）');
});
