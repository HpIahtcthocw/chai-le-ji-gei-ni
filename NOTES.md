# 拆了寄给你 — 开发笔记

群核 Aholo 3D AI 黑客松参赛项目。截止 2026-11-19 19:00（北京时间）。
单人开发，原则：宁可功能少，也要稳定跑通。

一句话：一件物品被 Lux3D 拆成部件，在浏览器里炸开；玩家把零件拼回去，每拼一块猜一次这是什么，拼完后物体动起来，可下载 STL。

---

## 0. 环境事实（2026-11-13 实测）

| 项 | 值 |
| --- | --- |
| Node / npm | v22.23.2 / 10.9.8 |
| Next.js | 15.5.29（App Router + TypeScript，`next build` 通过） |
| @manycore/aholo-viewer | 1.14.0（发布于 2026-11-12，MIT，ESM-only，`dist/index.js` 3.0 MB + `index.d.ts` 663 KB） |
| @manycore/aholo-sdk-lux3d | 1.9.0（依赖 `@manycore/aholo-sdk-core` ^1.3.0，仅 Node 端预生成用） |
| npm registry | 走 npmmirror 镜像，正常 |
| GitHub raw | **不通**（`raw.githubusercontent.com` 超时），官方 glTF 样例资产取不回来 |
| 官方文档站 | `https://aholojs.dev/llm/...` 可访问，且是给 AI 读的 markdown 版 |
| 本地浏览器 | Chrome 已装；`%LOCALAPPDATA%\ms-playwright` 有 chromium-1148 / headless-shell，但项目未装 playwright 包 |

构建产物：`/lab` 为静态预渲染页，`@manycore/aholo-viewer` 被拆成**懒加载分块**，不进首屏 shared JS（首屏 shared 仅 103 kB）。
这一点对"首屏 3 秒内看到炸开动画"有利：13 MB 的渲染器包不会压在首屏。

---

## 1. 阶段 1 可行性实验

### 1.1 合成测试资产

GitHub 拿不到 Khronos 样例，所以自建：

`scripts/make-lab-glb.mjs` → `public/items/_lab5/model.glb`（8,052 B）
- 5 个独立 Mesh 节点，名字 `base / pole / arm / shade / bulb`，各自独立 geometry 与材质（避免引擎的 mesh 合并/实例化干扰测试）
- 1 段节点关节动画 `arm-lift`：绕 Z 轴 0° → 45°，0～1.2 s
- `scripts/inspect-glb.mjs` 用 glTF-Transform 读回校验：5 nodes / 5 meshes / 5 materials / 1 animation，结构合法

**这是管道测试件，不是最终内容。** 最终必须有真实 Lux3D 拆分产物（见 §4 阻塞项）。

### 1.2 三个问题的结论

| # | 问题 | 状态 | 依据 |
| --- | --- | --- | --- |
| a | 能否加载带多个独立节点的 GLB | **静态已证，运行待验** | `loadGLTF(data: ArrayBuffer \| string, { textureLoader })` → `ParseResult { source, scene, scenes, animations, skeletons, componentMap }`（d.ts:10590 / 12618）。合成件含 5 独立节点。运行期是否逐节点保留，需浏览器实测 |
| b | 能否按节点读写 position 并做动画 | **静态已证，运行待验** | `Object3D` 有 `position/rotation/scale`、`traverse`、`getObjectByName`、`localToWorld`、`updateMatrixWorld`；官方 walk-demo 就是改 `characterRoot.position.copy()` 后 `updateMatrixWorld(true)` 再渲染 |
| c | 能否播放 GLB 内的关节动画 | **API 已确认，但与既有笔记冲突，运行待验** | 见 §1.3 |

### 1.3 关键发现：`AnimationAction` 没有 `play()`

项目简报里写的是 `clipAction(clip).play()`。**1.14.0 的类型声明里 `AnimationAction` 没有任何 `play()` / `stop()` 方法**（d.ts:4938–5000），公开可控的只有：

```ts
active: boolean      // 置 true 即播放
paused: boolean
weight: number       // 混合权重，做淡入淡出
speed: number
time: number
setLoop(mode, repetitions)
reset()
```

官方 walk-demo 源码（`https://aholojs.dev/llm/examples/walk-demo.md`）里的真实写法是：

```ts
const { AnimationPlugin, AnimationMixer, Skeleton } = Animation; // Animation 命名空间
const { loadGLTF } = GLTFLoader;

const mixer = new AnimationMixer(model);
const plugin = new AnimationPlugin();
plugin.registerToViewer({ viewer });      // 注意是对象包一层，不是直接传 viewer
plugin.add(mixer);

const action = mixer.clipAction(clip);
action.reset();
action.active = true;                      // ← 播放开关
action.weight = 1;                          // ← 淡入靠补 weight，不靠 fadeIn
```

淡入淡出的官方做法是自己每帧补 `action.weight`，播完把 `active` 置回 false（walk-demo 的 `fadeAction` / `updateActionFades`）。

**我们的实验页已经按 `active + weight` 写，没有照抄笔记里的 `.play()`。** 运行期结果待浏览器验证。

### 1.4 其它已确认的 API 事实（都有出处，不是猜）

| 用途 | API | 出处 |
| --- | --- | --- |
| 建场景 | `createViewer(name, container, { antialiasing })` | d.ts:7134；getting-started |
| 取场景/相机 | `viewer.getScene()` / `viewer.setCamera()` / `viewer.getCamera()` | d.ts:18376 / 18649 / 18654 |
| 渲染一帧 | `viewer.render()`；或设 `viewer.requestRenderHandler` 后由自身循环驱动 | getting-started |
| 关闭坐标系帮手 | `viewer.config.coordinateSystem.enabled.set(false)` | walk-demo |
| 背景/地面 | `setViewerConfig(viewer, { pipeline: { Background: { background: { active: BackgroundMode.BasicBackground, basic: { color } }, ground: { enabled: false } }, Splatting: { enabled: true }, TAA: { enabled: false } } })` | getting-started / walk-demo |
| 拾取 | `viewer.createPicker()` → `picker.pick(coords: Vector2, camera, pickFirst?, objects?)` | d.ts:18532 / 12912 |
| 射线（备选） | `Raycaster.setFromCamera(coords, camera, viewHeight?)` + `intersectObjects(objects, recursive)` | d.ts:13838–13896 |
| 高亮某零件 | `viewer.setHighlightObjects([{ object, groupIndex? }])` | d.ts:18659 |
| 手工改相机后强制刷新 | `(viewer as any).forceNextFrameRender = true` | walk-demo |
| 加物体后通知场景 | `scene.notifySceneChange()` | walk-demo |
| 适配尺寸的官方套路 | 算 `Box3().setFromObject(model)` → 按目标高度 `setScalar` → 把脚底移到原点 | walk-demo `normalizeModel` |
| 拾取结果字段 | `{ object, point, distance, primitiveIndex, distanceToRay? }` | d.ts:9599 |

`Picker.pick` 的 `coords` 是否为 NDC(-1..1) **尚未实测**。实验页用 `Vector2(0,0)` 打画面中心来反推：
若命中，说明是 NDC；若空，说明是像素坐标。这一条写进了实验页的 `pick` 结果里。

### 1.5 运行期验证的现状（未完成）

`app/lab` 已写好，`next build` 通过，但**还没在浏览器里跑过**——启动浏览器属于"控制本机"，按既定要求需先取得同意，已发问未获回复。

因此以下四项仍是**未验证**，不得当成结论：
1. 真机加载后 GLB 的 5 个节点是否各自独立（引擎是否有 mesh merge / instance 合并）
2. 逐节点 `position` 改动后画面是否只动该零件
3. `active + weight` 是否真的驱动 `arm-lift` 关节动画
4. `Picker.pick` 的坐标口径（NDC 还是像素）

其它未验证行为（都记着，不猜）：
- 引擎世界坐标是否 Z 轴朝上（walk-demo 用 `camera.up.set(0,0,1)`，getting-started 的 3DGS 例子用 `(0,-1,0)`，两者都是 3DGS，网格场景没给准话）
- Lux3D `partSplit` 产出的 GLB 里零件节点是否独立、命名规律
- Lux3D `articulationAnimation` 结果格式，能否被 `AnimationMixer` 吃下
- 拆分并发限制：OpenAPI 说同账号同时只能一个拆分任务，Lux3D 技能包说每账号 5 个 —— **以 OpenAPI 为准，但需实测**
- 每次调用消耗多少积分

---

## 2. 与项目简报不一致处（先报，不擅改）

1. **`AnimationAction.play()` 不存在** —— 见 §1.3。简报里的 `clipAction(clip).play()` 照抄会编译失败。
2. **`AnimationPlugin.registerToViewer` 的参数是 `{ viewer }`**，不是裸 `viewer`（d.ts 签名允许 `IViewerContext | Viewer`，但官方示例传的是 `{ viewer }` 上下文对象）。两种都试，以能跑的为准。
3. **`loadGLTF` 不是顶层导出**，挂在 `GLTFLoader.loadGLTF` 命名空间下（d.ts:8964–8971）。
4. **`Animation` 是命名空间**（`Animation.AnimationPlugin` / `Animation.AnimationMixer`），不是平铺导出。
5. 简报提到"3–4 件预置物品"，但 Lux3D 拆分是**同账号串行**，且下载链接 2 小时失效 —— 3 件排队生成属于关键路径，不是收尾工作。

---

## 3. 已完成 / 未完成

**已完成**
- 项目骨架（Next 15 + TS，无额外重型依赖），`next build` 通过
- aholo-viewer 1.14.0 / lux3d sdk 1.9.0 安装并核对版本
- 从类型声明与官方 llm 文档中整理出可用 API 清单（§1.4），纠正了 3 处与简报不一致的调用
- 合成 5 零件 + 关节动画 GLB，并用 glTF-Transform 校验结构
- `/lab` 实验页：装载 → 遍历 → 逐节点位移 → 动画播放 → 拾取，结果写到 `window.__LAB__`

**未完成**
- 浏览器里跑通 `/lab`（缺授权）
- 真实 Lux3D 拆分资产（缺 Key / GLB）
- 阶段 2 全部

---

## 4. 阻塞项（需要用户输入）

1. **已拆分的 GLB 或 Lux3D Key**：这是 go/no-go 的最后一步，也决定 §1.5 的 4 个未验证项能否收敛。
   没有 Key 时按约定用你给的 GLB 继续，但注意：**Lux3D 必须参与核心 3D 内容**（评审里"群核技术栈应用"占 30%），
   若最终资产不是 Lux3D 产出，这一项会直接失分，需要在报告书里如实说明。
2. **是否允许无头浏览器自动验证**：待回复。

---

## 5. 下一步

1. 拿到授权后跑 `/lab`，把 §1.5 四项变成确定结论，回填本文档。
2. 拿到拆分 GLB 后，用同一套实验脚本复跑，统计独立零件数与命名规律，决定是否需要 glTF-Transform 二次拆分。
3. 数据层：`public/items/<id>/` 按 `model.glb + meta.json + export.stl` 落地，`meta.json` 字段：
   `name, riddle, story, parts[{ nodeName, options[3], answerIndex }]`。
4. 阶段 2 顺序：物品选择页 → 炸开 → 拖拽吸合 → 三选一计分 → 关节动画 + 一句话 + STL 下载 → 顶部流程轨。
