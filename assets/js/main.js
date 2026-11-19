/**
 * main.js — 应用编排：图像载入、推理调度、参数联动、日志与导出
 */
import { Detector } from './detector.js';
import { ZoneEditor, DEFAULT_ZONE, evaluateDetection, zoneToPx } from './zone.js';
import { render } from './render.js';
import { CLASS_CHIPS, KEY_CLASSES, zhName } from './labels.js';

const $ = (id) => document.getElementById(id);

const SAMPLES = [
  {
    file: 'samples/site-road.jpg',
    title: '施工便道',
    desc: '三名作业人员穿行',
    tag: 'ROAD-04'
  },
  {
    file: 'samples/site-yard.jpg',
    title: '露天作业面',
    desc: '两名人员停留',
    tag: 'YARD-05'
  },
  {
    file: 'samples/site-dock.jpg',
    title: '装卸月台',
    desc: '卡车与叉车作业',
    tag: 'DOCK-03'
  }
];

const state = {
  detector: new Detector(),
  ready: null,
  frame: null,
  rawDets: [],
  threshold: 0.40,
  classes: new Set(['person', 'car', 'truck', 'bus']),
  otherOn: false,
  mode: 'ground',
  zone: { ...DEFAULT_ZONE },
  editing: false,
  batch: 0,
  cost: 0,
  stamp: '',
  busy: false,
  logs: []
};

const canvas = $('canvas');
const ctx = canvas.getContext('2d');
const emptyState = $('emptyState');
const scanline = $('scanline');
let editor;

/* ---------------- 工具 ---------------- */

function toast(msg, ms = 2600) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), ms);
}

function nowStamp() {
  const d = new Date();
  return d.toLocaleTimeString('zh-CN', { hour12: false });
}

function isAllowed(label) {
  if (state.classes.has(label)) return true;
  return state.otherOn && !KEY_CLASSES.includes(label);
}

/* ---------------- 初始化 ---------------- */

function buildSamples() {
  const box = $('samples');
  SAMPLES.forEach((s, i) => {
    const btn = document.createElement('button');
    btn.className = 'sample';
    btn.type = 'button';
    btn.dataset.file = s.file;
    btn.innerHTML = `
      <img src="${s.file}" alt="${s.title}" loading="lazy">
      <span class="sample-meta"><b>${s.title}</b><span>${s.desc}</span></span>
      <span class="sample-tag">${s.tag}</span>`;
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sample').forEach((n) => n.classList.remove('active'));
      btn.classList.add('active');
      loadImage(s.file, s.title);
    });
    box.appendChild(btn);
  });
}

function buildChips() {
  const box = $('classChips');
  CLASS_CHIPS.forEach((c) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip-btn';
    b.textContent = c.text;
    b.dataset.label = c.label;
    b.setAttribute('aria-pressed', String(state.classes.has(c.label)));
    b.addEventListener('click', () => {
      const on = state.classes.has(c.label);
      if (on) state.classes.delete(c.label);
      else state.classes.add(c.label);
      b.setAttribute('aria-pressed', String(!on));
      $('classCount').textContent = `${state.classes.size} 类`;
      applyFilters();
    });
    box.appendChild(b);
  });

  const other = document.createElement('button');
  other.type = 'button';
  other.className = 'chip-btn';
  other.textContent = '其他物体';
  other.setAttribute('aria-pressed', 'false');
  other.addEventListener('click', () => {
    state.otherOn = !state.otherOn;
    other.setAttribute('aria-pressed', String(state.otherOn));
    applyFilters();
  });
  box.appendChild(other);
  $('classCount').textContent = `${state.classes.size} 类`;
}

function setBusyUI(busy) {
  state.busy = busy;
  scanline.hidden = !busy;
  $('btnAnalyze').disabled = busy || !state.frame;
  $('btnAnalyze').textContent = busy ? '分析中…' : '立即分析';
  if (busy) $('statusText').textContent = '正在推理 · EfficientDet-Lite0 …';
}

/* ---------------- 图像载入 ---------------- */

async function loadImage(src, name) {
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('图像解码失败'));
      i.src = src;
    });

    const MAX_W = 1280;
    const scale = Math.min(1, MAX_W / img.naturalWidth);
    const frame = document.createElement('canvas');
    frame.width = Math.round(img.naturalWidth * scale);
    frame.height = Math.round(img.naturalHeight * scale);
    frame.getContext('2d').drawImage(img, 0, 0, frame.width, frame.height);

    state.frame = frame;
    canvas.width = frame.width;
    canvas.height = frame.height;

    emptyState.hidden = true;
    $('btnEditZone').disabled = false;
    $('btnResetZone').disabled = false;
    $('btnExport').disabled = true;
    $('sysRes').textContent = `${frame.width} × ${frame.height}`;
    $('statusMeta').textContent = `${frame.width}×${frame.height} · 待分析`;
    $('statusText').textContent = name ? `已载入场景：${name}` : '已载入图像';
    $('zoneNote').textContent = '警戒区 A · 已启用';

    // 首次载入自动分析，减少演示时的操作步骤
    await analyze();
  } catch (err) {
    toast(err.message || '图像载入失败');
  }
}

/* ---------------- 推理与判定 ---------------- */

async function analyze() {
  if (!state.frame || state.busy) return;
  if (!state.detector.model) {
    toast('模型尚未就绪，请稍候');
    return;
  }
  setBusyUI(true);
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 60)));

  let dets = [];
  const t0 = performance.now();
  try {
    dets = await state.detector.detect(state.frame);
  } catch (err) {
    setBusyUI(false);
    toast('推理失败：' + (err.message || err));
    return;
  }
  state.cost = performance.now() - t0;
  state.rawDets = dets;
  state.batch += 1;
  state.stamp = nowStamp();
  state.editorStamp = state.stamp;

  applyFilters();
  setBusyUI(false);
  $('sysBatch').textContent = String(state.batch);
  const kept = state.rawDets.filter((d) => d.score >= state.threshold && isAllowed(d.label)).length;
  $('statusText').textContent = kept
    ? `分析完成 · 关注目标 ${kept} 个（候选 ${dets.length}）`
    : '分析完成 · 未检出关注目标';
  $('statusMeta').textContent = `推理 ${Math.round(state.cost)} ms · 批次 #${state.batch}`;
}

function applyFilters() {
  if (!state.frame) return;

  const dets = state.rawDets.filter(
    (d) => d.score >= state.threshold && isAllowed(d.label)
  );
  const zonePx = zoneToPx(state.zone, canvas.width, canvas.height);
  const verdicts = dets.map((d) => evaluateDetection(d, zonePx, state.mode));
  const alarms = [];
  dets.forEach((d, i) => {
    if (verdicts[i].intruded) alarms.push({ det: d, v: verdicts[i] });
  });
  alarms.sort((a, b) => b.det.score - a.det.score);

  render(ctx, canvas, {
    frame: state.frame,
    dets,
    verdicts,
    zone: state.zone,
    editing: state.editing,
    hasAlarm: alarms.length > 0
  });

  // 统计
  $('statTotal').textContent = String(dets.length);
  $('statIntrude').textContent = String(alarms.length);
  $('statRate').textContent = dets.length
    ? `${Math.round((alarms.length / dets.length) * 100)}%`
    : '—';
  $('statCost').textContent = state.cost ? `${Math.round(state.cost)} ms` : '—';
  $('alarmBadge').textContent = String(alarms.length);

  // 日志
  state.logs = alarms.map((a) => ({
    cls: a.det.label,
    score: a.det.score,
    x: Math.round(a.v.ground.x),
    y: Math.round(a.v.ground.y),
    stamp: state.editorStamp || state.stamp,
    batch: state.batch
  }));
  renderLog();
  $('btnExport').disabled = state.logs.length === 0;
}

function renderLog() {
  const box = $('logList');
  if (!state.logs.length) {
    box.innerHTML = state.frame
      ? '<p class="log-empty">当前画面无越界目标。可拖动警戒区或下调阈值后观察判定变化。</p>'
      : '<p class="log-empty">尚无报警。载入图像并执行分析后，越界目标将在此登记。</p>';
    return;
  }
  box.innerHTML = state.logs
    .map(
      (l) => `
    <div class="log-item">
      <div class="log-top">
        <span class="log-cls">${zhName(l.cls)}</span>
        <span class="log-score">${l.score.toFixed(2)}</span>
      </div>
      <div class="log-sub">
        <span>落点 ${l.x}, ${l.y}</span>
        <span>#${l.batch} · ${l.stamp}</span>
      </div>
    </div>`
    )
    .join('');
}

/* ---------------- 导出 ---------------- */

function exportCsv() {
  if (!state.logs.length) return;
  const head = ['批次', '时间', '序号', '类别', '类别代码', '置信度', '落点X', '落点Y', '判定'];
  const rows = state.logs.map((l, i) => [
    l.batch, l.stamp, i + 1, zhName(l.cls), l.cls, l.score.toFixed(3), l.x, l.y, '入侵'
  ]);
  const csv = '\uFEFF' + [head, ...rows]
    .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
    .join('\r\n');

  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  const d = new Date();
  const ts = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  a.href = url;
  a.download = `巡检报警日志_批次${state.batch}_${ts}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
  toast('已导出当前批次的报警日志');
}

/* ---------------- 事件绑定 ---------------- */

function bindUI() {
  $('dropzone').addEventListener('click', () => $('fileInput').click());
  $('dropzone').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      $('fileInput').click();
    }
  });
  $('fileInput').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) readFile(f);
    e.target.value = '';
  });

  const dz = $('dropzone');
  ['dragenter', 'dragover'].forEach((ev) =>
    dz.addEventListener(ev, (e) => {
      e.preventDefault();
      dz.classList.add('drag');
    })
  );
  ['dragleave', 'drop'].forEach((ev) =>
    dz.addEventListener(ev, (e) => {
      e.preventDefault();
      dz.classList.remove('drag');
    })
  );
  dz.addEventListener('drop', (e) => {
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f && f.type.startsWith('image/')) readFile(f);
    else toast('请拖入图片文件');
  });

  // 舞台同样接受拖放
  const wrap = $('stageWrap');
  ['dragenter', 'dragover'].forEach((ev) =>
    wrap.addEventListener(ev, (e) => {
      e.preventDefault();
      wrap.classList.add('drag');
    })
  );
  wrap.addEventListener('dragleave', () => wrap.classList.remove('drag'));
  wrap.addEventListener('drop', (e) => {
    e.preventDefault();
    wrap.classList.remove('drag');
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f && f.type.startsWith('image/')) readFile(f);
  });

  // 粘贴板
  window.addEventListener('paste', (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const it of items) {
      if (it.type.startsWith('image/')) {
        readFile(it.getAsFile());
        break;
      }
    }
  });

  $('threshold').addEventListener('input', (e) => {
    state.threshold = Number(e.target.value);
    $('thresholdOut').textContent = state.threshold.toFixed(2);
    applyFilters();
  });

  $('verdictMode').addEventListener('change', (e) => {
    state.mode = e.target.value;
    applyFilters();
  });

  $('btnAnalyze').addEventListener('click', analyze);
  $('btnExport').addEventListener('click', exportCsv);
  $('btnResetZone').addEventListener('click', () => {
    editor.setZone(DEFAULT_ZONE);
    toast('警戒区已重置为默认范围');
  });

  $('btnEditZone').addEventListener('click', (e) => {
    state.editing = !state.editing;
    editor.setEnabled(state.editing);
    editor.setDrawMode(false);
    e.currentTarget.setAttribute('aria-pressed', String(state.editing));
    e.currentTarget.textContent = state.editing ? '完成编辑' : '编辑警戒区';
    $('zoneNote').textContent = `警戒区 A · ${state.editing ? '编辑中' : '已启用'}`;
    applyFilters();
  });
}

function readFile(file) {
  if (!file) return;
  if (file.size > 12 * 1024 * 1024) {
    toast('图片超过 12 MB，请先压缩');
    return;
  }
  document.querySelectorAll('.sample').forEach((n) => n.classList.remove('active'));
  const url = URL.createObjectURL(file);
  loadImage(url, '本地图像').finally(() => setTimeout(() => URL.revokeObjectURL(url), 2000));
}

/* ---------------- 启动 ---------------- */

async function boot() {
  buildSamples();
  buildChips();
  bindUI();

  editor = new ZoneEditor(canvas, (z) => {
    state.zone = z;
    $('zoneNote').textContent = `警戒区 A · ${state.editing ? '编辑中' : '已启用'}`;
    applyFilters();
  });
  window.__zoneEditor = editor;
  window.__state = state;

  if (location.protocol === 'file:') {
    $('modelChipText').textContent = '需通过 HTTP 访问';
    $('modelChip').querySelector('.dot').className = 'dot dot-err';
    emptyState.querySelector('.empty-title').textContent = '请通过本地服务器或线上链接打开';
    emptyState.querySelector('.empty-desc').textContent =
      '浏览器安全策略禁止 file:// 协议加载 WASM 与 ES 模块。请在项目目录执行 python -m http.server 8000，然后访问 http://localhost:8000。';
    return;
  }

  const chip = $('modelChip');
  const chipText = $('modelChipText');
  const dot = chip.querySelector('.dot');

  try {
    state.ready = state.detector.init((msg) => {
      chipText.textContent = msg;
    });
    const info = await state.ready;
    dot.className = 'dot dot-ok';
    chipText.textContent = '模型就绪';
    $('sysEngine').textContent = info.model;
    $('engineChip').textContent = 'EfficientDet-Lite0 · INT8 · WASM';
    $('statusText').textContent = '系统就绪 · 等待图像';
  } catch (err) {
    dot.className = 'dot dot-err';
    chipText.textContent = '模型加载失败';
    $('sysEngine').textContent = '加载失败';
    toast('模型加载失败，请检查 vendor 目录或网络策略', 5000);
    console.error(err);
  }
}

boot();
