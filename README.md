# 无名件 · Anonymous Part

> 把一句话藏进一件东西的零件里。收件人得亲手把它拆开，才读得到。

群核 Aholo 全球 3D AI 黑客松参赛作品。拍照 → Aholo Lux3D `imgTo3D` 生成带材质的 3D 模型 → `partSplit` 按结构拆成独立零件 → 你写一句话、封进最里面那块 → 生成一条包裹链接寄出去。

收件人打开链接，只看得到一件没有颜色、没有标签的墨色剪影；每拽下一块，那块当场恢复原色。拆到最里面，纸条才抽出来。

---

## 在线体验

| 入口 | 地址 |
|---|---|
| 线上体验（Vercel） | https://chai-le-ji-gei-ni.vercel.app |
| 拆件台 / 寄件端 | https://chai-le-ji-gei-ni.vercel.app/live |
| 收件拆件（示例包裹） | https://chai-le-ji-gei-ni.vercel.app/p/lamp · /p/radio · /p/fan |
| 成片（139 秒全流程） | [docs/demo/wumingjian-demo.mp4](docs/demo/wumingjian-demo.mp4) |
| 项目报告书 | [docs/无名件-项目报告书.pdf](docs/无名件-项目报告书.pdf) |

> 线上版本已接好三个真实生成出来的包裹（台灯 / 收音机 / 台扇），可直接拆。现场"拍照即生成"需要 `AHOLO_API_KEY`，仓库不自带密钥。

## 怎么玩

1. 打开 `/live`，拍照或选一张物体照片，点「拆成无名件」。
2. 等生成：`imgTo3D` 出带材质模型，`partSplit` 按结构拆件（几十秒到一两分钟）。
3. 写一句话，选一块作为"藏话的那块"，封装成链接。
4. 对方打开 `/p/<码>`：墨色剪影 → 一块块往外拽 → 最后一块抽出纸条 → 可回信 `/r/<码>`。
5. 摊开后点「下载 STL 去打印」：每块一个 STL（几何中心归零），导入切片软件即可打印——这封信可以变成桌上的实物。

### 手势

摄像头手势（MediaPipe Hands），也支持鼠标操作：

| 手势 | 动作 |
|---|---|
| 张开手掌并停 0.78 秒 | 分解：模型炸开成零件 |
| 合掌 / 握拳并停 0.62 秒 | 拼接：零件归位 |
| 捏合（拇指+食指） | 抓住某一块往外拽 |
| 静止悬停 | 高亮当前可抓的那块 |

## 技术

- Next.js（App Router）+ three.js 渲染，MediaPipe Hands 手势输入
- 群核 Aholo Lux3D：`imgTo3D`（图生 3D）+ `partSplit`（结构拆件），产物为 GLB，直连回源 URL 不落盘
- 拆件数据 = 零件几何分组 + 拆装顺序；顺序错会留"撬痕"（视觉反馈）
- 打印：`STLExporter` 客户端导出，每块按自身几何中心归零、独立成文件（台灯那件 7 个文件共 13.2MB）
- 真实生成任务号（可回溯）：`imgTo3D` 8319460 / `partSplit` 8320440；历史件 8235025、8310067、8310695

## 本地运行

```bash
npm ci
npm run dev      # http://localhost:3000
# 或
npm run build && npx next start -p 3000
```

可选环境变量：

```
AHOLO_API_KEY=      # 配了才有"拍照即生成"，不配只跑三个现成包裹
NEXT_PUBLIC_DEMO=1
```

## 目录

```
app/live/            拆件台（95 窗口工位，寄件端）
app/p/[code]/        收件拆件
app/r/[code]/        回信
components/          LockProto（拆装核心）、HandInput（手势）
public/items/        三个已生成包裹的 GLB 与拆件数据
docs/                报告书、成片、过程截图
```

## 已知限制

- 现场"拍照即生成"是分钟级任务：线上以轮询任务状态呈现，不在请求里同步等待。
- `*.vercel.app` 在境内部分网络不可直连；评委如打不开，请以仓库内成片与报告书为准，或本地 `npm run dev` 复现。
- 手势对光线和手部距离敏感，鼠标/触控同样可完成全部操作。
