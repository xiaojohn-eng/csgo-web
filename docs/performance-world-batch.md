# World（BSP 面片）批处理性能专项

日期：2026-09-11。构建：`release/source-r4`（23:55 重构，含 `source-world-batch.ts` r1），服务 27019（PID 3473）。代码：`game/source-world-batch.ts` + `game/source-dust2.ts` 集成 + `?noworldbatch` URL 开关（`game/scene.ts`）。

## 背景

道具双批处理（VHV `source-prop-batch` / 普通 `source-plain-prop-batch`）完成后，world 通道仍按原始 glTF 网格逐个绘制，且 PVS 集群切换时 CPU 对 world 面片做逐三角形重过滤（`selectTriangles` 重建几何），单次切换 2.6–5.5ms。此前文档记载「world（BSP 面片）仍 642 draw calls」——本轮审计证实该数字是把繁忙视角的**全场景** draw calls（soak 实测 246–611 随视角波动）误归因给了 world：world 场景实际只有 85 个网格（82 不透明 + 3 透明）。

## 实现

`createSourceWorldBatch(root, {excludedFaceIds})`：

- 按**材质状态**（基础纹理 uuid、lightmap uuid、颜色、side、透明度、alphaTest、depth 状态、toneMapped、fog）+ 顶点属性签名分组，82 个 `MeshBasicMaterial`+HDR-lightmap 网格 → **56 个合并网格**（302,202 三角形）。
- 世界变换与逆转置法线烘焙进顶点属性；`uv2`（Source face id）重编码为 `sourceFaceId` 顶点属性。
- PVS 可见性走 GPU 逐顶点查询（与道具批处理同一契约：faceId → 共享 R8 纹理最近采样，不可见面投影远平面外），`onBeforeCompile` 链在 HDR lightmap 解码注入之后，`customProgramCacheKey` 后缀 `+source-world-batch-r1`。
- 天空通道借用的面片 id（`excludedWorldFaceIds`）常驻 texel 0 保持剔除；3 个透明材质网格跳过合并（保逐对象排序）。
- `setVisibleFaces(mask, firstFace)` 把 PVS 集群切换收敛为一次纹理写入；原 82 网格从场景摘除（dispose 可恢复），随后 CPU 顶点释放照常回收原几何。

审计（生产 release 实测，`probe-worldbatch.mjs`）：`{groups: 56, sourceMeshes: 82, mergedTriangles: 302202, faceCount: 9792, faceTextureSide: 99, skipped: {transparent: 3}}`。

## 渲染一致性

`ab-worldbatch.mjs`：默认（world 批处理 ON）vs `?noworldbatch`（OFF），6 个出生点机位（amber/blue × 首/中/末），确定性冻结 + 手动帧驱动 + 任务内 `canvas.toDataURL` 逐像素对比，第三个 ON 会话为捕获确定性对照。证据 `output/playwright/source-worldbatch-ab.json`：

- **对照（ON vs ON2）全 6 机位全零** ——捕获链路确定性成立。
- ON vs OFF：最差机位 amber7 有 0.0046% 像素超阈 8/255（meanDiff 0.0044），其余机位 ≤0.0021%；量级与已验收的普通道具批处理一致，来源为共面细节贴片在合并后的绘制顺序变化。
- 逐机位 draw calls：on 248–370 vs off 257–370（出生点视角平均约 −6；world 最坏情况 85 → 59 个调用）。

## 性能 A/B（NAV 路线横穿全图）

`perf-worldbatch-ab.mjs`：页面内对原版 NAV 区域图（1118 areas，connection 边、不含梯子）做 BFS，在图上两个最远区域间来回步行（按键驱动，游戏自身模拟循环与碰撞生效；直接传送 sim.x 会被权威训练模拟回写、直线路点会撞墙——均已实测排除），90 秒 × OFF/ON 交叉两轮，含对局结束自动 restart。证据 `output/playwright/source-worldbatch-perf.json`。

| 指标 | OFF（CPU 逐三角重过滤） | ON（GPU 逐面剔除） | 结论 |
| --- | --- | --- | --- |
| 集群切换 applyMs p50 | 2.9 / 2.7 ms | **0.2 / 0.3 ms** | ~10 倍降低 |
| 集群切换 applyMs max | 5.0 / 5.2 ms | **0.5 / 0.5 ms** | 峰值消除 |
| 会话累计 applyMs（90s） | 95 / 94 ms | **12 / 11 ms** | -88% |
| FPS（四会话） | 60 / 60 | 60 / 60 | 无回归 |
| 帧时间 p95 / p99 | 17.7-17.9 / 18.9-19.7 ms | 17.7-17.9 / 18.3-18.8 ms | 无回归 |
| 超 50ms 帧 | 0 / 0 | 0 / 0 | 无回归 |
| 集群切换次数 | 32 / 34 | 50 / 40 | 均真实横穿全图（会话间机器人对局节奏不同致次数差异） |
| 位移跨度 | 71×54 m / 53×54 m | 60×80 m / 64×52 m | NAV 路线生效 |
| 采样 draw calls | 282-421 | 277-405 | ON 略低 |
| 提交三角形 | 5.3-6.5M | 5.4-6.6M | 常驻提交 302k world 三角无感知成本 |
| JS 堆 | 1359-1377 MB | 1359-1391 MB | 稳定 |
| 页面错误 | 0 | 0 | — |

（每格两值为两轮交叉会话；queryMs 两臂均 p50≈0/p95 0.1ms，PVS 查询本身不是瓶颈。）

## 结论

- **主收益**：PVS 集群切换的 world CPU 重过滤成本 **p50 2.7-2.9ms → 0.2-0.3ms、max 5.2ms → 0.5ms（约 10 倍 / -90%）**，90 秒会话累计 94-95ms → 11-12ms。移动/转头时集群连续切换场景下主线程更平滑（此前一轮少切换会话中 OFF 曾出现 83ms 单帧尖峰，ON 无）。
- **无 GPU 回归**：合并后 world 几何常驻提交（302k 三角形全过顶点着色器，不可见面顶点投影远平面外），四会话全部 60FPS、p95≤17.9ms、0 帧超 50ms，与 OFF 逐帧等价。
- **draw calls 次要改善**：world 最坏 85 → 59；出生点机位平均约 -6（248-370 vs 257-370）。此前文档的「world 642 draw calls」为全场景口径误归因，已在本档更正。

## 遗留

- 道具批处理组数仍是下一层天花板：VHV 道具 114 组、普通道具 84 组（按材质实例分组），继续压缩需纹理图集或材质状态合并，收益/成本比待评估。
- 天空通道（`Source_Original_3D_Sky` 独立场景，世界天空面片副本 + 全变换道具克隆）已在本档之后批处理完成（71 → 11 draw calls），见 `docs/performance-sky-batch.md`。
- 3 个透明 world 网格（木天花板/天线牌/卫星锅牌，共 105 三角形）按设计保留逐对象排序。
- 动态物体（武器/NPC/特效）不在批处理范围。
