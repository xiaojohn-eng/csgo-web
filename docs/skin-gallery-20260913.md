# 原版皮肤列表图片补齐（2026-09-13）

原来的皮肤选择器对所有原版涂装显示相同的通用枪形 SVG，只能点击之后看枪上的材质。本次列表直接显示本地原版库存 PNG，并提供中英文搜索、数量、已装备状态、懒加载和图片加载失败提示。Source 武器入口压缩为两列，让桌面进入武器库即可看到图片卡片；窄面板的图片列表变为两列。

## 原图与对应关系

从本机原版 VPK 原样导出 238 张涂装图和 6 张默认枪械图，均为 512 × 384 RGBA PNG，共 19,079,428 字节。按原始 `alternate_icons2/icon_path` 与武器、paint kit 双重关系定位，独立校验器重新读取 VPK、逐张核对字节、PNG CRC、RGBA 像素和目录映射。

| 武器 | 含默认的图片数 |
| --- | ---: |
| AK-47 | 46 |
| M4A4 | 40 |
| Glock-18 | 46 |
| USP-S | 36 |
| Desert Eagle | 36 |
| AWP | 40 |

资源：`public/source/csgo-12426148/skin-previews-20260913/`。目录索引 SHA-256：`828cc7d5d1f089714a863552d8db3bc9b06a2967b43a4e069d790cb98505e7cb`。

这些是原版的固定库存展示图，图案编号和磨损的变化继续在三维检视中展示。AWP 原图自身存在的左侧枪管裁切保留，网页使用 `object-fit: contain` 不再额外裁切。

## 并行方式

图片资源、React 列表界面、独立核验分别在三个工作树中完成，按文件所有权隔离后合并。集成阶段继续并行修复磨损边界和准备双客户端验收；主工作区负责最终布局、真实浏览器和 R4 构建部署。

## 验证证据

`output/skin-gallery-2026-09-13/` 保存：

- `assets-qa.json`：244 / 244 原图、映射及完整像素核验通过。
- `assets-visual-review.json`：六把默认武器及代表涂装的图片目视核验。
- `browser-qa.json`：六枪图片数量/路径，中英文搜索后装备、空结果、滚动到底的懒加载。
- `responsive-qa.json`、`gallery-narrow.png`：400px 视口下两列，无皮肤网格横向溢出。这是列表布局验证，不是手机操作适配承诺。
- `typecheck.log`、`lint.log`、`build.log`：集成类型、静态检查与构建。

导出和复核脚本：`scripts/export-source-skin-previews.py`、`scripts/verify-source-skin-previews.ts`。共享磨损参数的真实双客户端回归脚本为 `scripts/verify-source-finish-gallery-lan.ts`，只创建和退出自己的测试房间。

## 同轮发现并修复的磨损边界错误

原流程先按双精度目录边界接收磨损，再将输入转为 float32；运行时、渲染器和服务端重复校验时，`Math.fround(.06)` 小于 `.06`、`Math.fround(.8)` 大于 `.8`，合法的原端点被拒绝。当前目录有 42 个下限和 93 个上限会触发此问题。修复 `source-weapon-finish.ts` 与实际组合参数入口 `source-redline-seed.ts`，统一在原 float32 表示域校验，不改变图案随机序列或材质公式。

- `finish-regression.log`：5 文件 49 项测试通过，包含 238 款 min/max/mid 幂等、JSON 回传和 476 个实际组合参数端点；边界外的相邻 float32 仍拒绝。
- `wear-gpu-lower.json`、`wear-gpu-upper.json`：真实浏览器 AK14 最低 `.06` 与 AK707 最高 `.8` 均加载完成，帧异常与 WebGL 错误均为 0。
- `finish-lan-candidate.json`、`finish-lan-production.json`：候选及更新后的正式 R4，各完成 7 步双客户端权威快照检查，覆盖序列化端点、玩家之间互不串皮肤及双方恢复默认。测试房间已退出清理。该验收使用本机回环与实际 LAN 网卡上的两个 SDK 客户端，不代表第二台物理设备的浏览器验收。

## 已部署

2026-09-13 更新 R4 前后端，应用代码为 `3cd102d`，运行实例 `37f3048c-daf4-4b23-bfad-31d3f0b24c5f`。本机 `http://127.0.0.1:27019/?map=de_dust2`，局域网 `http://192.168.1.100:27019/?map=de_dust2`。地址与实例可能随网络/重启变化，以 `/api/server-info` 和 `/health` 为准。

`production-assets-http.json` 证明 244 张图片通过实际 LAN HTTP 返回且 SHA-256 正确。`production-browser.json` 与 `production-gallery.png` 记录正式页面的图片、真实装备和默认恢复。回退保存在 `release/source-r4-before-skin-gallery-20260913`，旧散列静态文件保留可供尚未刷新的页面使用，R3 文件未改动。

这次完成的是皮肤列表和上述装备边界错误；完整 CS:GO 渲染、动画与物理还原的其他差异仍以此前还原度报告为准。
