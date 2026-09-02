---
name: site-animation-keyframer
description: 当用户给出一个网站 URL（通常是 Three.js/WebGL 类的交互演示、物理现象模拟器、可视化页面），要求"复刻它并添加关键帧动画/时间轴/导出功能"时使用。流程：先抓取并分析原站展示的现象与全部可变参数 → 按引擎选路线（Three.js 用模板复刻；原始 WebGL2/Canvas 用注入式工作台）→ 为所有可变项（摄像机位置/旋转/视觉中心/FOV、灯光、材质参数等）添加关键帧轨道 → 提供摄像机/自由视角切换、自由视角一键同步为关键帧、视频/序列帧导出、工程保存/加载。工作台内置完整交互：播放头跟随鼠标 scrub（标尺/轨道空白点击拖动跳转）、关键帧随鼠标拖动改时间、全参数数值拖拽微调（Blender/AE 式 scrub，无关键帧时自动在当前时间打关键帧）、一键清空所有关键帧（可撤回）、撤销/重做（⌘Z/⌘⇧Z 快捷键 + 工具栏按钮，手势合并、50 步快照栈）、导入外部音频口播/配乐（波形对齐关键帧节奏、实时混音导出）、工程自动保存（localStorage，刷新不丢）+ 导出/导入 .json 工程文件、参数列与关键帧列严格行列对齐（单滚动容器 + 粘性左列）。关键词：网站加时间轴、加关键帧、动画工作台、复刻网站、Blender/AE 时间轴、导出动画、口播对齐、波形对齐、数值拖拽、scrub、自动打关键帧、同步视角、撤回、撤销、重做、undo、redo、工程保存、工程导入、工程文件、自动保存、刷新不丢、project、autosave、精确帧率、60fps、帧率不对、framerate、WebCodecs、框选、框选关键帧、多选、批量删除、整组移动、marquee、复制、粘贴、剪切、copy、paste、cut、⌘C、⌘V、帧吸附、吸附到帧、snap、缩放时间轴、Alt滚轮、滚轮缩放、zoom timeline、批量插值、插值类型、改插值、interp、帮助看板、help、功能说明、背景色、背景颜色、纯色背景、纯黑、纯白、纯绿、绿幕、抠像、background color、clearColor、bg color、参数范围、调节手柄、超出范围、继续增减、滑杆范围、安全边界、lo、hi、overflow、配色、配色选项、线条颜色、平面颜色、透明度、自定义颜色、color scheme、palette、自定义文件名、导出命名、口播命名、文件名、export name、filename、重置配色、恢复默认配色、配色撤回、配色撤销、配色色块、实时参考、swatch、当前时间线预览、配画面预览、color preview、孔板、平台、隐藏孔板、孔板开关、plate、显示平台、关键帧吸附、跨轨道吸附、吸附开关、吸附到关键帧、snap keyframe、keyframe snap、Shift 强制吸附、Shift 拖动吸附、强制吸附关键帧、shift snap override、物体中心拾取、拾取物体中心、绕视觉中心旋转、camOrbit、轨道旋转、视觉中心环绕、视觉中心、拾取视觉中心、点选主体、pick target、pick、拾取模式、X键删除、x key delete、自由视角旋转中心、free pivot、自由视角手动同步、同步视角固化机位、手动同步机位、摄像机视角切换、扫描框大小、scanSize、扫描平面、截面扫描框、调整扫描框、扫描框可调、frame size、穿透显示、xray、截面透明度、sectionOpacity、液柱穿透、半透明穿透。
agent_created: true
---

# 网站现象复刻 + 全参数关键帧动画工作台

把一个交互演示网站改造成"可编排动画、可导出视频"的工作台。**禁止直接改动原站的 minified 打包产物**——按引擎选择下面两条路线之一复刻。

## 路线选择（先判定引擎再动手）

| 引擎特征 | 路线 | 做法 |
|---------|------|------|
| Three.js（`WebGLRenderer/PerspectiveCamera/OrbitControls`） | **A · 模板复刻** | 复制 `assets/animation-workbench-template/`，只改写 `app.js` 的 TRACKS 与场景专属段（见阶段 2） |
| 原始 WebGL/WebGL2（手写 GLSL、无 Three.js）或 Canvas 2D | **B · 注入式工作台** | 保留原物理/渲染引擎不动，把工作台 HTML/CSS/JS 注入到原文件末尾（见"路线 B 注入要点"） |

两条路线都产出同一套交互能力（见"模板已实现的通用能力"），区别只在"场景/引擎层"如何接入。

## 阶段 1：分析原站（学习它展示什么现象）

1. `curl -sL <url>` 下载首页 HTML，提取 JS/CSS bundle 路径并全部下载到本地工作目录的 `original/` 子目录留档。
2. 在 bundle 里 grep 识别渲染引擎与现象本质：
   - 引擎：`WebGLRenderer / PerspectiveCamera / OrbitControls`（Three.js）、`createShader/gl.createProgram`（原始 WebGL）、`PIXI`、`canvas 2d` 等。
   - 现象与参数：搜中文标签（`grep -o '"[^"]*"' bundle.js | grep -E '关键词'`）、uniform 名、变量名。弄清楚：这个页面在演示什么物理/视觉现象？用户能调哪些滑杆/选项？
3. 产出一份"参数清单"：每个可变项的名称、范围、默认值、对画面的影响。**这份清单就是后面时间轴轨道的来源——一个都不能漏。**

## 阶段 2A：Three.js 模板复刻

1. 复制 `assets/animation-workbench-template/` 到项目目录作为起点。模板已内置全部依赖（three@0.160 module、OrbitControls、jszip、whammy），通过 importmap 本地化引用，无需联网。
2. 只改写 `app.js` 中的两处"场景专属区"，其余（时间轴/关键帧/导出）保持不动：
   - **TRACKS 数组**：替换为阶段 1 得出的参数清单。摄像机 11 条轨道（位置/旋转/视觉中心 XYZ + FOV + 绕视觉中心旋转°）必须保留。轨道格式 `{g:分组, id, label, min, max, step, def, integer?, seg?}`，`seg` 用于枚举型参数（自动阶梯插值 + 分段按钮）。
   - **场景搭建段**（`renderer/scene/camera` 之后、`applyAll` 之前）：按原站现象重建几何体、材质、灯光与可视化元素。shader 现象（拉丝高光、折射、粒子）用 ShaderMaterial 复刻。
3. 在 `applyAll(t)` 中把每条轨道求值结果接到场景对象上（uniform、位置、可见性等）。

## 阶段 2B：原始 WebGL2 / Canvas 注入

以"影香肠焦散模拟器"（原始 WebGL2 + 自定义 GLSL 光子追迹）实战为准：

1. 保留原渲染引擎与状态对象不动；工作台作为一层"叠加 UI"注入。
2. 三个必要预处理：
   - **删掉 frame-buster 重定向**：很多在线演示首页有 `window.location.replace("xxx")` 防 iframe 脚本，直接加载会被跳走，删掉首行。
   - **把硬编码视角参数改成变量**：如 `m4persp(48*DEG,...)` 改为 `m4persp(cam.fov,...)`，`cam = {az,el,dist,tx,ty,tz,fov}`，这样工作台才能驱动摄像机。
   - **工作台三段式注入**：CSS（`<style id="wb-style">`）+ HTML（工作台容器 `<div id="wb">`）+ JS（包在 IIFE 里，直接追加到 `</body>` 前的 `</script>` 中）。JS 里用 `document.getElementById('wb')` 定位，所有状态放在独立对象 `wb` 上，避免与原站全局变量冲突。
3. 轨道参数通过 `evalTrack(id, t)` 求值后写入原站状态对象（如 `S['depth'] = v`），触发原站自己的重建函数（`rebuild()/applyScene()`）。
4. 原站 25 个滑杆可以保留——工作台动画播放时通过 `applyAll` 覆盖它们；两者互不干扰。

## 阶段 3：验证与交付

1. 起本地静态服务器（`python3 -m http.server <port>`），用无头浏览器验证，方法见用户级技能 `headless-browser-testing`（playwright-core + 系统 Edge + swiftshader；agent-browser 的 Chromium 下载在此环境会被网络阻断）。
2. 必测项：页面无 pageerror；播放时参数面板数值随插值变化；双击轨道空白加帧、Delete 删帧、双击菱形改值；**参数列数值拖拽能改数且在无关键帧时自动打帧**；播放头点击/拖动跟随；**轨道空白处拖拽 >5px 弹出框选矩形、松开后多个关键帧同时高亮；框选后 Delete 批量删除、拖动任一选中帧整组同步移动、Esc 取消选择**；**⌘C 复制选中关键帧（含框选批量）→ 移动播放头 → ⌘V 粘贴：数量正确、落点在播放头且保持各帧相对时间偏移、粘贴后自动选中新帧、⌘Z 可撤回；⌘X 剪切 = 复制+删除；同一播放头重复粘贴覆盖不堆积**；**帧吸附：标尺/轨道任意位置点击后 `playhead.style.left` 换算的 t×帧率 ≈ 整数（容差 0.01 帧；注意 style.left 被 CSSOM 舍入到 ~0.001px，容差别取 1e-6）；拖动菱形、双击加帧、⌘V 粘贴的落点同样对齐帧**；**Alt+滚轮缩放时间轴：px/s 增减且缩放滑杆同步、缩放前后鼠标指向的时间不变（锚点，容差 0.05s）、普通滚轮不触发缩放；←/→ 逐帧后 tl-body 的 scrollLeft 保持 0（方向键必须 preventDefault，否则浏览器默认横向滚动会让粘性名字列盖住首列菱形）**；**批量插值：框选多帧 → 工具栏「∿ 批量插值」下拉选 阶梯/线性 → 选中帧 title 全部变为对应类型、⌘Z 恢复原类型；无选择时操作给出提示**；**粘贴的帧默认线性插值（title 显示 `（linear）`），⌘Z 撤销粘贴**；**❓ 帮助看板：顶栏按钮打开（display:flex）、内容含各功能分区与快捷键速查、✕/Esc/点遮罩均可关闭**；**🎨 背景色：顶栏「背景」下拉切 纯黑/纯白/纯绿（抠像）/默认 等预设、取色器自定义任意颜色——预览 canvas 角落像素采样验证（WebGL canvas 用临时 2d canvas drawImage 后 getImageData，取样点取 (8,8) 角落避开场景内容；scene.background 直接作 clearColor 输出不经过 ACES tone mapping，色值应接近原色，容差 ±55）；背景写入工程（bgColor 字段）随自动保存/刷新/打开工程恢复；背景随导出视频一并输出**；**参数范围手柄：每个参数滑杆是常用范围（min~max），数值框/拖拽可继续超出增减（安全边界 lo~hi，超出滑杆贴边+overflow 红色高亮）——验证：数值框输入超 max 值保留、超 hi 被 clamp、scrub 拖拽可超 max、物理极值渲染无崩溃、工程保存/恢复保留超范围关键帧值**；**MP4/MOV 导出文件头为 `ftyp`（H.264 ISO BMFF）、PNG 序列 ZIP 头为 `PK`**；**60fps 导出后实际帧率 = 60（用 ffprobe 验证 avg_frame_rate=60/1；MediaRecorder 做不到，必须走 WebCodecs）**；**透明 PNG 序列：勾选「透明背景」后导出期间 `scene.background = null` + `renderer.setClearAlpha(0)`（renderer 建在 `alpha:true`），PNG 为 RGBA——验证用 python zipfile 解 ZIP + 手工 unfilter PNG IDAT：四角 alpha=0 且内容像素（如 t=1s 液柱中心）alpha>200；导出结束后恢复背景色与 clearAlpha**；**工程自动保存：修改关键帧/时长/视角后刷新页面状态保留；导出 .json 工程文件结构完整（app/version/keys）；打开工程文件可完整恢复；新建工程回到默认演示**；**导出文件名：导出面板「文件名」输入框可自定义（导出文件名 = 自定义名 + 分辨率 + fps 后缀）；留空自动填充——有口播用音频文件名（去扩展名），无口播用 模拟器名+日期（如 axis_switching_2026-08-27）**；**孔板开关：顶栏「🕳 孔板」按钮显示/隐藏水流开始的孔板平台（jet.plateGroup.visible），状态存工程 plateVisible 字段随自动保存/刷新/新建联动；buildPlate 重建时应用 plateVisible**。**配画面预览：配色面板嵌入当前播放头画面预览（drawImage 主 canvas，150ms 刷新），改色实时显示效果；预览 canvas 棋盘格背景便于透明效果参考。**配色重置/撤回/实时参考：配色面板顶部「↺ 重置配色」恢复 COLOR_DEFAULTS 且可 ⌘Z 撤回；配色修改（input/change）走 snapshot() 纳入撤销栈（与关键帧同栈，手势 500ms 合并），⌘Z 恢复配色 + 面板 + 场景；每行右侧棋盘格 swatch 实时显示 hex+opacity 的 rgba 效果（updateSwatch，syncColorPanel 打开时同步）**；**关键帧吸附：工具栏「🧲 吸附」按钮（默认开启，localStorage `kfSnapOn` 持久化）——拖动关键帧时自动吸附到**其他轨道**上相近的关键帧（仅跨轨道、不吸同轨道帧，避免同轨道自吸导致无法微调），阈值 12px 随时间轴缩放自适应，吸附命中目标帧金色高亮（`snap-flash` class，拖动中与松开重绘后各闪一次）**。
3. 视觉调优：对照"现象该有的样子"截图迭代（见 references/implementation-notes.md 的 shader 陷阱清单）。
4. 预置一段 8–15 秒的演示关键帧动画（相机运镜 + 2–4 个核心参数变化，如"光线增长"），让用户打开即可播放。
5. `present_files` 交付：本地预览 URL + index.html + app.js，并说明部署只需上传整个目录。

## 模板已实现的通用能力（不要重写）

- **播放头**：播放/暂停/逐帧/循环、缩放、时长修改、面板高度拖拽、空格/方向键/Delete/X 快捷键；**标尺与轨道空白处点击/拖动 → 播放头精确跟随光标跳转**（scrub）；**帧吸附：`seek()` 统一 `snapToFrame()`（t → round(t×帧率)/帧率），播放头/标尺/轨道/波形跳转全部落在帧边界；方向键必须 `preventDefault()` 阻止浏览器默认横向滚动**；**Alt+滚轮缩放时间轴：以鼠标位置为锚点（缩放前后鼠标指向的时间不变），px/s 与缩放滑杆（30–500、步长 5）同步、超范围自动钳制、自动保存**
- **关键帧**：◇ 按钮在当前时间增删、双击轨道空白按当前求值插帧、**菱形可随鼠标拖动改时间**（>3px 判定拖动，未移动视为点击选中+跳转）、双击弹出编辑器（时间/数值/插值）、Catmull-Rom 平滑 / 线性 / 阶梯三种插值；**框选多选：轨道空白处按住拖拽 >5px 拉出半透明矩形框，松开后选中矩形内所有关键帧（`state.sel` 多选集合，Shift 框选追加选择）；框选后 Delete/🗑 批量删除（一次快照整体撤回）、拖动任一选中帧整组同步移动（按对象引用重建 index）、Esc 或空框取消选择**；**复制/剪切/粘贴（`⌘C/⌘X/⌘V` + 「📋 粘贴关键帧」按钮）：把选中的一组关键帧（含框选批量）粘贴到当前播放头位置——保持各帧相对最早帧的时间偏移、超时长自动钳制、同位置已有帧则覆盖不堆积、粘贴后自动选中新帧可立即整组拖动、一次快照整体撤回；粘贴的帧一律默认线性插值（不再继承源帧的平滑/阶梯，避免曲线过冲；如需保持可用「∿ 批量插值」改回）**（拖动/双击加帧/编辑器改时间/粘贴的落点全部 `snapToFrame()` 吸附帧边界）；**关键帧吸附（跨轨道）**：工具栏「🧲 吸附」开关（`btn-kf-snap`，`kfSnapOn` 默认开、localStorage 持久化，不随工程保存）——拖动关键帧时 `snapTargetT(t, skipTracks)` 在**其他轨道**（跳过拖动组所在轨道）中找最近关键帧，|Δt| ≤ `KF_SNAP_PX/state.px`（12px 随缩放自适应）则吸附对齐，命中时 `flashSnap()` 高亮目标帧（`snap-flash` 金色 outline，400ms 自动消除；pointerup 重绘后补闪一次）；**按住 Shift 拖动关键帧 = 强制吸附**（`snapTargetT` 取 `kfSnapOn || shiftHeld`）：吸附开关关闭时按住 Shift 拖动同样执行跨轨道吸附（Shift 临时强制吸附，不受开关影响），选中关键帧按住 Shift 拖动同样吸附到其他轨道帧——Shift 只作用于「时间轴上强制吸附」，精细微调仅保留在参数调节面板（参数柄/数值框按住 Shift 拖动 1/10 步进，见下条）；吸附只作用于**拖动改时间**，双击加帧/编辑器输入/粘贴不受影响（用户精确输入不被干扰）；**批量插值：选中（或框选）关键帧后用工具栏「∿ 批量插值」下拉一键改为 平滑/线性/阶梯（`setSelectionInterp`，一次快照整体撤回，无选择时提示；下拉用完自动复位占位项便于连选）**；「🗑 清空所有关键帧」一键清空全部轨道（confirm 防误删，提示已删数量，**可撤回**）；**❓ 帮助看板：顶栏按钮打开模态面板，分 7 区列出全部功能（播放/关键帧/视角/音频/工程/导出/快捷键速查），✕ 按钮、Esc（优先于取消选择、不受输入框焦点影响）、点遮罩三种方式关闭**
- **撤销 / 重做**：工具栏「↩ 撤回 / ↪ 重做」按钮 + 快捷键（`⌘Z/Ctrl+Z` 撤销、`⌘⇧Z/Ctrl+Shift+Z` 与 `Ctrl+Y` 重做），对 `state.keys` 做快照式撤销（50 步栈）；覆盖全部修改入口（scrub、菱形拖拽、双击插帧、◇ 按钮、kf 编辑器、清空、Delete、同步视角、时长/音频钳制），同一拖动手势自动合并为一步，空栈时提示不越界
- **参数数值拖拽微调（Blender/AE 式 scrub）**：左侧参数列数值与右侧面板数字框都支持按住左右拖动改数字（Shift 精细 10×、整数取整）；**任何数值改动都会在当前播放头时间自动创建/更新关键帧——该时刻无关键帧则自动创建，有则更新不重复**
- **参数范围手柄（lo/hi 安全边界）**：每个轨道 `min~max` 是滑杆手柄的常用调节范围，`lo~hi` 是数值框/scrub 拖拽/关键帧可继续增减的安全边界（缺省回退 min/max，seg 枚举轨道不设）；`commitValue/makeScrub/clampTrack/sanitizeProject/kf-editor` 五处 clamp 全部用 `tr.hi ?? tr.max / tr.lo ?? tr.min`；滑杆值同步时贴边显示（`Math.min(tr.max, Math.max(tr.min, val))`）并给 `overflow` class（超界变红高亮）；number input 的 min/max 属性用 lo/hi。**安全边界必须按轨道语义显式设定**——物理参数（如流量 Q≤0 会算负流速崩溃）、shader 数组上限（lightCount ≤ MAX_LIGHTS）等不能盲目算术扩展
- **行列严格对齐**：参数列与关键帧列共用单一滚动容器（`overflow:auto`），参数列 `position:sticky;left:0` 水平滚动钉在左侧，分组头行两侧等高对齐——禁止做成两个各自滚动的容器
- 视角：摄像机视角（按关键帧驱动）↔ 自由视角（OrbitControls）切换；摄像机可选"始终看向视觉中心"（勾选时忽略旋转轨道）；**自由视角摆好机位后点「📌 同步视角」，把当前视口机位（位置 + 视觉中心；非"看向"模式还含旋转欧拉）写入播放头时间的关键帧**，实现"自由观察 → 一键固化进动画"；**自由视角机位手动同步（不自动切回）**：自由视角移动/旋转/平移均不会自动切回摄像机视角，摆好机位后点「📌 同步视角」按钮才 `syncFreeViewToKeys()` 写入关键帧并 `setView('camera')` 切回（摄像机视角下点同步提示"请先切换到自由视角"）；**◎ 视觉中心拾取（物体中心）**：顶栏「◎ 视觉中心」按钮进入拾取模式（跨光标、Esc 退出），`Raycaster` 递归命中后**归并到 scene 直属对象**（沿 parent 链上溯），用 `Box3().setFromObject(obj).getCenter()` 取**物体包围盒中心**为视觉中心（非表面命中点），`isPickableObject()` 按 name 过滤网格/扫描框/截面等辅助可视化对象，命中主体 → 把物体中心写入当前时间 tgtX/Y/Z 关键帧并自动退出，提示含物体名与「中心」（射流/流线笼/孔板等场景主体需有 `.name`）；**取消「始终看向」不跳变**：取消勾选瞬间把当前相机朝向（Euler YXZ → 度）写入 rotX/Y/Z 关键帧并保持 controls.target = 相机前方视线点（freePivot），画面逐像素不变；**自由视角旋转中心**：取消看向后 `controls.target` 不再等于视觉中心，而是 `camera.position + forward × dist`（相机前方视线点，dist = 到原 target 距离，下限 20）——自由旋转围绕视线方向而非视觉中心；**同步视角不偏移视觉中心**：非"看向"模式同步视角只写位置 + 旋转欧拉，不再写 tgtX/Y/Z，避免视觉中心被拖走；**camOrbit 绕视觉中心旋转**：摄像机组新增「绕视觉中心旋转°」轨道（`camOrbit`，min -180~180，lo/hi ±720，def 0），`applyAll` 摄像机分支将相机位置绕视觉中心（tgt）绕 Y 轴旋转该角度（`atan2(dz,dx)+rad` 重算 cx/cz，保持高度与半径），0 时不旋转行为不变；**相机不在 scene 内且摄像机视角下 OrbitControls `update()` 直接 return（enabled=false），渲染前必须显式 `camera.updateMatrixWorld()`，否则机位改动不反映到画面**（v2.10 血泪教训：toDataURL 逐字节相同排查半天）；注意默认场景绕竖直轴对称（水柱/圆笼/孔板），视觉中心在对称轴上时旋转画面逐像素不变——物理正确，验证时改断言相机位置而非画面，功能主要用于组合动画/非对称机位
- **导出画幅安全框 + 网格开关**：预览画面中央叠加虚线"🔲 画幅框"（纯 DOM overlay，按导出分辨率宽高比等比缩放，左上角标注当前分辨率如 1920×1080；切换 720p/1080p/4K/自定义分辨率时自动跟随，**不进入导出画面**）；顶栏「📐 网格」按钮开关全局参考网格（GridHelper）——摆机位时随时确认"最终导出画面里能看到什么"
- **🎨 自定义背景色**：顶栏「背景」下拉预设（默认/纯黑/纯白/纯绿抠像）+ 右侧 `<input type=color>` 自定义任意颜色；`setBackgroundColor()` 直接改 `scene.background`（模板有 fog 时同步 `scene.fog.color` 防止纯色背景下物体发暗）——预览实时生效、随导出视频一并输出（适合绿幕抠像后期合成）；背景色作为 `bgColor` 字段写入工程（自动保存/刷新/打开工程/新建全部联动）；下拉用"选完立即复位 value=''"技巧保证重复选同一预设也触发 change
- **🎨 配色面板**：顶栏「配色」打开面板，提供 9 个对象的颜色与透明度独立调节——4 线条（流线笼/截面线/前端线/参考网格，颜色 + 透明度）+ 5 平面（液柱表面/截面填充/截面光晕/前端填充/扫描框，颜色 + 透明度）；`colors` 状态对象分组 lines/planes，`applyColors()` 调 `jet.applyJetColors()`（jet 内 jetMat/solidMat/wireMat/cageMat/sectionFill/sectionHalo/sectionLine/frontFill/frontLine/scanBoxMat/scanPlaneMat）+ 模块级处理 grid（GridHelper 材质数组遍历）；液柱透明度叠加渲染模式/调暗系数（cage: dim?0.333:(m===0?1:1.667)）；**新建**扫面框/光晕/液柱等重建材质时初始化用 colors 颜色，避免重建重置配色；`colors` 字段随工程自动保存/刷新/打开工程/新建全部联动；**配色可撤回：snapshot() 改为快照 `{keys, colors}`（cloneColors = JSON.parse(JSON.stringify(colors))），undo/redo 同时恢复 colors + applyColors() + syncColorPanel()；「↺ 重置配色」按钮也先 snapshot（重置可撤回）；每行棋盘格 swatch 实时显示 rgba 效果；**面板顶部嵌入配画面预览：每 150ms drawImage 主 renderer canvas（preserveDrawingBuffer:true）到面板 canvas 2D context，contain 等比缩放居中；toggleColors(true) 启动 setInterval，toggleColors(false) clearInterval 避免泄漏**
- 导出：**MP4 视频（H.264，全平台可预览）/ MOV 视频（H.264 兼容容器，多数播放器/剪辑可打开）/ PNG 序列（JSZip 打包，可选透明背景 alpha 通道）**；720p/1080p/4K/自定义 × 24/30/60fps；**无声 MP4/MOV 走 WebCodecs 逐帧精确编码**（`VideoEncoder` + mp4-muxer 动态加载，帧率严格等于所选值，60fps 就是 60fps，关键帧间隔 5s、队列背压防内存堆积、导出后封装容器；MOV = mp4-muxer 输出 + `.mov` 扩展名 + `video/quicktime` 类型）；浏览器不支持 WebCodecs 或 muxer 库加载失败时**自动回退 MediaRecorder 实时录制**（总时长 = 动画时长，但实际帧率由浏览器编码器决定、无法精确控制，状态栏会提示）；导出期间临时改 renderer 尺寸、完成后恢复现场；PNG 序列逐帧 applyAll(t, true) 强制相机动画渲染；**自定义文件名：导出面板「文件名」输入框（留空自动填充默认——有口播 audioState.name 去扩展名，无口播 `SIM_NAME + todayStr()` 如 axis_switching_2026-08-27；`sanitizeName` 清理 `\/:*?"<>|`）；打开面板时输入框为空才填默认（用户自定义后保留）**；**透明 PNG 序列：勾选「透明背景」→ 导出期间 `scene.background=null` + `renderer.setClearAlpha(0)`（renderer 建在 `alpha:true`），PNG 带 alpha 通道便于 AE/剪辑后期合成/抠像；导出后恢复背景色与 clearAlpha**
- **音频口播导入与波形对齐**：点击顶部「🎙 导入口播」导入 mp3/wav/ogg/m4a，AudioContext 解码后生成 2000 桶峰值波形，自动扩展动画时长覆盖口播长度；播放时音频与动画同步推进（音画绑定），波形行点击/拖动可跳转播放头，半透已播蒙版直观显示当前进度；导出视频时可选「混入口播」走 canvas.captureStream + audioEl.captureStream 实时录制（MP4 H.264 优先），确保音频轨精确嵌入视频
- **工程管理（自动保存 + 文件导入导出）**：所有编辑（关键帧/时长/播放头/视角/网格/画幅框/音频元数据）经 `scheduleAutosave()` 防抖 600ms 写入 localStorage，**刷新页面自动恢复全部状态**（`tryRestoreAutosave()` 必须在 `buildTimeline()` 之前调用）；「💾 保存工程」下载 `.json` 工程文件（含 app 标识、version、duration/time/px/loop/view/lookAtTarget/gridVisible/frameVisible、全部 keys、音频峰值元数据）；「📂 打开工程」或**直接把 .json 拖进页面**即可恢复（导入后清空撤销栈）；「🗑 新建」重置为默认演示动画；非法文件校验（app 标识 + keys 结构）后拒绝且不影响当前状态。音频本体（文件流）不序列化——恢复后波形可显示但需重新导入才能播放/混音（`metaOnly` 标志）

详细实现说明与已踩过的坑见 `references/implementation-notes.md`。

## 更新源（实时更新）

本技能发布在公开仓库 **https://github.com/SwingPigeon/site-animation-keyframer**，每次迭代后自动推送。保持最新：

```bash
cd ~/.claude/skills/site-animation-keyframer && git pull
```

（或在仓库页面 Code → Download ZIP 手动更新；详情见仓库 README。）
