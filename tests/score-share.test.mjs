import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './helpers/load-app.mjs';

const BEST_KEY = 'sound-toybox:best-scores';
const TILT = Math.PI / 4;

// ステージ 1 を実際に解く（stages.test.mjs と同じ置き方）。クリアまで物理を進める
function clearStage1(app, { seconds = 31 } = {}) {
  app.g("switchMode('6-8'); stopBallTimer(); loadStage(1)");
  app.g(`stageStartedAt = Date.now() - ${seconds * 1000}`);
  const start = app.g('startSpawner').position;
  for (const [shape, dx, dy, angle = 0] of [['conveyor', -20, 45], ['bouncer', 140, 80, TILT]]) {
    app.g(`currentShape = '${shape}'; createBlock(${start.x + dx}, ${start.y + dy})`);
    const block = app.blocks().filter((b) => b.blockType === shape).pop();
    app.g('Body').setAngle(block, block.angle + angle);
  }
  app.g('dropBall()');
  const modal = app.document.getElementById('clear-modal');
  const engine = app.g('engine');
  const Engine = app.g('Engine');
  for (let i = 0; i < 900 && modal.classList.contains('hidden'); i++) Engine.update(engine, 1000 / 60);
  assert.equal(modal.classList.contains('hidden'), false, 'ステージ 1 がクリアにならない');
}

test('スコアはクリア 300 てん + ブロックの少なさ（最大 400）+ はやさ（最大 300）で、300〜1000 てん', () => {
  const app = loadApp();
  const score = (b, s) => app.g(`calcStageScore(${b}, ${s})`);
  assert.equal(score(0, 0), 1000);
  assert.equal(score(2, 31), 300 + 320 + 238);
  assert.equal(score(10, 150), 300);
  assert.equal(score(30, 999), 300);
  assert.equal(app.g('starsFor(800)'), 3);
  assert.equal(app.g('starsFor(799)'), 2);
  assert.equal(app.g('starsFor(550)'), 2);
  assert.equal(app.g('starsFor(549)'), 1);
  app.close();
});

test('クリアすると、使ったブロックの数・かかった時間・スコアとベストがクリア画面に出て、ベストが保存される', () => {
  const app = loadApp().start();
  clearStage1(app, { seconds: 31 });
  const text = (id) => app.document.getElementById(id).textContent;
  assert.match(text('score-main'), /スコア 858てん ★★★/);
  assert.match(text('score-detail'), /ブロック 2こ ・ 31びょう/);
  assert.match(text('score-best'), /じこベスト こうしん/);
  assert.match(text('score-best'), /ごうけい 858てん（1\/5 ステージ）/);
  const saved = JSON.parse(app.window.localStorage.getItem(BEST_KEY));
  assert.deepEqual(saved['1'], { score: 858, blocks: 2, seconds: 31 });
  assert.deepEqual(app.errors, []);
  app.close();
});

test('ベストより低いスコアではベストを上書きしない', () => {
  const app = loadApp({ storage: { [BEST_KEY]: JSON.stringify({ 1: { score: 990, blocks: 1, seconds: 5 } }) } }).start();
  clearStage1(app, { seconds: 31 });
  assert.match(app.document.getElementById('score-best').textContent, /ベスト 990てん/);
  assert.equal(JSON.parse(app.window.localStorage.getItem(BEST_KEY))['1'].score, 990);
  app.close();
});

test('壊れたベストのきろくがあっても、クリアできて新しいきろくで直る', () => {
  const app = loadApp({ storage: { [BEST_KEY]: '{broken' } }).start();
  clearStage1(app);
  assert.equal(JSON.parse(app.window.localStorage.getItem(BEST_KEY))['1'].score, 858);
  assert.deepEqual(app.errors, []);
  app.close();
});

test('「もういちど」はブロックも時間もはじめからにする', () => {
  const app = loadApp().start();
  clearStage1(app, { seconds: 31 });
  app.document.getElementById('btn-retry-stage').click();
  assert.equal(app.document.getElementById('clear-modal').classList.contains('hidden'), true);
  assert.equal(app.g('countPlacedBlocks()'), 0);
  assert.ok(Date.now() - app.g('stageStartedAt') < 1000);
  app.close();
});

test('ちょうせんじょうのリンク（?ch=ステージ-てんすう）で開くと案内が出て、スタートでそのステージになる', () => {
  const app = loadApp({ url: 'http://localhost/?ch=1-900' });
  const invite = app.document.getElementById('start-invite');
  assert.equal(invite.classList.contains('hidden'), false);
  assert.match(invite.textContent, /ステージ1で 900てん/);
  app.start();
  assert.equal(app.g('currentMode'), '6-8');
  assert.equal(app.g('currentStage'), 1);
  clearStage1(app, { seconds: 31 });
  assert.match(app.document.getElementById('score-challenge').textContent, /あと 43てん/);
  app.close();

  const win = loadApp({ url: 'http://localhost/?ch=1-800' }).start();
  clearStage1(win, { seconds: 31 });
  assert.match(win.document.getElementById('score-challenge').textContent, /ちょうせん せいこう/);
  win.close();
});

test('おかしな ちょうせんじょう・さくひんのリンクは無視して、ふつうに始まる', () => {
  for (const q of ['?ch=9-900', '?ch=1-5000', '?ch=1-299', '?ch=abc', '?s=x', '?s=3~6~10~12~', '?s=3~6~10~12~z.1.1.0', '?s=9~99~10~12~c.1.1.0']) {
    const app = loadApp({ url: `http://localhost/${q}` });
    assert.equal(app.document.getElementById('start-invite').classList.contains('hidden'), true, q);
    app.start();
    assert.equal(app.g('currentMode'), '3-5', q);
    assert.equal(app.blocks().length, 0, q);
    assert.deepEqual(app.errors, [], q);
    app.close();
  }
});

test('ピタゴラおんがくの作品をリンクにして開き直すと、同じ形・音・ドラム・スライダーで置き直される', () => {
  const app = loadApp().start();
  app.g("switchMode('9-10')");
  const set = (id, v) => { const el = app.document.getElementById(id); el.value = v; el.dispatchEvent(new app.window.Event('input')); };
  set('slider-gravity', '0.3');
  set('slider-friction', '0.25');
  set('slider-bpm', '90');
  const place = (shape, x, y) => app.g(`currentShape = '${shape}'; createBlock(${x}, ${y})`);
  place('slope', 300, 300);
  place('note', 500, 350);
  place('drum', 700, 400);
  place('motor-gear', 400, 500);
  const note = app.blocks().find((b) => b.blockType === 'note');
  note.toneIndex = 7;
  const drum = app.blocks().find((b) => b.blockType === 'drum');
  drum.drumType = 'snare';
  const slope = app.blocks().find((b) => b.blockType === 'slope');
  app.g('Body').setAngle(slope, Math.PI / 4);

  const content = app.g('buildShareContent()');
  assert.match(content.url, /^https:\/\/omcha\.jp\/pitagora-puzzle-game\/\?s=/);
  const query = new URL(content.url).search;
  app.close();

  const copy = loadApp({ url: `http://localhost/${query}` });
  assert.match(copy.document.getElementById('start-invite').textContent, /ピタゴラおんがく・ブロック4こ/);
  copy.start();
  assert.equal(copy.g('currentMode'), '9-10');
  assert.equal(copy.document.getElementById('slider-gravity').value, '0.3');
  assert.equal(copy.document.getElementById('slider-bpm').value, '90');
  assert.equal(copy.g('engine').gravity.y, 0.3);
  const blocks = copy.blocks();
  assert.equal(blocks.length, 4);
  const byType = (t) => blocks.find((b) => (b.shapeType || b.blockType) === t);
  assert.equal(byType('note').toneIndex, 7);
  assert.equal(byType('drum').drumType, 'snare');
  assert.ok(Math.abs(byType('slope').angle - Math.PI / 4) < 0.02);
  assert.ok(Math.abs(byType('note').position.x - 500) < 2);
  assert.ok(byType('motor-gear'));
  // 置き直しのときに、置く音を一斉に鳴らさない
  assert.equal(copy.audio.frequencies.filter((f) => f === 392).length, 0);
  assert.deepEqual(copy.errors, []);
  copy.close();
});

test('おもちゃばこの作品は まる・さんかく・しかく だけで置き直す', () => {
  const app = loadApp({ url: 'http://localhost/?s=' + encodeURIComponent('3~6~10~12~c.300.300.0_t.500.400.330_s.700.500.0_g.400.400.0') }).start();
  assert.equal(app.g('currentMode'), '3-5');
  assert.equal(app.blocks().map((b) => b.shapeType).sort().join(','), 'circle,square,triangle');
  app.close();
});

test('シェアは端末の共有画面を使い、使えないときは X・LINE・コピーの画面を出す', async () => {
  const app = loadApp().start();
  clearStage1(app, { seconds: 31 });
  let shared = null;
  app.window.navigator.share = async (data) => { shared = data; };
  app.document.getElementById('btn-share-score').click();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(shared.url, 'https://omcha.jp/pitagora-puzzle-game/?ch=1-858');
  assert.match(shared.text, /ステージ1を ブロック2こ・31びょうで クリア！ スコア858てん/);
  assert.equal(app.document.getElementById('share-modal').classList.contains('hidden'), true);

  // 共有画面が使えない（iframe で許可されていない等）ときは、選ぶ画面
  app.window.navigator.share = async () => { throw new app.window.DOMException('blocked', 'NotAllowedError'); };
  app.document.getElementById('btn-share-score').click();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(app.document.getElementById('share-modal').classList.contains('hidden'), false);
  assert.match(app.document.getElementById('share-text').textContent, /\?ch=1-858/);

  // （テストの読み込みでは起動処理が 2 回走ってボタンの登録が二重になるため、開いた URL の種類で確かめる）
  const opened = [];
  app.window.open = (u) => { opened.push(u); };
  app.document.getElementById('btn-share-x').click();
  assert.ok(opened.length > 0 && opened.every((u) => /^https:\/\/x\.com\/intent\/post\?text=.+&url=https%3A%2F%2Fomcha\.jp%2Fpitagora-puzzle-game%2F%3Fch%3D1-858$/.test(u)), opened.join(' | '));
  opened.length = 0;
  app.document.getElementById('btn-share-line').click();
  assert.ok(opened.length > 0 && opened.every((u) => /^https:\/\/line\.me\/R\/share\?text=.+pitagora-puzzle-game%2F%3Fch%3D1-858$/.test(u)), opened.join(' | '));

  let copied = '';
  Object.defineProperty(app.window.navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => { copied = t; } } });
  app.document.getElementById('btn-share-copy').click();
  await new Promise((r) => setTimeout(r, 0));
  assert.match(copied, /\?ch=1-858$/);
  assert.match(app.document.getElementById('share-status').textContent, /コピーしたよ/);
  app.document.getElementById('btn-share-close').click();
  assert.equal(app.document.getElementById('share-modal').classList.contains('hidden'), true);

  // 自分で共有画面を閉じたときは、選ぶ画面を出さない
  app.window.navigator.share = async () => { throw new app.window.DOMException('cancel', 'AbortError'); };
  app.document.getElementById('btn-share-score').click();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(app.document.getElementById('share-modal').classList.contains('hidden'), true);
  app.close();
});

test('何も置いていないときのシェアは、ゲームのページだけを送る', () => {
  const app = loadApp().start();
  const content = app.g('buildShareContent()');
  assert.equal(content.url, 'https://omcha.jp/pitagora-puzzle-game/');
  app.close();
});
