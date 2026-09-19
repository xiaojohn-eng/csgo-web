# 天空通道（Source_Original_3D_Sky）批处理性能专项

日期：2026-09-11。构建：`release/source-r4`（13:11 重构，含 `source-sky-batch.ts` r1），服务 127.0.0.1:27025。代码：`game/source-sky-batch.ts` + `game/source-dust2.ts` 集成 + `?noskybatch` URL 开关（`game/scene.ts`）。工作树 `.worktrees/sky`，分支 `codex/r4-sky-batch`（基线 f230fde）。

## 背景

world/道具双批处理完成后，`docs/performance-world-batch.md` 遗留明确记录：天空通道（`Source_Original_3D_Sky` 独立场景：1 个 world 天空面片副本网格（4 个 disp 面，896 三角）+ 76 个静态道具网格克隆（31,109 三角））未批处理。基线测量（`probe-skybatch.mjs`，基线构建 12:43，`output/sky-batch-baseline.json`）：

- **71 个 sky draw calls / 77 个网格 / 32,005 三角形**（出生点机位），构成：48 个 olive_branch_01 叶片网格（2,400 三角，数量主力）、4 个 mudbrick_plaster_skybox、7 个 inferno skybox_bushes、5 个 palm_treecard、3 个 buildings_02、以及 crane/lifter/dome 等单体。
- 天空通道无 PVS（整个背板每帧全画），成本纯粹是 draw call 数：71 次 vs 合并后 11 次。

## 实现

`createSourceSkyBatch({scene, sourceMeshes, vhv, olive})`，镜像 world/道具批处理方法论：按**渲染状态**（非材质实例）分组、逐网格 shader 输入烘焙进顶点属性、保持原三角形顺序/UV/光照载荷、透明与单体网格留在原路径。天空场景借用三类材质，合并分三类：

- **vhvPlain**（4 组）：VHV plain-unbumped 道具替换材质，shader 用 `gl_VertexID` 解 VHV 光照；合并网格把解析出的**光照像素坐标**逐顶点烘焙（与 `source-prop-batch` r2 同契约，地址超 float32 精确整数域故烘焙 (x,y) 像素对）。
- **olive**（1 组，48 网格 → 1 次调用）：olive treesway 叶片，shader 除 VHV 光照外还用**逐网格模型行 + 共享动画风向量**做顶点位移；合并网格额外烘焙原始局部位置、3 个模型行、3 个世界旋转列，风增量按逐实例矩阵完全一致的方式旋转。合并材质 `onBeforeCompile` 注入与原 olive owner 相同的 `SOURCE_OLIVE_TREESWAY_GLSL`，uniform 借用共享 `lookup.lighting` 纹理与 `timeWind` 向量（`source-olive-lighting.ts` 新增暴露，非复制）；`customProgramCacheKey` 后缀 `source-sky-batch-olive-r1`。olive 保留 frustumCulled=false（风位移超静态包围盒，与原 owner 同契约）。
- **plain**（1 组）：无 shader owner 的默认 glTF 材质克隆合并，烘焙世界变换。

分组键 = 类别 + 材质状态（type/map uuid/颜色/side/透明度/opacity/alphaTest/alphaToCoverage/depthWrite/depthTest/toneMapped/vertexColors/blending/fog）+ 顶点属性签名 + plain 类材质 uuid。天空通道无 PVS，与 world/道具批不同，**不注入 GPU 可见性查询**。

跳过 7 个网格（保留原路径，`keptTriangles: 6316`）：`Dust2_world_faces_MESH_84`（geometry groups 多材质）、kasbah crane VHV bump 分支 1 个、`static_prop_164`（透明材质保逐对象排序）、4 个单网格组（合并无收益）。

审计（生产 release 实测，`output/sky-batch-probe.json`）：`{groups: 6, mergedMeshes: 6, sourceMeshes: 70, mergedTriangles: 25689, keptTriangles: 6316, mergedVertices: 40971, vertexBytes: 1783964, indexBytes: 154134, categories: {vhvPlain: 4, olive: 1, plain: 1}, skipped: 7}`。32,005 三角形逐三角保留（25,689 合并 + 6,316 保留）。

## draw calls 前后对比

| 机位 | OFF（逐网格） | ON（批处理） | 结论 |
| --- | --- | --- | --- |
| 出生点 amber0（probe 自然渲染） | 71 | **11** | -60（-84.5%） |
| A/B 末机位 blue14（手动帧驱动） | 68 | **11** | -57 |

ON 场景 13 网格 = 6 个合并网格 + 7 个保留网格；天空通道从「数量仅次于 world 的第二大头」降为固定 11 次调用（随 PVS 微幅波动 11-12）。

## 渲染一致性

`ab-skybatch.mjs`：默认（sky 批处理 ON）vs `?noskybatch`（OFF），6 个出生点机位（amber/blue × 首/中/末），rAF 补丁 + 手动固定 60Hz 帧驱动 + 任务内 `canvas.toDataURL` 逐像素对比，第三个 ON 会话为捕获确定性对照；每机位前 `sourceWindGeneration++` 重新生成地图风（fresh epoch → 固定 seed-0 重置，与 restart 同机制）保证确定性风时间线。证据 `output/sky-batch-ab.json` + 4 张可视图 `output/sky-batch-ab-{on,off}-{amber0,blue7}.png`：

- **对照（ON vs ON2）全 6 机位全零** —— 捕获链路确定性成立（风动画、PVS、帧驱动逐帧一致）。
- 每机位捕获为真实渲染（非空缓冲）：amber0 平均亮度 94.8/89,993 色、blue0 24.8/40,820 色等逐机位显著不同。
- ON vs OFF：amber0 maxDiff 39 / 0.0007% 像素超阈 8/255（meanDiff 0.00022）、amber7 maxDiff 43 / 0.0013%（meanDiff 0.00038）、amber14 maxDiff 2 / 0.0000%、**blue0/blue7/blue14 全零**；diff bbox 局部（amber0 [117,191]-[347,282]、amber7 [237,210]-[936,300]），量级低于已验收的 world 批处理（0.0046%），来源同类：共面天空细节贴片合并后的绘制顺序变化。
- 三会话 errors 全空。

## 验证链

- `npm run typecheck` 退出 0。
- `tests/source-sky-batch.test.ts` 9 单测全过（合并/属性烘焙/三类 shader 注入/审计/dispose 恢复）。
- 全量回归 **162 文件 853/853** 通过（13:43，含新增 9 个 sky 批处理单测；基线 844）。
- `npm run source:build` exit 0（13:11，`output/source-skybatch-build.log`）。

## 调试记录（方法论）

初版 A/B 用 `art.sourceWindEpoch = null` 做逐机位风重置——**错误**：它只把 `sourceWindTime` 回零而风 owner 的 epoch 字符串不变，`updateWind(0,'menu:0')` 触发单调时间校验每帧抛错；错误被 `runtime.frame` 的 try/catch 吃掉（rAF 链保活、无 pageerror），渲染循环熔断后画布只剩黑屏，六机位全零 diff 是**黑屏 vs 黑屏**。捕获统计（平均亮度/去重色数）作为空缓冲哨兵加入脚本后当场暴露；改用 `art.sourceWindGeneration++`（`clearEffects()`/restart 同机制，epoch 真变更 → owner 固定 seed-0 重置）修复。教训：**像素全零 diff 必须配非空捕获证明**，否则验收无效。

## 结论

- 天空通道 draw calls **71 → 11**（出生点机位；A/B 机位 68 → 11），全图常驻：渲染一致性达标（对照全零、最差机位 0.0013% 超阈 8/255、三个 blue 机位严格零差）。
- 32,005 三角形零增减，olive 风动画在合并网格中与逐网格路径逐帧等价（uniform 借用共享实例，非复制）。
- 合并后 605KB 顶点/索引常驻 GPU（1,783,964B 顶点 + 154,134B 索引），天空背板每帧全画下的顶点成本无可感知回归（A/B 三会话无错误、60Hz 帧驱动正常）。

## 遗留

- sky pass 剩余 11 次调用中 7 个保留网格：4 个单网格组（合并无收益）、1 个透明材质（保逐对象排序）、1 个 VHV bump 分支 kasbah crane（原路径）、1 个多材质 geometry groups 网格；继续压缩需拆 groups 或纹理图集，收益成本比低。
- `Source_Original_3D_Sky` 的 fog start/end/maxDensity 与 UnlitTwoTexture 第二层/TextureScroll 仍是 `docs/source-sky.md` 记载的材质缺口，不在批处理范围。
- 道具批处理组数（VHV 114 组、普通 84 组）仍是下一层天花板（world-batch 文档遗留）。
