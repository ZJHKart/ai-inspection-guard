/**
 * main.js — 应用编排：图像载入、推理调度、参数联动、批量检测、历史与导出
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

const HISTORY_KEY = 'aig.history.v1';
const HISTORY_LIMIT = 200;
const MAX_SIDE = 1280;

const state = {
  detector: new Detector(),
  ready: null,
  frame: null,
  fileName: '',
  rawDets: [],
  threshold: 0.30,
  classes: new Set(['person', 'car', 'truck', 'bus']),
  otherOn: false,
  mode: 'ground',
  zone: { ...DEFAULT_ZONE },
  editing: false,
  batch: 0,
  cost: 0,
  stamp: '',
  busy: false,
  logs: [],
  history: [],
  results: [],
  batchRunning: false
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
  return new Date().toLocaleTimeString('zh-CN', { hour12: false });
}

function todayTag() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function isAllowed(label) {
  if (state.classes.has(label)) return true;
  return state.otherOn && !KEY_CLASSES.includes(label);
}

function downloadCsv(name, head, rows) {
  const csv = '\uFEFF' + [head, ...rows]
    .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
    .join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

/* ---------------- 历史批次（localStorage） ---------------- */

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    state.history = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(state.history)) state.history = [];
  } catch {
    state.history = [];
  }
}

function saveHistory() {
  try {
    if (state.history.length > HISTORY_LIMIT) {
      state.history = state.history.slice(0, HISTORY_LIMIT);
    }
    localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history));
  } catch {
    /* 存储被禁用时静默降级，不影响主流程 */
  }
}

function addHistory(entry) {
  state.history.unshift(entry);
  saveHistory();
  renderHistory();
}

function renderHistory() {
  const box = $('historyList');
  if (!box) return;
  if (!state.history.length) {
    box.innerHTML = '<p class="log-empty">还没有历史批次。每次分析或批量检测都会在这里留档，刷新页面不会丢失。</p>';
    return;
  }
  box.innerHTML = state.history
    .slice(0, 30)
    .map(
      (h) => `
    <div class="hist-item">
      <span class="hist-name" title="${h.name || '未命名'}">${h.name || '未命名'}</span>
      <span class="hist-num mono">${h.intrude}/${h.total}</span>
      <span class="hist-time mono">${h.time}</span>
    </div>`
    )
    .join('');
}

function clearHistory() {
  if (!state.history.length) return;
  state.history = [];
  saveHistory();
  renderHistory();
  toast('历史记录已清空');
}

function exportHistory() {
  if (!state.history.length) return;
  const head = ['时间', '来源', '模式', '文件名', '关注目标', '越界目标', '耗时(ms)'];
  const rows = state.history.map((h) => [
    h.time, h.source || '图像', h.mode === 'batch' ? '批量' : '单张',
    h.name || '', h.total, h.intrude, h.cost ? Math.round(h.cost) : ''
  ]);
  downloadCsv(`巡检历史批次_${todayTag()}.csv`, head, rows);
  toast('已导出全部历史批次');
}

/* ---------------- 图像与渲染 ---------------- */

async function buildFrame(src) {
  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('图像解码失败'));
    i.src = src;
  });
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const frame = document.createElement('canvas');
  frame.width = Math.round(img.naturalWidth * scale);
  frame.height = Math.round(img.naturalHeight * scale);
  frame.getContext('2d').drawImage(img, 0, 0, frame.width, frame.height);
  return frame;
}

/** 按当前阈值/类别过滤，并计算每个目标的越界判定 */
function evaluate(frame, rawDets) {
  const dets = rawDets.filter((d) => d.score >= state.threshold && isAllowed(d.label));
  const zonePx = zoneToPx(state.zone, frame.width, frame.height);
  const verdicts = dets.map((d) => evaluateDetection(d, zonePx, state.mode));
  const alarms = [];
  dets.forEach((d, i) => {
    if (verdicts[i].intruded) alarms.push({ det: d, v: verdicts[i] });
  });
  alarms.sort((a, b) => b.det.score - a.det.score);
  return { dets, verdicts, alarms };
}

function paint(frame, dets, verdicts, hasAlarm, editing) {
  canvas.width = frame.width;
  canvas.height = frame.height;
  render(ctx, canvas, {
    frame,
    dets,
    verdicts,
    zone: state.zone,
    editing,
    hasAlarm
  });
}

/* ---------------- 初始化 ---------------- */

function buildSamples() {
  const box = $('samples');
  SAMPLES.forEach((s) => {
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
  $('btnBatch').disabled = busy || !state.detector.model;
  if (busy) $('statusText').textContent = '正在推理 · EfficientDet-Lite0 …';
}

/* ---------------- 单图流程 ---------------- */

async function loadImage(src, name) {
  try {
    const frame = await buildFrame(src);
    state.frame = frame;
    state.fileName = name || '本地图像';

    emptyState.hidden = true;
    $('btnEditZone').disabled = false;
    $('btnResetZone').disabled = false;
    $('btnExport').disabled = true;
    $('sysRes').textContent = `${frame.width} × ${frame.height}`;
    $('statusMeta').textContent = `${frame.width}×${frame.height} · 待分析`;
    $('statusText').textContent = name ? `已载入场景：${name}` : '已载入图像';
    $('zoneNote').textContent = '警戒区 A · 已启用';

    await analyze();
  } catch (err) {
    toast(err.message || '图像载入失败');
  }
}

async function analyze() {
  if (!state.frame || state.busy) return;
  if (!state.detector.model) {
    toast('模型尚未就绪，请稍候');
    return;
  }
  setBusyUI(true);
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 60)));

  let rawDets = [];
  const t0 = performance.now();
  try {
    rawDets = await state.detector.detect(state.frame);
  } catch (err) {
    setBusyUI(false);
    toast('推理失败：' + (err.message || err));
    return;
  }
  state.cost = performance.now() - t0;
  state.rawDets = rawDets;
  state.batch += 1;
  state.stamp = nowStamp();

  applyFilters();
  setBusyUI(false);
  $('sysBatch').textContent = String(state.batch);

  const { dets, alarms } = evaluate(state.frame, rawDets);
  $('statusText').textContent = dets.length
    ? `分析完成 · 关注目标 ${dets.length} 个（候选 ${rawDets.length}）`
    : '分析完成 · 未检出关注目标';
  $('statusMeta').textContent = `推理 ${Math.round(state.cost)} ms · 批次 #${state.batch}`;

  addHistory({
    time: state.stamp,
    name: state.fileName,
    source: '图像',
    mode: 'single',
    total: dets.length,
    intrude: alarms.length,
    cost: state.cost,
    batch: state.batch
  });
}

function applyFilters() {
  if (!state.frame) return;

  const { dets, verdicts, alarms } = evaluate(state.frame, state.rawDets);
  paint(state.frame, dets, verdicts, alarms.length > 0, state.editing);

  $('statTotal').textContent = String(dets.length);
  $('statIntrude').textContent = String(alarms.length);
  $('statRate').textContent = dets.length ? `${Math.round((alarms.length / dets.length) * 100)}%` : '—';
  $('statCost').textContent = state.cost ? `${Math.round(state.cost)} ms` : '—';
  $('alarmBadge').textContent = String(alarms.length);

  state.logs = alarms.map((a) => ({
    cls: a.det.label,
    score: a.det.score,
    x: Math.round(a.v.ground.x),
    y: Math.round(a.v.ground.y),
    stamp: state.stamp,
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

/* ---------------- 批量检测 ---------------- */

async function runBatch(files) {
  if (state.batchRunning || !state.detector.model) return;
  const list = Array.from(files).filter((f) => f.type.startsWith('image/'));
  if (!list.length) {
    toast('请选择图片文件');
    return;
  }

  state.batchRunning = true;
  state.results = [];
  $('btnBatch').disabled = true;
  $('btnAnalyze').disabled = true;
  $('batchPanel').hidden = false;
  $('batchBody').innerHTML = '<p class="log-empty">正在处理…</p>';
  $('batchSummary').textContent = `0 / ${list.length}`;

  for (let i = 0; i < list.length; i += 1) {
    const file = list[i];
    $('batchSummary').textContent = `${i + 1} / ${list.length} · ${file.name}`;
    $('statusText').textContent = `批量检测 ${i + 1}/${list.length}：${file.name}`;
    const url = URL.createObjectURL(file);
    try {
      const frame = await buildFrame(url);
      const t0 = performance.now();
      const rawDets = await state.detector.detect(frame);
      const cost = performance.now() - t0;
      const { dets, verdicts, alarms } = evaluate(frame, rawDets);

      state.results.push({
        name: file.name,
        ok: true,
        total: dets.length,
        intrude: alarms.length,
        cost,
        dets: dets.map((d, k) => ({
          label: d.label,
          score: +d.score.toFixed(2),
          intruded: verdicts[k].intruded
        }))
      });

      // 画布跟随当前处理的图像，便于查看进度
      state.frame = frame;
      state.fileName = file.name;
      paint(frame, dets, verdicts, alarms.length > 0, false);
      emptyState.hidden = true;
      $('sysRes').textContent = `${frame.width} × ${frame.height}`;
      $('statTotal').textContent = String(dets.length);
      $('statIntrude').textContent = String(alarms.length);
      $('statRate').textContent = dets.length ? `${Math.round((alarms.length / dets.length) * 100)}%` : '—';
      $('statCost').textContent = `${Math.round(cost)} ms`;
      $('alarmBadge').textContent = String(alarms.length);
      state.logs = alarms.map((a) => ({
        cls: a.det.label,
        score: a.det.score,
        x: Math.round(a.v.ground.x),
        y: Math.round(a.v.ground.y),
        stamp: nowStamp(),
        batch: state.batch
      }));
      renderLog();
      renderBatchTable();
    } catch (err) {
      state.results.push({ name: file.name, ok: false, error: String(err.message || err) });
      renderBatchTable();
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  const ok = state.results.filter((r) => r.ok);
  const totalObj = ok.reduce((s, r) => s + r.total, 0);
  const totalAlarm = ok.reduce((s, r) => s + r.intrude, 0);
  const avg = ok.length ? ok.reduce((s, r) => s + r.cost, 0) / ok.length : 0;

  state.batch += 1;
  $('batchSummary').textContent =
    `${list.length} 张 · 目标 ${totalObj} · 越界 ${totalAlarm} · 平均 ${Math.round(avg)} ms`;
  $('statusText').textContent = `批量检测完成 · ${list.length} 张图，${totalAlarm} 个越界目标`;
  $('statusMeta').textContent = `平均 ${Math.round(avg)} ms/张 · 批次 #${state.batch}`;
  $('sysBatch').textContent = String(state.batch);
  $('btnBatch').disabled = false;
  $('btnAnalyze').disabled = false;
  state.batchRunning = false;

  addHistory({
    time: nowStamp(),
    name: `批量 ${list.length} 张`,
    source: '批量',
    mode: 'batch',
    total: totalObj,
    intrude: totalAlarm,
    cost: avg,
    batch: state.batch
  });
}

function renderBatchTable() {
  const box = $('batchBody');
  const rows = state.results
    .map(
      (r, i) => `
    <tr>
      <td class="mono">${i + 1}</td>
      <td class="batch-name" title="${r.name}">${r.name}</td>
      <td class="mono">${r.ok ? r.total : '—'}</td>
      <td class="mono ${r.ok && r.intrude ? 'alarm' : ''}">${r.ok ? r.intrude : '—'}</td>
      <td class="mono">${r.ok ? Math.round(r.cost) + ' ms' : '解码失败'}</td>
      <td class="batch-dets">${r.ok ? r.dets.map((d) => `${zhName(d.label)}${d.intruded ? '!' : ''}`).join(' ') : ''}</td>
    </tr>`
    )
    .join('');
  box.innerHTML = `
    <table class="batch-table">
      <thead><tr><th>#</th><th>文件</th><th>目标</th><th>越界</th><th>耗时</th><th>明细（! = 越界）</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function exportBatch() {
  const ok = state.results.filter((r) => r.ok);
  if (!ok.length) return;
  const head = ['文件名', '关注目标', '越界目标', '耗时(ms)', '检出明细'];
  const rows = state.results.map((r) => [
    r.name,
    r.ok ? r.total : '',
    r.ok ? r.intrude : '',
    r.ok ? Math.round(r.cost) : '',
    r.ok ? r.dets.map((d) => `${zhName(d.label)}(${d.score}${d.intruded ? ',越界' : ''})`).join(' | ') : '解码失败'
  ]);
  downloadCsv(`批量检测结果_${todayTag()}.csv`, head, rows);
  toast('已导出批量检测结果');
}

/* ---------------- 导出（单批次） ---------------- */

function exportCsv() {
  if (!state.logs.length) return;
  const head = ['批次', '时间', '序号', '类别', '类别代码', '置信度', '落点X', '落点Y', '判定'];
  const rows = state.logs.map((l, i) => [
    l.batch, l.stamp, i + 1, zhName(l.cls), l.cls, l.score.toFixed(3), l.x, l.y, '入侵'
  ]);
  downloadCsv(`巡检报警日志_批次${state.batch}_${todayTag()}.csv`, head, rows);
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

  $('btnBatch').addEventListener('click', () => $('batchInput').click());
  $('batchInput').addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length) runBatch(e.target.files);
    e.target.value = '';
  });
  $('btnBatchClose').addEventListener('click', () => {
    $('batchPanel').hidden = true;
  });
  $('btnBatchCsv').addEventListener('click', exportBatch);

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
    const fs = e.dataTransfer.files;
    if (!fs || !fs.length) return;
    if (fs.length > 1) runBatch(fs);
    else if (fs[0].type.startsWith('image/')) readFile(fs[0]);
    else toast('请拖入图片文件');
  });

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
    const fs = e.dataTransfer.files;
    if (!fs || !fs.length) return;
    if (fs.length > 1) runBatch(fs);
    else if (fs[0].type.startsWith('image/')) readFile(fs[0]);
  });

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
  $('btnClearHistory').addEventListener('click', clearHistory);
  $('btnExportHistory').addEventListener('click', exportHistory);
  $('btnRetry').addEventListener('click', () => initModel(true));
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
  loadImage(url, file.name).finally(() => setTimeout(() => URL.revokeObjectURL(url), 2000));
}

/* ---------------- 启动 ---------------- */

async function initModel(isRetry = false) {
  const chip = $('modelChip');
  const chipText = $('modelChipText');
  const dot = chip.querySelector('.dot');
  $('btnRetry').hidden = true;
  dot.className = 'dot dot-wait';
  chipText.textContent = isRetry ? '重新加载…' : '模型加载中';

  try {
    if (isRetry) {
      state.detector = new Detector();
    }
    state.ready = state.detector.init((msg) => {
      chipText.textContent = msg;
    });
    const info = await state.ready;
    dot.className = 'dot dot-ok';
    chipText.textContent = '模型就绪';
    $('sysEngine').textContent = info.model;
    $('engineChip').textContent = 'EfficientDet-Lite0 · INT8 · WASM';
    $('statusText').textContent = '系统就绪 · 等待图像';
    $('btnBatch').disabled = false;
  } catch (err) {
    dot.className = 'dot dot-err';
    chipText.textContent = '模型加载失败';
    $('sysEngine').textContent = '加载失败';
    $('btnRetry').hidden = false;
    toast('模型加载失败，可点“重新加载模型”重试', 5000);
    console.error(err);
  }
}

async function boot() {
  buildSamples();
  buildChips();
  bindUI();
  loadHistory();
  renderHistory();

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

  await initModel();
}

boot();
