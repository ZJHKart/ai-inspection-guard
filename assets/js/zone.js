/**
 * zone.js — 警戒区几何与交互编辑
 * 警戒区以归一化坐标保存（0~1），与画布分辨率解耦。
 */

export const DEFAULT_ZONE = { x: 0.33, y: 0.16, w: 0.30, h: 0.78 };

export function zoneToPx(zone, W, H) {
  return { x: zone.x * W, y: zone.y * H, w: zone.w * W, h: zone.h * H };
}

export function pointInRect(px, py, r) {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

export function overlapRatio(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const area = a.w * a.h;
  return area > 0 ? inter / area : 0;
}

/**
 * 判定单个目标是否侵入警戒区
 * @param {{box:{x,y,w,h}}} det
 * @param {{x,y,w,h}} zonePx
 * @param {'ground'|'center'|'overlap'} mode
 */
export function evaluateDetection(det, zonePx, mode) {
  const b = det.box;
  const center = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const ground = { x: b.x + b.w / 2, y: b.y + b.h };
  let intruded = false;
  if (mode === 'center') intruded = pointInRect(center.x, center.y, zonePx);
  else if (mode === 'overlap') intruded = overlapRatio(b, zonePx) >= 0.15;
  else intruded = pointInRect(ground.x, ground.y, zonePx);
  return { intruded, center, ground };
}

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/**
 * 画布上的警戒区拖拽 / 缩放 / 重绘
 */
export class ZoneEditor {
  constructor(canvas, onChange) {
    this.canvas = canvas;
    this.onChange = onChange;
    this.zone = { ...DEFAULT_ZONE };
    this.enabled = false;
    this.drawMode = false;
    this.drag = null;
    this._bind();
  }

  setZone(zone) {
    this.zone = { ...zone };
    this.onChange(this.zone);
  }

  setEnabled(v) {
    this.enabled = !!v;
    this.canvas.classList.toggle('editing', this.enabled);
  }

  setDrawMode(v) {
    this.drawMode = !!v;
    if (this.drawMode) this.canvas.classList.add('editing');
  }

  /** client 坐标 → 画布像素坐标 */
  _toCanvas(e) {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * this.canvas.width,
      y: ((e.clientY - r.top) / r.height) * this.canvas.height,
      scale: this.canvas.width / r.width
    };
  }

  _handlePoints(z) {
    const { x, y, w, h } = z;
    return {
      nw: { x, y }, n: { x: x + w / 2, y }, ne: { x: x + w, y },
      e: { x: x + w, y: y + h / 2 }, se: { x: x + w, y: y + h },
      s: { x: x + w / 2, y: y + h }, sw: { x, y: y + h }, w: { x, y: y + h / 2 }
    };
  }

  _hitHandle(px, py, radius) {
    const z = zoneToPx(this.zone, this.canvas.width, this.canvas.height);
    const pts = this._handlePoints(z);
    for (const h of HANDLES) {
      if (Math.abs(px - pts[h].x) <= radius && Math.abs(py - pts[h].y) <= radius) return h;
    }
    return null;
  }

  _clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  _bind() {
    const c = this.canvas;

    c.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      const p = this._toCanvas(e);
      const W = c.width, H = c.height;

      if (this.drawMode) {
        this.drawMode = false;
        this.drag = { type: 'draw', origin: p, start: { x: p.x / W, y: p.y / H } };
        this.zone = { x: p.x / W, y: p.y / H, w: 0.001, h: 0.001 };
        c.setPointerCapture(e.pointerId);
        return;
      }

      const z = zoneToPx(this.zone, W, H);
      const handle = this._hitHandle(p.x, p.y, 10 * p.scale);
      if (handle) {
        this.drag = { type: 'resize', handle, start: this.zone };
      } else if (pointInRect(p.x, p.y, z)) {
        this.drag = { type: 'move', origin: p, start: this.zone };
      } else {
        return;
      }
      c.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    c.addEventListener('pointermove', (e) => {
      if (!this.enabled) return;
      const p = this._toCanvas(e);

      if (!this.drag) {
        const handle = this._hitHandle(p.x, p.y, 10 * p.scale);
        c.style.cursor = this.drawMode ? 'crosshair' : handle ? cursorFor(handle) : 'default';
        return;
      }

      const W = c.width, H = c.height;
      const nx = p.x / W, ny = p.y / H;

      if (this.drag.type === 'move') {
        const dx = (p.x - this.drag.origin.x) / W;
        const dy = (p.y - this.drag.origin.y) / H;
        const s = this.drag.start;
        this.zone = {
          x: this._clamp(s.x + dx, 0, 1 - s.w),
          y: this._clamp(s.y + dy, 0, 1 - s.h),
          w: s.w, h: s.h
        };
      } else if (this.drag.type === 'resize') {
        this.zone = resizeZone(this.drag.start, this.drag.handle, nx, ny);
      } else if (this.drag.type === 'draw') {
        const s = this.drag.start;
        this.zone = {
          x: Math.min(s.x, nx),
          y: Math.min(s.y, ny),
          w: Math.max(Math.abs(nx - s.x), 0.02),
          h: Math.max(Math.abs(ny - s.y), 0.02)
        };
      }
      this.onChange(this.zone);
    });

    const end = (e) => {
      if (!this.drag) return;
      if (this.drag.type === 'draw') {
        // 兜底：过小的框回到默认尺寸
        if (this.zone.w < 0.05 || this.zone.h < 0.05) {
          this.zone = { ...DEFAULT_ZONE };
        }
      }
      this.drag = null;
      this.onChange(this.zone);
      if (c.hasPointerCapture(e.pointerId)) c.releasePointerCapture(e.pointerId);
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
  }
}

function resizeZone(start, handle, nx, ny) {
  const MIN = 0.04;
  let { x, y, w, h } = start;
  const right = x + w;
  const bottom = y + h;

  if (handle.includes('n')) {
    const top = Math.min(Math.max(0, ny), bottom - MIN);
    y = top;
    h = bottom - top;
  }
  if (handle.includes('s')) {
    const b = Math.max(Math.min(1, ny), y + MIN);
    h = b - y;
  }
  if (handle.includes('w')) {
    const left = Math.min(Math.max(0, nx), right - MIN);
    x = left;
    w = right - left;
  }
  if (handle.includes('e')) {
    const r = Math.max(Math.min(1, nx), x + MIN);
    w = r - x;
  }
  return { x, y, w, h };
}

function cursorFor(handle) {
  if (handle === 'n' || handle === 's') return 'ns-resize';
  if (handle === 'e' || handle === 'w') return 'ew-resize';
  if (handle === 'nw' || handle === 'se') return 'nwse-resize';
  return 'nesw-resize';
}
