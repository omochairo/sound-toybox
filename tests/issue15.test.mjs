// Issue #15 の再現テスト
// B（直せる不具合）は、直す前のコードで失敗し、直したあとで通ることを確かめたもの。
// A（仕様の判断が要るもの）は、PR #16 に書いた推奨のとおりに直し、そのふるまいを確かめる。
// 推奨が「案内を出す」で、現象そのものは残すもの（A-1 の横画面のステージ 2）は、再現テストを test.skip で残す
// （skip を外すと、いまのコードでは失敗する = 現象が起きていることを示す）。
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadApp, sleep } from './helpers/load-app.mjs';

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

// -------------------------------------------------------------
// B-1 「まさつ」スライダー
// -------------------------------------------------------------
// さかみちの上に置いたボールが、1 秒でどこまで下ったか
// （ボールの大きさは乱数なので、Math.random を固定してどの大きさでも確かめる）
function rollOnSlope(friction, random = 0.5) {
  const a = loadApp().start();
  try {
    a.g("switchMode('9-10'); stopBallTimer()");
    setSlider(a, 'slider-friction', friction);
    a.g("currentShape = 'slope'; createBlock(500, 400)");
    a.window.Math.random = () => random;
    a.g('dropBall()');
    const ball = a.g('activeBalls[0]');
    a.g('Body').setPosition(ball, { x: 490, y: 340 });
    a.step(60);
    return { block: a.blocks()[0].friction, ball: ball.friction, distance: 490 - ball.position.x };
  } finally {
    a.close();
  }
}

test('B-1 まさつ: スライダーの値がブロックとボールの摩擦にそのまま入る（0 も 0 として扱う）', () => {
  for (const f of [0, 0.25, 0.5]) {
    const r = rollOnSlope(f);
    assert.equal(r.block, f, `まさつ ${f} のブロック`);
    assert.equal(r.ball, f, `まさつ ${f} のボール`);
  }
});

test('B-1 まさつ: 0 のほうが 0.5 より、さかみちを遠くまで すべり下りる', () => {
  for (const random of [0, 0.5, 0.99]) { // ボールの半径 12・14.5・17px
    const zero = rollOnSlope(0, random);
    const high = rollOnSlope(0.5, random);
    assert.ok(zero.distance > high.distance + 20, `半径の乱数 ${random}: まさつ 0 で ${zero.distance.toFixed(0)}px、0.5 で ${high.distance.toFixed(0)}px`);
  }
});

test('B-1 まさつ: スライダーを動かすと、置いてあるブロック・はぐるま・ボールにも効く', () => {
  app = loadApp().start();
  app.g("switchMode('9-10'); stopBallTimer()");
  app.g("currentShape = 'square'; createBlock(300, 300)");
  app.g("currentShape = 'gear'; createBlock(600, 300)");
  app.g('dropBall()');
  setSlider(app, 'slider-friction', 0.35);
  for (const block of app.blocks()) assert.equal(block.friction, 0.35, block.blockType || 'square');
  assert.equal(app.g('activeBalls[0]').friction, 0.35);
});

test('B-1 まさつ: 3〜5 歳・6〜8 歳の摩擦は今までのまま（スライダーは 9〜10 歳だけ）', () => {
  app = loadApp().start();
  for (const mode of ['3-5', '6-8']) {
    app.g(`switchMode('${mode}'); stopBallTimer()`);
    app.g("currentShape = 'square'; createBlock(300, 600)");
    app.g('dropBall()');
    const block = app.blocks().pop();
    assert.equal(block.friction, 1, `${mode} のブロック（isStatic の既定値）`);
    assert.equal(app.g('activeBalls').pop().friction, 0.02, `${mode} のボール`);
  }
});

// -------------------------------------------------------------
// B-2〜B-4 ピアノ
// -------------------------------------------------------------
const pianoOf = (a) => a.document.getElementById('piano-keyboard');
const isPianoOpen = (a) => !pianoOf(a).classList.contains('hidden');

function placeNote(a, x, y) {
  a.g("switchMode('9-10'); stopBallTimer(); switchSubCategory('music'); currentShape = 'note'");
  a.tap(x, y);
  return a.blocks().find((b) => b.blockType === 'note');
}

test('B-2 ピアノ: 開いたまま回転・リサイズすると閉じる（前の位置に残らない）', async () => {
  app = loadApp().start();
  placeNote(app, 200, 300);
  await sleep(320);
  app.tap(200, 300);
  assert.equal(isPianoOpen(app), true);
  app.resize(812, 375);
  assert.equal(isPianoOpen(app), false);
  assert.equal(app.g('selectedNoteBlock'), null);
});

test('B-3 ピアノ: おんぷをすばやく 2 回タップすると、開いてから閉じる（トグル）', async () => {
  app = loadApp().start();
  placeNote(app, 200, 300);
  await sleep(320);
  app.tap(200, 300); // 1 回目: 開く
  assert.equal(isPianoOpen(app), true);
  app.tap(200, 300); // すぐに 2 回目: 閉じる
  assert.equal(isPianoOpen(app), false);
});

test('B-4 ピアノ: 画面の上のほうのおんぷでも、鍵盤がおんぷブロックに重ならない', async () => {
  const PIANO_HEIGHT = 110; // style.css の .keys-container
  // 上に出すと年齢タブ（70px）にかかる位置（y < 195）のおんぷ
  for (const y of [90, 150, 190]) {
    app = loadApp().start();
    const note = placeNote(app, 300, y);
    await sleep(320);
    app.tap(300, y);
    assert.equal(isPianoOpen(app), true);
    const top = parseFloat(pianoOf(app).style.top);
    const { min, max } = note.bounds;
    assert.ok(top + PIANO_HEIGHT <= min.y || top >= max.y, `y=${y}: 鍵盤 ${top}〜${top + PIANO_HEIGHT}、おんぷ ${min.y}〜${max.y}`);
    assert.ok(top >= 70, `y=${y}: 上のタブに重ならない`);
    app.close();
    app = null;
  }
});

test('B-4 ピアノ: 上に余裕があるおんぷでは、今までどおりブロックの上に出す', async () => {
  app = loadApp().start();
  placeNote(app, 300, 400);
  await sleep(320);
  app.tap(300, 400);
  assert.equal(pianoOf(app).style.top, '275px');
});

// -------------------------------------------------------------
// B-5 モード・ステージの切り替えで押下状態を取り消す
// -------------------------------------------------------------
test('B-5 ブロックを押さえたまま年齢タブを押すと、長押しタイマーとドラッグが残らない', async () => {
  app = loadApp().start();
  app.tap(300, 300);
  await sleep(320);
  app.mouse('mousedown', 300, 300); // 押さえたまま（指を離さない）
  assert.ok(app.g('draggedBody'));
  const before = app.audio.frequencies.length;
  app.document.querySelector('.age-tab[data-mode="9-10"]').click();
  assert.equal(app.g('draggedBody'), null);
  assert.equal(app.g('pressTimer'), null);
  await sleep(700);
  assert.ok(!app.audio.frequencies.slice(before).includes(150), '見えていない所で消去音が鳴らない');
});

test('B-5 ブロックを押さえたままステージを選ぶと、長押しタイマーとドラッグが残らない', async () => {
  app = loadApp().start();
  app.g("switchMode('6-8'); stopBallTimer()");
  app.tap(300, 450);
  await sleep(320);
  app.mouse('mousedown', 300, 450);
  assert.ok(app.g('draggedBody'));
  const before = app.audio.frequencies.length;
  app.document.querySelector('.stage-btn[data-stage="2"]').click();
  assert.equal(app.g('draggedBody'), null);
  assert.equal(app.g('pressTimer'), null);
  await sleep(700);
  assert.ok(!app.audio.frequencies.slice(before).includes(150), '見えていない所で消去音が鳴らない');
});

// -------------------------------------------------------------
// B-6 読み込みに失敗したときの文言
// -------------------------------------------------------------
test('B-6 Matter.js が読めないときの案内は、ネットワークのせいと決めつけない', () => {
  app = loadApp({ withMatter: false });
  const text = app.document.querySelector('#start-screen .subtitle').textContent;
  assert.match(text, /しっぱい/);
  assert.doesNotMatch(text, /インターネット/);
});

// -------------------------------------------------------------
// B-7 README の冒頭
// -------------------------------------------------------------
test('B-7 README の冒頭は、実装の 3 モード（3〜10 歳）に合っている', () => {
  const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const intro = readme.split('## ')[0];
  assert.doesNotMatch(intro, /3〜5歳向け/);
  assert.match(intro, /3〜10/);
});

// -------------------------------------------------------------
// B-8 ドラムの音量の下限
// -------------------------------------------------------------
test('B-8 ドラムにゆっくり当たっても、鉄琴と同じ下限の音量で鳴る', () => {
  app = loadApp().start();
  const ctx = app.g('audioCtx');
  const peaks = [];
  const createGain = ctx.createGain.bind(ctx);
  ctx.createGain = () => {
    const node = createGain();
    const ramp = node.gain.linearRampToValueAtTime.bind(node.gain);
    node.gain.linearRampToValueAtTime = (v, t) => { peaks.push(v); return ramp(v, t); };
    return node;
  };
  app.g("playDrum('bass', 0.01)");
  app.g("playDrum('snare', 0.01)");
  app.g('playTone(440, 0.01)');
  const [bass, snare, tone] = peaks;
  assert.ok(bass >= 0.1 * 0.7 - 1e-9, `太鼓 ${bass}`);
  assert.ok(snare >= 0.1 * 0.35 - 1e-9, `シンバル ${snare}`);
  assert.ok(tone >= 0.1 * 0.35 - 1e-9, `鉄琴（今までどおり） ${tone}`);
});

// -------------------------------------------------------------
// B-9 physicsLoop の端数
// -------------------------------------------------------------
test('B-9 15fps 前後に重くなっても、物理は 1 秒あたり約 60 ステップ進む（端数を捨てない）', () => {
  app = loadApp().start();
  let steps = 0;
  app.g('Matter').Events.on(app.g('engine'), 'afterUpdate', () => steps++);
  for (const hz of [15, 16, 18]) {
    steps = 0;
    app.g('lastPhysicsTime = null; physicsAccumulator = 0');
    app.step(1, hz); // 基準時刻
    app.step(hz * 10, hz); // 10 秒
    assert.ok(steps >= 595 && steps <= 601, `${hz}Hz で 10 秒に ${steps} ステップ`);
  }
});

// -------------------------------------------------------------
// A（仕様の判断）: PR #16 の推奨のとおりに直したもの
// -------------------------------------------------------------
const hintOf = (a) => a.document.getElementById('rotate-hint');
const isHintShown = (a) => !hintOf(a).classList.contains('hidden');

// A-1 推奨 1: 横画面で 6〜8 歳を開いたら「たてに すると あそびやすいよ」と案内する（遊べなくはしない）
test('A-1 スマホ横画面で 6〜8 歳を開くと、たて向きの案内が少しのあいだ出る', async () => {
  app = loadApp({ width: 812, height: 375 }).start();
  app.g("switchMode('6-8'); stopBallTimer()");
  assert.equal(isHintShown(app), true);
  assert.match(hintOf(app).textContent, /たてに すると あそびやすいよ/);
  // ステージは今までどおり置かれ、ブロックも置ける
  assert.ok(app.g('goalSensor'));
  app.tap(600, 200);
  assert.equal(app.blocks().length, 1);
  await sleep(4100);
  assert.equal(isHintShown(app), false);
});

test('A-1 たて画面・タブレットでは、案内を出さない', () => {
  for (const [width, height] of [[375, 812], [1024, 768], [768, 1024]]) {
    app = loadApp({ width, height }).start();
    app.g("switchMode('6-8'); stopBallTimer()");
    assert.equal(isHintShown(app), false, `${width}x${height}`);
    app.close();
    app = null;
  }
});

test('A-1 たてから横に回すと案内が出て、たてに戻すと消える。ほかのモードでは出ない', () => {
  app = loadApp({ width: 375, height: 812 }).start();
  app.g("switchMode('6-8'); stopBallTimer()");
  assert.equal(isHintShown(app), false);
  app.resize(812, 375);
  assert.equal(isHintShown(app), true);
  app.resize(375, 812);
  assert.equal(isHintShown(app), false);
  app.resize(812, 375);
  app.g("switchMode('3-5'); stopBallTimer()");
  assert.equal(isHintShown(app), false);
  app.g("switchMode('9-10'); stopBallTimer()");
  assert.equal(isHintShown(app), false);
});

// A-1 の現象そのもの（横画面ではステージ 2 が何も置かずにクリアになる）は、推奨 1 では残る。
// ステージ配置を見直すとき（PR #16 の選択肢 2〜4）に skip を外す
test.skip('A-1 スマホ横画面でも、ステージ 2 は何も置かずにはクリアできない', () => {
  for (const [width, height] of [[812, 375], [667, 375], [740, 360], [844, 390], [926, 428]]) {
    const a = loadApp({ width, height }).start();
    try {
      a.g("switchMode('6-8'); stopBallTimer()");
      let cleared = false;
      a.window.handleStageClear = () => { cleared = true; };
      a.g('loadStage(2)');
      a.g('dropBall()');
      const engine = a.g('engine');
      const Engine = a.g('Engine');
      for (let i = 0; i < 900 && !cleared; i++) Engine.update(engine, 1000 / 60);
      assert.equal(cleared, false, `${width}x${height}`);
    } finally {
      a.close();
    }
  }
});

// A-2 推奨 1: はぐるま・モーターギアにも、ほかのブロックと同じく音・きらきら・光を出す
for (const shape of ['gear', 'motor-gear']) {
  test(`A-2 ${shape === 'gear' ? 'はぐるま' : 'モーターギア'}にボールが当たると、はぐるまの色で光って、音が鳴る`, () => {
    app = loadApp().start();
    app.g(`switchMode('9-10'); stopBallTimer(); currentShape = '${shape}'; createBlock(500, 300)`);
    const gear = app.blocks()[0];
    const gearColor = gear.parts[1].render.fillStyle;
    app.g('dropBall()');
    app.g('Body').setPosition(app.g('activeBalls[0]'), { x: 530, y: 200 });
    const before = app.audio.frequencies.length;
    for (let i = 0; i < 60 && !gear.flashStartTime; i++) app.step(1);
    assert.ok(gear.flashStartTime > 0, '光る');
    assert.ok(app.audio.frequencies.length > before, '音が鳴る');
    const sparkles = app.bodies((b) => b.label === 'particle');
    assert.ok(sparkles.length > 0, 'きらきらが出る');
    assert.ok(sparkles.every((p) => p.render.fillStyle === gearColor), 'きらきらは はぐるまの色');
    assert.equal(app.g('getBlockColor')(gear), gearColor);
  });
}

// A-3 推奨 1: 重力 0 のときは、ボールを画面の中（上の UI のすぐ下）から出す
test('A-3 重力 0 では、ボールが画面の中に出て、見える所に浮かぶ', () => {
  for (const mode of ['9-10', '3-5']) {
    app = loadApp({ width: 375, height: 812 }).start();
    app.g(`switchMode('9-10'); stopBallTimer()`);
    setSlider(app, 'slider-gravity', 0);
    if (mode === '3-5') app.g("currentMode = '3-5'"); // 3〜5 歳は重力を変えられないが、0 なら同じに扱う
    const top = app.g("getTopUiBottom(['age-selector', 'physics-panel'])");
    const bottom = 812 - app.document.getElementById('control-panel').offsetHeight;
    for (let i = 0; i < 20; i++) app.g('dropBall()');
    // 出した位置: 上の UI と下のパネルのあいだ
    for (const ball of app.g('activeBalls')) {
      const r = ball.circleRadius;
      assert.ok(ball.position.y - r >= top && ball.position.y + r <= bottom, `${mode}: 出した高さ ${ball.position.y}（${top}〜${bottom} の中）`);
    }
    // 10 秒たっても、画面の外へ出ていったボールは無い
    app.step(600);
    const outside = app.g('activeBalls').filter((b) => b.position.y + b.circleRadius < 0 || b.position.y - b.circleRadius > 812);
    assert.equal(outside.length, 0, `${mode}: 画面の外 ${outside.length} 個`);
    app.close();
    app = null;
  }
});

test('A-3 重力があるときは、今までどおり画面の上の外から落とす', () => {
  app = loadApp().start();
  app.g("switchMode('9-10'); stopBallTimer()");
  app.g('dropBall()');
  assert.equal(app.g('activeBalls[0]').position.y, -20);
});

// A-4 推奨 1: ガイドはドミソのまま（コメントだけ直した）
test('A-4 メロディガイドは ド・ミ・ソ のまま', () => {
  const src = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const guide = src.slice(src.indexOf('function drawMelodyGuide'), src.indexOf('ctx.strokeStyle', src.indexOf('function drawMelodyGuide')));
  assert.deepEqual([...guide.matchAll(/note: '(.+?)'/g)].map((m) => m[1]), ['ド', 'ミ', 'ソ']);
  assert.doesNotMatch(src, /きらきら星の最初の3音/);
});

// A-5 推奨 1: 6〜8 歳で障害物の上にも置ける（今のまま許す）
test('A-5 6〜8 歳で、障害物に重なる位置にもブロックを置ける', () => {
  app = loadApp().start();
  app.g("switchMode('6-8'); stopBallTimer(); loadStage(1)");
  const obstacle = app.bodies((b) => b.label === 'obstacle')[0];
  app.g(`createBlock(${obstacle.position.x}, ${obstacle.position.y})`);
  assert.equal(app.blocks().length, 1);
});
