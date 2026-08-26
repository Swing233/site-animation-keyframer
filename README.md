# site-animation-keyframer — WorkBuddy 技能

**网站现象复刻 + 全参数关键帧动画工作台**：把一个 Three.js/WebGL 交互演示网站改造成"可编排动画、可导出视频"的工作台。内置完整交互（播放头 scrub、关键帧编辑/框选/复制粘贴、帧吸附、批量插值、背景色、撤销重做、帮助看板、音频波形对齐、工程自动保存、MP4/WebM/PNG 序列导出）。

## 安装（一行命令）

```bash
git clone https://github.com/SwingPigeon/site-animation-keyframer.git ~/.workbuddy/skills/site-animation-keyframer
```

> 支持 macOS / Windows / Linux 的 WorkBuddy。安装后在对话中提到"复刻网站加时间轴/关键帧动画/导出视频"即自动触发。

## 实时更新

技能持续迭代，本仓库即唯一分发源，**保持最新**：

```bash
cd ~/.workbuddy/skills/site-animation-keyframer && git pull
```

每次迭代后都会推送新版本（commit 号见 git log）。如果你想要完全自动的更新，可用 WorkBuddy 自动化每日执行上面的 `git pull`。

## 在线演示（本技能产出的工作台实例）

用本技能制作的真实演示页面，可在线体验：

| 演示 | 说明 | 在线地址 |
|---|---|---|
| 🚿 **射流轴交换 · Axis Switching 动画工作台** | 水流经非圆孔喷出后形成"锁链状"水柱的物理模拟 → 全参数关键帧动画工作台（时间轴/导出视频/帮助看板） | https://swingpigeon.github.io/axis-switching-workbench/ |
| 📐 **圆锥曲线动画工作台** | 椭圆/双曲线/抛物线等圆锥曲线参数化动画演示工作台 | https://swingpigeon.github.io/conic-sections-workbench/ |

> 两个演示均由本技能（模板复刻 + 关键帧工作台）制作，可作为"用这个技能能做出什么"的参考；对应技能仓库见 [axis-switching-workbench](https://github.com/SwingPigeon/axis-switching-workbench)。

## 目录结构

```
site-animation-keyframer/
├── SKILL.md                          # 技能入口（触发词 / 流程 / 必测项）
├── assets/animation-workbench-template/   # 路线 A 模板：Three.js 复刻工作台
│   ├── app.js                        # 核心：参数轨道引擎 + 场景重建 + 导出管线
│   ├── index.html                    # 工作台 UI（时间轴 / 关键帧编辑器 / 导出面板）
│   └── assets/vendor/                # 离线依赖：three.module.js / OrbitControls / JSZip
└── references/implementation-notes.md # 实现细节与踩坑记录
```

## 核心能力速览

- **关键帧**：10+ 参数轨道、平滑/线性/阶梯插值、框选多选、整组移动、复制/剪切/粘贴（默认线性）、批量改插值、撤销/重做
- **时间轴**：播放头 scrub、帧吸附、Alt+滚轮锚点缩放、音频波形对齐
- **视角**：摄像机/自由视角切换、自由视角一键同步为关键帧、参考网格、导出画幅安全框
- **画面**：🎨 自定义背景色（纯黑/纯白/纯绿抠像等预设 + 自定义取色器，随导出视频输出）
- **工程**：自动保存（localStorage 刷新不丢）、.json 工程导出/导入/拖拽恢复
- **导出**：MP4（H.264）/ WebM（VP9）/ PNG 序列；无声导出 WebCodecs 精确帧率（60fps 就是 60fps）；口播混音实时录制

## 其他说明

- 完整使用说明见 `SKILL.md`；实现细节与已踩过的坑见 `references/implementation-notes.md`
- 第三方用户可提交 Issue 反馈问题或功能建议
