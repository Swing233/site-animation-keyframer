# 实现说明与陷阱清单

基于模板 `assets/animation-workbench-template/`（源自"沟槽反射亮线模拟器"增强版实战）总结。

## 一、分析原站的 grep 技巧

minified bundle 里最有效的信息源是**中文 UI 标签**和**变量名**：

```bash
# 中文标签（发现参数与现象描述）
grep -o '"[^"]\{4,40\}"' bundle.js | grep -E '沟槽|光线|深度|数量|角度|强度|相机|视角' | sort | uniq -c | sort -rn
# 引擎判定
grep -o 'WebGLRenderer\|PerspectiveCamera\|OrbitControls' bundle.js | sort | uniq -c
# 英文变量/参数名
grep -o "'[a-zA-Z]\{3,30\}'" bundle.js | grep -iE 'count|depth|angle|light|camera|mode' | sort | uniq -c
```

## 二、模板 app.js 的结构（改动点标注）

| 区段 | 是否改动 | 说明 |
|------|---------|------|
| `TRACKS` 数组 | **必改** | 每轨道：`{g:分组, id, label, min, max, step, def, integer?, seg?}`；`seg` 用于枚举型参数（自动用阶梯插值 + 分段按钮 UI） |
| `seedDemo()` | **必改** | 预置演示关键帧：`K('轨道id', [[t, v, 'interp?'], ...])` |
| 场景搭建（plate/lightRig 等） | **必改** | 复刻原站现象；光源/物体可视化随参数更新 |
| `applyAll(t, forceCamera)` | 部分改 | 把 `v[轨道id]` 接到场景；摄像机/面板/播放头逻辑保持不动 |
| 时间轴 UI、关键帧编辑、导出 | **不改** | 通用，直接复用 |

`upsertKey` / `evalTrack` / `removeKey` 是关键帧数据层。**任何数值改动（面板输入/拖拽微调/枚举按钮）都走 `commitValue(tr, raw)` → 恒在当前播放头时间 `upsertKey`**：该时刻无关键帧则自动创建（继承轨道默认插值），有则原地更新、绝不重复。这等价于 AE 常开码表的行为——改值即打帧，符合"时间轴上没有关键帧就自动创建"的预期。轨道从未被打过帧时，`evalTrack` 回退到 `state.statics[id]` 静态默认值。

## 三、Shader / 视觉陷阱（实战踩过）

1. **周期纹理摩尔纹**：屏幕空间过滤是标准解——`float fw = fwidth(phase); float micro = 1.0 - smoothstep(0.4, 1.2, fw);`，把法线扰动和槽纹明暗都乘 `micro`（可再乘 `exp(-dist*0.02)` 距离衰减双保险）。WebGL2 直接用 `fwidth`，无需扩展声明。
2. **法线扰动振幅必须小**：`slope = -sin(phase) * depth * 0.9` 量级即可（最大倾角 ~40°）。**绝不能乘 spacing/频率**（如 `* 30`）——法线近乎随机水平，高光会散成满屏噪声。
3. **高光泛白整板**：多点光源叠加 + 宽 shininess 会让整个面变灰。对策：锐化 `shin = mix(60, 600, 1-rough)`、每光源距离衰减 `att = 1/(1+0.02*dist2)` 让亮斑局部化、压低 diffuse 与 fresnel 环境项。
4. **各向异性亮线**（拉丝/沟槽类）：Kajiya 项 `aniso = pow(max(0, 1-abs(dot(H,T))), p)`，T 为沟槽切向，乘进 specular。
5. **Tone mapping 顺序**：`col = col/(1+col)` 再 `pow(col, 1/2.2)`；gamma 会显著抬亮暗部，评估"背景够不够黑"要按 gamma 后的值估算。
6. **Three.js 录屏/截图**：renderer 必须 `preserveDrawingBuffer: true`、`setPixelRatio(1)`，导出时 `setSize(w,h,false)`（不改 CSS 尺寸）。

## 四、Whammy / JSZip API 速查

```js
// WebM（精确帧率，逐帧喂 webp dataURL）
const video = new Whammy.Video(fps);            // fps 决定每帧 duration
video.add(canvas.toDataURL('image/webp', 0.92)); // 必须是 webp dataURL 或 canvas
const blob = await new Promise(res => video.compile(false, res));

// PNG 序列 ZIP
const zip = new JSZip();
const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
zip.file(`frame_${String(i).padStart(4,'0')}.png`, blob);
const out = await zip.generateAsync({type:'blob'}, m => {/* m.percent 进度 */});
```

## 五、导出循环的正确姿势

- 逐帧 `applyAll(t, true)`（第三个参数强制按相机动画渲染，忽略当前自由视角）→ `renderer.render` → 立刻抓帧（同帧同步抓取最稳）。
- 每帧 `await new Promise(r=>setTimeout(r,0))` 让出主线程刷进度条；检查取消标志位。
- 结束后恢复 `renderer.setSize(旧w,旧h,false)` 与 `camera.aspect`。
- 4K×60fps×长时长会慢且吃内存，属正常；给进度条和取消按钮即可。

## 六、验证（headless-browser-testing 技能）

agent-browser 的 Chromium 在本机网络下下载会超时失败；用 playwright-core + 系统 Edge（`--use-angle=swiftshader --enable-unsafe-swiftshader`）。测试脚本要点与已知陷阱（boundingBox 遮挡、下载魔数校验、弹窗拦截点击）见该技能的 SKILL.md。

## 七、交互层陷阱（实战踩过，勿重蹈）

1. **`setPointerCapture` 在合成 PointerEvent 下抛错**：测试里用 `el.dispatchEvent(new PointerEvent('pointerdown',...))` 模拟拖动时，`setPointerCapture` 抛 `No active pointer with the given id is found` 并**中断整个 handler**（表现为 scrub 永远 0.00s、拖动无效）。所有 `setPointerCapture` 调用必须包 `try{...}catch(_){}`：真实指针下正常捕获，合成事件下静默跳过。
2. **参数列/关键帧列滚动错位**：绝不要做成两个各自 `overflow-y:auto` 的容器（行高、分组头不一致必然错位）。正确方案：单一滚动容器 + 参数列 `position:sticky;left:0`（水平滚动钉左），左右两侧分组头行同高（如 24px）、参数行/轨道行同高（如 26px），行数逐行对应。
3. **参数值拖拽微调（scrub）模式**：`pointerdown` 记 `{startX, startVal}`，`pointermove` 里 `val = startVal + dx * base`，其中 `base = (max-min)/200`（拖满 200px 走完整量程）、Shift 时 `base×0.1` 精细微调；`>3px` 才判定为拖动，未拖动且目标是输入框则 `focus()` 允许键入；元素加 `touch-action:none` 与 `user-select:none`。每次 move 直接 `commitValue`（自动打帧 + 渲染）。
4. **自动创建关键帧的容差**：`findIndex(k => Math.abs(k.t - t) <= 0.5/30)`（半帧 @30fps）判定"该时刻已有帧"，避免拖动数值时在既有帧旁产生重复帧。
5. **音频行/特殊行排除 scrubbing**：数值拖拽只挂到普通参数行的 `.tval`/`.wb-val`，用 `:not(#audioRowId)` 或 `data-id` 选择器排除音频波形行；音频行点击有自己的 seek 逻辑。
6. **`delKeyframe` 要防 `index < 0`**：仅点击选中轨道（未选具体帧）时 selected.index 为 -1，直接 `splice(-1,1)` 会误删最后一帧，需守卫返回。
7. **自由视角同步按钮（📌 同步视角，模板已内置）**：`applyAll` 里的 `controls.target.set(...)` 必须包在 `if (driveCamera)` 内——否则每帧都会把用户右键平移的视觉中心拉回关键帧求值，自由视角的"平移"形同虚设（旋转/缩放只改 `camera.position` 不受影响，因为 `driveCamera=false` 时不写 position）。按钮逻辑：读 `camera.position` + `controls.target` 写入 `camX/Y/Z`、`tgtX/Y/Z` 当前播放头时间的关键帧；当 `state.lookAtTarget` 未勾选（用旋转轨道控朝向）时，用 `new THREE.Euler(0,0,0,'YXZ').setFromQuaternion(camera.quaternion)` 取欧拉写 `rotX/Y/Z`——**欧拉序必须与 applyAll 写回时的 `'YXZ'` 一致**，否则旋转会错乱；所有写入值 clamp 到轨道 min/max。按钮在自由视角时高亮（`.on`），反馈复用 `viewBadge` 短暂提示后恢复。
8. **撤销/重做（↩ 撤回 / ↪ 重做，模板已内置）**：核心可变状态是 `state.keys`（每轨道 `{t,v,interp}` 数组），快照式方案 = 每次破坏性修改前 `snapshot()` 深拷贝全轨道表压入 `undoStack`（`redoStack` 在快照时清空）；`undo()` 把当前态压入 redoStack、整体替换 `state.keys` 并重渲染。要点：①**手势合并**——`pointerdown` 时 `beginGesture()`（scrub、菱形拖拽、面板滑杆），`snapshot()` 内做"同手势 + 500ms 内"去重，否则一次数值拖拽会压入几十个撤销节点；②**入口全覆盖**（漏一处就"撤不动"）：`commitValue`、菱形 `k.t = t`、轨道双击插帧、面板/轨道行 ◇ 按钮、kf-editor 的 time/value/interp 三个 change + kf-delete、`btn-key-all`/`btn-del-key`/`btn-clear-all`、键盘 Delete、`syncFreeViewToKeys`、时长修改与导入口播导致的 `k.t` 钳制；③**非破坏操作不记录**：seek、播放、视角切换、缩放、时长本身；④快捷键判定用 **`e.code === 'KeyZ'` / `'KeyY'`（物理键位）而非 `e.key`**——中文输入法激活时 `e.key` 可能不返回 'z'，会导致快捷键静默失效；且判断放在 INPUT/SELECT 早退**之前**（`⌘/Ctrl+Z` 撤销、`⌘/Ctrl+Shift+Z` 与 `Ctrl+Y` 重做），保证编辑器输入框内也能撤回关键帧改动；⑤撤销后若所选帧索引已不存在则清空 `state.selected`、关闭 kf 弹窗、刷新按钮禁用态；⑥空栈时 `flashHint` 提示并直接返回（连按不越界）。

  9. **导出画幅安全框（🔲 画幅框）+ 全局网格开关（📐 网格，模板已内置）**：安全框**必须用 DOM overlay**（`#viewport-wrap` 内绝对定位的虚线框 + 左上角分辨率标签）而不是 3D 线框——相机在场景内画不了"屏幕边缘框"，且 DOM overlay 不进 canvas，导出录制时不会污染画面。比例跟随导出分辨率：`currentExportSize()` 读 `#exp-res`（custom 时读 `#exp-w/#exp-h`），宽/高取 viewport 的 94% 上限等比缩放；`resize()` 里调用 `updateSafeFrame()`。网格开关只是 `grid.visible = !grid.visible` + 按钮 `.on` 类。**位置陷阱**：功能块必须插在 `new ResizeObserver(resize).observe(viewport);` 之后、`resize()` 首次显式调用**之前**，否则 `const safeFrame` 引用存在 TDZ 报错。

  10. **导出格式：MP4(H.264)/WebM(VP9) 用浏览器原生 MediaRecorder，Whammy 已退役**：Whammy（纯 JS WebM 编码器）生成的 WebM **缺时长元数据 + VP8 编码**，QuickTime/Safari/多数播放器无法预览——用户反馈"导出 webm 无法预览"的根源。正确方案：`canvas.captureStream(fps)` + `MediaRecorder` 实时录制，`MediaRecorder.isTypeSupported()` 依次探测 `video/mp4;codecs=avc1.42E01E` → `video/mp4` → `video/webm;codecs=vp9` → `vp8`（Firefox 无 MP4 录制，需回退 WebM 并禁用 MP4 选项）。要点：①**rAF 按真实流逝时间推进动画**（`el = (performance.now()-t0)/1000`，`el >= state.duration` 时 `rec.stop()`），保证视频总时长 = 动画时长；②**用户明确选 WebM 时 `wantWebm` 参数强制只在 WebM 容器内选 MIME**，否则优先 MP4 会"选了 WebM 却录出 MP4"；③混音导出同样走 `pickVideoMime(true, wantWebm)`（MP4 优先 + 音频轨）；④导出期间临时 `renderer.setSize(w,h,false)` 改画布尺寸、完成后恢复；⑤验证：下载文件魔数校验——MP4 头第 5-8 字节为 `ftyp`、WebM 头为 EBML `1a45dfa3`，有 ffprobe 时用 `ffprobe -show_entries stream=codec_name,width,height` 确认 h264；⑥实时录制掉帧风险在慢机器/无 GPU 环境存在，PNG 序列仍是逐帧精确的保底方案。

## 八、路线 B（注入式工作台）要点

- **frame-buster 重定向**：原站常有 `window.location.replace(...)` 防 iframe，直接加载会被跳走，删除首行。
- **硬编码视角改变量**：`m4persp(48*DEG,...)` → `m4persp(cam.fov,...)`；摄像机参数归入一个 `cam` 对象供工作台写入。
- **三段式注入**：CSS + HTML（`<div id="wb">`）+ JS（IIFE，独立 `wb` 状态对象）追加到原文件末尾；`applyAll(t)` 把 `evalTrack` 结果写回原站状态（如 `S['depth']=v`）并触发原站 `rebuild()/applyScene()`。
- **WebGL2 + swiftshader**：`EXT_color_buffer_float` / `EXT_float_blend` 在无头 swiftshader 下可跑（实测可行），截图/录屏验证没问题。
- 原站滑杆保留即可：播放时 `applyAll` 覆盖，两者互不干扰。

## 九、工程管理（自动保存 + 导入导出，模板已内置）要点

1. **序列化范围**：`{app, version, savedAt, duration, time, loop, px, view, lookAtTarget, gridVisible, frameVisible, keys, audio?}`。`keys` 直接引用 `state.keys`（JSON.stringify 自动深拷贝）；音频只存**峰值元数据**（name/duration/peaks 数组），**不存音频本体**——工程文件保持轻量，恢复后波形可显示（`metaOnly` 标志），但播放/混音需重新导入音频文件。
2. **自动保存入口**：`scheduleAutosave()` 防抖 600ms 写 localStorage。**必须挂在所有修改入口**：`snapshot()`（覆盖全部关键帧编辑）、`seek()`（播放头位置）、`setView()`、lookAt 勾选、loop、缩放、时长、网格/画幅框开关、音频导入/移除。`beforeunload` 兜底立即保存一次。**不要在 `applyAll`/主循环里保存**（每帧调用会疯狂写盘）。
3. **恢复时机是硬约束**：`tryRestoreAutosave()` 必须在 `buildTimeline()` **之前**执行（时间轴按恢复后的 `state.keys`/`duration` 构建），同时必须在 `safeFrame`/`grid` 等 DOM 引用定义**之后**（`applyProjectData` 会操作它们）。模板里放在 `updateSafeFrame()` 调用之后、splitter 块之前正好满足。
4. **`sanitizeProject` 容错**：校验 `app` 标识 + `keys` 结构（非本工作台文件直接抛错）；每条关键帧校验 `t/v` 有限性、clamp 到轨道 min/max、整数轨道取整、非法插值回退（seg 轨道→`step`，其余→`smooth`）、按 t 排序；`duration/time/px` 全部 clamp。导入后清空撤销栈（旧栈指向已失效的状态）。
5. **`newProject` 默认值不要硬编码**：用 `parseFloat(document.getElementById('inp-duration').defaultValue)` 读取 HTML 初始值——模板（12s）与具体项目（14s）默认时长不同，硬编码会让"新建"重置错时长。
6. **拖拽导入**：window 级 `dragover` 阻止默认 + `drop` 里按 `.json` 后缀过滤后走同一 `importProjectFile` 入口。
7. **验证脚本纯 DOM 断言**（模块作用域变量 `state` 在 page.evaluate 里不可见）：时长读 `#inp-duration.value`、视角读 `#btn-view` 文本、网格读 `#btn-grid` 的 `.on` class、播放头读 `#time-display`、关键帧读 `.diamond` 的 `left`（= t×px）与 `title`（含 `= 值`）。localStorage 可跨 reload 保留（同一 context），改状态 → 等 900ms → `page.reload()` → 断言恢复。

## 十、导出帧率陷阱：MediaRecorder 帧率不受控 → WebCodecs 精确编码（模板已内置）

1. **根因**：`canvas.captureStream(fps)` + `MediaRecorder` 的输出帧率由**浏览器编码器**决定，API 无法指定输出帧率。实测设置 60fps 导出，Chrome 实际输出只有 **~23.98fps**（用户反馈"导出 60 帧结果帧率只有 23"）。MediaRecorder 只能保证"时长正确 + 内容完整"，帧率规格不可信。
2. **正确方案（无声导出）**：**WebCodecs `VideoEncoder` 逐帧精确编码**——`frames = duration×fps` 逐帧 `applyAll(t,true)` + `renderer.render()` → `new VideoFrame(canvas, {timestamp: i×1e6/fps, duration: 1e6/fps})` → `encoder.encode(frame, {keyFrame})` → muxer 封装。
   - **muxer 库**：`mp4-muxer@5.2.2`（全局 `Mp4Muxer`）与 `webm-muxer@5.0.3`（全局 `WebMMuxer`）从 jsdelivr 动态注入 `<script>`，两者 UMD 都暴露 `Muxer` 类 + `ArrayBufferTarget`（不是 `WebMuxer`/`Mp4Muxer` 类名，注意核对）。**不要**把库内联进 app.js（体积翻倍且无必要）。
   - **codec 探测降级链**：`VideoEncoder.isConfigSupported` 依次试 H.264 `avc1.64002a→640028→42002a→42001f`、VP9 `vp09.00.41.08→vp09.00.10.08`；mp4-muxer 的 `video.codec` 传 `'avc'`、webm-muxer 传 `'V_VP9'`。
   - **muxer 配置**：`firstTimestampBehavior: 'offset'`（首帧时间戳从 0 偏移，否则报错）；MP4 加 `fastStart: 'in-memory'`（moov 前置，便于播放器预览）。
   - **背压**：`while (enc.encodeQueueSize > 8) await new Promise(r=>setTimeout(r,0))`——编码是异步队列，4K 长动画不背压会内存暴涨。
   - **VideoFrame 必须 `close()`**（每帧编码后立即释放）。
3. **回退**：浏览器无 `VideoEncoder`/`VideoFrame`（Firefox、Safari<16.4）或 muxer 库加载失败 → 回退 MediaRecorder，状态栏提示"实际帧率由浏览器决定（通常 24/30fps）"。**带混音导出保持 MediaRecorder**（音画实时同步优先，帧率同样不受控，状态栏已注明）。
4. **UI 提示**：导出面板加一行说明"MP4/WebM 无声导出采用 WebCodecs 精确编码，帧率严格等于所选值；混入口播时为实时录制，帧率由浏览器决定"。
5. **验证（关键）**：ffprobe 实测 `avg_frame_rate`——60fps 导出必须为 `60/1`、帧数 = duration×60。**不要用浏览器内 `getVideoPlaybackQuality().totalVideoFrames` 实测帧率**：无头环境下会误报（实测读出 19），且 UI 会误导用户。WebCodecs 路径帧率是确定性的，状态栏直接写"@ 60fps 精确编码"即可。下载文件魔数校验仍有效（MP4 `ftyp`、WebM EBML `1a45dfa3`）。

## 十一、关键帧框选（marquee 多选 + 整组拖动 + 批量删除，模板已内置）要点

1. **多选状态**：新增 `state.sel: Set`（存 `"trackId:index"` 字符串），`state.selected` 由它**派生**（`syncSelected()`：仅 `size===1` 时设置 `state.selected={track,index}`）——保持与编辑器、键盘等旧代码兼容，避免大面积重构。高亮渲染一律读 `state.sel.has(tr.id+':'+i)`，不再直接读 `state.selected`。
2. **手势判定**：轨道区空白 `pointerdown` 记录起点 `{x0,y0}`（同时 `laneSeek` 保留 scrub 行为），`pointermove` 位移 >5px 才进入框选模式（防止误触）；`pointerup` 用 `getBoundingClientRect` 求矩形内所有 `.diamond` **中心点**命中（不是元素边界相交——半遮挡帧不该被选）。`#marquee` 为 `position:absolute; z-index:40; pointer-events:none` 的半透明矩形，结束时隐藏。
3. **名字列排除**：框选起点落在 `.tl-name`（196px 名字列）内时用 `e.target.closest('.tl-name')` 提前 return——否则点名字列会误触发框选/或框选 0 帧。验证脚本起点必须用 `NAMES_W + 2`（不能用 `NAMES_W - 5`，会落进名字列）。
4. **Shift 追加**：`e.shiftKey` 时框选**不清空**现有选择（union 合并），否则先 `clearSelection()`。
5. **整组拖动**：`drag.group` 保存所有选中帧的 `{id, i, k(对象引用), initT}`；move 时按主帧 delta `k.t = clamp(initT + delta, 0, duration)` 同步移动**对象引用**（不是 index——排序变化后 index 失效）；`pointerup` 后按对象引用**重建 `state.sel`**（各帧新 index 重新入 Set），一次 `snapshot()` 整体可撤回。
6. **批量删除**：`deleteSelection()` 按 trackId 分组、每组索引**降序** `splice`（升序会错位），一次 `snapshot()`；`btn-del-key`/键盘 Delete/Backspace 都走它。`removeKey` 内同步 `state.sel.delete(id+':'+index)`。
7. **撤销兼容**：`afterKeysChanged()` 改为调 `rebuildSelection()`——剔除已失效的 `"trackId:index"`（index 越界或超时长），防止撤销后 `state.sel` 指向幽灵帧；`openKfEditor`/`kf-time` change 改用 `clearSelection()` + `selKey()` 单选语义。Esc 取消选择（`clearSelection()` + `renderDiamonds()`）。
8. **DOM-only 验证模式**（模块作用域 `state` 对 `page.evaluate` 不可见）：断言 `.diamond.selected` 数量、`style.left`（= t×px，整组右移 Δ=60px）、`title` 含 `= 值`；批量删除后数量 = 原数−选中数；⌘Z 后全部恢复。Shift 追加测试的框选区域必须够大（2px 窄条会 miss 帧中心），改用轨道 2~4s 区域必然命中。

## 十二、关键帧复制/剪切/粘贴（⌘C/⌘X/⌘V，模板已内置）要点

1. **剪贴板结构**：模块级 `let kfClipboard = null`，存 `[{id, t, v, interp}]`（**深拷贝值**，不存 index——粘贴时 index 必然失效）。复制来源直接遍历 `state.sel`，天然支持框选批量。
2. **粘贴锚点算法**：`anchorT = min(剪贴板各帧 t)`，新位置 `t = clamp(播放头 + (item.t − anchorT), 0, duration)`——**保持各帧相对最早帧的时间偏移**，整组形状不变形。播放头本身 clamp 到 [0, duration]。
3. **upsert 语义**：粘贴用现成的 `upsertKey(id, t, v, interp)`——同位置已有帧则**覆盖其值不新增**（同一播放头连按 ⌘V 不会堆积重复帧）。这是特性不是缺陷；想再贴一份先拖走播放头。验证脚本必须注意：**连续两次粘贴在同一播放头，第二次数量不变**，测试预期别写成 +N。
4. **粘贴后自动选中新帧**：对每个粘贴项 `idx = keyIndexAt(id, t)`，`state.sel.add(selKey(id, idx))`——用户粘贴后可立即整组拖动微调位置，体验与"粘贴即选中"一致。多个帧 clamp 到 duration 时 index 可能重复，Set 自动去重无碍。
5. **一次快照**：`pasteSelection()` 开头 `snapshot()` 一次（整组粘贴 = 一步撤销）；`cutSelection() = copySelection() + deleteSelection()`（删除内部自带快照）。
6. **键盘绑定位置**：⌘C/⌘X/⌘V 必须放在 `INPUT/SELECT` focus 守卫**之后**——焦点在输入框时应复制文本而不是关键帧；而 ⌘Z/⌘Y 在守卫之前（输入框内也允许撤销）。模板 keydown 用 `e.key.toLowerCase()` 匹配（`k === 'c'/'x'/'v'`），工作台用 `e.code === 'KeyC'` 等，两种写法等价。
7. **UI**：工具栏加「📋 粘贴关键帧」按钮（调 `pasteSelection()`，鼠标党友好）+ 「⧉ 复制粘贴」hint 标签（tooltip 写清三个快捷键与"粘贴到播放头"语义）；顶栏 hint 长文案同步加 `⌘C/⌘X/⌘V` 说明。空剪贴板/无选择时 flashHint 引导而非静默失败。
8. **值域天然安全**：剪贴板里 `v` 来自同轨道（min/max 不变），duration 变化只影响 t（已 clamp），无需再校验 v。

## 十三、帧吸附 + Alt 滚轮缩放时间轴（模板已内置）要点

1. **snapToFrame 单点收口**：`snapToFrame(t) = Math.round(t * PREVIEW_FPS) / PREVIEW_FPS`。只在一个辅助函数里做量化，所有入口统一调用：`seek()`（播放头/标尺/轨道/波形跳转全部经过它）、菱形拖动（主帧 t + 整组每帧 `g.k.t` 各自 snap）、双击轨道加帧、kf 编辑器改时间、`pasteSelection()`。**播放循环不受影响**——`loop()` 里播放推进直接改 `state.time` 不走 `seek()`，实况导出 `tick()` 同理。
2. **吸附后 clamp 顺序**：`Math.min(duration, Math.max(0, snapToFrame(t)))`——先 snap 后 clamp，duration 本身不吸到帧边界（保留任意时长如 12.5s，帧号允许非整时间起点）。
3. **Alt+滚轮锚点缩放**：`tlBody.addEventListener('wheel', e => { if (!e.altKey) return; e.preventDefault(); ... }, { passive: false })`。锚点算法：`tAt = (scrollLeft + clientX − bodyRect.left − NAMES_W) / px` → 改 px（×1.15 或 ÷1.15，round 到 5 与滑杆步长一致，clamp 30–500）→ `renderTimeline()` 后 `scrollLeft = max(0, NAMES_W + tAt × newPx − bodyX)`。**必须先 render 再设 scrollLeft**（scrollWidth 变了钳制才正确）。
4. **锚点两边界钳制**：scrollLeft ∈ [0, maxScroll]。缩得太小/鼠标太靠左时锚点无法保持（内容起点被拉回视口左缘）——标准行为，不要为保锚点硬造负 scroll。验证脚本先 `scrollLeft = 250` 腾出余量再测。
5. **方向键必须 preventDefault**：`ArrowLeft/Right` 不 `preventDefault()` 时浏览器默认行为会横向滚动 `#tl-body`（一次 40px）——粘性名字列（`position:sticky; left:0`，196px）随即盖住首列菱形，之后的点击/拖动全打到名字列上（`closest('.tl-name')` 拦截）。这是隐蔽 bug：逐帧几次后框选/拖动悄悄失灵。Space 键同理已 preventDefault。
6. **验证容差**：`style.left` 经 CSSOM 序列化会**舍入到 ~0.001px**（"332.167px"），反推 t×30 会有 ~1e-4 帧误差——帧对齐断言容差取 **0.01 帧**（既容纳序列化舍入，又能抓出真实错位）。别用 1e-6。
7. **验证锚点**：缩放前后各算一次 `(scrollLeft + 鼠标x − bodyLeft − NAMES_W) / px`，差 < 0.05s。Playwright 触发 Alt+滚轮：`keyboard.down('Alt')` → `mouse.wheel(0, ±240)` → `keyboard.up('Alt')`；普通滚轮（无 Alt）不应改变 px。
8. **缩放状态持久化**：`state.px` 已在工程自动保存字段里（`scheduleAutosave()`），Alt 滚轮后记得同步 `inp-zoom` 滑杆值，否则 UI 与实际缩放脱节。

## 十四、批量插值 + 粘贴默认线性 + 帮助看板（模板已内置）要点

1. **批量插值 `setSelectionInterp(interp)`**：遍历 `state.sel`（天然支持框选多选），逐帧改 `k.interp`，一次 `snapshot()` 整体撤回，`renderTimeline()` 后选择高亮保留（renderDiamonds 读 `state.sel`）。入口校验 `['smooth','linear','step'].includes`；`state.sel` 为空时 flashHint 提示"先选中关键帧"。
2. **工具栏下拉 `#sel-interp`**：占位项 `<option value="">∿ 批量插值…</option>`，change 事件取值执行后**立即 `e.target.value = ''` 复位**——否则第二次选同一类型不触发 change。注意该元素是 SELECT：keydown 的 INPUT/SELECT 守卫会拦截它聚焦时的快捷键，帮助看板的 Esc 关闭要放在守卫**之前**。
3. **粘贴默认线性**：`upsertKey(item.id, t, item.v, 'linear')`——不继承源帧 interp。动机：粘贴通常用于"把某时刻的参数值复制到另一时刻"，平滑（Catmull-Rom）会让粘贴帧与邻帧之间产生过冲弯曲；线性 = 直线过渡，同值帧之间数值完全不变。用户要"保持不动"可再框选 → 批量插值 → 阶梯。
4. **帮助看板**：`#help-overlay`（`position:fixed; inset:0; z-index:200` 遮罩 + 居中卡片，`display:none/flex` 切换）。三处关闭：✕ 按钮、`e.target === helpOverlay` 的遮罩点击（卡片内点击不冒泡关闭）、Esc（keydown 顶部判断 `helpOverlay.style.display === 'flex'`，**放在 INPUT/SELECT 守卫之前**——焦点在下拉框时 Esc 也能关）。卡片内容用 `.hsec` 分区网格（`repeat(auto-fit, minmax(270px,1fr))`）+ `user-select:text`（页面全局 no-select，帮助文字要能选中复制）。
5. **验证插值断言（DOM-only）**：菱形 `title` 末尾格式 `（${interp}）`，用正则 `title.match(/（(\w+)）$/)` 提取；改插值后比对所有 `.diamond.selected` 的提取值。撤销恢复时先 `waitForTimeout(600)` 越过快照手势合并窗口（snapshot 对 500ms 内同一 gesture 的连续变更会合并）。
6. **验证粘贴默认线性**：找源帧用 `/（smooth）$/.test(title)` 定位 → 单击选中 → ⌘C → 点标尺移动播放头到**无帧间隙**（取相邻帧中心点中点，避免 upsert 覆盖既有帧导致数量不变）→ ⌘V → 断言 `.diamond.selected` 的 title 为 `（linear）` 且总数 +1。

## 十五、自定义背景色（模板已内置）要点

1. **实现**：`setBackgroundColor(colorStr)` 直接 `scene.background = new THREE.Color(colorStr)`（工作台 renderer 建在 `alpha:true`，但 scene.background 有值时完全不透明；背景色**不经 ACES tone mapping**，是渲染器的 clearColor 直出，色值贴近原色）。模板带 `scene.fog`（`Fog(默认色, 40, 90)`）——背景改纯色时必须同步 `scene.fog.color`，否则纯白背景下远处物体被近黑雾罩住发暗。
2. **UI**：顶栏「🎨 背景」`<select id="sel-bg">`（占位项 + 预设：默认/纯黑/纯白/纯绿抠像）+ `<input type="color" id="bg-color">` 自定义。两个联动技巧：下拉 change 后**立即复位 `value=''`**（复用批量插值下拉的教训）；自定义色板走 `input` 事件（拖色板连续触发）**不加 flashHint**，预设下拉才 flashHint 提示名称。
3. **预设值语义**：工作台默认背景 `#0b1526`（深空蓝）、模板默认 `#05070d`（近黑）——`BG_PRESETS` 与 `sanitizeProject` 的兜底默认值、`newProject` 复位值必须跟各自默认一致，别写死成对方的。`select` 值同步：预设色时显示对应 option，自定义色时复位占位项。
4. **工程持久化**：`serializeProject` 写 `bgColor: '#' + scene.background.getHexString()`；`sanitizeProject` 用 `/^#[0-9a-f]{6}$/i.test` 校验（非法回退默认）；`applyProjectData` 调 `setBackgroundColor(p.bgColor)`（随自动保存/刷新/打开工程恢复）；`newProject` 复位默认。网格按钮、背景色互不耦合——纯色抠像时用户自己关网格。
5. **验证（像素采样）**：WebGL canvas 不能直接 `getContext('2d')`，用临时 2d canvas `drawImage` 拷贝后再 `getImageData` 取像素（`preserveDrawingBuffer:true` 保证 toDataURL/drawImage 可用）。采样点取 **canvas 左上角 (8,8)**——场景内容（液柱/网格/扫描面）在画面中部，角落必是纯背景。验证断言：默认 `[11,21,38]`、纯黑 `[0,0,0]`（容差 ±60）、纯白 `[255,255,255]`（±60）、纯绿 `#00b140 → [0,177,64]`（±55）、自定义红 `[255,0,0]`（±55）。切换后 `waitForTimeout(500)` 等渲染。注意 `file://` 协议下 ES module 被 CORS 拦截 app.js 根本不加载——**必须起本地 http server 验证**（`python3 -m http.server <port>`），之前多轮验证都吃过这个亏。
6. **范围**：背景色是全局设置（非关键帧轨道），随工程保存；预览与导出（WebCodecs 逐帧/MediaRecorder）共用同一 renderer，背景自动进入导出画面，绿幕抠像零额外配置。

## 十六、参数范围手柄（滑杆常用范围 + lo/hi 安全边界，模板已内置）要点

1. **双范围模型**：每个轨道 `min~max` = 滑杆手柄的常用调节范围；`lo~hi` = 数值框 / scrub 拖拽 / 关键帧编辑器 / 工程加载可继续增减的**安全边界**。缺省 `lo/hi` 时回退 `min/max`（不扩展）；seg 枚举轨道（按钮组）不设 lo/hi，天然不可超界（也无 number 输入框）。
2. **五处 clamp 统一放开**：`commitValue`（数值框/滑杆）、`makeScrub`（scrub 拖拽）、`clampTrack`（同步视角）、`sanitizeProject`（工程加载关键帧值）、kf-editor 的 kf-value。全部写成 `Math.min(tr.hi ?? tr.max, Math.max(tr.lo ?? tr.min, val))`——**用 `??` 回退而不是展开写死**，缺省轨道行为不变。滑杆 input 事件不受影响（range 值天然在 min/max 内）。
3. **滑杆超界显示**：`syncPanel` 里 range 值同步时手动贴边 `Math.min(tr.max, Math.max(tr.min, val))`（浏览器本就 clamp，但显式写清楚），另加 `classList.toggle('overflow', val < tr.min || val > tr.max)` + CSS `.prow input[type=range].overflow{accent-color:#ff7b6b; box-shadow:...}`——超界时滑杆贴边并变红，提示"数值已超出手柄范围，可从数值框继续增减"。
4. **安全边界必须按轨道语义显式设定，不能盲目算术扩展**：
   - 物理参数：工作台流量 `flowMlS` 的 `lo` 必须 >0（v0=Q/area0，负 Q → 负流速 → zAtPhase 算出负 jetLength → 物理全崩）；`frontProgress`（0~1）语义完整，lo/hi 就设 0/1。
   - shader 数组上限：模板 `lightCount` 的 `hi` 必须 = `MAX_LIGHTS`（GLSL uniform 数组越界读返回 0 不崩但画面错乱），注释写明。
   - 角度类：rotX/rotY/rotZ/grooveAngle 给 ±540°（多圈），fov 给 5~150（超大广角 OK），距离类给 3 倍左右余量。
   - 数值框 min/max 属性也换成 lo/hi（`<input type="number" min="${tr.lo ?? tr.min}" max="${tr.hi ?? tr.max}">`），原生 spinner 箭头可走到安全边界。
5. **验证（Playwright DOM-only）**：数值框输入超 max（如 camX=1000>400）→ `num.value` 保留、`range.value` 贴边 400、range 有 overflow class、时间线 tval 同步；输入超 hi（5000>1200）→ clamp 到 1200；scrub 拖拽（dispatch pointerdown/pointermove/pointerup）→ 值可超 max 继续增；物理极值（width=10/aspect=24/flow=80）→ canvas 重绘 `litPx` 正常、无 pageerror；seg 轨道断言无 number 输入框；localStorage 保存后刷新，超范围关键帧值与 overflow 状态保持。**注意**：物理超范围值必须实测渲染不崩，别只信数值逻辑。

## 十七、配色面板（线条颜色 + 平面颜色/透明度，模板已内置）要点

1. **双层分组**：`colors = { lines: { cage/section/front/grid }, planes: { jet/sectionFill/sectionHalo/frontFill/scan } }`，每项 `{color, opacity}`。`COLOR_DEFAULTS` 覆盖默认配色；持久化用 `sanitizeColors` 校验 hex6 + opacity[0,1]。
2. **jet 内材质暴露**：液柱/扫描相关材质全在 jet IIFE 内，jet 暴露 `applyJetColors()` 方法处理 jetMat/solidMat/wireMat/cageMat/sectionMesh/sectionHalo/sectionLine/frontFill/frontLine/scanBoxMat/scanPlaneMat；模块级 `applyColors()` 调 `jet.applyJetColors()` + 遍历 `grid.material` 数组（GridHelper 有两个 LineBasicMaterial）。**关键**：jet 内有局部 `const colors`（热力图 Float32Array 顶点色），必须重命名为 `heatColors` 否则遮蔽模块级 colors → `colors.planes.jet.color` 拿到 Float32Array 报错。
3. **重建初始化**：updateScan/updateFront 每次重建 sectionMesh/sectionHalo/sectionLine/frontFill/frontLine 材质时，**必须**用 `new THREE.Color(colors.planes.xxx.color).getHex()` 初始化（不仅是 modify）——否则重建后配色丢失。rebuild 重建 jetMesh/solidMat/cageMat 同理（`!jetMesh`/`m === 1 && !solidMat` 等一次性创建路径）。
4. **透明度叠加系数**：液柱玻璃 jetMat 的 `opacity = colors.planes.jet.opacity * (dim ? 0.304 : 1)`（默认 0.92，dim 时降为 0.28 ≈ 0.92×0.304）；cageMat `opacity = colors.lines.cage.opacity * (dim ? 0.333 : (mode === 0 ? 1 : 1.667))`（默认 0.45，玻璃 1×0.45=0.45 / 实心 1.667×0.45=0.75 / dim 0.333×0.45=0.15）；setMode 与 applyDim 都调此公式，**避免**分散修改 cageMat.opacity。solidMat/wireMat 不受 colors 透明度影响（默认固定 dim?0.3:1）——若要支持需额外映射。
5. **GridHelper 材质**：构造 `new GridHelper(size, div, color1, color2)` 创建**两个** LineBasicMaterial（主线/次色）；`grid.material` 是数组需遍历。透明度统一应用（损失原主/次色层次——可接受）。
6. **验证（Playwright swiftshader 局限）**：transmission/glass 材质（液柱/cage）在 swiftshader headless 下渲染异常（截图为空背景），回滚到 3acdb77 clean 也复现此问题——**与本功能无关，是 swiftshader + glass 材质渲染限制**。**可靠断言**：网格 LineBasicMaterial 可渲染，改色后底部区域逐像素扫描（宽松判定如 `g>r+15 && g>b+15` 验证绿色，因 ACES tone mapping 后 #00ff00 渲染像素 r 也会被压低）；液柱改色仅断言状态（localStorage colors 字段正确 + 刷新恢复 + 无 JS 错误）。

## 十八、透明 PNG 序列 + MOV 导出 + 移除 WebM（模板已内置）要点

1. **透明 PNG**：renderer 建在 `alpha:true`（`WebGLRenderer({alpha:true, preserveDrawingBuffer:true})`）→ 支持透明背景。导出期间 `scene.background = null` + `renderer.setClearAlpha(0)`，PNG 输出 RGBA（color type 6）带 alpha；`finally` 恢复 `scene.background = savedBg` + `renderer.setClearAlpha(savedClearAlpha)`。**不要只设 clearAlpha**——scene.background 有值时 clearAlpha 被忽略。
2. **MOV**：mp4-muxer 生成 ISO BMFF（H.264），QuickTime/主流播放器可打开。实现 = 同一 WebCodecs 管线 + `isMov` 参数：文件扩展名 `.mov` + blob type `video/quicktime`。`frameAccurateExport/recordingExport/exportLiveVoice` 都加 `isMov=false` 参数透传 ext。**诚实文案**：UI 标"MOV（H.264，兼容容器）"，不做 ProRes/Animation 编码（Web 端无此 muxer）。
3. **移除 WebM**：UI `exp-format` 删 `webm` 选项；`btn-export` 兜底 `if (!MP4_OK && value==='mp4') value='mov'`；`exp-start` 分支改 `mp4||mov`；内部 `wantWebm`/pickVideoMime/loadMuxerLib(MUXER_CDN.webm)/webm-muxer 代码保留为不可达兜底（不删以免动面大，但 UI 不再暴露）。
4. **面板联动**：`exp-format` change → `exp-mix-row`（mp4/mov + 有音频时显示）、`exp-alpha-row`（仅 png 显示）；`btn-export` 打开时同样同步。
5. **验证（Playwright + 下载文件解析）**：`page.waitForEvent('download')` + `saveAs` 捕获导出文件。PNG 透明验证：python `zipfile` 解 ZIP → 手工解析 PNG（IHDR color type 6=RGBA → zlib 解 IDAT → **逐行 unfilter**（filter byte + Paeth 等 5 种滤波）→ 读像素）——断言四角 alpha=0 且 t=1s 帧中心（液柱）alpha>200；**注意** t=0 帧液柱未生长（frontProgress=0），中心也是透明，取中间帧断言。MOV 验证：文件名 `.mov` + 前 8 字节 `000000xx ftyp`（ISO BMFF）。Playwright `selectOption` 要求元素可见（export-modal 需先打开）。
## 十九、自定义导出文件名（口播名 > 模拟器+日期）要点

1. **命名优先级**：`exportBaseName()` = `exp-name` 输入框（trim + sanitizeName 清理 `\ / : * ? " < > |`）→ 为空时 `defaultExportBase()`：有口播（`audioState.ready && audioState.name`）用音频文件名去扩展名（`audioState.name.replace(/\.[^.]+$/, '')`），否则 `SIM_NAME + '_' + todayStr()`（YYYY-MM-DD 本地时区）。
2. **填充时机**：`btn-export` 打开面板时若输入框为空才填默认（`if (!nameInput.value.trim()) nameInput.value = defaultExportBase();`）——用户自定义后重开面板保留，清空则回默认。
3. **文件名结构**：导出文件名 = `${exportBaseName()}_${w}x${h}_${fps}fps.${ext}`（保留分辨率/fps 后缀便于区分多版本导出）；混音导出 = `${base}_voice_...`；PNG 序列 = `${base}_..._序列帧[_透明].zip`。工程 json 下载名独立（axis-switching_工程_时间戳）。
4. **验证（Playwright）**：无口播打开面板 → `#exp-name` value 匹配 `^axis_switching_\d{4}-\d{2}-\d{2}$`；填自定义名导出 MOV → download.suggestedFilename() 以自定义名开头；自定义名重开面板保留。口播分支逻辑简单（audioState.name 去扩展名），importAudio 时 name: file.name。

## 二十、配色重置 + 撤回 + 实时参考色块要点

1. **配色纳入撤销栈**：`snapshot()` 的快照从 `cloneKeys()` 升级为 `{ keys: cloneKeys(), colors: cloneColors() }`（cloneColors = `JSON.parse(JSON.stringify(colors))`，colors 很小无性能问题）；`undo()/redo()` 恢复 `state.keys` + `Object.assign(colors, snap.colors)` + `applyColors()` + `syncColorPanel()`。**注意**：关键帧操作（commitValue/upsert 等）也走 snapshot，会顺带快照 colors（冗余但无害）。
2. **重置配色**：`resetColors()` = `snapshot()`（进入撤销栈，重置可撤回）→ `Object.assign(colors, JSON.parse(JSON.stringify(COLOR_DEFAULTS)))` → `applyColors()` → `syncColorPanel()` → `scheduleAutosave()` → flashHint 提示可撤回。
3. **实时参考色块**：每行 `output` 后加 `<span class="swatch"><i></i></span>`；CSS 棋盘格（`conic-gradient` 8px 方格）模拟透明底 + `i` 覆盖 `hexToRgba(color, opacity)`（`rgba(r,g,b,a)`）；`updateSwatch(el)` 在配色 input/change 事件与 `syncColorPanel()` 打开时调用。**不要用 `<input type=color>` 自带的色块当透明度参考**（无透明信息）。
4. **手势合并**：配色拖动（range input 连续事件）复用 snapshot 的 500ms 合并窗口，一次拖动 = 一步撤销（无需 beginGesture）。
5. **验证（Playwright）**：swatch `style.background` 含 `rgba(255, 0, 255, 0.5)`；改网格色后 ⌘Z → 面板 value 回 `#1d2f52` 且 swatch 回 `rgba(29, 47, 82, 0.8)`；重置后全部默认；重置后 ⌘Z 回品红。快捷键 `process.platform==='darwin' ? 'Meta+z' : 'Control+z'`。

## 二十一、配色面板：当前时间线画面预览要点

1. **复用主 canvas（不建第二个 WebGL context）**：`colorPreviewCanvas` 是面板里的 2D canvas（480×270）；`syncColorPreview()` 用 `colorPreviewCtx.drawImage(renderer.domElement, ...)` 复制当前帧。**前提**：`WebGLRenderer({ preserveDrawingBuffer: true })`（已为 PNG 导出开启）—— 否则 WebGL buffer 在合成后清空，drawImage 读到空帧。
2. **contain 等比缩放**：`scale = min(pw/cw, ph/ch)`；dw=cw*scale, dh=ch*scale；drawImage(..., (pw-dw)/2, (ph-dh)/2, dw, dh) 居中。
3. **150ms 定时**：`setInterval(syncColorPreview, 150)`，面板打开启动（`toggleColors(true)`）、关闭停止（`clearInterval`），避免后台空转。打开时**立即**调一次 `syncColorPreview()`（避免等 150ms 才出图）。
4. **棋盘格背景**：CSS `conic-gradient` 8~10px 方格 + 预览 canvas 透明——改液柱/截面透明度时直接看到透明效果。
5. **swiftshader 局限**（已存在非本次引入）：headless swiftshader 下改网格颜色/透明度后**主 canvas 渲染异常**（v2.3 已存在现象，verify_color_reset 6/6 PASS 未覆盖主画面像素）；预览功能本身（drawImage 复制 + setInterval）正常工作——state_panel.png 清晰显示预览有画面+9 色块。**真实浏览器（GPU 加速）下无此问题**。

## 二十二、孔板（水流开始平台）显示开关要点

1. **实现**：模块级 `let plateVisible = true`（随工程持久化）+ 顶栏 `btn-plate` 按钮（仿 btn-grid/btn-frame 模式）；`jet` 暴露 `get plateGroup()`；`buildPlate()` 创建时 `plateGroup.visible = plateVisible`（**重建后不丢状态**）；serialize `plateVisible` / sanitize `!== false` / applyProjectData / newProject 全链路。
2. **⚠️ TDZ 坑（本次踩到）**：`let plateVisible` 声明在文件中部（按钮绑定处）会导致 jet IIFE 内 `buildPlate`（文件前部、页面加载时先于声明执行）访问时抛 `ReferenceError: Cannot access 'plateVisible' before initialization`——**并且异常发生在 jet.rebuild（初始化早期），会中断整个初始化链**（后续所有 addEventListener 都不执行，按钮无响应、loop 不启动，页面"看起来正常"但功能全废）。**模块级 let 变量若被前部代码（jet IIFE/buildPlate 等）引用，声明必须放在文件最顶部（colors 定义附近）**。
3. **验证（Playwright）**：按钮默认 on；click 后 class 移除 on；localStorage `plateVisible:false`；刷新后仍隐藏；再点击恢复。**注意**：`page.evaluate(btn.click())` 与 `page.click` 等价（都触发 listener）；若点击后 class 不变，优先查 pageerror——TDZ 这类初始化中断错误会显示在 pageerror。

## 二十三、关键帧吸附（跨轨道）要点

1. **需求本质**：用户要的是"不同轨道间关键帧相互吸附"——拖动某轨道关键帧时，自动对齐到**其他轨道**相近时间的关键帧（形成同一时间列）。**只跨轨道、不吸同轨道帧**（否则同轨道相邻帧互相粘连，无法微调单帧位置）。
2. **实现**：模块级 `let kfSnapOn = localStorage.getItem('kfSnapOn') !== '0'`（默认开，localStorage 持久化，**不随工程 json 保存**——吸附是编辑偏好，不影响导出/渲染）；工具栏 `btn-kf-snap` 按钮切换（仿 btn-plate 模式但持久化到 localStorage 而非工程）。`snapTargetT(t, skipTracks)`：遍历所有轨道（跳过拖动组所在轨道集合），找 |Δt| ≤ `KF_SNAP_PX/state.px`（12 像素阈值随缩放自适应，缩放越大可吸附的时间范围越小）的最近帧，命中返回 `{t, id, k}`（k 为对象引用）。接入点：仅 `pointermove` 拖动主帧处——`snapTargetT` 先于 delta 计算，整组拖动时主帧吸附、其余帧保持相对偏移同步；**双击加帧 / kf 编辑器改时间 / ⌘V 粘贴不做关键帧吸附**（保留帧吸附即可，精确输入不被干扰）。
3. **⚠️ 吸附反馈的坑**：拖动中 `flashSnap()` 给目标 diamond 加 `snap-flash`（金色 outline），但 `pointerup` 会调 `renderTimeline()` **重建全部 diamond DOM，class 被冲掉**，导致松开瞬间高亮消失（截图/测试捕捉不到）。解法：`snapTargetT` 返回**对象引用 k**（不是索引 i），`flashSnap` 用 `state.keys[id].indexOf(s.k)` 定位新索引；`pointerup` 里 `renderTimeline()` 之后补调一次 `flashSnap(drag.lastSnap)`（drag 上记 lastSnap）。**重绘后按对象引用而非索引找元素**。
4. **验证（Playwright）**：开关默认 on；拖 shape 8.1s 帧到 8.05s 屏幕位置 → 落点吸附为 8.0s（widthMm/aspect 同刻帧），diamond `style.left/px` 精确 8.0；吸附命中时目标轨道 diamond 带 `snap-flash`（up 后 250ms 内检查，400ms 定时内）；点击开关 → 同操作落点 ≈10.4667（仅帧吸附，snapToFrame 30fps）；reload 后开关状态持久化；再开恢复吸附；最后 `localStorage.clear()` + reload 恢复默认。注意 kf 拖动后 index 因排序可能变化——读 diamond 用 `data-index` 时以拖动后为准（shape 8.1→8.0 后原帧仍在 index2，稳定排序）。

## 二十四、Shift 拖动数据条细调（1/10 步进）

1. **需求本质**：参数面板的 range 滑块（"数据条"）默认按 `tr.step` 步进（widthMm 0.05、aspect 0.1 等），用户希望按住 Shift 拖动时进入精细调节模式——步进变为 `tr.step/10`，数值显示精度也对应提高。整数（seg 按钮）轨道天然不适用。
2. **实现**：模块级 `let shiftHeld` + 全局 keydown/keyup/blur 监听（`key==='Shift'`），实时反映 Shift 当前状态——拖动中按/松 Shift 立即切换步进。`applyFineStep(range, tr)`：根据 `shiftHeld && !tr.integer` 决定 `range.step = tr.step/10 || tr.step`，并切换 `.fine` class（CSS 高亮青蓝 box-shadow）。接入点：range 的 `pointerdown` 和每次 `input` 事件都调一次 `applyFineStep`，原生 range 的 step 在拖动中动态改变——浏览器在下一次值更新时用新 step 吸附，行为符合直觉。`pointerup` 时把 step 恢复为 `tr.step`（避免遗留状态影响下次拖动）。**数值显示精度**：`fmtVal(tr, val)`——dec = max(2, step 小数位+1)，保证细调值（如 0.005、0.001）能在数字框和轨道值显示中正确呈现（原来 toFixed(2) 会把 0.005 显示为 0.01）。数字框拖拽 makeScrub 同步改为读全局 `shiftHeld`（去掉原 scrub.shift 一次性快照），实现"拖动中按 shift 立即细调"。
3. **⚠️ 浮点精度坑**：`tr.step/10` 出现浮点尾巴（如 0.01/10 = 0.0010000000000000002），String() 后是长串。Chromium 接收 range.step 字符串后内部解析，el.step 读回仍可正常归一化为期望步进（测试验证 step=0.005、0.001 等都生效）。无需额外处理。
4. **验证（Playwright 11/11 通过）**：默认 step=0.05；Shift+拖动 widthMm → step 变 0.005、fine 高亮、值落在 0.005 网格、数值框显示 3 位（2.440）；松开 Shift → 立即恢复 0.05、值回到 0.05 网格；普通拖动 step 保持 0.05；另一轨道 frontProgress（step=0.01）Shift 后 step 变 0.001（验证 1/10 步进对不同 step 普适）；无 JS 报错。**测试易错点**：先 `locator.scrollIntoViewIfNeeded()`，否则视口外滑块 mouse.move 落空，pointerdown 不触发。

## 二十五、视觉中心拾取 + 取消看向不跳变 + 自由视角自动同步（v2.8）要点

1. **视觉中心拾取**：顶栏 `btn-pick-tgt`（「◎ 视觉中心」）进入拾取模式（模块级 `pickTargetMode`，body 加 `.picking` class 跨光标 + 状态栏提示；Esc 优先退出）。`pickAt(e)`：`Raycaster.setFromCamera(normalizedXY, camera)` + `intersectObjects(scene.children, true)`（递归，命中最前物体），把命中点 `p.x/p.y/p.z` 写入当前播放头时间的 tgtX/Y/Z 关键帧（`upsertKeyAt` 三轨批量），命中后 `setPickMode(false)` 自动退出并 flashHint 提示；拾取期间 `controls.enabled = false`（禁自由视角），`setView()` 里开拾取模式时同步禁用。**拾取的是"视觉中心目标点"（视觉中心关键帧），不是相机对准动作**——镜头保持当前机位，只是把关注点固化到时间线。
2. **取消「始终看向」不跳变**：勾选状态变化时若 `!state.lookAtTarget`：先 `snapshot()`，把**当前相机朝向**（`camera.getWorldDirection()` → Euler YXZ（与相机旋转一致）→ 转度）写入 rotX/rotY/rotZ 关键帧（`rotZ = -degrees(euler.z)`，注意符号一致性），保证"画面内容逐像素不变"（因为 lookAtTarget 模式忽略旋转轨道，直接沿用当前朝向即等价画面）；同时 `refreshFreePivot()` + `controls.target.copy(freePivot)`。**这是 Blender「取消约束瞬间打关键帧」同款思路**。
3. **自由视角旋转中心（freePivot）**：模块级 `let freePivot = new THREE.Vector3(0, -L0/2, 0)`；`refreshFreePivot()`：`dist = max(20, camera.position.distanceTo(controls.target))`，`freePivot = camera.position + camForward() × dist`（相机前方视线点）。**取消看向后 controls.target 不再等于视觉中心**——自由旋转围绕视线方向而不是视觉中心（视觉中心是场景物体位置，取消看向后继续绕它转不符合直觉）。`applyAll()` 摄像机分支：`driveCamera` 时 `state.lookAtTarget ? controls.target.set(tgt...) : controls.target.copy(freePivot)`；`setView('free')` 时若 `!lookAtTarget` 先 `refreshFreePivot()`（切自由视角的瞬间重新取视线点）。
4. **自由视角自动同步**：OrbitControls `start/end` 事件——`end` 时（阻尼稳定后）比较 `controls.target` 与拖动前快照的位移，`>0.05` 判定为"机位动了"：`syncFreeViewToKeys()`（位置 + 旋转欧拉写入关键帧）+ `setView('camera')` 自动切回摄像机视角（状态栏提示「机位已同步到关键帧并切回摄像机视角」）。**同步视角不偏移视觉中心**：`syncFreeViewToKeys()` 在非"看向"模式只写 camX/Y/Z + rotX/Y/Z，**不再写 tgtX/Y/Z**（原实现会把 controls.target 写回 tgt，导致视觉中心被拖走——取消看向后 target 是 freePivot 不是视觉中心，写回即偏移）。
5. **X 键删除**：键盘监听在 Delete/Backspace 之外加 `e.key === 'x' || e.key === 'X'`（`deleteSelection()`）；帮助面板、状态栏、快捷键速查同步更新。
6. **Shift 时间线吸附（v2.8 实现，v2.9 已替换）**：v2.8 用 `snapTargetT()` 开头 `const snap = shiftHeld ? !kfSnapOn : kfSnapOn` 实现"Shift 临时反转吸附开关"（开→临时不吸，关→临时吸）。**v2.9 起废弃该语义**——用户要求"精细操作改为按住 Shift 拖动"，Shift 拖动关键帧改为精细微调（见二十六节），`snapTargetT` 不再读 `shiftHeld`（`const snap = kfSnapOn`）。
7. **验证（Playwright 21/21）**：拾取模式（按钮点击进入 → body 有 picking class → 点击 canvas 命中 → 当前时间 tgtX 关键帧值 ≈ 命中点 x → 自动退出）；X 键删除（选中帧后按 x → 帧消失）；Shift 吸附 4 场景（开+Shift 不吸 / 关+Shift 吸 / 关不吸 / 开吸附）；取消看向不跳变（**逐像素验证**：取消勾选前后 `canvas.toDataURL()` 完全一致——swiftshader headless 下同帧渲染确定性强，注意要在渲染静止帧后采样；同时断言 rotX 关键帧被写入、切自由视角画面不变、自由视角旋转时旋转中心是视线点而非视觉中心——通过旋转后 tgt 关键帧值不变断言）；自由视角自动同步（拖动相机松手 → 自动切回 camera 视角 + camX 关键帧值变化）。**测试易错点**：时间线在视口下方（y>900）需先 `scrollIntoViewIfNeeded()` 否则鼠标事件落空；断言"吸附"用「原位置帧消失」而非「目标帧存在」（目标轨道本就有帧会误报）。

## 二十六、Shift 拖动关键帧 = 精细微调（v2.9）要点

1. **需求本质**：用户要求「精细操作改为按住 Shift 拖动」——把"精细操作"（关键帧拖动改时间）的触发方式统一为 Shift，与 v2.7 数据条 Shift 细调（1/10 步进）同一全局语义（Shift = 精细）。**同时废弃 v2.8 的"Shift 临时反转吸附"**（反转语义不符合用户直觉，用户明确纠正）。Shift 现在在时间线的含义：精细微调（1/10 速度 + 亚帧网格 + 不吸附），吸附开关的 on/off 只管普通拖动。
2. **实现**：
   - `snapFine(t)`：`Math.round(t * PREVIEW_FPS * 10) / (PREVIEW_FPS * 10)` —— 亚帧网格（30fps → 1/300s），与 `snapToFrame`（1/30s）并列。
   - `snapTargetT()`：删除 `shiftHeld` 反转逻辑 → `const snap = kfSnapOn;`（Shift 精细模式根本不调用它，双重保险）。
   - `pointerdown`：drag 对象加 `startX: e.clientX`（拖动起点屏幕 X，精细模式的位移基准）。
   - `pointermove`：`shiftHeld` 时走精细分支——主帧 `t = snapFine(main.initT + (e.clientX - drag.startX) / (state.px * 10))`（**1/10 拖动速度**：位移÷10，鼠标移动 10px 才产生 1px 的时间变化，可精确停在任意细位置；以起点时间为基准而非 lane rect，避免起始不对齐误差），跳过 `snapTargetT`；非 Shift 走原逻辑（snapToFrame + 跨轨道吸附）。整组移动时组内成员也用 `snapFine`（`(shiftHeld ? snapFine : snapToFrame)(...)` 统一处理），保持组内相对偏移且落在亚帧网格。
3. **UI 文案**：`btn-kf-snap` title、帮助面板「移动」「🧲 关键帧吸附」两条、状态栏 hint（`Shift+拖动 精细微调`）、快捷键速查（`Shift+拖动菱形 精细微调`）全部更新；**注意删除「临时反转」残留文案**（v2.8 遗留）。
4. **与框选不冲突**：Shift+空白拖动 = 追加框选（目标在轨道空白处），Shift+菱形拖动 = 精细微调（目标在 diamond 上，pointerdown 已 stopPropagation）——同一 Shift 键两个入口按命中目标分流。
5. **验证（Playwright 8/8）**：吸附开关默认 on；回归·普通拖动（开）8.1→8.05 吸到 8.0；Shift 拖动（开）10.5 左移 10px → 10.49（期望 `round((10.5-10/950)*300)/300`，非 1/30 整数帧、未吸附——吸附开也不吸）；关开关后 Shift 拖动 → 亚帧网格（`nearInt(t,300)` 且 `!nearInt(t,30)`）；回归·普通拖动（关）→ 仅帧吸附 10.4333 不跨轨道；无 pageerror；清理后恢复默认。**测试易错点**：Shift 用 `page.keyboard.down('Shift')`（拖动前按下、pointerup 后松开）；帧时间随排序 index 变化 → 用 `kfNear(lane, t)` 按时间找最近帧再拖，不要写死 data-index。

## 二十七、自由视角手动同步 + 物体中心拾取 + camOrbit + Shift 强制吸附（v2.10）要点

1. **自由视角不自动切回**：v2.8 的 OrbitControls `start/end` 监听（松手位移 >0.05 即同步 + 切回）对纯旋转/平移观察也触发，太激进。v2.10 改为**删除整个自动监听块**，仅手动「📌 同步视角」按钮执行 `syncFreeViewToKeys()` + `setView('camera')`；自由视角点同步提示"请先切换到自由视角"。验证：旋转/平移拖动后 badge 仍自由视角；点同步后切回 + camX 关键帧写入。
2. **物体中心拾取（Box3）**：`pickAt()` 用 `Raycaster.intersectObjects(scene.children, true)` 递归命中后**沿 parent 链归并到 scene 直属对象**（`while (o.parent && o.parent !== scene) o = o.parent`），`Box3().setFromObject(obj).getCenter()` 取包围盒中心为视觉中心（非表面命中点）；`isPickableObject()` 按 name 正则排除辅助对象（grid/扫描框/截面/光晕/标签等），场景主体（射流/流线笼/孔板/扫描框/截面）必须补 `.name`。虚空点击提示"未点中主体"、不退出不写入。
3. **camOrbit 绕视觉中心旋转**：TRACKS 加 `{g:'摄像机', id:'camOrbit', label:'绕视觉中心旋转°', min:-180, max:180, lo:-720, hi:720, step:1, def:0}`；applyAll 摄像机分支 `rad=degToRad(v.camOrbit); dx=cx-tgtX, dz=cz-tgtZ; r=hypot(dx,dz)||1; a=atan2(dz,dx)+rad; cx=tgtX+r*cos(a); cz=tgtZ+r*sin(a)`——绕 tgt 绕 Y 轴旋转、保持高度与半径，0 时不旋转。
4. **⚠️ camera.matrixWorld 血泪教训**：camera 不在 scene 内，摄像机视角（`controls.enabled=false`）下 OrbitControls `update()` 第一行 `if (this.enabled === false) return;` 直接返回——**不会更新 camera.matrixWorld**。applyAll 设置 position/lookAt 后必须显式 `camera.updateMatrixWorld()`，否则相机位置变了但 `canvas.toDataURL()` 逐字节相同。v2.10 排查半天才定位。**验证技巧**：临时挂 `window.__camDbg` 读 camera.position（90°→(0,-40,122)、45°→(86.3,-40,86.3)），用完删除。
5. **⚠️ 轴对称场景画面不变陷阱**：射流场景绕竖直轴对称（水柱/圆笼/孔板），视觉中心在对称轴上时相机绕 Y 轴旋转，画面逐像素不变（物理正确，不是 bug）。**不要用 toDataURL 对比断言 camOrbit 生效**——断言相机位置数学或关键帧值；画面断言改为"对称性回归保护"（始终一致 = 相机未损坏）。
6. **Shift 语义修正**（用户明确澄清）：时间轴按住 Shift = **强制吸附关键帧**（`snapTargetT` 改为 `kfSnapOn || shiftHeld`，开关关时 Shift 临时强制吸附）；选中关键帧按住 Shift 拖动同样吸附；**Shift 精细微调只存在于参数调节面板**（参数柄/数值框 1/10 步进，v2.7 已有，保留）。删除 v2.9 的 `snapFine()`、`drag.startX`、pointermove Shift 精细分支——时间线 Shift 不再精细微调。文案同步（状态栏/帮助/快捷键/按钮 title），注意删除 v2.9「Shift 临时反转」残留。
7. **Playwright 易错点补充**：① autosave 防抖 600ms，`localStorage` 断言前 `waitForTimeout(1000)`（400ms 读到旧工程 camOrbit undefined）；② `state.keys` 按轨道分组对象 `{trackId:[{t,v,interp}]}` 非数组；③ 拾取模式断言 `#btn-pick-tgt.on` class（body 无 `.picking`）；④ D 测试拖帧后轨道排序变化，用「按 left≈找帧」再拖（`dragShapeTo(p, t, shift, findLeft)`），不写死 index；⑤ beforeunload 自动保存 → 用独立 browser context 隔离 localStorage。

## 二十八、截面扫描框大小可调（scanSize 轨道）要点

1. **需求本质**：截面扫描的白色方框（扫描平面）原本是硬编码常量 `FRAME_SIZE = 46`（mm），用户要求框大小可调、且能打关键帧动画。
2. **实现**：TRACKS 加 `{ g:'液柱显示', id:'scanSize', label:'扫描框大小', min:10, max:120, lo:5, hi:240, step:1, def:FRAME_SIZE }`。核心是把「白框 4 条边 + 半透明面」从 `scanGroup` 抽成独立子组 `frameGroup`（`scanGroup.add(frameGroup)`），新增 `setScanSize(sizeMm)` 只 `frameGroup.scale.setScalar(sizeMm / FRAME_SIZE)` 整体缩放——**高亮截面（sectionMesh/sectionHalo/sectionLine）加在 scanGroup 上、不进 frameGroup，缩放框时不会连截面一起放大**（截面是物理形状，不可缩放）。`applyAll` 加 `lastScanSize` 守卫 → `jet.setScanSize(v.scanSize)`，框大小随播放头插值/关键帧动画。
3. **标签定位复用**：抽 `placeScanLabel()`（用 `frameSize/2 + 3` 投影到屏幕，`curScanZ` 记录当前扫描深度），`updateScan` 与 `setScanSize` 都调用——框变大时标签跟着右边缘外移。
4. **验证（Playwright）**：数值轨道 input 是 `input[data-id="scanSize"]`（**注意是 `data-id` 不是 `data-track`**；seg 枚举轨道才用 `button[data-seg]`）。开扫描点 `button[data-seg="scanOn"][data-v="1"]`；设 scanSize 46→120 画面 50743 px 变化、120→20 60180 px 变化、0 pageerror。

## 二十九、穿透显示(xray) + 截面透明度(sectionOpacity) 要点

1. **需求本质**：① 用户反馈"切换截面扫描开关后液柱材质会变化"——原 `applyDim()` 在扫描开时把液柱调暗（transmission 0 / opacity 0.304 / 不写深度）。用户要的**不是**去掉这效果，而是：把「开启截面扫描时」的穿透半透明材质作为基准，并做成独立开关；② 再要一个「截面透明度」调整条（数据条轨道）。
2. **移除扫描开关与材质的耦合**：删掉 `applyDim()` 及 `setScan` 里的调用——`setScan(on)` 现在只 `scanGroup.visible = on` + 标签显隐，**不再碰液柱材质**。`rebuild`/`setMode` 末尾改调 `applyXray()`。
3. **xray 穿透显示**：TRACKS 加 `{ g:'液柱显示', id:'xray', label:'穿透显示', min:0, max:1, step:1, def:1, integer:true, seg:['关','开'] }`。`applyXray()` 复用原 applyDim 逻辑（`xrayOn ? transmission 0 / opacity 0.304 / depthWrite false : transmission 0.85 / opacity 1 / depthWrite true`），`setXray(on)` 供 applyAll 调用。**默认开（def:1）** = 原"开启截面扫描"的材质。applyJetColors 里 jetMat/solidMat/wireMat/cageMat 的 opacity 都乘 `(xrayOn ? ... : ...)` 分支。
4. **sectionOpacity 截面透明度**：TRACKS 加 `{ g:'液柱显示', id:'sectionOpacity', label:'截面透明度', min:0, max:1, step:0.01, def:1 }`。`updateScan` 创建 `sectionMesh` 时 `opacity: sectionOpacity`（替代 `colors.planes.sectionFill.opacity`）；`setSectionOpacity(v)` 只改 `sectionMesh.material.opacity`（**不动 sectionHalo/sectionLine**）；applyJetColors 里 sectionMesh opacity 同步用 `sectionOpacity`。
5. **⚠️ swiftshader 透明度渲染局限**：headless swiftshader 下改 `MeshBasicMaterial.opacity` 后主 canvas 几乎不刷新（改透明度只 1px 像素变化），**功能本身正确**（`sectionMesh.material.opacity` 已正确更新为 0.1，用临时 `window.__dbgSection` 钩子验证后删除）。真实浏览器 GPU 下正常。**验证材质类改动不要依赖 swiftshader 的像素对比**——改 transmission（MeshPhysicalMaterial）能刷新（7447px），改 BasicMaterial opacity 不刷新。用「读材质值」断言而非「读画面」。

## 三十、扫描框 + 截面 透明度合并为一条统一轨道（sectionOpacity 升级为整体乘数）要点

1. **需求本质**：v2.12 的「截面透明度」只控高亮填充（sectionMesh），白框线和衬板仍是硬编码基准（0.9 / 0.12），调低时只有彩色填充变淡、白框不联动，视觉割裂。**用户感知到「扫描框」与「截面」本应是一个整体**，要求合并为一条参数柄统一驱动两者一起淡入淡出。
2. **方案：sectionOpacity 升格为整体乘数**：不再"只改填充"，而是 `v ∈ [0,1]` 乘到扫描组内 5 个半透明元素各自的基准值上：
   - 白框线 `scanBoxMat.opacity = colors.planes.scan.opacity * v`（基准 0.9）
   - 衬板 `scanPlaneMat.opacity = SCAN_PLANE_OPACITY * v`（**抽常量** SCAN_PLANE_OPACITY = 0.12，原硬编码字面量提到模块顶部）
   - 高亮填充 `sectionMesh.material.opacity = colors.planes.sectionFill.opacity * v`（基准 1）
   - 光晕 `sectionHalo.material.opacity = colors.planes.sectionHalo.opacity * v`（基准 0.38）
   - 轮廓 `sectionLine.material.opacity = colors.lines.section.opacity * v`（基准 1）
   v=1 时与现状逐位一致（无回归）；v=0 时整组隐藏（白框线+衬板+填充+光晕+轮廓全 0）。
3. **集中函数 `applySectionOpacity()`**：把上面 5 个赋值收敛为一个函数，`setSectionOpacity(v)` 内部 `applySectionOpacity()` 统一刷新——避免基准与乘法在多处漂移。`applyJetColors()` 末尾（scanBoxMat/scanPlaneMat 段之后）也调一次 `applySectionOpacity()`，保证 colors 刷新时透明度同步更新（scanBoxMat/scanPlaneMat 段去掉原 opacity 赋值，仅保留 color set）。
4. **重建一致性**：`updateScan` 重建 sectionMesh/halo/line 时初始 opacity 也用 `基准 * sectionOpacity`（原 `opacity: sectionOpacity` 仅对 fill 有效，对 halo/line 是 0.38/1 硬编码），防止重建瞬间闪回基准。
5. **轨道改名**：`label: '截面透明度'` → `'扫描框/截面透明度'`，并在轨道定义后 inline 注释 "合并乘数：白框线/衬板/高亮填充/光晕/轮廓一起淡入淡出"，让用户看到轨道名就知道作用域。**id 保持 `sectionOpacity` 不变**——工程文件按 track id 持久化（state.statics / state.keys），改 id 会让旧工程该关键帧失效。
6. **验证（Playwright 0 报错）**：headless Edge + swiftshader 下开扫描后，设 slider 0.3 → 0.6 → 0 → 1.0 四档，**通过临时 `window.__SEC_DBG` 钩子读闭包内材质**（5 个 opacity + visible），结果：
   - v=0.3：box 0.27 / plane 0.036 / fill 0.3 / halo 0.114 / line 0.3 ✓
   - v=0.6：box 0.54 / plane 0.072 / fill 0.6 / halo 0.228 / line 0.6 ✓
   - v=0：全 0 ✓
   - v=1.0：box 0.9 / plane 0.12 / fill 1 / halo 0.38 / line 1 ✓ 无回归
   - 无 pageerror/console error；UI 文本含"扫描框/截面透明度"
   **测试技巧**：闭包内变量读不到 → 临时 `window.__SEC_DBG` 开关 + setSectionOpacity 内写 `window.__SEC_SNAP`，断言后删除钩子。**像素对比在 swiftshader 下不可信**（见二十九），必须读材质值。
