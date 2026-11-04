// 操作（タップ・ドラッグ・長押し・マルチタッチ）と画面まわり（リサイズ・裏に回る）の再現テスト
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

// jsdom には Touch が無いので、identifier と座標だけを持つ指を作って TouchEvent 相当を投げる
// fingers: いま画面に触れている指すべて、changed: この event で変わった指
function touch(a, type, fingers, changed) {
  const target = type === 'touchend' || type === 'touchcancel'
    ? a.window
    : a.document.querySelector('#game-container canvas');
  const e = new a.window.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'touches', { value: fingers });
  Object.defineProperty(e, 'changedTouches', { value: changed });
  target.dispatchEvent(e);
  return e;
}
const finger = (identifier, clientX, clientY) => ({ identifier, clientX, clientY });

// -------------------------------------------------------------
// マルチタッチ
// -------------------------------------------------------------
test('マルチタッチ: ブロックをドラッグ中に別の指でタップしても、ドラッグが切れない', () => {
  app = loadApp().start();
  app.tap(300, 300);
  app.g('lastTapTime = 0; lastTappedBody = null');
  const block = app.blocks()[0];

  const a1 = finger(1, 300, 300);
  touch(app, 'touchstart', [a1], [a1]);
  const a2 = finger(1, 340, 300);
  touch(app, 'touchmove', [a2], [a2]);
  assert.equal(Math.round(block.position.x), 340);

  // 2 本目の指で、空いている所をちょんと触って離す
  const b = finger(2, 700, 200);
  touch(app, 'touchstart', [a2, b], [b]);
  touch(app, 'touchend', [a2], [b]);

  // 1 本目の指はまだブロックを持っている
  const a3 = finger(1, 400, 320);
  touch(app, 'touchmove', [a3], [a3]);
  assert.deepEqual([Math.round(block.position.x), Math.round(block.position.y)], [400, 320]);
  touch(app, 'touchend', [], [a3]);
  assert.equal(app.g('draggedBody'), null);
});

test('マルチタッチ: ブロックを触った直後に別の指が触れても、2 回タップ（回転）にならない', () => {
  app = loadApp().start();
  app.g("currentShape = 'square'");
  app.tap(300, 300);
  app.g('lastTapTime = 0; lastTappedBody = null');
  const block = app.blocks()[0];

  const a = finger(1, 300, 300);
  touch(app, 'touchstart', [a], [a]);
  const b = finger(2, 700, 200);
  touch(app, 'touchstart', [a, b], [b]);
  touch(app, 'touchend', [a], [b]);
  touch(app, 'touchend', [], [a]);

  assert.equal(block.angle, 0);
  assert.equal(app.blocks().length, 1);
});

test('マルチタッチ: 1 本目の指で長押し中に、2 本目の指を離しても長押し削除は続く', async () => {
  app = loadApp().start();
  app.tap(300, 300);
  await sleep(350);
  const a = finger(1, 300, 300);
  touch(app, 'touchstart', [a], [a]);
  const b = finger(2, 700, 200);
  touch(app, 'touchstart', [a, b], [b]);
  touch(app, 'touchend', [a], [b]);
  await sleep(700);
  touch(app, 'touchend', [], [a]);
  assert.equal(app.blocks().length, 0);
});

test('タッチの押し始めは既定の動き（ピンチ拡大・スクロール）を止める', () => {
  app = loadApp().start();
  const a = finger(1, 300, 300);
  const e = touch(app, 'touchstart', [a], [a]);
  assert.equal(e.defaultPrevented, true);
  const b = finger(2, 500, 300);
  const e2 = touch(app, 'touchstart', [a, b], [b]);
  assert.equal(e2.defaultPrevented, true, '2 本目の指（ピンチ）も止める');
  touch(app, 'touchend', [], [a, b]);
});

// -------------------------------------------------------------
// マウスの右クリック・長押しメニュー
// -------------------------------------------------------------
test('右クリックではブロックを置かず、キャンバス上のメニューも出さない', () => {
  app = loadApp().start();
  const canvas = app.document.querySelector('#game-container canvas');
  canvas.dispatchEvent(new app.window.MouseEvent('mousedown', { clientX: 300, clientY: 300, button: 2, bubbles: true, cancelable: true }));
  app.window.dispatchEvent(new app.window.MouseEvent('mouseup', { clientX: 300, clientY: 300, button: 2, bubbles: true, cancelable: true }));
  assert.equal(app.blocks().length, 0);

  const menu = new app.window.MouseEvent('contextmenu', { clientX: 300, clientY: 300, bubbles: true, cancelable: true });
  canvas.dispatchEvent(menu);
  assert.equal(menu.defaultPrevented, true);
});

// -------------------------------------------------------------
// 裏に回る
// -------------------------------------------------------------
test('ブロックを押したまま裏に回ったら、長押し削除もドラッグも取り消す', async () => {
  app = loadApp().start();
  app.tap(300, 300);
  await sleep(350);
  app.mouse('mousedown', 300, 300);
  app.setHidden(true);
  await sleep(700);
  assert.equal(app.blocks().length, 1, '見ていない間に消えない');
  app.setHidden(false);
  app.mouse('mousemove', 400, 400);
  const { x, y } = app.blocks()[0].position;
  assert.deepEqual([Math.round(x), Math.round(y)], [300, 300], '戻ったあとボタンを離していてもブロックが付いてこない');
  app.mouse('mouseup', 400, 400);
});

// -------------------------------------------------------------
// リサイズ・回転
// -------------------------------------------------------------
test('画面を回して狭くなっても、置いたブロックは画面（下のパネルより上）の中に残る', () => {
  app = loadApp({ width: 1024, height: 768 }).start();
  app.tap(950, 300);
  app.g("currentShape = 'square'");
  app.tap(300, 590);
  // タブレット横 → スマホ縦
  app.resize(375, 667);
  for (const b of app.blocks()) {
    assert.ok(b.bounds.min.x >= 0 && b.bounds.max.x <= 375, `横にはみ出さない: ${b.bounds.min.x}〜${b.bounds.max.x}`);
  }
  // スマホ縦 → スマホ横（下のパネルは 103px）
  app.resize(812, 375);
  for (const b of app.blocks()) {
    assert.ok(b.bounds.max.y <= 375 - 103 + 1e-6, `パネルの裏に隠れない: ${b.bounds.max.y}`);
    assert.ok(b.bounds.min.y >= 0);
  }
  assert.equal(app.blocks().length, 2);
});

test('はぐるまも、ピン留めの位置ごと画面の中へ戻る', () => {
  app = loadApp({ width: 1024, height: 768 }).start();
  app.g("switchMode('9-10'); stopBallTimer(); currentShape = 'gear'");
  app.tap(960, 300);
  app.resize(375, 667);
  const gear = app.blocks()[0];
  const pin = app.g('Composite.allConstraints(engine.world)[0]');
  assert.ok(gear.bounds.max.x <= 375 + 1e-6, `${gear.bounds.max.x}`);
  assert.ok(Math.abs(pin.pointA.x - gear.position.x) < 1e-6 && Math.abs(pin.pointA.y - gear.position.y) < 1e-6, 'ピンも一緒に動く');
  app.step(30);
  assert.ok(gear.bounds.max.x <= 375 + 1, 'ピンに引き戻されない');
});

test('画面に収まっているブロックは、リサイズで動かさない', () => {
  app = loadApp({ width: 1024, height: 768 }).start();
  app.tap(200, 300);
  app.resize(800, 600);
  const { x, y } = app.blocks()[0].position;
  assert.deepEqual([x, y], [200, 300]);
});
