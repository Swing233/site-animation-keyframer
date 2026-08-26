// ============================================================================
// Glitter Path · 沟槽反射亮线 — 三维动画工作台
// 场景：带微沟槽的金属表面在点光源阵列下反射出亮线（拉丝/同心圆两种模式）
// 功能：Blender/AE 风格时间轴 + 全参数关键帧 + 摄像机/自由视角切换 + 视频/序列帧导出
// ============================================================================
import * as THREE from 'three';
import { OrbitControls } from './assets/vendor/OrbitControls.js';

const PREVIEW_FPS = 30;
const MAX_LIGHTS = 16;
const NAMES_W = 196;
const LANE_H = 26;
const RULER_H = 30;

// ---------------------------------------------------------------------------
// 1. 可打关键帧的参数轨道定义
// ---------------------------------------------------------------------------
const TRACKS = [
  // min/max = 滑杆手柄的常用调节范围；lo/hi = 数值框/拖拽可继续增减的安全边界（seg 枚举轨道不设，保持 clamp）
  { g: '摄像机', id: 'camX', label: '位置 X', min: -30, max: 30, lo: -90, hi: 90, step: 0.1, def: 13 },
  { g: '摄像机', id: 'camY', label: '位置 Y', min: 0.5, max: 30, lo: 0.1, hi: 90, step: 0.1, def: 8 },
  { g: '摄像机', id: 'camZ', label: '位置 Z', min: -30, max: 30, lo: -90, hi: 90, step: 0.1, def: 14 },
  { g: '摄像机', id: 'rotX', label: '旋转 X°', min: -180, max: 180, lo: -540, hi: 540, step: 1, def: -28 },
  { g: '摄像机', id: 'rotY', label: '旋转 Y°', min: -180, max: 180, lo: -540, hi: 540, step: 1, def: 0 },
  { g: '摄像机', id: 'rotZ', label: '旋转 Z°', min: -180, max: 180, lo: -540, hi: 540, step: 1, def: 0 },
  { g: '摄像机', id: 'fov', label: '焦距 FOV', min: 15, max: 110, lo: 5, hi: 150, step: 0.5, def: 45 },
  { g: '摄像机', id: 'tgtX', label: '视觉中心 X', min: -15, max: 15, lo: -45, hi: 45, step: 0.1, def: 0 },
  { g: '摄像机', id: 'tgtY', label: '视觉中心 Y', min: -15, max: 15, lo: -45, hi: 45, step: 0.1, def: 0 },
  { g: '摄像机', id: 'tgtZ', label: '视觉中心 Z', min: -15, max: 15, lo: -45, hi: 45, step: 0.1, def: 0 },
  { g: '灯光', id: 'lightCount', label: '光线条数', min: 0, max: MAX_LIGHTS, lo: 0, hi: MAX_LIGHTS, step: 1, def: 3, integer: true }, // 上限=shader 数组 MAX_LIGHTS，不可超
  { g: '灯光', id: 'lightIntensity', label: '光线强度', min: 0, max: 3, lo: 0, hi: 6, step: 0.01, def: 1.0 },
  { g: '灯光', id: 'lightHeight', label: '光线高度', min: 1, max: 16, lo: 0.5, hi: 40, step: 0.1, def: 8 },
  { g: '灯光', id: 'lightSpread', label: '排列宽度', min: 1, max: 22, lo: 0.5, hi: 60, step: 0.1, def: 12 },
  { g: '沟槽表面', id: 'grooveDepth', label: '沟槽深度', min: 0, max: 1, lo: 0, hi: 1.5, step: 0.005, def: 0.35 },
  { g: '沟槽表面', id: 'grooveAngle', label: '沟槽角度°', min: -180, max: 180, lo: -540, hi: 540, step: 1, def: 0 },
  { g: '沟槽表面', id: 'grooveSpacing', label: '沟槽密度', min: 2, max: 90, lo: 1, hi: 200, step: 0.5, def: 30 },
  { g: '沟槽表面', id: 'grooveMode', label: '沟槽模式', min: 0, max: 1, step: 1, def: 0, integer: true, seg: ['平行拉丝', '同心圆'] },
  { g: '沟槽表面', id: 'roughness', label: '表面粗糙度', min: 0, max: 1, lo: 0, hi: 1, step: 0.01, def: 0.3 },
];
const TRACK_MAP = Object.fromEntries(TRACKS.map(t => [t.id, t]));

// ---------------------------------------------------------------------------
// 2. 全局状态：静态值 + 关键帧表 + 播放状态
// ---------------------------------------------------------------------------
const state = {
  duration: 12,
  time: 0,
  playing: false,
  loop: true,
  px: 95,                 // 时间轴缩放：像素/秒
  view: 'camera',         // 'camera' | 'free'
  lookAtTarget: true,     // 摄像机视角下始终看向“视觉中心”
  selected: null,         // {trackId, index}
  sel: new Set(),         // 多选集合，元素为 "trackId:index"；selected 在 size===1 时由它派生
  statics: {},            // 无关键帧轨道的静态值
  keys: {},               // trackId -> [{t, v, interp:'smooth'|'linear'|'step'}]
};
for (const tr of TRACKS) { state.statics[tr.id] = tr.def; state.keys[tr.id] = []; }

// 预置一段演示动画：相机环绕 + 光线增长 + 沟槽深度/角度变化
function seedDemo() {
  const K = (id, arr) => { state.keys[id] = arr.map(([t, v, i]) => ({ t, v, interp: i || 'smooth' })); };
  K('camX', [[0, 13], [4, 2], [8, -13], [12, 13]]);
  K('camY', [[0, 8], [6, 13], [12, 7]]);
  K('camZ', [[0, 14], [4, 9], [8, 2], [12, 14]]);
  K('lightCount', [[0, 2, 'linear'], [6, 14], [9, 16], [12, 16]]);
  K('lightIntensity', [[0, 0.5], [3, 1.7], [8, 1.2], [12, 1.5]]);
  K('lightHeight', [[0, 11], [6, 4], [12, 8]]);
  K('grooveDepth', [[0, 0.12], [5, 0.85], [12, 0.3]]);
  K('grooveAngle', [[0, 0], [12, 150]]);
  K('fov', [[0, 45], [6, 38], [12, 45]]);
}
seedDemo();

// ---------------------------------------------------------------------------
// 3. Three.js 场景
// ---------------------------------------------------------------------------
const viewport = document.getElementById('viewport');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
viewport.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070d);
scene.fog = new THREE.Fog(0x05070d, 40, 90);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
camera.position.set(13, 8, 14);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 3;
controls.maxDistance = 60;
controls.enabled = false;

// --- 沟槽金属板（自定义 shader，法线扰动 + 各向异性高光 → 亮线） ---
const plateUniforms = {
  uCount: { value: 3 },
  uLightPos: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector3()) },
  uIntensity: { value: 1.0 },
  uRough: { value: 0.3 },
  uDepth: { value: 0.35 },
  uAngle: { value: 0 },
  uSpacing: { value: 30 },
  uMode: { value: 0 },
  uCamPos: { value: new THREE.Vector3() },
};
const plateMat = new THREE.ShaderMaterial({
  uniforms: plateUniforms,
  vertexShader: /* glsl */`
    varying vec3 vWorld;
    void main(){
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorld = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`,
  fragmentShader: /* glsl */`
    precision highp float;
    #define MAXL ${MAX_LIGHTS}
    uniform int uCount;
    uniform vec3 uLightPos[MAXL];
    uniform float uIntensity, uRough, uDepth, uAngle, uSpacing;
    uniform int uMode;
    uniform vec3 uCamPos;
    varying vec3 vWorld;

    void main(){
      vec2 p = vWorld.xz;
      // 沟槽走向（平行=固定角度；同心圆=径向）
      float a = radians(uAngle);
      vec2 d = (uMode == 0) ? vec2(cos(a), sin(a))
                            : (length(p) > 1e-4 ? normalize(p) : vec2(1.0, 0.0));
      vec2 n2 = vec2(-d.y, d.x);
      float coord = (uMode == 0) ? dot(p, d) : length(p);
      float phase = coord * uSpacing;

      // 屏幕空间微表面过滤：一个像素覆盖多个沟槽周期时自动淡出，消除摩尔纹
      float fw = fwidth(phase);
      float micro = 1.0 - smoothstep(0.4, 1.2, fw);
      // 视线距离衰减（双保险）
      float viewDist = length(uCamPos - vWorld);
      float lod = micro * exp(-viewDist * 0.02);

      // 沟槽法线扰动：深度 → 倾角（小角度才有真实拉丝感）
      float slope = -sin(phase) * uDepth * 0.9 * lod;
      vec3 N = normalize(vec3(n2.x * slope, 1.0, n2.y * slope));
      vec3 V = normalize(uCamPos - vWorld);
      vec3 T = normalize(vec3(d.x, 0.0, d.y));

      float ridge = mix(1.0, 0.86 + 0.14 * cos(phase), lod);   // 槽脊微阴影
      vec3 col = vec3(0.020, 0.023, 0.030) * ridge;

      float shin = mix(60.0, 600.0, 1.0 - uRough);
      float anisoPow = mix(3.0, 34.0, 1.0 - uRough);
      for (int i = 0; i < MAXL; i++){
        if (i >= uCount) break;
        vec3 Lv = uLightPos[i] - vWorld;
        float dist2 = dot(Lv, Lv);
        float att = 1.0 / (1.0 + 0.02 * dist2);                // 距离衰减 → 亮线局部化
        vec3 L = normalize(Lv);
        float diff = max(dot(N, L), 0.0);
        vec3 H = normalize(L + V);
        float dh = max(dot(N, H), 0.0);
        // Kajiya 风格各向异性项：高光被约束在垂直于沟槽的方向 → 拖出亮线
        float aniso = pow(max(0.0, 1.0 - abs(dot(H, T))), anisoPow);
        float spec = pow(dh, shin) * (0.05 + 1.8 * aniso);
        col += (vec3(0.005, 0.0055, 0.007) * diff + vec3(1.0, 0.80, 0.50) * spec) * uIntensity * att;
      }
      float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
      col += fres * vec3(0.040, 0.052, 0.075);
      col = col / (1.0 + col);                          // 简单 tone mapping
      gl_FragColor = vec4(pow(col, vec3(0.4545)), 1.0);
    }`,
});
const plate = new THREE.Mesh(new THREE.PlaneGeometry(24, 16), plateMat);
plate.rotation.x = -Math.PI / 2;
scene.add(plate);

// 板的描边框，增强立体感
const rim = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.PlaneGeometry(24, 16)),
  new THREE.LineBasicMaterial({ color: 0x3a4152 })
);
rim.rotation.x = -Math.PI / 2;
rim.position.y = 0.002;
scene.add(rim);

const grid = new THREE.GridHelper(80, 80, 0x1d2230, 0x12151f);
grid.position.y = -0.02;
scene.add(grid);

// --- 光源阵列可视化：发光小球 + 射向板面的光线 ---
const lightRig = new THREE.Group();
scene.add(lightRig);
const lightUnits = [];
{
  const sphereGeo = new THREE.SphereGeometry(0.16, 16, 12);
  for (let i = 0; i < MAX_LIGHTS; i++) {
    const unit = new THREE.Group();
    const ball = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({ color: 0xffd9a0 }));
    unit.add(ball);
    const rays = [];
    for (let j = 0; j < 3; j++) {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const line = new THREE.Line(g, new THREE.LineBasicMaterial({
        color: 0xffe2b0, transparent: true, opacity: 0.22,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      unit.add(line); rays.push(line);
    }
    lightRig.add(unit);
    lightUnits.push({ unit, ball, rays });
  }
}
function lightPosAt(i, count, spread, height) {
  const x = count <= 1 ? 0 : (i / (count - 1) - 0.5) * spread;
  return new THREE.Vector3(x, height, -7.5);
}
function updateLightVisuals(count, spread, height, intensity) {
  for (let i = 0; i < MAX_LIGHTS; i++) {
    const u = lightUnits[i];
    const on = i < count;
    u.unit.visible = on;
    if (!on) continue;
    const pos = lightPosAt(i, count, spread, height);
    u.ball.position.copy(pos);
    const s = 0.8 + 0.5 * Math.min(intensity, 2);
    u.ball.scale.setScalar(s);
    u.ball.material.color.setHSL(0.09, 0.75, Math.min(0.45 + intensity * 0.18, 0.8));
    for (let j = 0; j < 3; j++) {
      const target = new THREE.Vector3(pos.x * 0.35 + (j - 1) * 2.4, 0, (j - 1) * 1.8);
      const pts = [pos, target];
      u.rays[j].geometry.setFromPoints(pts);
      u.rays[j].material.opacity = 0.10 + 0.14 * Math.min(intensity, 2);
    }
  }
}

// ---------------------------------------------------------------------------
// 4. 关键帧求值（Catmull-Rom 平滑 / 线性 / 阶梯）
// ---------------------------------------------------------------------------
function keysOf(id) { return state.keys[id]; }
function evalTrack(id, t) {
  const ks = keysOf(id);
  if (!ks.length) return state.statics[id];
  if (t <= ks[0].t) return ks[0].v;
  if (t >= ks[ks.length - 1].t) return ks[ks.length - 1].v;
  let i = 0;
  while (i < ks.length - 2 && ks[i + 1].t <= t) i++;
  const k0 = ks[Math.max(0, i - 1)], k1 = ks[i], k2 = ks[i + 1], k3 = ks[Math.min(ks.length - 1, i + 2)];
  const span = k2.t - k1.t;
  const u = span > 1e-9 ? (t - k1.t) / span : 0;
  if (k1.interp === 'step') return k1.v;
  if (k1.interp === 'linear') return k1.v + (k2.v - k1.v) * u;
  // Catmull-Rom
  const t1 = u, t2 = t1 * u, t3 = t2 * u;
  return 0.5 * ((2 * k1.v) + (-k0.v + k2.v) * t1 +
    (2 * k0.v - 5 * k1.v + 4 * k2.v - k3.v) * t2 +
    (-k0.v + 3 * k1.v - 3 * k2.v + k3.v) * t3);
}
function currentValue(id) {
  const v = evalTrack(id, state.time);
  return TRACK_MAP[id].integer ? Math.round(v) : v;
}
function keyIndexAt(id, t, tol = 0.5 / PREVIEW_FPS) {
  return keysOf(id).findIndex(k => Math.abs(k.t - t) <= tol);
}
function snapToFrame(t) { // 帧吸附：时间量化到最近帧边界（PREVIEW_FPS）
  return Math.round(t * PREVIEW_FPS) / PREVIEW_FPS;
}
function upsertKey(id, t, v, interp) {
  const ks = keysOf(id);
  const idx = keyIndexAt(id, t);
  if (idx >= 0) { ks[idx].v = v; if (interp) ks[idx].interp = interp; }
  else {
    ks.push({ t, v, interp: interp || (TRACK_MAP[id].seg ? 'step' : 'smooth') });
    ks.sort((a, b) => a.t - b.t);
  }
}
function removeKey(id, index) {
  if (index < 0) return;
  state.keys[id].splice(index, 1);
  state.sel.delete(id + ':' + index);
  if (state.selected && state.selected.trackId === id) state.selected = null;
}

// --- 多选（框选）辅助 ---
function selKey(id, i) { return id + ':' + i; }
function syncSelected() { // selected 由 sel 派生：仅单选时存在
  state.selected = null;
  if (state.sel.size === 1) {
    const [id, i] = [...state.sel][0].split(':');
    state.selected = { trackId: id, index: +i };
  }
}
function clearSelection() { state.sel.clear(); state.selected = null; }
function rebuildSelection() { // 剔除已被删除/失效的选中项（撤销、删除后调用）
  const ns = new Set();
  for (const key of state.sel) {
    const [id, i] = key.split(':');
    if (keysOf(id)[+i]) ns.add(key);
  }
  state.sel = ns; syncSelected();
}
function deleteSelection() { // 批量删除所有选中的关键帧（一次快照，可整体撤回）
  if (!state.sel.size) return;
  snapshot();
  const byTrack = {};
  for (const key of state.sel) {
    const [id, i] = key.split(':');
    (byTrack[id] = byTrack[id] || []).push(+i);
  }
  for (const id in byTrack) {
    byTrack[id].sort((a, b) => b - a); // 索引降序删除，避免错位
    for (const i of byTrack[id]) removeKey(id, i);
  }
  clearSelection();
  closeKfEditor();
  renderTimeline(); applyAll(state.time);
}

function setSelectionInterp(interp) { // 批量修改选中关键帧的插值类型（一次快照，可整体撤回）
  if (!['smooth', 'linear', 'step'].includes(interp)) return;
  if (!state.sel.size) { flashHint('先选中关键帧（点击或框选多选），再选择插值类型'); return; }
  snapshot();
  let n = 0;
  for (const key of state.sel) {
    const [id, i] = key.split(':');
    const k = keysOf(id)[+i];
    if (k) { k.interp = interp; n++; }
  }
  renderTimeline(); applyAll(state.time);
  const name = { smooth: '平滑（贝塞尔）', linear: '线性', step: '阶梯（保持）' }[interp];
  flashHint(`已把 ${n} 个关键帧的插值改为「${name}」（⌘Z 可撤回）`);
}

// --- 复制 / 剪切 / 粘贴（与框选多选配合，支持批量） ---
let kfClipboard = null; // [{id, t, v, interp}]，t 为复制时刻的原始时间
function copySelection() {
  if (!state.sel.size) { flashHint('先选中关键帧（点击或框选），再按 ⌘C 复制'); return false; }
  const items = [];
  for (const key of state.sel) {
    const [id, i] = key.split(':');
    const k = keysOf(id)[+i];
    if (k) items.push({ id, t: k.t, v: k.v, interp: k.interp });
  }
  if (!items.length) return false;
  kfClipboard = items;
  flashHint(`已复制 ${items.length} 个关键帧（⌘V 粘贴到播放头位置）`);
  return true;
}
function cutSelection() { // 剪切 = 复制 + 删除（deleteSelection 内含一次快照，可撤回）
  if (copySelection()) deleteSelection();
}
function pasteSelection() { // 粘贴到当前播放头：保持各帧相对最早帧的时间偏移
  if (!kfClipboard || !kfClipboard.length) { flashHint('剪贴板为空：先 ⌘C 复制或 ⌘X 剪切关键帧'); return; }
  snapshot();
  const anchorT = Math.min(...kfClipboard.map(k => k.t));
  const base = Math.max(0, Math.min(state.time, state.duration)); // 播放头即新锚点
  clearSelection();
  let pasted = 0;
  for (const item of kfClipboard) {
    const t = snapToFrame(Math.max(0, Math.min(state.duration, base + (item.t - anchorT))));
    upsertKey(item.id, t, item.v, 'linear'); // 粘贴默认线性插值：同值帧之间数值保持不变，可再用「批量插值」改回
    const idx = keyIndexAt(item.id, t);
    if (idx >= 0) state.sel.add(selKey(item.id, idx)); // 粘贴后自动选中新帧，可立即整组拖动
    pasted++;
  }
  syncSelected();
  renderTimeline(); applyAll(state.time);
  flashHint(`已粘贴 ${pasted} 个关键帧到 ${base.toFixed(2)}s`);
}

// --- 撤销 / 重做（快照式，作用于全部关键帧轨道 state.keys）---
// 每次破坏性修改前 snapshot() 一次；同一手势（拖动数值/菱形/滑杆）内自动合并为一步
const MAX_UNDO = 50;
const undoStack = [];
const redoStack = [];
let gestureId = 0;
let snapGesture = -1;
let lastSnapAt = 0;
function beginGesture() { gestureId++; }
function cloneKeys() {
  const out = {};
  for (const id in state.keys) out[id] = state.keys[id].map(k => ({ ...k }));
  return out;
}
function snapshot() {
  const now = Date.now();
  if (snapGesture === gestureId && now - lastSnapAt < 500) return; // 同手势连续变更合并
  snapGesture = gestureId; lastSnapAt = now;
  undoStack.push(cloneKeys());
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack.length = 0;
  updateUndoButtons();
  scheduleAutosave(); // 每次编辑都触发自动保存（防抖 600ms），刷新页面不丢工程
}
function restoreKeys(snap) {
  const out = {};
  for (const id in state.keys) out[id] = (snap[id] || []).map(k => ({ ...k }));
  return out;
}
function afterKeysChanged() {
  rebuildSelection();
  closeKfEditor();
  renderTimeline();
  applyAll(state.time);
  updateUndoButtons();
}
function undo() {
  if (!undoStack.length) { flashHint('没有可撤回的操作'); return; }
  redoStack.push(cloneKeys());
  state.keys = restoreKeys(undoStack.pop());
  snapGesture = -1; lastSnapAt = 0;
  afterKeysChanged();
  flashHint('↩ 已撤回');
}
function redo() {
  if (!redoStack.length) { flashHint('没有可重做的操作'); return; }
  undoStack.push(cloneKeys());
  state.keys = restoreKeys(redoStack.pop());
  snapGesture = -1; lastSnapAt = 0;
  afterKeysChanged();
  flashHint('↪ 已重做');
}
function updateUndoButtons() {
  const u = document.getElementById('btn-undo');
  const r = document.getElementById('btn-redo');
  if (u) u.disabled = !undoStack.length;
  if (r) r.disabled = !redoStack.length;
}

// 修改参数值 → 在当前播放头时间自动创建/更新关键帧（该时刻无关键帧则自动创建）
function commitValue(tr, raw) {
  snapshot();
  let val = parseFloat(raw);
  if (isNaN(val)) return;
  val = Math.min(tr.hi ?? tr.max, Math.max(tr.lo ?? tr.min, val));
  if (tr.integer) val = Math.round(val);
  upsertKey(tr.id, state.time, val);
  renderTimeline();
  applyAll(state.time);
}

// 参数数值拖拽微调：按住数值左右拖动 → 修改数字（按住 Shift 精细 10×），改动自动在当前时间打关键帧
function makeScrub(el, tr) {
  let scrub = null;
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    beginGesture();
    scrub = { startX: e.clientX, startVal: currentValue(tr.id), moved: false, shift: e.shiftKey };
    el.classList.add('scrubbing');
    try { el.setPointerCapture(e.pointerId); } catch (_) {}
  });
  el.addEventListener('pointermove', e => {
    if (!scrub) return;
    const dx = e.clientX - scrub.startX;
    if (Math.abs(dx) > 3) scrub.moved = true;
    const base = (tr.max - tr.min) / 200;
    const step = scrub.shift ? base * 0.1 : base;
    let val = scrub.startVal + dx * step;
    val = Math.min(tr.hi ?? tr.max, Math.max(tr.lo ?? tr.min, val));
    if (tr.integer) val = Math.round(val);
    commitValue(tr, val);
  });
  const end = () => {
    if (!scrub) return;
    const wasMoved = scrub.moved;
    scrub = null;
    el.classList.remove('scrubbing');
    // 单击未拖动 → 聚焦输入框便于键盘精确键入
    if (!wasMoved && el.tagName === 'INPUT') el.focus();
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}

// ---------------------------------------------------------------------------
// 5. 把当前时间的求值结果应用到场景 + 面板
// ---------------------------------------------------------------------------
let panelSyncLock = false;
function applyAll(t, forceCamera = false) {
  const v = {};
  for (const tr of TRACKS) v[tr.id] = tr.integer ? Math.round(evalTrack(tr.id, t)) : evalTrack(tr.id, t);

  // shader / 灯光
  plateUniforms.uCount.value = v.lightCount;
  plateUniforms.uIntensity.value = v.lightIntensity;
  plateUniforms.uRough.value = v.roughness;
  plateUniforms.uDepth.value = v.grooveDepth;
  plateUniforms.uAngle.value = v.grooveAngle;
  plateUniforms.uSpacing.value = v.grooveSpacing;
  plateUniforms.uMode.value = v.grooveMode;
  for (let i = 0; i < MAX_LIGHTS; i++)
    plateUniforms.uLightPos.value[i].copy(lightPosAt(i, v.lightCount, v.lightSpread, v.lightHeight));
  updateLightVisuals(v.lightCount, v.lightSpread, v.lightHeight, v.lightIntensity);

  // 摄像机
  const driveCamera = forceCamera || state.view === 'camera';
  if (driveCamera) {
    camera.position.set(v.camX, v.camY, v.camZ);
    if (state.lookAtTarget) {
      camera.lookAt(v.tgtX, v.tgtY, v.tgtZ);
    } else {
      camera.rotation.set(THREE.MathUtils.degToRad(v.rotX), THREE.MathUtils.degToRad(v.rotY), THREE.MathUtils.degToRad(v.rotZ), 'YXZ');
    }
    if (camera.fov !== v.fov) { camera.fov = v.fov; camera.updateProjectionMatrix(); }
  }
  // 自由视角下允许用户平移视觉中心（右键拖拽），不强制写回关键帧求值
  if (driveCamera) controls.target.set(v.tgtX, v.tgtY, v.tgtZ);
  plateUniforms.uCamPos.value.copy(camera.position);

  syncPanel(v);
  updateTimeDisplay();
  updatePlayhead();
  updateKfButtons();
}

// ---------------------------------------------------------------------------
// 6. 右侧参数面板
// ---------------------------------------------------------------------------
const panel = document.getElementById('panel');
const panelInputs = {}; // id -> {range, num, kfBtn, segBtns?}
{
  let lastGroup = null;
  for (const tr of TRACKS) {
    if (tr.g !== lastGroup) {
      const h = document.createElement('h3'); h.textContent = tr.g; panel.appendChild(h);
      if (tr.g === '摄像机') {
        const chk = document.createElement('label');
        chk.className = 'chkrow';
        chk.innerHTML = `<input type="checkbox" id="chk-lookat" checked/> 摄像机始终看向视觉中心（取消后用旋转关键帧控制朝向）`;
        panel.appendChild(chk);
        chk.querySelector('input').addEventListener('change', e => { state.lookAtTarget = e.target.checked; applyAll(state.time); scheduleAutosave(); });
      }
      lastGroup = tr.g;
    }
    const row = document.createElement('div');
    row.className = 'prow' + (tr.seg ? ' seg' : '');
    const kfBtn = `<button class="kfbtn" data-kf="${tr.id}" title="在当前时间添加/移除关键帧">◇</button>`;
    if (tr.seg) {
      row.innerHTML = `<div class="pname" title="${tr.label}">${tr.label}</div>
        <div class="segbtns">${tr.seg.map((s, i) => `<button data-seg="${tr.id}" data-v="${i}">${s}</button>`).join('')}</div>${kfBtn}`;
    } else {
      row.innerHTML = `<div class="pname" title="${tr.label}">${tr.label}</div>
        <input type="range" data-id="${tr.id}" min="${tr.min}" max="${tr.max}" step="${tr.step}" title="常用调节范围手柄（可继续用右侧数值框/拖拽超出）"/>
        <input type="number" data-id="${tr.id}" min="${tr.lo ?? tr.min}" max="${tr.hi ?? tr.max}" step="${tr.step}" title="可直接输入：可超出滑杆范围继续增减（安全边界 ${tr.lo ?? tr.min} ~ ${tr.hi ?? tr.max}）"/>
        <input type="number" data-id="${tr.id}" min="${tr.min}" max="${tr.max}" step="${tr.step}"/>${kfBtn}`;
    }
    panel.appendChild(row);
  }
  for (const tr of TRACKS) {
    panelInputs[tr.id] = {
      range: panel.querySelector(`input[type=range][data-id="${tr.id}"]`),
      num: panel.querySelector(`input[type=number][data-id="${tr.id}"]`),
      kfBtn: panel.querySelector(`button[data-kf="${tr.id}"]`),
      segs: tr.seg ? [...panel.querySelectorAll(`button[data-seg="${tr.id}"]`)] : null,
    };
  }
  // 事件
  for (const tr of TRACKS) {
    const pi = panelInputs[tr.id];
    const commit = raw => commitValue(tr, raw); // 始终在当前时间自动创建/更新关键帧
    if (pi.range) {
      pi.range.addEventListener('pointerdown', beginGesture);
      pi.range.addEventListener('input', e => commit(e.target.value));
      pi.num.addEventListener('change', e => commit(e.target.value));
      makeScrub(pi.num, tr); // 数字输入框支持拖拽微调
    }
    if (pi.segs) pi.segs.forEach(b => b.addEventListener('click', () => commit(b.dataset.v)));
    pi.kfBtn.addEventListener('click', () => {
      snapshot();
      const idx = keyIndexAt(tr.id, state.time);
      if (idx >= 0) removeKey(tr.id, idx);
      else upsertKey(tr.id, state.time, currentValue(tr.id));
      renderTimeline(); applyAll(state.time);
    });
  }
}
function syncPanel(v) {
  if (panelSyncLock) return;
  for (const tr of TRACKS) {
    const pi = panelInputs[tr.id];
    const val = v[tr.id];
    if (pi.range && document.activeElement !== pi.range) pi.range.value = Math.min(tr.max, Math.max(tr.min, val));
    if (pi.range) pi.range.classList.toggle('overflow', val < tr.min || val > tr.max);
    if (pi.num && document.activeElement !== pi.num) pi.num.value = tr.integer ? val : (+val).toFixed(2);
    if (pi.segs) pi.segs.forEach(b => b.classList.toggle('on', +b.dataset.v === Math.round(val)));
    // 时间轴左侧参数列的实时数值
    const tv = document.querySelector(`.tl-name .tval[data-id="${tr.id}"]`);
    if (tv) tv.textContent = tr.integer ? val : (+val).toFixed(2);
  }
}
function updateKfButtons() {
  for (const tr of TRACKS) {
    panelInputs[tr.id].kfBtn.classList.toggle('active', keyIndexAt(tr.id, state.time) >= 0);
    const laneBtn = document.querySelector(`.tl-name .kfbtn[data-kf="${tr.id}"]`);
    if (laneBtn) laneBtn.classList.toggle('active', keyIndexAt(tr.id, state.time) >= 0);
  }
}

// ---------------------------------------------------------------------------
// 7. 音频口播（外部音频导入 · 波形对齐关键帧节奏）
// ---------------------------------------------------------------------------
const AUDIO_ROW_H = 58;
const audioState = {
  el: null, url: null, name: '', duration: 0,
  peaks: null, ready: false, metaOnly: false, // metaOnly：工程恢复后仅有波形元数据（无音频本体），可显示波形但不可播放/混音
  wave: null, waveCtx: null, mask: null, wrap: null
};
const btnAudio = document.getElementById('btn-audio');
const fileAudio = document.getElementById('file-audio');
const audioChip = document.getElementById('audio-chip');
const hintEl = document.querySelector('#topbar .hint');
let hintTimer = null;
function flashHint(msg) {
  if (!hintEl) return;
  hintEl.textContent = msg; hintEl.style.color = '#8fd0ff';
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => {
    hintEl.textContent = '💾 自动保存 · 空格 播放/暂停 · ←/→ 逐帧 · Delete 删除所选关键帧 · ⌘C/⌘X/⌘V 复制/剪切/粘贴（粘贴默认线性） · 框选后可批量改插值 · 双击轨道空白处加帧 · 拖动数值改参数（自动打帧） · 标尺/轨道拖动跳转（吸附帧） · Alt+滚轮 缩放时间轴 · 🎙 导入口播 · ⌘Z/⌃Z 撤回 · ⌘⇧Z/⌃⇧Z 重做 · 💾 保存工程/📂 打开工程 · ❓ 帮助看板';
    hintEl.style.color = '';
  }, 7000);
}

async function importAudio(file) {
  try {
    const buf = await file.arrayBuffer();
    const AC = window.AudioContext || window.webkitAudioContext;
    const ac = new AC();
    const decoded = await ac.decodeAudioData(buf);
    ac.close();

    // 峰值波形（2000 桶，取绝对值最大值）
    const buckets = 2000;
    const ch = decoded.getChannelData(0);
    const per = Math.max(1, Math.floor(ch.length / buckets));
    const peaks = new Float32Array(buckets);
    for (let i = 0; i < buckets; i++) {
      let m = 0;
      const start = i * per;
      for (let j = 0; j < per; j++) {
        const a = Math.abs(ch[start + j] || 0);
        if (a > m) m = a;
      }
      peaks[i] = m;
    }

    if (audioState.el) { audioState.el.pause(); audioState.el.src = ''; }
    if (audioState.url) URL.revokeObjectURL(audioState.url);
    const url = URL.createObjectURL(file);
    const el = new Audio();
    el.preload = 'auto';
    el.src = url;
    Object.assign(audioState, { el, url, name: file.name, duration: decoded.duration, peaks, ready: true });
    el.addEventListener('ended', () => { if (state.playing) setPlaying(false); });

    // 自动扩展动画时长，确保口播完整覆盖
    const need = Math.max(state.duration, Math.ceil(decoded.duration));
    if (need !== state.duration) {
      snapshot();
      state.duration = need;
      document.getElementById('inp-duration').value = need;
      for (const tr of TRACKS) keysOf(tr.id).forEach(k => { k.t = Math.min(k.t, state.duration); });
    }

    audioChip.style.display = 'inline-flex';
    document.getElementById('audio-chip-name').textContent = file.name;
    document.getElementById('audio-chip-dur').textContent = decoded.duration.toFixed(1) + 's';
    document.getElementById('exp-mix-row').style.display = 'flex';
    renderTimeline();
    syncAudioTime();
    scheduleAutosave();
    flashHint('已导入口播：「' + file.name + '」 ' + decoded.duration.toFixed(1) + 's — 波形已显示在时间轴，播放同步、点击波形可跳转。动画时长已调整为 ' + need + 's');
  } catch (err) {
    alert('音频解码失败：' + err.message);
  }
}

function removeAudio() {
  if (audioState.el) { audioState.el.pause(); audioState.el.src = ''; }
  if (audioState.url) URL.revokeObjectURL(audioState.url);
  audioState.ready = false; audioState.peaks = null;
  audioState.el = null; audioState.url = null; audioState.name = ''; audioState.duration = 0;
  audioState.metaOnly = false;
  audioChip.style.display = 'none';
  document.getElementById('exp-mix-row').style.display = 'none';
  renderTimeline();
  scheduleAutosave();
  flashHint('已移除口播音频');
}

function syncAudioTime() {
  if (audioState.ready && audioState.el && !state.exportLive) {
    const t = Math.min(audioState.duration, state.time);
    if (Math.abs(audioState.el.currentTime - t) > 0.06) audioState.el.currentTime = t;
  }
  if (audioState.mask) audioState.mask.style.width = (state.time * state.px) + 'px';
}

btnAudio.addEventListener('click', () => fileAudio.click());
fileAudio.addEventListener('change', () => {
  const f = fileAudio.files[0];
  if (f) importAudio(f);
  fileAudio.value = '';
});
audioChip.addEventListener('click', removeAudio);

// ---------------------------------------------------------------------------
// 8. 时间轴 UI
// ---------------------------------------------------------------------------
const tlBody = document.getElementById('tl-body');
const tlContent = document.getElementById('tl-content');
const playheadEl = document.getElementById('playhead');
const laneEls = {}; // id -> lane div
let rulerCanvas, rulerCtx;

function trackWidth() { return state.duration * state.px; }

function buildTimeline() {
  // 清除旧行（保留 playhead）
  [...tlContent.querySelectorAll('.tl-row')].forEach(el => el.remove());

  // 标尺行
  const rulerRow = document.createElement('div');
  rulerRow.className = 'tl-row ruler-row';
  rulerRow.style.height = RULER_H + 'px';
  rulerRow.innerHTML = `<div class="tl-corner">时间（秒）</div>`;
  rulerCanvas = document.createElement('canvas');
  rulerCanvas.id = 'ruler';
  rulerCanvas.height = RULER_H;
  rulerRow.appendChild(rulerCanvas);
  tlContent.appendChild(rulerRow);

  // 音频口播行（标尺下方，波形用于对齐关键帧节奏）
  const audioRow = document.createElement('div');
  audioRow.className = 'tl-row audio-row';
  audioRow.style.height = AUDIO_ROW_H + 'px';
  audioRow.innerHTML = `
    <div class="tl-name">
      <span class="tlabel">${audioState.name ? '🎙 ' + audioState.name : '🎙 音频口播'}</span>
      ${audioState.name ? `<span class="audio-dur">${audioState.duration.toFixed(2)}s</span>` : ''}
    </div>
    <div id="audio-wave-wrap">
      <canvas id="audio-wave"></canvas>
      <div id="audio-wave-mask"></div>
      <div id="audio-wave-empty" ${audioState.name ? 'style="display:none"' : ''}>🎙 <span>导入口播音频 — 波形显示于此，播放同步、点击跳转、对齐关键帧节奏</span></div>
    </div>`;
  tlContent.appendChild(audioRow);
  audioState.wave = audioRow.querySelector('#audio-wave');
  audioState.waveCtx = audioState.wave.getContext('2d');
  audioState.mask = audioRow.querySelector('#audio-wave-mask');
  audioState.wrap = audioRow.querySelector('#audio-wave-wrap');

  // 波形点击 / 拖动 → 跳转播放头
  let audioScrub = false;
  const waveSeek = e => {
    const rect = audioState.wrap.getBoundingClientRect();
    seek((e.clientX - rect.left) / state.px);
  };
  audioState.wrap.addEventListener('pointerdown', e => {
    audioScrub = true;
    try { audioState.wrap.setPointerCapture(e.pointerId); } catch (_) {}
    waveSeek(e);
  });
  audioState.wrap.addEventListener('pointermove', e => { if (audioScrub) waveSeek(e); });
  audioState.wrap.addEventListener('pointerup', () => { audioScrub = false; });

  // 轨道行
  for (const tr of TRACKS) {
    const row = document.createElement('div');
    row.className = 'tl-row';
    row.style.height = LANE_H + 'px';
    row.innerHTML = `
      <div class="tl-name">
        <button class="kfbtn" data-kf="${tr.id}" title="在当前时间添加/移除关键帧">◇</button>
        <span class="tlabel">${tr.label}</span>
        <span class="tval" data-id="${tr.id}" title="按住拖动修改数值 · Shift 精细微调 · 自动在当前时间打关键帧">—</span>
        <span class="group-tag">${tr.g}</span>
      </div>
      <div class="tl-lane" data-lane="${tr.id}"></div>`;
    tlContent.appendChild(row);
    laneEls[tr.id] = row.querySelector('.tl-lane');
    makeScrub(row.querySelector('.tval'), tr); // 参数列数值拖拽微调
    row.querySelector('.kfbtn').addEventListener('click', () => {
      snapshot();
      const idx = keyIndexAt(tr.id, state.time);
      if (idx >= 0) removeKey(tr.id, idx);
      else upsertKey(tr.id, state.time, currentValue(tr.id));
      renderTimeline(); applyAll(state.time);
    });
  }
  layoutTimeline();
  drawRuler();
  renderDiamonds();
  bindTimelineEvents();
}

function layoutTimeline() {
  const w = trackWidth();
  tlContent.style.width = (NAMES_W + w + 40) + 'px';
  tlContent.style.minHeight = '100%';
  rulerCanvas.width = Math.max(1, Math.round(w));
  rulerCanvas.style.width = w + 'px';
  for (const tr of TRACKS) laneEls[tr.id].style.width = w + 'px';
  if (audioState.wave) {
    audioState.wave.width = Math.max(1, Math.round(w));
    audioState.wave.style.width = w + 'px';
    audioState.wave.height = AUDIO_ROW_H;
  }
  const h = RULER_H + AUDIO_ROW_H + TRACKS.length * LANE_H;
  playheadEl.style.height = h + 'px';
}

function drawRuler() {
  const ctx = rulerCanvas.getContext('2d');
  const w = rulerCanvas.width, h = RULER_H;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#262932'; ctx.fillRect(0, 0, w, h);
  const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 30];
  let step = steps.find(s => s * state.px >= 70) || 30;
  ctx.font = '10px sans-serif';
  ctx.textBaseline = 'top';
  for (let t = 0; t <= state.duration + 1e-6; t += step / 5) {
    const x = t * state.px;
    const major = Math.abs(t / step - Math.round(t / step)) < 1e-6;
    ctx.strokeStyle = major ? '#565c6a' : '#3a3f4c';
    ctx.beginPath(); ctx.moveTo(x + 0.5, major ? h - 14 : h - 7); ctx.lineTo(x + 0.5, h); ctx.stroke();
    if (major) {
      ctx.fillStyle = '#9aa0ad';
      ctx.fillText((Math.round(t * 100) / 100) + 's', x + 4, 4);
    }
  }
}

function renderDiamonds() {
  for (const tr of TRACKS) {
    const lane = laneEls[tr.id];
    lane.querySelectorAll('.diamond').forEach(d => d.remove());
    keysOf(tr.id).forEach((k, i) => {
      const d = document.createElement('div');
      d.className = 'diamond' + (k.interp !== 'smooth' ? ' ' + k.interp : '');
      d.style.left = (k.t * state.px) + 'px';
      d.dataset.track = tr.id; d.dataset.index = i;
      d.title = `${tr.label} · ${k.t.toFixed(2)}s = ${(+k.v).toFixed(2)}（${k.interp}）`;
      if (state.sel.has(tr.id + ':' + i))
        d.classList.add('selected');
      lane.appendChild(d);
    });
  }
}
function renderTimeline() { layoutTimeline(); drawRuler(); renderAudioWave(); renderDiamonds(); updateKfButtons(); syncAudioTime(); }

function renderAudioWave() {
  if (!audioState.peaks || !audioState.waveCtx) return;
  const ctx = audioState.waveCtx;
  const w = audioState.wave.width, h = AUDIO_ROW_H;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#15181e'; ctx.fillRect(0, 0, w, h);
  // 中线
  ctx.strokeStyle = '#2a3038';
  ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
  // 每像素取对应峰值桶 → 上下对称柱状波形
  const n = audioState.peaks.length;
  const mid = h / 2;
  const amp = h / 2 - 8;
  ctx.fillStyle = '#5aa2f0';
  for (let x = 0; x < w; x++) {
    const idx = Math.min(n - 1, Math.floor(x / w * n));
    const v = audioState.peaks[idx];
    const barH = Math.max(1, v * amp);
    ctx.fillRect(x, mid - barH, 1, barH * 2);
  }
}

function updatePlayhead() {
  playheadEl.style.left = (NAMES_W + state.time * state.px) + 'px';
}
function updateTimeDisplay() {
  const el = document.getElementById('time-display');
  el.textContent = `${state.time.toFixed(2)}s · 帧 ${Math.round(state.time * PREVIEW_FPS)}`;
}

function seek(t, pause = true) {
  state.time = Math.min(state.duration, Math.max(0, snapToFrame(t))); // 吸附到帧边界
  if (pause) setPlaying(false);
  syncAudioTime();
  applyAll(state.time);
  scheduleAutosave(); // 播放头位置也随工程自动保存
}

function bindTimelineEvents() {
  // 标尺点击 / 拖动播放头
  let scrubbing = false;
  rulerCanvas.addEventListener('pointerdown', e => {
    scrubbing = true;
    try { rulerCanvas.setPointerCapture(e.pointerId); } catch (_) {}
    seek(e.offsetX / state.px);
  });
  rulerCanvas.addEventListener('pointermove', e => { if (scrubbing) seek(e.offsetX / state.px); });
  rulerCanvas.addEventListener('pointerup', () => { scrubbing = false; });

  // 菱形关键帧：选择 / 拖动（支持多选整组移动）/ 双击编辑
  let drag = null;
  tlContent.addEventListener('pointerdown', e => {
    const d = e.target.closest('.diamond');
    if (!d) return;
    e.stopPropagation();
    const trackId = d.dataset.track, index = +d.dataset.index;
    if (!state.sel.has(selKey(trackId, index))) { // 点未选中的帧 → 单选
      state.sel.clear(); state.sel.add(selKey(trackId, index)); syncSelected();
      renderDiamonds();
    }
    beginGesture();
    drag = { trackId, index, moved: false,
      group: [...state.sel].map(key => {
        const [id, i] = key.split(':');
        const kf = keysOf(id)[+i];
        return kf ? { id, i: +i, k: kf, initT: kf.t } : null;
      }).filter(Boolean) };
    try { d.setPointerCapture(e.pointerId); } catch (_) {}
  });
  tlContent.addEventListener('pointermove', e => {
    if (!drag) return;
    const lane = laneEls[drag.trackId];
    const rect = lane.getBoundingClientRect();
    let t = snapToFrame((e.clientX - rect.left) / state.px); // 拖动吸附到帧
    t = Math.min(state.duration, Math.max(0, t));
    const k = keysOf(drag.trackId)[drag.index];
    if (!k) { drag = null; return; }
    if (!drag.moved) snapshot();
    const main = drag.group.find(g => g.id === drag.trackId && g.i === drag.index);
    const delta = main ? t - main.initT : 0;
    for (const g of drag.group) { // 整组同步移动（逐帧吸附）
      if (!g.k) continue;
      g.k.t = snapToFrame(Math.min(state.duration, Math.max(0, g.initT + delta)));
      const el = laneEls[g.id].querySelector(`.diamond[data-index="${g.i}"]`);
      if (el) el.style.left = (g.k.t * state.px) + 'px';
    }
    drag.moved = true;
  });
  tlContent.addEventListener('pointerup', () => {
    if (drag && drag.moved) {
      for (const g of drag.group) if (g.k) keysOf(g.id).sort((a, b) => a.t - b.t);
      const ns = new Set(); // 移动后 index 可能变化，按对象引用重建选择
      for (const g of drag.group) {
        if (!g.k) continue;
        const idx = keysOf(g.id).indexOf(g.k);
        if (idx >= 0) ns.add(selKey(g.id, idx));
      }
      state.sel = ns; syncSelected();
      renderTimeline(); applyAll(state.time);
    }
    drag = null;
  });
  tlContent.addEventListener('dblclick', e => {
    const d = e.target.closest('.diamond');
    if (d) { openKfEditor(d.dataset.track, +d.dataset.index, e.clientX, e.clientY); return; }
    const lane = e.target.closest('.tl-lane');
    if (lane) {
      // 双击轨道空白 → 在该时间插入关键帧（取当前求值）
      const rect = lane.getBoundingClientRect();
      const t = snapToFrame(Math.min(state.duration, Math.max(0, (e.clientX - rect.left) / state.px)));
      const id = lane.dataset.lane;
      snapshot();
      upsertKey(id, t, evalTrack(id, t));
      seek(t);
      renderTimeline();
    }
  });

  // 轨道行空白处：点击/拖动 → 播放头跟随（scrub）；拖拽 >5px → 框选多个关键帧
  let laneScrub = null, marquee = null;
  const laneSeek = (e, lane) => {
    const rect = lane.getBoundingClientRect();
    seek((e.clientX - rect.left) / state.px);
  };
  const marqueeEl = document.getElementById('marquee');
  const updateMarquee = (cx, cy) => {
    const rect = tlContent.getBoundingClientRect();
    const x1 = Math.min(marquee.x0, cx) - rect.left, y1 = Math.min(marquee.y0, cy) - rect.top;
    const x2 = Math.max(marquee.x0, cx) - rect.left, y2 = Math.max(marquee.y0, cy) - rect.top;
    marqueeEl.style.display = 'block';
    marqueeEl.style.left = x1 + 'px'; marqueeEl.style.top = y1 + 'px';
    marqueeEl.style.width = (x2 - x1) + 'px'; marqueeEl.style.height = (y2 - y1) + 'px';
  };
  const finishMarquee = e => {
    const rect = tlContent.getBoundingClientRect();
    const l = Math.min(marquee.x0, e.clientX) - rect.left, top = Math.min(marquee.y0, e.clientY) - rect.top;
    const r = Math.max(marquee.x0, e.clientX) - rect.left, bot = Math.max(marquee.y0, e.clientY) - rect.top;
    const hit = new Set();
    tlContent.querySelectorAll('.diamond').forEach(d => {
      const dr = d.getBoundingClientRect();
      const cx = dr.left + dr.width / 2 - rect.left, cy = dr.top + dr.height / 2 - rect.top;
      if (cx >= l && cx <= r && cy >= top && cy <= bot) hit.add(selKey(d.dataset.track, +d.dataset.index));
    });
    if (!e.shiftKey) state.sel.clear(); // 按住 Shift 框选 = 追加选择
    for (const key of hit) state.sel.add(key);
    syncSelected();
    marqueeEl.style.display = 'none';
    renderDiamonds();
  };
  tlContent.addEventListener('pointerdown', e => {
    if (e.target.closest('.diamond')) return;   // 菱形交给拖动逻辑
    if (e.target.closest('#audio-wave-wrap')) return; // 音频波形有自己的 seek
    if (e.target.closest('.tl-name') || e.target.closest('.tl-corner')) return; // 名字列不框选
    const lane = e.target.closest('.tl-lane');
    if (!lane) return;
    laneScrub = lane;
    try { lane.setPointerCapture(e.pointerId); } catch (_) {}
    laneSeek(e, lane); // 点击即跳转播放头（保留原行为）
    marquee = { x0: e.clientX, y0: e.clientY, active: false };
  });
  tlContent.addEventListener('pointermove', e => {
    if (laneScrub) laneSeek(e, laneScrub);
    if (!marquee) return;
    if (!marquee.active && Math.hypot(e.clientX - marquee.x0, e.clientY - marquee.y0) > 5) {
      marquee.active = true;
      laneScrub = null; // 进入框选后停止播放头跟随
    }
    if (marquee.active) updateMarquee(e.clientX, e.clientY);
  });
  tlContent.addEventListener('pointerup', e => {
    if (marquee && marquee.active) finishMarquee(e);
    marquee = null;
    laneScrub = null;
  });
}

// --- 关键帧编辑弹窗 ---
const kfEditor = document.getElementById('kf-editor');
let editing = null;
function openKfEditor(trackId, index, x, y) {
  const k = keysOf(trackId)[index];
  if (!k) return;
  editing = { trackId, index };
  document.getElementById('kf-track').value = TRACK_MAP[trackId].label;
  document.getElementById('kf-time').value = k.t.toFixed(2);
  document.getElementById('kf-value').value = (+k.v).toFixed(3);
  document.getElementById('kf-interp').value = k.interp;
  kfEditor.style.display = 'block';
  const px = Math.min(x, window.innerWidth - 230);
  const py = Math.min(y, window.innerHeight - 220);
  kfEditor.style.left = px + 'px'; kfEditor.style.top = py + 'px';
  state.sel.clear(); state.sel.add(selKey(trackId, index)); syncSelected();
  renderDiamonds();
}
function closeKfEditor() { kfEditor.style.display = 'none'; editing = null; }
document.getElementById('kf-time').addEventListener('change', e => {
  if (!editing) return;
  snapshot();
  const k = keysOf(editing.trackId)[editing.index];
  k.t = snapToFrame(Math.min(state.duration, Math.max(0, parseFloat(e.target.value) || 0)));
  keysOf(editing.trackId).sort((a, b) => a.t - b.t);
  editing.index = keysOf(editing.trackId).indexOf(k);
  state.sel.clear(); state.sel.add(selKey(editing.trackId, editing.index)); syncSelected();
  renderTimeline(); applyAll(state.time);
});
document.getElementById('kf-value').addEventListener('change', e => {
  if (!editing) return;
  snapshot();
  const tr = TRACK_MAP[editing.trackId];
  let val = parseFloat(e.target.value) || 0;
  val = Math.min(tr.hi ?? tr.max, Math.max(tr.lo ?? tr.min, val));
  keysOf(editing.trackId)[editing.index].v = tr.integer ? Math.round(val) : val;
  renderTimeline(); applyAll(state.time);
});
document.getElementById('kf-interp').addEventListener('change', e => {
  if (!editing) return;
  snapshot();
  keysOf(editing.trackId)[editing.index].interp = e.target.value;
  renderTimeline(); applyAll(state.time);
});
document.getElementById('kf-delete').addEventListener('click', () => {
  if (!editing) return;
  snapshot();
  removeKey(editing.trackId, editing.index);
  closeKfEditor(); renderTimeline(); applyAll(state.time);
});
document.getElementById('kf-close').addEventListener('click', closeKfEditor);

// --- 工具栏 ---
function setPlaying(on) {
  state.playing = on;
  document.getElementById('btn-play').textContent = on ? '⏸' : '▶';
  if (audioState.ready && audioState.el) {
    if (on) {
      if (audioState.el.ended) audioState.el.currentTime = state.time;
      audioState.el.play().catch(() => {});
    } else {
      audioState.el.pause();
    }
  }
}
document.getElementById('btn-play').addEventListener('click', () => setPlaying(!state.playing));
document.getElementById('btn-start').addEventListener('click', () => seek(0));
document.getElementById('btn-end').addEventListener('click', () => seek(state.duration));
document.getElementById('btn-prevf').addEventListener('click', () => seek(state.time - 1 / PREVIEW_FPS));
document.getElementById('btn-nextf').addEventListener('click', () => seek(state.time + 1 / PREVIEW_FPS));
document.getElementById('chk-loop').addEventListener('change', e => { state.loop = e.target.checked; scheduleAutosave(); });
document.getElementById('inp-duration').addEventListener('change', e => {
  snapshot();
  state.duration = Math.min(300, Math.max(1, parseFloat(e.target.value) || 12));
  for (const tr of TRACKS) keysOf(tr.id).forEach(k => { k.t = Math.min(k.t, state.duration); });
  renderTimeline(); seek(Math.min(state.time, state.duration));
});
document.getElementById('inp-zoom').addEventListener('input', e => {
  state.px = +e.target.value; renderTimeline(); updatePlayhead(); scheduleAutosave();
});
// Alt + 滚轮：以鼠标位置为锚点缩放时间轴（鼠标指向的时间在缩放前后保持不变）
tlBody.addEventListener('wheel', e => {
  if (!e.altKey) return;
  e.preventDefault();
  const rect = tlBody.getBoundingClientRect();
  const bodyX = e.clientX - rect.left;                 // 鼠标在可视区内的横向位置
  const contentX = tlBody.scrollLeft + bodyX;          // 鼠标处的 timeline 内容坐标
  const tAt = (contentX - NAMES_W) / state.px;         // 鼠标指向的时间（可为负）
  const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;       // 上滚放大，下滚缩小
  const oldPx = state.px;
  state.px = Math.min(500, Math.max(30, Math.round(state.px * factor / 5) * 5)); // 与缩放滑杆同范围/步长
  if (state.px === oldPx) return;
  document.getElementById('inp-zoom').value = state.px;
  renderTimeline(); updatePlayhead();
  tlBody.scrollLeft = Math.max(0, NAMES_W + tAt * state.px - bodyX); // 锚点回位
  scheduleAutosave();
}, { passive: false });
document.getElementById('btn-key-all').addEventListener('click', () => {
  snapshot();
  for (const tr of TRACKS) upsertKey(tr.id, state.time, currentValue(tr.id));
  renderTimeline(); applyAll(state.time);
});
document.getElementById('btn-del-key').addEventListener('click', () => {
  deleteSelection();
});
document.getElementById('btn-paste-key').addEventListener('click', () => {
  pasteSelection();
});
document.getElementById('sel-interp').addEventListener('change', e => {
  const v = e.target.value;
  if (v) setSelectionInterp(v);
  e.target.value = ''; // 复位占位项，便于连续选择同一类型
});
// 一键删除所有轨道的全部关键帧（confirm 防误删，可用 ⌘Z 撤回）
document.getElementById('btn-clear-all').addEventListener('click', () => {
  const total = TRACKS.reduce((s, tr) => s + keysOf(tr.id).length, 0);
  if (total === 0) { flashHint('当前没有任何关键帧'); return; }
  if (!confirm(`确认删除全部 ${total} 个关键帧？（可用 ⌘Z 撤回）`)) return;
  snapshot();
  for (const tr of TRACKS) keysOf(tr.id).length = 0;
  clearSelection();
  closeKfEditor();
  renderTimeline();
  applyAll(state.time);
  flashHint(`已清空全部 ${total} 个关键帧`);
});

// --- 帮助看板（功能总览 + 快捷键速查） ---
const helpOverlay = document.getElementById('help-overlay');
function toggleHelp(show) {
  helpOverlay.style.display = show ? 'flex' : 'none';
}
document.getElementById('btn-help').addEventListener('click', () => toggleHelp(true));
document.getElementById('help-close').addEventListener('click', () => toggleHelp(false));
helpOverlay.addEventListener('click', e => { if (e.target === helpOverlay) toggleHelp(false); });

window.addEventListener('keydown', e => {
  const mod = e.metaKey || e.ctrlKey;
  const k = e.key.toLowerCase();
  if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
  if (mod && k === 'y') { e.preventDefault(); redo(); return; }
  if (e.key === 'Escape' && helpOverlay.style.display === 'flex') { toggleHelp(false); return; } // 帮助看板优先关闭（不受输入框焦点影响）
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (mod && k === 'c') { e.preventDefault(); copySelection(); return; }
  if (mod && k === 'x') { e.preventDefault(); cutSelection(); return; }
  if (mod && k === 'v') { e.preventDefault(); pasteSelection(); return; }
  if (e.code === 'Space') { e.preventDefault(); setPlaying(!state.playing); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); seek(state.time - 1 / PREVIEW_FPS); } // 阻止默认横向滚动
  else if (e.key === 'ArrowRight') { e.preventDefault(); seek(state.time + 1 / PREVIEW_FPS); }
  else if (e.key === 'Delete' || e.key === 'Backspace') {
    deleteSelection();
  } else if (e.key === 'Escape') {
    closeKfEditor();
    if (state.sel.size) { clearSelection(); renderDiamonds(); }
  }
});

// ---------------------------------------------------------------------------
// 8. 视角切换
// ---------------------------------------------------------------------------
const btnView = document.getElementById('btn-view');
const viewBadge = document.getElementById('view-badge');
function setView(mode) {
  state.view = mode;
  const free = mode === 'free';
  controls.enabled = free;
  btnView.textContent = free ? '🖐 自由视角' : '🎥 摄像机视角';
  btnView.classList.toggle('on', !free);
  btnSyncCam.classList.toggle('on', free);
  viewBadge.textContent = free
    ? '自由视角 · 拖拽旋转 / 滚轮缩放 / 右键平移（不影响关键帧）'
    : '摄像机视角 · 按关键帧动画渲染';
  applyAll(state.time);
  scheduleAutosave();
}
btnView.addEventListener('click', () => setView(state.view === 'camera' ? 'free' : 'camera'));

// ---------------------------------------------------------------------------
// 8b. 同步自由视角 → 当前时间关键帧
//     在自由视角摆好机位（旋转/缩放/平移视觉中心）后，点击按钮把当前视口
//     的相机位置 + 视觉中心写入播放头时间的关键帧；若取消"看向视觉中心"
//     则额外写入旋转欧拉角。
// ---------------------------------------------------------------------------
const btnSyncCam = document.getElementById('btn-sync-cam');
let syncToastTimer = null;
function clampTrack(id, v) {
  const tr = TRACK_MAP[id];
  return Math.min(tr.hi ?? tr.max, Math.max(tr.lo ?? tr.min, v));
}
function syncFreeViewToKeys() {
  snapshot();
  const t = state.time;
  const set = (id, v) => upsertKey(id, t, clampTrack(id, v));
  set('camX', camera.position.x);
  set('camY', camera.position.y);
  set('camZ', camera.position.z);
  set('tgtX', controls.target.x);
  set('tgtY', controls.target.y);
  set('tgtZ', controls.target.z);
  if (!state.lookAtTarget) {
    const eul = new THREE.Euler(0, 0, 0, 'YXZ').setFromQuaternion(camera.quaternion);
    set('rotX', THREE.MathUtils.radToDeg(eul.x));
    set('rotY', THREE.MathUtils.radToDeg(eul.y));
    set('rotZ', THREE.MathUtils.radToDeg(eul.z));
  }
  renderTimeline();
  applyAll(state.time);
  viewBadge.textContent = `📌 已同步自由视角机位 → 关键帧 @ ${t.toFixed(2)}s${state.lookAtTarget ? '' : '（含旋转）'}`;
  clearTimeout(syncToastTimer);
  syncToastTimer = setTimeout(() => {
    viewBadge.textContent = state.view === 'free'
      ? '自由视角 · 拖拽旋转 / 滚轮缩放 / 右键平移（不影响关键帧）'
      : '摄像机视角 · 按关键帧动画渲染';
  }, 2200);
}
btnSyncCam.addEventListener('click', syncFreeViewToKeys);

// --- 撤销 / 重做按钮 ---
document.getElementById('btn-undo').addEventListener('click', undo);
document.getElementById('btn-redo').addEventListener('click', redo);
updateUndoButtons();

// ---------------------------------------------------------------------------
// 9. 导出
// ---------------------------------------------------------------------------
const exportModal = document.getElementById('export-modal');
const expRes = document.getElementById('exp-res');
const expCustomRow = document.getElementById('exp-custom-row');
expRes.addEventListener('change', () => {
  expCustomRow.style.display = expRes.value === 'custom' ? 'flex' : 'none';
});
const MP4_OK = typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/mp4');
const expFormat = document.getElementById('exp-format');
expFormat.addEventListener('change', () => {
  const f = expFormat.value;
  document.getElementById('exp-mix-row').style.display = ((f === 'mp4' || f === 'webm') && audioState.ready) ? 'flex' : 'none';
});
document.getElementById('btn-export').addEventListener('click', () => {
  const mixOk = audioState.ready;
  // 浏览器不支持 MP4 录制时禁用该选项（如 Firefox）
  const mp4Opt = expFormat.querySelector('option[value="mp4"]');
  mp4Opt.disabled = !MP4_OK;
  if (!MP4_OK && expFormat.value === 'mp4') expFormat.value = 'webm';
  document.getElementById('exp-mix-row').style.display = mixOk ? 'flex' : 'none';
  document.getElementById('exp-mix').checked = mixOk;
  document.getElementById('exp-range').value = mixOk
    ? `口播 ${audioState.duration.toFixed(1)}s · 动画 ${state.duration}s — 混音导出为实时录制，时长以口播为准`
    : `0 – ${state.duration}s（实时录制，视频时长 = 动画时长 ${state.duration}s）`;
  document.getElementById('export-status').textContent = '';
  document.getElementById('export-progress').style.display = 'none';
  exportModal.style.display = 'flex';
});
document.getElementById('exp-cancel').addEventListener('click', () => {
  if (exporting) { exportCancelled = true; }
  else exportModal.style.display = 'none';
});

let exporting = false, exportCancelled = false;

function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// 挑选当前浏览器支持的最佳录制编码：MP4(H.264) 优先，其次 VP9，最后 VP8。
// wantWebm=true 时只在 WebM 容器内选（用户明确选了 WebM 格式）。
function pickVideoMime(withAudio, wantWebm) {
  const groups = wantWebm
    ? (withAudio
        ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
        : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'])
    : (withAudio
        ? ['video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
        : ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1.640028', 'video/mp4',
           'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']);
  for (const c of groups) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return null;
}

// ---- WebCodecs 精确帧率导出（解决 MediaRecorder 输出帧率不受控）----
// 根因：MediaRecorder 的输出帧率由浏览器编码器决定，无法通过 API 指定——
// 设置 60fps 导出，实际文件帧率可能只有 ~24fps（Chrome 编码器行为）。
// 这里改用 WebCodecs VideoEncoder 逐帧精确编码 + mp4-muxer / webm-muxer 封装容器，
// 帧率严格等于所选值；环境不支持（Firefox/Safari 无 VideoEncoder）或 muxer 库
// 加载失败时，调用方回退到 MediaRecorder 实时录制。
const MUXER_CDN = {
  mp4: 'https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.2/build/mp4-muxer.min.js',     // 全局 Mp4Muxer
  webm: 'https://cdn.jsdelivr.net/npm/webm-muxer@5.0.3/build/webm-muxer.min.js',   // 全局 WebMMuxer
};
let muxerLibCache = {};

function loadMuxerLib(wantWebm) {
  const key = wantWebm ? 'webm' : 'mp4';
  if (muxerLibCache[key]) return muxerLibCache[key];
  if (muxerLibCache[key] === false) return Promise.reject(new Error('muxer 库加载失败'));
  muxerLibCache[key] = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = MUXER_CDN[key];
    s.onload = () => {
      const lib = window[key === 'webm' ? 'WebMMuxer' : 'Mp4Muxer'];
      if (lib && lib.Muxer && lib.ArrayBufferTarget) resolve(lib);
      else { muxerLibCache[key] = false; reject(new Error('muxer 库格式异常')); }
    };
    s.onerror = () => { muxerLibCache[key] = false; reject(new Error('muxer 库加载失败（网络不可达）')); };
    document.head.appendChild(s);
  });
  return muxerLibCache[key];
}

function canUseWebCodecs() {
  return typeof window.VideoEncoder === 'function' && typeof VideoFrame === 'function';
}

// 探测编码器支持的 codec 字符串：H.264 由 High 4.2 到 Baseline 降级，VP9 由 level 4.1 降级。
async function pickVideoCodec(wantWebm, w, h, fps) {
  const cands = wantWebm
    ? ['vp09.00.41.08', 'vp09.00.10.08']
    : ['avc1.64002a', 'avc1.640028', 'avc1.42002a', 'avc1.42001f'];
  for (const codec of cands) {
    try {
      const r = await VideoEncoder.isConfigSupported({ codec, width: w, height: h, bitrate: 16e6, framerate: fps });
      if (r && r.supported) return codec;
    } catch (e) { /* 尝试下一个 */ }
  }
  return null;
}

// 逐帧精确导出。返回 'ok' | 'cancelled' | 'unsupported'（unsupported → 调用方回退 MediaRecorder）
async function frameAccurateExport(w, h, fps, wantWebm) {
  if (!canUseWebCodecs()) return 'unsupported';
  const bar = document.querySelector('#export-progress i');
  const status = document.getElementById('export-status');
  const prog = document.getElementById('export-progress');
  prog.style.display = 'block';
  exporting = true; exportCancelled = false;
  setPlaying(false);

  const canvas = renderer.domElement;
  const oldW = canvas.width, oldH = canvas.height;
  const oldAspect = camera.aspect;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();

  let enc = null;
  try {
    const lib = await loadMuxerLib(wantWebm);
    const codec = await pickVideoCodec(wantWebm, w, h, fps);
    if (!codec) return 'unsupported';
    const ext = wantWebm ? 'webm' : 'mp4';
    const frames = Math.max(1, Math.round(state.duration * fps));
    const usPerFrame = Math.round(1e6 / fps);

    const muxer = new lib.Muxer({
      target: new lib.ArrayBufferTarget(),
      video: { codec: wantWebm ? 'V_VP9' : 'avc', width: w, height: h, frameRate: fps, bitrate: 16e6 },
      ...(wantWebm ? {} : { fastStart: 'in-memory' }),
      firstTimestampBehavior: 'offset',
    });

    enc = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: e => { throw e; },
    });
    enc.configure({ codec, width: w, height: h, bitrate: 16e6, framerate: fps });

    for (let i = 0; i < frames; i++) {
      if (exportCancelled) break;
      const t = i / fps;
      applyAll(t, true);
      controls.update();
      renderer.render(scene, camera);
      const vf = new VideoFrame(canvas, { timestamp: i * usPerFrame, duration: usPerFrame });
      enc.encode(vf, { keyFrame: i % Math.round(fps * 5) === 0 });
      vf.close();
      // 背压：等编码队列消化，避免 4K 长动画内存堆积
      while (enc.encodeQueueSize > 8) await new Promise(r => setTimeout(r, 0));
      bar.style.width = ((i + 1) / frames * 100).toFixed(1) + '%';
      status.textContent = `精确编码 ${i + 1} / ${frames} 帧（t = ${t.toFixed(2)}s @ ${fps}fps）`;
    }
    if (exportCancelled) { await enc.flush().catch(() => {}); return 'cancelled'; }

    status.textContent = '正在封装容器并写入文件…';
    await enc.flush();
    enc.close(); enc = null;
    muxer.finalize();
    const blob = new Blob([muxer.target.buffer], { type: wantWebm ? 'video/webm' : 'video/mp4' });
    downloadBlob(blob, `glitter_${w}x${h}_${fps}fps.${ext}`);
    status.textContent = `✅ 已导出 ${ext.toUpperCase()} 视频（${w}×${h} @ ${fps}fps 精确编码，${blob.size / 1048576 > 1 ? (blob.size / 1048576).toFixed(1) + ' MB' : Math.round(blob.size / 1024) + ' KB'}）— 可直接预览`;
    return 'ok';
  } catch (err) {
    status.textContent = '精确导出失败：' + err.message;
    return 'unsupported';
  } finally {
    if (enc) { try { enc.close(); } catch (e) {} }
    renderer.setSize(oldW, oldH, false);
    camera.aspect = oldAspect;
    camera.updateProjectionMatrix();
    exporting = false;
    applyAll(state.time);
  }
}

// 用浏览器原生 MediaRecorder 实时录制（MP4/WebM）。以真实流逝时间驱动动画，
// 保证视频总时长 = 动画时长；canvas.captureStream 按帧率节流捕获，不掉帧丢内容。
// 注意：MediaRecorder 的输出帧率由浏览器编码器决定，无法精确控制（回退路径）。
async function recordingExport(w, h, fps, wantWebm) {
  const bar = document.querySelector('#export-progress i');
  const status = document.getElementById('export-status');
  const prog = document.getElementById('export-progress');
  prog.style.display = 'block';
  exporting = true; exportCancelled = false;
  setPlaying(false);

  const canvas = renderer.domElement;
  const oldW = canvas.width, oldH = canvas.height;
  const oldAspect = camera.aspect;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();

  try {
    const mime = pickVideoMime(false, wantWebm);
    if (!mime) throw new Error('当前浏览器不支持视频录制');
    const isMp4 = mime.startsWith('video/mp4');
    const ext = isMp4 ? 'mp4' : 'webm';

    const stream = canvas.captureStream(fps);
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 16e6 });
    const chunks = [];
    rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    const stopped = new Promise(res => { rec.onstop = res; });

    rec.start(200);
    const t0 = performance.now();
    let rafId = 0;
    const finish = () => { cancelAnimationFrame(rafId); rec.stop(); };
    const tick = () => {
      if (exportCancelled) { finish(); return; }
      const el = (performance.now() - t0) / 1000;
      if (el >= state.duration) { finish(); return; }
      applyAll(el, true);
      controls.update();
      renderer.render(scene, camera);
      bar.style.width = Math.min(100, (el / state.duration * 100).toFixed(1)) + '%';
      status.textContent = `录制中 ${el.toFixed(2)}s / ${state.duration.toFixed(1)}s（${ext.toUpperCase()} ${isMp4 ? 'H.264' : 'VP9'}，导出后可直接预览）`;
      rafId = requestAnimationFrame(tick);
    };
    tick();
    await stopped;

    if (exportCancelled) {
      status.textContent = '已取消导出。';
    } else {
      const blob = new Blob(chunks, { type: mime });
      downloadBlob(blob, `glitter_${w}x${h}_${fps}fps.${ext}`);
      status.textContent = `✅ 已导出 ${ext.toUpperCase()} 视频（${w}×${h} @ ${fps}fps，${blob.size / 1048576 > 1 ? (blob.size / 1048576).toFixed(1) + ' MB' : Math.round(blob.size / 1024) + ' KB'}）— 可直接预览。注意：本浏览器不支持精确帧率编码，实际帧率由浏览器决定（通常 24/30fps）`;
    }
  } catch (err) {
    status.textContent = '导出失败：' + err.message;
  } finally {
    renderer.setSize(oldW, oldH, false);
    camera.aspect = oldAspect;
    camera.updateProjectionMatrix();
    exporting = false;
    applyAll(state.time);
  }
}

// 实时录制导出：canvas.captureStream + 口播音频轨 → MP4/WebM（音画同步，时长以口播为准）
async function exportLiveVoice(w, h, fps, wantWebm) {
  const bar = document.querySelector('#export-progress i');
  const status = document.getElementById('export-status');
  const prog = document.getElementById('export-progress');
  prog.style.display = 'block';
  exporting = true; exportCancelled = false;
  setPlaying(false);

  const canvas = renderer.domElement;
  const oldW = canvas.width, oldH = canvas.height;
  const oldAspect = camera.aspect;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();

  try {
    const stream = canvas.captureStream(fps);
    const audioTracks = audioState.el.captureStream().getAudioTracks();
    if (!audioTracks.length) throw new Error('无法捕获口播音频轨');
    audioTracks.forEach(t => stream.addTrack(t));
    const mime = pickVideoMime(true, wantWebm);
    if (!mime) throw new Error('当前浏览器不支持视频录制');
    const isMp4 = mime.startsWith('video/mp4');
    const ext = isMp4 ? 'mp4' : 'webm';

    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 16e6, audioBitsPerSecond: 160e3 });
    const chunks = [];
    rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    const stopped = new Promise(res => { rec.onstop = res; });

    rec.start(100);
    state.exportLive = true;
    audioState.el.currentTime = 0;
    seek(0, false);
    setPlaying(true); // 内部会 audioEl.play()

    while (state.exportLive) {
      await new Promise(r => setTimeout(r, 100));
      if (exportCancelled || audioState.el.ended || state.time >= state.duration - 1e-4) state.exportLive = false;
      status.textContent = `实时录制中 · 口播 ${audioState.el.currentTime.toFixed(2)}s / ${audioState.duration.toFixed(1)}s（音画同步）`;
      bar.style.width = Math.min(100, (audioState.el.currentTime / state.duration * 100).toFixed(1)) + '%';
    }
    setPlaying(false);
    audioState.el.pause();
    rec.stop();
    await stopped;

    if (exportCancelled) {
      status.textContent = '已取消导出。';
    } else {
      const blob = new Blob(chunks, { type: mime });
      downloadBlob(blob, `glitter_voice_${w}x${h}_${fps}fps.${ext}`);
      status.textContent = `✅ 已导出带口播的 ${ext.toUpperCase()} 视频（${w}×${h}，${blob.size / 1048576 > 1 ? (blob.size / 1048576).toFixed(1) + ' MB' : Math.round(blob.size / 1024) + ' KB'}）— 可直接预览。注意：实时混音录制的帧率由浏览器编码器决定（可能与所选 ${fps}fps 不一致）`;
    }
  } catch (err) {
    status.textContent = '混音导出失败：' + err.message;
  } finally {
    state.exportLive = false;
    renderer.setSize(oldW, oldH, false);
    camera.aspect = oldAspect;
    camera.updateProjectionMatrix();
    exporting = false;
    applyAll(state.time);
  }
}

document.getElementById('exp-start').addEventListener('click', async () => {
  if (exporting) return;
  let w, h;
  if (expRes.value === 'custom') {
    w = Math.max(16, +document.getElementById('exp-w').value || 1920);
    h = Math.max(16, +document.getElementById('exp-h').value || 1080);
  } else { [w, h] = expRes.value.split('x').map(Number); }
  const fps = +document.getElementById('exp-fps').value;
  const format = document.getElementById('exp-format').value;
  const mix = document.getElementById('exp-mix').checked;

  // MP4 / WebM：优先 WebCodecs 逐帧精确编码（帧率严格 = 所选值，60fps 就是 60fps）；
  // 浏览器不支持 WebCodecs 或 muxer 库加载失败时，回退 MediaRecorder 实时录制。
  if (format === 'mp4' || format === 'webm') {
    const wantWebm = format === 'webm';
    if (mix && audioState.ready) {
      await exportLiveVoice(w, h, fps, wantWebm); // 混音：实时录制（音画同步优先）
    } else {
      const r = await frameAccurateExport(w, h, fps, wantWebm);
      if (r === 'ok' || r === 'cancelled') return;
      await recordingExport(w, h, fps, wantWebm);
    }
    return;
  }

  // PNG 序列：逐帧精确渲染打包 ZIP
  const frames = Math.max(1, Math.round(state.duration * fps));

  const bar = document.querySelector('#export-progress i');
  const status = document.getElementById('export-status');
  const prog = document.getElementById('export-progress');
  prog.style.display = 'block';
  exporting = true; exportCancelled = false;
  setPlaying(false);

  // 保存现场
  const canvas = renderer.domElement;
  const oldW = canvas.width, oldH = canvas.height;
  const oldAspect = camera.aspect;

  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();

  const zip = new JSZip();
  const pad = n => String(n).padStart(4, '0');
  try {
    for (let i = 0; i < frames; i++) {
      if (exportCancelled) break;
      const t = i / fps;
      applyAll(t, true);                 // 导出始终按摄像机关键帧动画渲染
      controls.update();
      renderer.render(scene, camera);
      const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
      zip.file(`frame_${pad(i)}.png`, blob);
      bar.style.width = ((i + 1) / frames * 100).toFixed(1) + '%';
      status.textContent = `渲染帧 ${i + 1} / ${frames}（t = ${t.toFixed(2)}s）`;
      await new Promise(r => setTimeout(r, 0));
    }
    if (!exportCancelled) {
      status.textContent = '正在打包 ZIP…';
      const blob = await zip.generateAsync({ type: 'blob' }, m => {
        bar.style.width = (m.percent).toFixed(1) + '%';
      });
      downloadBlob(blob, `glitter_${w}x${h}_${fps}fps_序列帧.zip`);
      status.textContent = `✅ 已导出 ${frames} 帧 PNG 序列（${w}×${h} @ ${fps}fps）`;
    } else {
      status.textContent = '已取消导出。';
    }
  } catch (err) {
    status.textContent = '导出失败：' + err.message;
  } finally {
    renderer.setSize(oldW, oldH, false);
    camera.aspect = oldAspect;
    camera.updateProjectionMatrix();
    exporting = false;
    applyAll(state.time);
  }
});

// ---------------------------------------------------------------------------
// 10. 布局 / 主循环
// ---------------------------------------------------------------------------
function resize() {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  updateSafeFrame();
}
new ResizeObserver(resize).observe(viewport);

// ---------------------------------------------------------------------------
// 预览辅助：导出画幅安全框 + 全局网格显示开关
//   安全框是 DOM overlay（不进入 canvas，因此不会出现在导出视频中），
//   按导出分辨率宽高比在视口中央等比缩放，虚线范围即最终输出画面。
// ---------------------------------------------------------------------------
const safeFrame = document.getElementById('safe-frame');
const safeLabel = document.getElementById('safe-label');
function currentExportSize() {
  const r = document.getElementById('exp-res');
  if (r && r.value === 'custom') {
    return [
      Math.max(16, +document.getElementById('exp-w').value || 1920),
      Math.max(16, +document.getElementById('exp-h').value || 1080),
    ];
  }
  if (r) { const p = r.value.split('x').map(Number); if (p.length === 2) return p; }
  return [1920, 1080];
}
function updateSafeFrame() {
  const wrap = document.getElementById('viewport-wrap');
  const ww = wrap.clientWidth, wh = wrap.clientHeight;
  if (!ww || !wh) return;
  const [ew, eh] = currentExportSize();
  safeLabel.textContent = ew + '×' + eh;
  let fw = ww * 0.94, fh = fw * eh / ew;
  if (fh > wh * 0.94) { fh = wh * 0.94; fw = fh * ew / eh; }
  safeFrame.style.width = fw + 'px';
  safeFrame.style.height = fh + 'px';
}
document.getElementById('btn-grid').addEventListener('click', () => {
  grid.visible = !grid.visible;
  document.getElementById('btn-grid').classList.toggle('on', grid.visible);
  scheduleAutosave();
});
document.getElementById('btn-frame').addEventListener('click', () => {
  const hidden = safeFrame.classList.toggle('hidden');
  document.getElementById('btn-frame').classList.toggle('on', !hidden);
  scheduleAutosave();
});
// 背景色：预设下拉（默认近黑/纯黑/纯白/纯绿抠像）+ 自定义取色器，scene.background 实时生效并写入工程/导出
const BG_PRESETS = {
  '#05070d': '默认（近黑）',
  '#000000': '纯黑',
  '#ffffff': '纯白',
  '#00b140': '纯绿（抠像）',
};
function setBackgroundColor(colorStr) {
  let c;
  try { c = new THREE.Color(colorStr); } catch (e) { return; }
  scene.background = c;
  if (scene.fog) scene.fog.color = new THREE.Color(colorStr); // 模板带距离雾，背景变色时同步雾色避免物体发暗
  const hex = '#' + c.getHexString();
  const sel = document.getElementById('sel-bg');
  if (sel) sel.value = (hex in BG_PRESETS) ? hex : '';
  const colorInput = document.getElementById('bg-color');
  if (colorInput) colorInput.value = hex;
}
const _selBgEl = document.getElementById('sel-bg');
const _bgColorEl = document.getElementById('bg-color');
if (_selBgEl) _selBgEl.addEventListener('change', () => {
  const v = _selBgEl.value;
  _selBgEl.value = ''; // 立即复位：再次选择同一预设也能触发 change
  if (!v) return;
  setBackgroundColor(v);
  scheduleAutosave();
  flashHint('🎨 背景已切换为 ' + (BG_PRESETS[v] || v));
});
if (_bgColorEl) _bgColorEl.addEventListener('input', () => {
  // 拖色板时连续触发，静默生效，不打扰提示
  setBackgroundColor(_bgColorEl.value);
  scheduleAutosave();
});
const _expResEl = document.getElementById('exp-res');
const _expWEl = document.getElementById('exp-w');
const _expHEl = document.getElementById('exp-h');
if (_expResEl) _expResEl.addEventListener('change', updateSafeFrame);
if (_expWEl) _expWEl.addEventListener('change', updateSafeFrame);
if (_expHEl) _expHEl.addEventListener('change', updateSafeFrame);
window.addEventListener('resize', updateSafeFrame);
updateSafeFrame();

// ---------------------------------------------------------------------------
// 12. 工程管理：自动保存（localStorage）+ 导出/导入 .json 工程文件
//     任何编辑（关键帧/时长/设置/视角/网格/音频元数据）都会防抖自动保存，
//     刷新页面自动恢复；「保存工程」可下载 .json 备份/分享，「打开工程」随时调用。
// ---------------------------------------------------------------------------
const STORAGE_KEY = 'animation-workbench-project';
let autosaveTimer = null;

function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(saveProjectToStorage, 600);
}

function serializeProject() {
  return {
    app: 'animation-workbench',
    version: 1,
    savedAt: new Date().toISOString(),
    duration: state.duration,
    time: +state.time.toFixed(3),
    loop: state.loop,
    px: state.px,
    view: state.view,
    lookAtTarget: state.lookAtTarget,
    gridVisible: grid.visible,
    frameVisible: !safeFrame.classList.contains('hidden'),
    bgColor: '#' + scene.background.getHexString(),
    keys: state.keys,
    audio: (audioState.peaks && audioState.peaks.length) ? {
      name: audioState.name,
      duration: audioState.duration,
      peaks: Array.from(audioState.peaks), // 仅波形元数据，音频本体需重新导入才能播放/混音
    } : null,
  };
}

function saveProjectToStorage() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeProject())); }
  catch (e) { /* 存储配额不足时静默失败，不影响工作台 */ }
}

function sanitizeProject(data) {
  if (!data || typeof data !== 'object' || data.app !== 'animation-workbench' ||
      !data.keys || typeof data.keys !== 'object')
    throw new Error('文件缺少工程标识（app/version/keys），可能不是本工作台的工程文件');
  const p = {
    duration: Math.min(300, Math.max(1, +data.duration || 12)),
    time: 0, px: Math.min(500, Math.max(30, +data.px || 95)),
    loop: data.loop !== false,
    view: data.view === 'free' ? 'free' : 'camera',
    lookAtTarget: data.lookAtTarget !== false,
    gridVisible: data.gridVisible !== false,
    frameVisible: data.frameVisible !== false,
    bgColor: /^#[0-9a-f]{6}$/i.test(data.bgColor) ? data.bgColor.toLowerCase() : '#05070d',
    keys: {}, audio: null,
  };
  p.time = Math.min(p.duration, Math.max(0, +data.time || 0));
  for (const id in data.keys) {
    const tr = TRACK_MAP[id];
    if (!tr || !Array.isArray(data.keys[id])) continue;
    const arr = [];
    for (const k of data.keys[id]) {
      const t = +k.t, v = +k.v;
      if (!isFinite(t) || !isFinite(v)) continue;
      let cv = Math.min(tr.hi ?? tr.max, Math.max(tr.lo ?? tr.min, v));
      if (tr.integer) cv = Math.round(cv);
      const interp = (k.interp === 'linear' || k.interp === 'step') ? k.interp : (tr.seg ? 'step' : 'smooth');
      arr.push({ t: Math.min(p.duration, Math.max(0, t)), v: cv, interp });
    }
    arr.sort((a, b) => a.t - b.t);
    p.keys[id] = arr;
  }
  if (data.audio && Array.isArray(data.audio.peaks) && data.audio.peaks.length) {
    p.audio = {
      name: String(data.audio.name || '音频'),
      duration: Math.max(0, +data.audio.duration || 0),
      peaks: data.audio.peaks.slice(0, 4000).map(Number).filter(n => isFinite(n)),
    };
  }
  return p;
}

function restoreAudioMeta(meta) {
  if (meta && meta.peaks && meta.peaks.length) {
    audioState.name = meta.name;
    audioState.duration = meta.duration;
    audioState.peaks = new Float32Array(meta.peaks);
    audioState.metaOnly = true;
    audioChip.style.display = 'inline-flex';
    document.getElementById('audio-chip-name').textContent = meta.name;
    document.getElementById('audio-chip-dur').textContent = meta.duration.toFixed(1) + 's';
    document.getElementById('exp-mix-row').style.display = 'none'; // 无音频本体，不可混音
  } else {
    audioState.name = ''; audioState.duration = 0; audioState.peaks = null; audioState.metaOnly = false;
    audioChip.style.display = 'none';
    document.getElementById('exp-mix-row').style.display = 'none';
  }
}

function applyProjectData(data) {
  const p = sanitizeProject(data);
  state.duration = p.duration;
  state.time = p.time;
  state.loop = p.loop;
  state.px = p.px;
  state.lookAtTarget = p.lookAtTarget;
  clearSelection();
  state.keys = p.keys;
  closeKfEditor();
  restoreAudioMeta(p.audio);
  document.getElementById('inp-duration').value = p.duration;
  document.getElementById('inp-zoom').value = p.px;
  document.getElementById('chk-loop').checked = p.loop;
  const lookAt = document.getElementById('chk-lookat');
  if (lookAt) lookAt.checked = p.lookAtTarget;
  grid.visible = p.gridVisible;
  document.getElementById('btn-grid').classList.toggle('on', p.gridVisible);
  safeFrame.classList.toggle('hidden', !p.frameVisible);
  document.getElementById('btn-frame').classList.toggle('on', p.frameVisible);
  setBackgroundColor(p.bgColor);
  setView(p.view);
  return p;
}

function exportProjectFile() {
  const blob = new Blob([JSON.stringify(serializeProject(), null, 2)], { type: 'application/json' });
  const d = new Date(), pad = n => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
  downloadBlob(blob, `workbench_工程_${stamp}.json`);
  const keyCount = Object.values(state.keys).reduce((s, a) => s + a.length, 0);
  flashHint(`💾 已导出工程文件（${state.duration}s · ${keyCount} 个关键帧）— 可随时通过「打开工程」或拖拽恢复`);
}

async function importProjectFile(file) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const p = applyProjectData(data);
    undoStack.length = 0; redoStack.length = 0;
    renderTimeline();
    applyAll(state.time);
    updateUndoButtons();
    scheduleAutosave();
    const keyCount = Object.values(p.keys).reduce((s, a) => s + a.length, 0);
    flashHint(`📂 已打开工程「${file.name}」— ${p.duration}s · ${keyCount} 个关键帧`);
  } catch (err) {
    alert('工程文件读取失败：' + err.message);
  }
}

function newProject() {
  if (!confirm('新建工程将清空当前全部关键帧与设置，并恢复默认演示动画。\n建议先点击「保存工程」备份当前内容。确定继续？')) return;
  const defDur = parseFloat(document.getElementById('inp-duration').defaultValue) || 12;
  const defPx = parseFloat(document.getElementById('inp-zoom').defaultValue) || 95;
  removeAudio();
  undoStack.length = 0; redoStack.length = 0;
  state.duration = defDur; state.time = 0; state.loop = true; state.px = defPx;
  state.view = 'camera'; state.lookAtTarget = true; clearSelection();
  for (const tr of TRACKS) { state.statics[tr.id] = tr.def; state.keys[tr.id] = []; }
  seedDemo();
  document.getElementById('inp-duration').value = defDur;
  document.getElementById('inp-zoom').value = defPx;
  document.getElementById('chk-loop').checked = true;
  const lookAt = document.getElementById('chk-lookat');
  if (lookAt) lookAt.checked = true;
  grid.visible = true; document.getElementById('btn-grid').classList.add('on');
  safeFrame.classList.remove('hidden'); document.getElementById('btn-frame').classList.add('on');
  setBackgroundColor('#05070d');
  setView('camera');
  renderTimeline();
  applyAll(state.time);
  updateUndoButtons();
  scheduleAutosave();
  flashHint('🗑 已新建工程（恢复默认演示动画）');
}

function tryRestoreAutosave() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    applyProjectData(JSON.parse(raw));
    flashHint('已自动恢复上次的工程（关键帧/时长/设置均已保存）');
    return true;
  } catch (e) {
    console.warn('自动恢复失败：', e);
    return false;
  }
}

document.getElementById('btn-project-save').addEventListener('click', exportProjectFile);
document.getElementById('btn-project-open').addEventListener('click', () => document.getElementById('file-project').click());
document.getElementById('file-project').addEventListener('change', () => {
  const f = document.getElementById('file-project').files[0];
  if (f) importProjectFile(f);
  document.getElementById('file-project').value = '';
});
document.getElementById('btn-project-new').addEventListener('click', newProject);
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => {
  e.preventDefault();
  const f = [...((e.dataTransfer && e.dataTransfer.files) || [])].find(f => /\.json$/i.test(f.name));
  if (f) importProjectFile(f);
});
window.addEventListener('beforeunload', saveProjectToStorage);

// 启动时自动恢复上次工程（必须在 buildTimeline() 之前执行，让时间轴按恢复后的状态构建）
tryRestoreAutosave();

// 时间轴高度拖拽
{
  const splitter = document.getElementById('splitter');
  const timeline = document.getElementById('timeline');
  let startY = 0, startH = 0, dragOn = false;
  splitter.addEventListener('pointerdown', e => {
    dragOn = true; startY = e.clientY; startH = timeline.offsetHeight;
    try { splitter.setPointerCapture(e.pointerId); } catch (_) {}
  });
  splitter.addEventListener('pointermove', e => {
    if (!dragOn) return;
    const nh = Math.min(window.innerHeight - 140, Math.max(120, startH + (startY - e.clientY)));
    timeline.style.height = nh + 'px';
    timeline.style.flexBasis = nh + 'px';
    resize();
  });
  splitter.addEventListener('pointerup', () => { dragOn = false; });
}

const clock = new THREE.Clock();
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.1);
  if (state.playing) {
    if (state.exportLive && audioState.ready) {
      // 实时录制：时间由口播音频驱动，保证音画精确同步
      state.time = Math.min(state.duration, audioState.el.currentTime);
      if (audioState.el.ended) { state.time = state.duration; setPlaying(false); }
    } else {
      state.time += dt;
      if (state.time >= state.duration) {
        if (state.loop) {
          state.time = 0;
          if (audioState.ready && audioState.el) audioState.el.currentTime = 0;
        }
        else { state.time = state.duration; setPlaying(false); }
      }
      if (audioState.ready && audioState.el && audioState.el.paused && !audioState.el.ended)
        audioState.el.play().catch(() => {});
    }
  }
  syncAudioTime();
  controls.update();
  applyAll(state.time);
  renderer.render(scene, camera);
}

buildTimeline();
resize();
applyAll(0);
loop();
