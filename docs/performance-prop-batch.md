# 静态道具批处理与 GPU 可见性剔除

2026-09-10；目标：消除 de_dust2 网页版移动场景卡顿。全程 Vite dev 服务 127.0.0.1:27016 实测，证据在 `output/playwright/source-prop-batch-*.json`。

## 基线问题（2026-09-10 实测）

- 移动场景 draw calls 1165–1180，其中静态道具（props）占约 550 个独立绘制；
- CPU 顶点副本常驻：GLTF parse 后 position/normal/uv/index 的 ArrayBuffer 全部保留在内存，JS 堆 2509 MB；
- CDP 截图触发 `webglcontextlost/restored`，恢复时已释放的顶点数组无法重传，渲染链直接死亡；
- 移动卡顿主因：`getProgramInfoLog`（shader 编译同步等待）占主线程 55%。

## 本轮四项改动

### 1. GLTF CPU 副本释放（`game/source-prop-lighting.ts`）

`releaseSourceGLTFCPUBuffers` 清空 geometry attribute 的 `array` 引用与 GLTFLoader 缓存。约束：PVS（`filteredGeometry`）引用中的几何不释放，否则集群切换时属性无效。JS 堆 2509 MB → 1192 MB（-52%）。

### 2. 静态道具按材质合并（`game/source-prop-batch.ts`）

合并规则（`groupKey`）：

- 仅合并 `MeshBasicMaterial` + map channel 0 + 有 tint 颜色的纯不透明道具；数组材质、透明/半透明材质（依赖逐物体排序）全部跳过；
- 每顶点烘焙：世界矩阵（变换烘焙进 position）、VHV 光照地址（**vec2 纹理坐标**，非单个 float——最大地址 17,711,685 超 float32 精确整数范围 16,777,216）、tint 颜色、decal UV、propId。

效果：props 绘制从约 550 次降至约 20 次合并网格绘制，总 draw calls 1165–1180 → 592–648。

### 3. GPU 可见性剔除（合并后恢复 PVS 控制）

批处理合并后单个大网格无法按道具从场景摘除，PVS 失效，提交三角形从 210 万涨回 500 万。修复：

- 每顶点属性 `sourcePropId` + 共享 R8 纹理 `sourcePropVisibleTex`（side² ≥ 道具数）；
- PVS 集群变化时 `source-visibility-render.ts` 的 `onStaticProps` 回调把 `staticPropMask` 写入纹理（`source-dust2.ts` 接线，mask=null 时 uniform 短路为全可见，零纹理采样）；
- 顶点着色器把不可见道具的顶点投影到远平面外：`gl_Position=mix(vec4(0.0,0.0,2.0,1.0),gl_Position,sourcePropVisibleFactor())`——保持低 draw calls，剔除由光栅化前的裁剪阶段完成。

注意：`renderer.info.render.triangles` 统计提交量（batch 恒约 500 万），GPU 实际光栅化量与 nobatch 基线一致（约 210 万），以真实 rAF FPS 等价性验证（见下）。

### 4. 渲染链健壮性（`game/runtime.ts`）

- `webglcontextrestored` → 自动 reload 重建上下文（释放后的顶点数据无法重传，reload 是唯一正确恢复）；
- rAF 渲染循环熔断：单帧异常不再冻结整链，累计 `frameErrors` 供测试断言。

## 渲染一致性验证（GPU 剔除生效后）

`~/.trae-cn/work/.../ab-consistency2.mjs`，方法与结论（证据 `output/playwright/source-prop-batch-consistency.json`）：

- 6 个真实出生点机位（amber/blue 各 3 个），世界确定性冻结：`clearEffects()` 重置风动 epoch（直接置空 epoch 会使风动时间回退、每帧抛异常）、隐藏第一人称武器与 bot（动画相位逐会话不同）；
- 同一页面任务内 `toDataURL` 捕获（CDP 截图会杀上下文，禁用）；
- 结果：**5/6 机位 batch vs nobatch 像素完全一致**；amber0 仅 0.0008% 像素（约 7/921600）超阈值 8、0 像素超 32，来自 alpha 混合边界舍入；batch vs batch2 确定性对照全零。

## 移动场景主线程性能（同步 burst 驱动，消除一切 rAF 节流干扰）

证据 `output/playwright/source-prop-batch-perf.json`（GPU 剔除生效后，2026-09-10 21:14 与复测两轮一致）：

| 场景 | median | p95 | max | draw calls | programs |
| --- | --- | --- | --- | --- | --- |
| idle | 2.4–2.7 ms | 3.8 ms | 6.9 ms | 648 | 42 |
| moveW ×2 | 2.4–2.5 ms | 3.4 ms | 3.9 ms | 648 | 42 |
| strafe | 2.5 ms | 3.2 ms | 3.6 ms | 648 | 42 |
| run | 2.7 ms | 4.0 ms | 4.6 ms | 648 | 42 |
| turn（yaw 扫掠，PVS+视锥最坏情况） | 2.7 ms | 3.8 ms | 4.4 ms | 648 | 42 |

零帧超 50 ms。`getProgramInfoLog` 卡顿已消除（programs 稳定 42，shader 编译仅在首次出现）。

## 真实 rAF FPS A/B（GPU 剔除收益的直接证据）

证据 `output/playwright/source-prop-batch-realfps.json`（nobatch→batch→nobatch2→batch2 交叉两轮，各 4 场景）：

| 场景 | nobatch FPS（两轮） | batch FPS（两轮） |
| --- | --- | --- |
| idle | 34 / 35 | （rAF 预热缺口，见证据注释） |
| moveW | 48 / 5 | 40 / 40 |
| run | **2 / 2**（median 734 ms/帧） | **61 / 61** |
| turn | **3 / 3**（median 431 ms/帧） | **66 / 73** |

两个结论：

1. **nobatch 的 run/turn 卡死根因不是 draw calls，而是 CPU PVS 摘除/挂载**：移动/转头时集群频繁切换，逐个 attach/detach 数千个 prop 对象使主线程单帧 734 ms。批处理把集群切换收敛为一次 R8 纹理写入（`setVisibleProps`），该成本归零——这正是用户报告的「网页太卡跑不动」的根因修复。
2. **GPU 可见性剔除确实生效**：batch 提交 505 万三角形仍比只提交 216 万的 nobatch 快 30 倍；若剔除着色器失效（505 万全光栅化），GPU 压力不可能支撑 61 FPS。

## 遗留

- world（BSP 面片）仍 642 draw calls、天空 69——props 批处理已到收益上限，下一步如需继续压 draw calls 须合并世界几何分块；
- 动态物体（武器/NPC/特效）不在本轮批处理范围；
- `renderer.info` 无法直接读 GPU 光栅化三角形数，GPU 剔除收益以真实 FPS 等价性为准。

## release 生产版验收（2026-09-10 22:30）

批处理构建落 `release/source-r4` 后在生产服务 27019（PID 52748，非 dev server）完成真实浏览器回归：

- **USP 训练回归** `output/playwright/source-r5-usp-gameplay-batch(-final).json` passed：原版 T 手臂、原 reload/inspect 序列、VHV totalAppliedMeshes=2640、消音器门禁/弹药隔离/走蹲站全过，errors=[]。
- **双客户端 LAN 回归** `output/playwright/source-r5-lan-batch(-final).json` passed：房间创建/加入/快照同步、WebSocket 端点断言、peer 退出与清房，errors=[]。服务重启前后各一次均过。
- **全量验证链**：typecheck 0；157 文件 814/814（`output/source-r5-release-full-tests.log`）；server tsc 重编译 exit 0。
- 验收环境：Playwright 驱动切 headless（本机 headed 窗口被前台 Electron 应用遮挡，macOS 原生 occlusion 把 rAF 节流到 <1FPS 冻结模拟时钟；headless 下 WebGL2 via Metal + rAF ~60fps，headless-probe.mjs 已验证）。这是测试环境根因修复，不影响玩家真实 headed 浏览器体验。

## 10 人满员持续战斗压测（2026-09-10 23:05）

生产服务 27019（release/source-r4）上 headless Chrome（Metal GPU），1 真人 + 9 bots 满员持续战斗 10 分钟，脚本 `.trae-cn/work/6aa232450e575482663dbb51/soak-10p.mjs`（移动/开火/换弹循环；训练回合自动结束时 `restartWatcher` 重开回合保持续战，10 分钟内 4 次重开全部成功）。判据：堆增长 <5%、无页面错误、战斗持续。**PASS**：

- 帧率：10 个分钟窗全部 FPS=60（每窗完整帧数 ≈3600）；p50 16.6-16.7ms、p95 17.9-18.8ms、p99 18.6-20ms、max 45.5ms（仅首分钟预热）；全程 0 帧超 50ms、0 帧超 100ms。
- 内存：JS 堆首四分之一窗均值 1348.3MB → 末四分之一窗 1340MB = **-0.6%，无泄漏**（全程 1320-1357MB 波动）。
- 渲染：draw calls 246-611（PVS 随视角波动）、tris 3.5M-5.0M、programs 稳定 45。
- 活性：maxEventId 1479→14046 单调递增、tick ≈59.7/s、fireBursts 272、alivePlayers 6-10 真实交战波动、stalledWindows=0、pageErrors=0、frameErrors=0。
- 证据：`output/playwright/source-r5-soak-10p.json`（完整采样）、`source-r5-soak-10p-console.log`（逐分钟日志）、`source-r5-soak-10p-short.json`（2 分钟预跑）。

仍未测（不虚报）：烟火叠加满屏、低配目标设备 p95/p99。
