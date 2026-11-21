import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  pointInRect,
  overlapRatio,
  evaluateDetection,
  zoneToPx,
  DEFAULT_ZONE
} from '../assets/js/zone.js';

const ZONE = { x: 100, y: 100, w: 200, h: 200 };

test('pointInRect：边界点计入区域，区域外不计入', () => {
  assert.equal(pointInRect(150, 150, ZONE), true);
  assert.equal(pointInRect(100, 100, ZONE), true, '左上角属于区域');
  assert.equal(pointInRect(300, 300, ZONE), true, '右下角属于区域');
  assert.equal(pointInRect(99, 150, ZONE), false);
  assert.equal(pointInRect(301, 150, ZONE), false);
});

test('overlapRatio：完全重叠为 1，不相交为 0，半重叠为 0.5', () => {
  assert.equal(overlapRatio({ x: 100, y: 100, w: 100, h: 100 }, { x: 100, y: 100, w: 100, h: 100 }), 1);
  assert.equal(overlapRatio({ x: 0, y: 0, w: 50, h: 50 }, { x: 100, y: 100, w: 50, h: 50 }), 0);
  assert.equal(overlapRatio({ x: 100, y: 100, w: 100, h: 100 }, { x: 150, y: 100, w: 100, h: 100 }), 0.5);
});

test('overlapRatio：目标框面积为 0 时返回 0，不产生除零', () => {
  assert.equal(overlapRatio({ x: 0, y: 0, w: 0, h: 0 }, ZONE), 0);
});

test('落地点判据：底边中点落在区域内判定为越界', () => {
  const det = { box: { x: 100, y: 100, w: 100, h: 150 } }; // 底边中点 (150, 250)
  const r = evaluateDetection(det, ZONE, 'ground');
  assert.equal(r.ground.x, 150);
  assert.equal(r.ground.y, 250);
  assert.equal(r.intruded, true);
});

test('落地点判据：目标整体在区域上方时判定为未越界', () => {
  const det = { box: { x: 120, y: 0, w: 60, h: 80 } }; // 底边 y = 80 < 区域上沿 100
  assert.equal(evaluateDetection(det, ZONE, 'ground').intruded, false);
});

test('中心点与落地点判据对同一目标可以给出不同结论', () => {
  const det = { box: { x: 140, y: 60, w: 20, h: 60 } }; // 中心 y=90 在区外，底边 y=120 在区内
  assert.equal(evaluateDetection(det, ZONE, 'center').intruded, false);
  assert.equal(evaluateDetection(det, ZONE, 'ground').intruded, true);
});

test('重叠率判据：目标框落入区域的面积达到 15% 才判定越界', () => {
  const zone = { x: 0, y: 0, w: 100, h: 100 };
  const det = { x: 0, y: 0, w: 100, h: 100 };
  assert.equal(overlapRatio(det, { x: 0, y: 0, w: 10, h: 100 }), 0.1);
  assert.equal(evaluateDetection({ box: det }, { x: 0, y: 0, w: 10, h: 100 }, 'overlap').intruded, false);
  assert.equal(evaluateDetection({ box: det }, { x: 0, y: 0, w: 20, h: 100 }, 'overlap').intruded, true);
});

test('zoneToPx：归一化坐标按画布尺寸换算', () => {
  const px = zoneToPx({ x: 0.5, y: 0.25, w: 0.25, h: 0.5 }, 800, 400);
  assert.deepEqual(px, { x: 400, y: 100, w: 200, h: 200 });
});

test('DEFAULT_ZONE 落在画面内且非退化', () => {
  assert.ok(DEFAULT_ZONE.w > 0.1 && DEFAULT_ZONE.h > 0.1);
  assert.ok(DEFAULT_ZONE.x >= 0 && DEFAULT_ZONE.y >= 0);
  assert.ok(DEFAULT_ZONE.x + DEFAULT_ZONE.w <= 1);
  assert.ok(DEFAULT_ZONE.y + DEFAULT_ZONE.h <= 1);
});
