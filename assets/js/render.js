/**
 * render.js — 画布绘制：画面、警戒区、检测框、状态标记
 */
import { zoneToPx } from './zone.js';
import { zhName } from './labels.js';

export const C = {
  accent: '#4cc2ff',
  alarm: '#ff5d47',
  ink: '#0a0f15',
  plate: 'rgba(9, 13, 18, .82)'
};

export function render(ctx, canvas, { frame, dets, verdicts, zone, editing, hasAlarm }) {
  const W = canvas.width;
  const H = canvas.height;
  const s = Math.min(1.6, Math.max(0.7, W / 1180));

  ctx.clearRect(0, 0, W, H);
  if (frame) ctx.drawImage(frame, 0, 0, W, H);

  const zonePx = zone ? zoneToPx(zone, W, H) : null;
  if (zonePx) drawZone(ctx, zonePx, s, hasAlarm, editing);

  (dets || []).forEach((det, i) => {
    const v = verdicts[i];
    drawDetection(ctx, det, v, s, W, H);
  });

  if (zonePx && editing) drawHandles(ctx, zonePx, s);
}

function drawZone(ctx, z, s, alarm, editing) {
  ctx.save();
  ctx.fillStyle = alarm ? 'rgba(255, 93, 71, .10)' : 'rgba(76, 194, 255, .07)';
  ctx.fillRect(z.x, z.y, z.w, z.h);

  ctx.strokeStyle = alarm ? C.alarm : C.accent;
  ctx.lineWidth = Math.max(1, 1.4 * s);
  ctx.setLineDash([7 * s, 5 * s]);
  ctx.strokeRect(z.x + .5, z.y + .5, z.w, z.h);
  ctx.setLineDash([]);

  // 四角实线刻度，强化"区域"边界感
  const L = Math.min(26 * s, z.w / 4, z.h / 4);
  ctx.lineWidth = 3 * s;
  ctx.lineCap = 'butt';
  const corners = [
    [z.x, z.y, 1, 1], [z.x + z.w, z.y, -1, 1],
    [z.x, z.y + z.h, 1, -1], [z.x + z.w, z.y + z.h, -1, -1]
  ];
  for (const [cx, cy, dx, dy] of corners) {
    ctx.beginPath();
    ctx.moveTo(cx + dx * L, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy + dy * L);
    ctx.stroke();
  }
  ctx.restore();

  // 区域铭牌
  const fs = 11 * s;
  const text = editing ? '警戒区 A · 编辑中' : '警戒区 A';
  ctx.save();
  ctx.font = `600 ${fs}px "JetBrains Mono", Consolas, monospace`;
  const tw = ctx.measureText(text).width;
  const padX = 7 * s;
  const plateH = 20 * s;
  const py = z.y - plateH - 5 * s < 2 ? z.y + 4 * s : z.y - plateH - 5 * s;
  ctx.fillStyle = alarm ? C.alarm : C.accent;
  ctx.fillRect(z.x, py, tw + padX * 2, plateH);
  ctx.fillStyle = C.ink;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, z.x + padX, py + plateH / 2 + .5);
  ctx.restore();
}

function drawDetection(ctx, det, v, s, W, H) {
  const b = det.box;
  const alarm = v && v.intruded;
  const color = alarm ? C.alarm : C.accent;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = (alarm ? 2.2 : 1.4) * s;
  ctx.strokeRect(b.x, b.y, b.w, b.h);

  // 四角短线
  const L = Math.min(13 * s, b.w / 3, b.h / 3);
  ctx.lineWidth = (alarm ? 3 : 2) * s;
  const cs = [
    [b.x, b.y, 1, 1], [b.x + b.w, b.y, -1, 1],
    [b.x, b.y + b.h, 1, -1], [b.x + b.w, b.y + b.h, -1, -1]
  ];
  for (const [cx, cy, dx, dy] of cs) {
    ctx.beginPath();
    ctx.moveTo(cx + dx * L, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy + dy * L);
    ctx.stroke();
  }

  // 标签
  const fs = 11.5 * s;
  ctx.font = `600 ${fs}px "Inter", "Microsoft YaHei", sans-serif`;
  const label = `${zhName(det.label)} ${det.score.toFixed(2)}`;
  const tw = ctx.measureText(label).width;
  const padX = 6 * s;
  const lh = 19 * s;
  const ly = b.y - lh - 3 * s < 2 ? b.y + 3 * s : b.y - lh - 3 * s;
  ctx.fillStyle = alarm ? C.alarm : C.plate;
  ctx.fillRect(b.x, ly, tw + padX * 2 + (alarm ? 0 : 0), lh);
  ctx.fillStyle = alarm ? C.ink : '#d8e6f2';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, b.x + padX, ly + lh / 2 + .5);

  // 落地点：判定依据可视化
  if (v && v.ground && (alarm || v.intruded)) {
    ctx.beginPath();
    ctx.arc(v.ground.x, v.ground.y, 3.4 * s, 0, Math.PI * 2);
    ctx.fillStyle = alarm ? C.alarm : C.accent;
    ctx.fill();
    if (alarm) {
      ctx.beginPath();
      ctx.arc(v.ground.x, v.ground.y, 9 * s, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 93, 71, .5)';
      ctx.lineWidth = 1.2 * s;
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawHandles(ctx, z, s) {
  const r = 4.6 * s;
  const pts = [
    [z.x, z.y], [z.x + z.w / 2, z.y], [z.x + z.w, z.y],
    [z.x + z.w, z.y + z.h / 2], [z.x + z.w, z.y + z.h],
    [z.x + z.w / 2, z.y + z.h], [z.x, z.y + z.h], [z.x, z.y + z.h / 2]
  ];
  ctx.save();
  for (const [x, y] of pts) {
    ctx.beginPath();
    ctx.rect(x - r, y - r, r * 2, r * 2);
    ctx.fillStyle = '#0b0e13';
    ctx.fill();
    ctx.strokeStyle = C.accent;
    ctx.lineWidth = 1.6 * s;
    ctx.stroke();
  }
  ctx.restore();
}
