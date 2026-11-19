/**
 * detector.js — 目标检测推理封装
 * 运行时：MediaPipe Tasks Vision（WASM / CPU）
 * 模型：EfficientDet-Lite0 INT8（COCO 80 类）
 * 全部资源来自本地 vendor/，不依赖任何外网 CDN。
 */
import { FilesetResolver, ObjectDetector } from '../../vendor/mediapipe/vision_bundle.mjs';

const WASM_DIR = new URL('vendor/mediapipe/wasm', document.baseURI).href;
const MODEL_PATH = new URL('vendor/models/efficientdet_lite0_int8.tflite', document.baseURI).href;

export class Detector {
  constructor() {
    this.model = null;
  }

  /** 初始化推理引擎；返回模型元信息 */
  async init(onProgress = () => {}) {
    onProgress('加载 WASM 运行时');
    const vision = await FilesetResolver.forVisionTasks(WASM_DIR);

    onProgress('载入检测模型');
    this.model = await ObjectDetector.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: MODEL_PATH,
        delegate: 'CPU'
      },
      runningMode: 'IMAGE',
      // 阈值放宽到 0.1，界面上的滑杆可在不重新推理的前提下做二次筛选
      scoreThreshold: 0.1,
      maxResults: 60
    });

    onProgress('预热推理管线');
    const warm = document.createElement('canvas');
    warm.width = 320;
    warm.height = 320;
    const ctx = warm.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 320, 320);
    this.model.detect(warm);

    return { model: 'EfficientDet-Lite0 / INT8' };
  }

  /**
   * 对画布做一次检测
   * @param {HTMLCanvasElement} canvas 已按最大边长缩放过的画面
   * @returns {Promise<Array<{label:string,score:number,box:{x:number,y:number,w:number,h:number}}>>}
   */
  async detect(canvas) {
    if (!this.model) throw new Error('模型尚未加载');
    const result = this.model.detect(canvas);
    const out = [];
    for (const det of result.detections || []) {
      const c = det.categories && det.categories[0];
      if (!c) continue;
      const b = det.boundingBox;
      out.push({
        label: c.categoryName || 'object',
        score: c.score,
        box: { x: b.originX, y: b.originY, w: b.width, h: b.height }
      });
    }
    return out;
  }
}
