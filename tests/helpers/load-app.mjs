// index.html + vendor/matter.min.js + app.js を jsdom の中で丸ごと動かすためのハーネス。
// canvas・Web Audio・requestAnimationFrame は jsdom に無いので差し替え、物理は step() で手動で進める。
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const matterSrc = read('vendor/matter.min.js');
const appSrc = read('app.js');

// 何を呼んでも何もしない 2D コンテキスト
function createFakeContext() {
  const noop = () => {};
  return new Proxy({}, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'measureText') return () => ({ width: 0 });
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient' || prop === 'createPattern') {
        return () => ({ addColorStop: noop });
      }
      if (typeof prop === 'string' && /BackingStore/.test(prop)) return undefined;
      return noop;
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    }
  });
}

// 実ブラウザと同じく、有限でない値を入れたら例外を投げる AudioParam
function createParam(log, name) {
  let value = 0;
  const check = (v) => {
    if (!Number.isFinite(v)) throw new TypeError(`${name}: non-finite value ${v}`);
  };
  return {
    get value() { return value; },
    set value(v) { check(v); value = v; if (name === 'frequency') log.frequencies.push(v); },
    setValueAtTime(v) { check(v); },
    linearRampToValueAtTime(v) { check(v); },
    exponentialRampToValueAtTime(v) { check(v); }
  };
}

function createFakeAudio() {
  const log = { contexts: [], frequencies: [], resumeCalls: 0 };
  class FakeAudioContext {
    constructor() {
      this.state = 'running';
      this.currentTime = 0;
      this.sampleRate = 44100;
      this.destination = { connect() {} };
      log.contexts.push(this);
    }
    resume() { log.resumeCalls++; this.state = 'running'; return Promise.resolve(); }
    createOscillator() {
      return { type: 'sine', frequency: createParam(log, 'frequency'), connect() {}, start() {}, stop() {} };
    }
    createGain() { return { gain: createParam(log, 'gain'), connect() {} }; }
    createDynamicsCompressor() {
      const p = (n) => createParam(log, n);
      return { threshold: p('threshold'), knee: p('knee'), ratio: p('ratio'), attack: p('attack'), release: p('release'), connect() {} };
    }
    createBuffer(channels, length) { const data = new Float32Array(length); return { getChannelData: () => data }; }
    createBufferSource() { return { buffer: null, connect() {}, start() {}, stop() {} }; }
    createBiquadFilter() { return { type: 'lowpass', frequency: createParam(log, 'filter'), connect() {} }; }
  }
  return { FakeAudioContext, log };
}

export function loadApp({ withMatter = true, width = 1024, height = 768, storage } = {}) {
  const html = read('index.html')
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<link[^>]*>/g, '');
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'http://localhost/' });
  const { window } = dom;
  const { document } = window;

  const errors = [];
  window.addEventListener('error', (e) => errors.push(e.error || e.message));

  window.HTMLCanvasElement.prototype.getContext = function () {
    if (!this.__ctx) this.__ctx = createFakeContext();
    return this.__ctx;
  };
  window.requestAnimationFrame = () => 0;
  window.cancelAnimationFrame = () => {};
  const audio = createFakeAudio();
  window.AudioContext = audio.FakeAudioContext;

  if (storage) {
    for (const [k, v] of Object.entries(storage)) window.localStorage.setItem(k, v);
  }

  const size = { width, height };
  const container = document.getElementById('game-container');
  Object.defineProperty(container, 'clientWidth', { configurable: true, get: () => size.width });
  Object.defineProperty(container, 'clientHeight', { configurable: true, get: () => size.height });

  let hidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });

  // 本番と同じく classic script として読み込む（window.eval だとトップレベルの let/const がその中に閉じてしまう）
  const addScript = (src) => {
    const el = document.createElement('script');
    el.textContent = src;
    document.body.appendChild(el);
  };
  if (withMatter) addScript(matterSrc);
  addScript(appSrc);
  document.dispatchEvent(new window.Event('DOMContentLoaded'));

  const g = (expr) => window.eval(expr);
  let time = 1000;

  const app = {
    window,
    document,
    audio: audio.log,
    errors,
    size,
    g,
    // スタートボタンを押して、自動落下タイマーを止める（テストではボールを手で落とす）
    start({ keepTimer = false } = {}) {
      document.getElementById('btn-start').click();
      if (!keepTimer) g('stopBallTimer()');
      g('lastPhysicsTime = null');
      return app;
    },
    // 画面のリフレッシュレート hz で frames 回、描画フレームを進める
    step(frames = 1, hz = 60) {
      const loop = g('physicsLoop');
      for (let i = 0; i < frames; i++) {
        time += 1000 / hz;
        loop(time);
      }
    },
    setHidden(value) {
      hidden = value;
      document.dispatchEvent(new window.Event('visibilitychange'));
    },
    resize(newWidth, newHeight) {
      size.width = newWidth;
      size.height = newHeight;
      window.dispatchEvent(new window.Event('resize'));
    },
    // キャンバス上でのマウス操作（getBoundingClientRect は jsdom では 0 なので、座標はそのまま）
    mouse(type, x, y) {
      const canvas = container.querySelector('canvas');
      const target = type === 'mouseup' ? window : canvas;
      target.dispatchEvent(new window.MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true }));
    },
    tap(x, y) {
      app.mouse('mousedown', x, y);
      app.mouse('mouseup', x, y);
    },
    bodies(filter = () => true) {
      return g('Composite.allBodies(engine.world)').filter(filter);
    },
    blocks() {
      return app.bodies((b) => b.label === 'block');
    },
    close() {
      try { g('stopBallTimer()'); } catch (e) { /* 起動前 */ }
      window.close();
    }
  };
  return app;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
