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
1. 引擎加载后 GLB 的节点是否各自独立（引擎是否有 mesh merge / instance 合并）
2. 逐节点 `position` 改动后画面是否只动该零件
3. `active + weight` 是否真的驱动 `arm-lift` 关节动画
4. `Picker.pick` 的坐标口径（NDC 还是像素）

其它未验证行为（都记着，不猜）：
- 引擎世界坐标是否 Z 轴朝上（walk-demo 用 `camera.up.set(0,0,1)`，getting-started 的 3DGS 例子用 `(0,-1,0)`，两者都是 3DGS，网格场景没给准话）
- Lux3D `articulationAnimation` 结果格式，能否被 `AnimationMixer` 吃下
- 拆分并发限制：OpenAPI 说同账号同时只能一个拆分任务，Lux3D 技能包说每账号 5 个 —— **以 OpenAPI 为准，但需实测**
- 每次调用消耗多少积分（API 无余额/用量查询接口）

### 1.6 真实 Lux3D 链路：台灯（2026-11-13 跑通）

脚本 `scripts/lux3d/pipeline.mjs`，可断点续跑，状态写 `public/items/<id>/pipeline.json`。

| 步骤 | 调用 | 结果 |
| --- | --- | --- |
| 生成 | `textTo3d.create({ prompt, version:'G1-Turbo', style:'photorealistic', faceCount:200000, outputFormat:['glb'], enablePbr:true })` | taskId **6974188**，status 3；1～2 分钟 |
| 拆分 | `partSplit.create({ glbUrl: 生成产物URL })` | taskId **6974827**，status 3；数分钟 |
| 导出 | `multiFormatExport.create({ modelUrl: 生成产物URL, outputFormat:['stl'] })` | taskId **6977071**，status 3；`printable.stl` 12.95 MB |

产物全部落盘 `public/items/lamp/`：`source.glb` 16.15 MB、`model.glb` 16.21 MB、`export.stl` 12.95 MB。
三个任务共花 **3 个任务额度**。

**拆分结构判定（go/no-go 关键）：7 个 Mesh 节点、7 meshes、7 materials、2 textures、0 animations，每节点单 primitive。**
独立零件数 7 ≥ 5，**这一项通过**。

顶点数（按 GLB 内顺序）：part-0 26,432 / part-1 11,315 / part-2 50,347 / part-3 8,983 / part-4 12,926 / part-5 36,842 / part-6 25,562。

两个必须记录的新事实：

1. **所有节点 `name` 为空**，`scripts/inspect-glb.mjs` 与 `analyze-parts.mjs` 都返回 `(unnamed)`。
2. **所有节点 `translation` 均为 `[0,0,0]`**，几何直接烘进世界坐标。

`scripts/analyze-parts.mjs` 给出的包围盒事实：整体 `min[-0.195,-0.24,-0.117]` / `max[0.195,0.24,0.117]`，
`totalSize [0.39, 0.48, 0.234]`，`center [0,0,0]`（正好原点居中），`longestAxis = 1` → **Y-up（glTF 标准），约 0.48 m 高**。

逐块推断（尺寸单位 m，看得出的语义）：

| 块 | size | center | 推断 |
| --- | --- | --- | --- |
| part-6 | 0.389×0.052×0.185 | (0, −0.214, −0.025) | 底座（最底部、最扁） |
| part-5 | 0.181×0.027×0.184 | (0.009, −0.226, 0.025) | 底座上盖 / 配重片 |
| part-4 | 0.034×0.318×0.043 | (−0.046, −0.057, 0.025) | 灯杆（竖向细长） |
| part-1 | 0.207×0.177×0.025 | (−0.062, 0.079, 0.025) | 灯臂（斜向薄板） |
| part-2 | 0.139×0.154×0.127 | (0.113, 0.155, 0.03) | 灯罩（右上方体积最大） |
| part-0 | 0.094×0.115×0.089 | (0.103, 0.166, 0.025) | 灯泡（在灯罩内部） |
| part-3 | 0.059×0.091×0.071 | (0.056, 0.195, 0.024) | 灯头接头（灯罩根部） |

**导出接口的一个硬约束（实测得出，文档没写全）：**
`multiFormatExport` 传**拆分产物 URL**（`glbPartsReconstructResult/...glb`）→ 任务 status=4 失败，且 `tasks.retrieve` 不回任何失败原因；
改传**生成产物 URL**（`genesis3d/.../tex_mesh.glb`）→ 成功。所以 STL 只能从生成产物导出（这刚好也符合产品语义：玩家下载的是拼好的整件物体）。

STL 校验（`scripts/inspect-stl.mjs`）：二进制、**271,602 三角面**、字节长度自洽；
包围盒 `64.87 × 39.04 × 80`，与 GLB 等比但做了 **Y-up → Z-up** 转换并放大 ×166.6 倍（典型 3D 打印导出行为）。

**由这些事实直接改掉的设计（已写进下面的数据层方案）：**

- `meta.json` 不能用 `nodeName` 做零件键 —— 节点没有名字。改为按 GLB 内子节点顺序赋稳定 id `part-0..part-N`，载入后遍历时按索引对齐。
- 因为节点变换是单位矩阵、几何在世界坐标系里，**逐零件平移 = 直接加节点 `position`** 即可；但**绕零件自身中心旋转**会绕世界原点转，必须额外套一层 pivot `Object3D`（正好对应简报里"程序化铰链"的退路）。
- 16 MB / 件的体积对移动端网络偏重，需要后续用 glTF-Transform 做 weld/simplify 或降 `faceCount` 再生成。

---

## 2. 与项目简报不一致处（先报，不擅改）

1. **`AnimationAction.play()` 不存在** —— 见 §1.3。简报里的 `clipAction(clip).play()` 照抄会编译失败。
2. **`AnimationPlugin.registerToViewer` 的参数是 `{ viewer }`**，不是裸 `viewer`（d.ts 签名允许 `IViewerContext | Viewer`，但官方示例传的是 `{ viewer }` 上下文对象）。两种都试，以能跑的为准。
3. **`loadGLTF` 不是顶层导出**，挂在 `GLTFLoader.loadGLTF` 命名空间下（d.ts:8964–8971）。
4. **`Animation` 是命名空间**（`Animation.AnimationPlugin` / `Animation.AnimationMixer`），不是平铺导出。
5. 简报提到"3–4 件预置物品"，但 Lux3D 拆分是**同账号串行**，且下载链接 2 小时失效 —— 3 件排队生成属于关键路径，不是收尾工作。
6. **拆分产物里零件节点没有名字**，简报的数据格式 `parts[{ nodeName, ... }]` 无法照写，改用 `partId`（见 §1.6）。
7. **`multiFormatExport` 不接受拆分产物 URL**（实测 status=4），只能从生成产物导出 STL（见 §1.6）。
8. **导出任务的失败原因查不到**：`tasks.retrieve` 只给 `{ taskId, bizId, status:4, outputs:[] }`，没有错误信息。所以每次失败都要靠换参数二分定位，成本是任务额度。

---

## 3. 已完成 / 未完成

**已完成**
- 项目骨架（Next 15 + TS，无额外重型依赖），`next build` 通过
- aholo-viewer 1.14.0 / lux3d sdk 1.9.0 安装并核对版本
- 从类型声明与官方 llm 文档中整理出可用 API 清单（§1.4），纠正了 3 处与简报不一致的调用
- 合成 5 零件 + 关节动画 GLB，并用 glTF-Transform 校验结构
- `/lab` 实验页：装载 → 遍历 → 逐节点位移 → 动画播放 → 拾取，结果写到 `window.__LAB__`
- **真实 Lux3D 全链路跑通**（生成 → 拆分 → 导出），台灯一件三类产物落盘（§1.6）
- 资产分析工具：`scripts/inspect-glb.mjs`（结构）、`scripts/analyze-parts.mjs`（逐块包围盒）、`scripts/inspect-stl.mjs`（STL 校验）

**未完成**
- 浏览器里跑通 `/lab`（缺授权）→ §1.5 四项仍未验证
- 第二、三件物品（拆分同账号串行，需排队）
- 关节动画任务未跑（`articulationAnimation.create`）
- `meta.json` 未写
- 阶段 2 全部

---

## 4. 阻塞项（需要用户输入）

1. **是否允许启动本地浏览器做运行期验证**：待回复。
   替代方案：你自己 `npm run dev` 打开 `http://localhost:3000/lab`，右侧日志面板会直接列出四项结论。
2. **积分预算**：API 没有余额查询接口，只能按任务数自律。台灯一共创建了 4 个任务（生成 / 拆分 / 一次失败的导出 / 一次成功的导出），
   其中失败的那次是为定位"导出不吃拆分 URL"付的学费。后续每件物品至少还需 3 个任务（生成 + 拆分 + 导出）。

---

## 5. 下一步

1. 用同一套脚本复跑第二件物品（换结构清楚的：手持风扇 / 闹钟 / 订书机），确认"7 块"不是台灯的偶然结果。
2. 数据层：`public/items/<id>/` 落 `model.glb + meta.json + export.stl`；`meta.json` 字段改为
   `name, riddle, story, parts[{ partId, options[3], answerIndex }]`（原因见 §1.6）。
3. 阶段 2 顺序：物品选择页 → 炸开 → 拖拽吸合 → 三选一计分 → 关节动画 + 一句话 + STL 下载 → 顶部流程轨。
4. 体积治理：16 MB/件对移动端偏重，优先降 `faceCount` 重新生成，其次 glTF-Transform weld/simplify。
