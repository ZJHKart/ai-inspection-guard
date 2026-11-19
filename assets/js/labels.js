/** labels.js — COCO 80 类中英文对照与巡检关注类别 */

export const ZH = {
  person: '人员', bicycle: '自行车', car: '轿车', motorcycle: '摩托车', airplane: '飞机',
  bus: '客车', train: '列车', truck: '卡车', boat: '船只', 'traffic light': '信号灯',
  'fire hydrant': '消防栓', 'stop sign': '停止标志', 'parking meter': '停车计时器', bench: '长椅',
  bird: '鸟', cat: '猫', dog: '犬', horse: '马', sheep: '羊', cow: '牛',
  elephant: '大象', bear: '熊', zebra: '斑马', giraffe: '长颈鹿', backpack: '背包',
  umbrella: '雨伞', handbag: '手提包', tie: '领带', suitcase: '行李箱', frisbee: '飞盘',
  skis: '滑雪板', snowboard: '单板', 'sports ball': '球类', kite: '风筝', 'baseball bat': '球棒',
  'baseball glove': '手套', skateboard: '滑板', surfboard: '冲浪板', 'tennis racket': '球拍',
  bottle: '瓶子', 'wine glass': '酒杯', cup: '杯子', fork: '叉子', knife: '刀具',
  spoon: '勺子', bowl: '碗', banana: '香蕉', apple: '苹果', sandwich: '三明治',
  orange: '橙子', broccoli: '西兰花', carrot: '胡萝卜', 'hot dog': '热狗', pizza: '披萨',
  donut: '甜甜圈', cake: '蛋糕', chair: '椅子', couch: '沙发', 'potted plant': '盆栽',
  bed: '床', 'dining table': '餐桌', toilet: '马桶', tv: '显示器', laptop: '笔记本',
  mouse: '鼠标', remote: '遥控器', keyboard: '键盘', 'cell phone': '手机', microwave: '微波炉',
  oven: '烤箱', toaster: '烤面包机', sink: '水槽', refrigerator: '冰箱', book: '书本',
  clock: '时钟', vase: '花瓶', scissors: '剪刀', 'teddy bear': '玩偶', 'hair drier': '吹风机',
  toothbrush: '牙刷'
};

/** 巡检场景的六个核心目标类别 */
export const KEY_CLASSES = ['person', 'car', 'truck', 'bus', 'motorcycle', 'bicycle'];

export const CLASS_CHIPS = [
  { label: 'person', text: '人员' },
  { label: 'car', text: '轿车' },
  { label: 'truck', text: '卡车' },
  { label: 'bus', text: '客车' },
  { label: 'motorcycle', text: '摩托车' },
  { label: 'bicycle', text: '自行车' }
];

export function zhName(label) {
  return ZH[label] || label;
}
