# Dust2 map owner：原 foliage 静态光与动态风接入

2026-09-09。此轮把已分别验证的 70 个 palm/sumac 原 foliage shader、原 VHV 三路静态光与 `env_wind` 状态机接入实际 `loadSourceDust2` owner。原 R5 材质分支与数值保持不变；没有修改 Scene、服务器、生产运行端口或进行生产构建。

## 调用合同

```ts
const map = await loadSourceDust2({
  sky: true,
  propLighting: {
    maxTextureSize: renderer.capabilities.maxTextureSize,
    enablePlainUnbumped: true,
    enableDecalMultiply: true,
    enableTintMask: true,
    enableTintDecal: true,
    // enableFoliage: true 是有 propLighting 时的新默认值。
    // 显式 false 可恢复原 R5 基线，不请求 foliage 文件。
  },
});

map.updateWind(levelTime, epoch);
map.windSnapshot(); // JSON 可读的当前 epoch/clock/原风状态，用于审计。
map.dispose();
```

`levelTime` 是当前客户端视觉 epoch 的单调秒数；每个新菜单/房间 epoch 从 0 开始，不能直接传有跳跃的 authority/server 时间。新 epoch 显式建立 `seed=0, startTime=0, initialDirection=0, initialSpeed=0`，其中 startTime 0 表示新时钟零点，不声称恢复某个已经运行的原游戏连接历史。相同 epoch 不更换随机种子。

每帧都向 shader 提交 float32 `levelTime` 和原 `renderParameter3.xy`；仅达到原 `nextThinkTime` 时才推进风状态机。它不使用 `currentWind` 代替两秒 sway 缓存的插值结果，不用固定风或 `Math.random()`。离线暂停可重复相同时间；在线继续计时是调用方的策略。根任务已按此合同接入 Scene，本文 GPU 验证的是 map owner 的独立实际入口，没有把根任务的生产联机验证计入本轮。

同一 epoch 倒退、非法 epoch、非有限/负时间、超过 1,000,000 秒、与上次已采样状态超过 300 秒的间隔会在改变状态和 uniform 前抛错。新 epoch 从 0 初始化也保留 300 秒上限。长暂停应保持视觉时间不动，或建立明确的新 epoch；此处不伪造被省略的历史 think 调用。普通 JSON 风状态的恢复接口仍由 `source-wind.ts` 提供。

## 资产与生命周期

复用根任务已 stage 的 `public/source/csgo-12426148/dust2/vhv/foliage/`，本轮逐文件 SHA256 回读通过。合计 2,258,531 bytes：

| 文件 | bytes | SHA256 |
| --- | ---: | --- |
| manifest.json | 196 | a1ced706b85dc450a1193428855c938a5c2fe10dd04a39fd23f8c001fd06a5ab |
| bindings.json | 121751 | f03c5655f5fe5e5713cffdedc948f0b6078a420aed0cbcde2e98cbbb23d5c058 |
| remap.u32 | 88304 | 433f06cbcc106dea3442439cff6ee4d780c685bb6abafa634f49e7d4c243433e |
| lighting.bin | 2048280 | 29d97fc8ecb895f20bb63fe760d5f891a81728d66505bd1d25f42b664c2d1d18 |

`propLighting.foliageBaseURL` 可覆盖目录，默认从 map manifest 旁解析 `vhv/foliage/`。SHA、几何属性、索引和原实例矩阵验证继续严格执行；70 mesh coverage 不符合便回滚整个 map owner。原几何不修改、不近邻匹配、不改变 alphaTest .3、DoubleSide 或原底色。R5 的 `appliedMeshes=2325` 保留，新增 `totalAppliedMeshes=2395`；`stats.foliage.meshes=70`、`stats.wind.enabled=true`。

独立 foliage audit 中 `envWindStateSimulation=false` 仍正确描述叶片模块自身不持有风状态机；map 层的 `stats.wind` 才描述本次组合 owner 的动态风。避免把独立模块与组合 owner 的证据混为一项。

失败/退出按逆序释放 root、PVS、sky、wind、foliage、R5、HDR 与原 GLTF。风 owner 先失效，叶片 owner 恢复原 material/frustum 状态并释放 lookup texture，最后才销毁 GLTF 缓存。已覆盖 foliage 下载校验失败，以及叶片已绑定后 PVS 身份拒绝的完整回滚。保持原 3158 个 static prop 身份与 sky 排除规则；关闭 PVS 并不把已经由 sky owner 单独拥有的 75 个 props 重复放回主 pass。

## 实际 GPU 验证

私有入口：`http://127.0.0.1:27018/assets/source-exports/dust2-wind/preview.html`。源码 `scripts/preview-source-map-wind.ts`，仅构建私有 JS，不触生产 bundle。使用实际 `loadSourceDust2`、staged 原资产、现有 sky owner 和相同双 pass render 路径。独立 headless Chromium session `csgo-map-wind-r1`；1280×720、DPR1、固定相机和曝光。

收据：`output/playwright/source-map-wind-gpu.json`，SHA256 `6904b1fec05bfda7f9b3de415b91a8c6c1bbf10df4e397672fb729658a78f012`。它记录源文件/私有 bundle 哈希、全部截图哈希、实际 WebGL `gl.getUniform`、完整可恢复风状态、PVS 与资源计数。

- R5：2325 meshes。R6：原 2325 + 70 = 2395；原叶片 geometry/instance 验证通过。
- t=0→8 按 60 Hz 更新，70 个已编译叶材质实际 GPU uniform 都为 `[0,8,1.700953722000122,-0.20660918951034546]`，后两项精确等于原 `renderParameter3.xy`。
- t=8 连续重复 20 次：完整风状态与双 RNG 完全不变；暂停截图与 t=8 截图逐像素一致。
- epoch 改变并回 t=0：完整风状态精确恢复初始值；截图也与最初 t=0 逐像素一致。
- PVS 开启时 mapped props 3158、unknown anchors 0、主 pass 可见 1312；关闭时主 pass 3083，另外 75 仍由原 sky owner 排除。没有改变 PVS/LOD 身份。
- R5 和 R6 卸载均回到预览环境空基线：geometry 0 / texture 2 / program 0；R6 wind disposed=true。两张 texture 属于仍存活的预览环境。当前被记录的验证过程 `errors=[]`。
- 初次私有 HTML 的 importmap 写错 `/vendor/three` URL，曾产生 404；修正为 `/vendor/three/build/three.module.js` 和对应 addons 后全新载入，再开始本收据。历史预检错误没有被混称为成功 run。

已亲自查看所有九张截图：

| 比较 | 改变像素 / 921600 | 观察 |
| --- | ---: | --- |
| R5 / R6 T 出生同机位 | 14866 | 棕榈叶原烘焙暗部恢复；既有箱体/墙体分支保持 |
| R5 / R6 棕榈近景 | 290154 | 叶背的奶白亮面恢复为原深棕/绿色静态光 |
| R5 / R6 sumac 近景 | 73560 | 下层叶片与枝条暗部恢复，原 alpha 边界保留 |
| R6 棕榈 t=0 / t=8 | 247649 | 原树摆几何在实际 shader 中随时钟和风状态变化 |
| R6 t=8 / 重复暂停 | 0 | 暂停稳定 |
| R6 t=0 / 新 epoch t=0 | 0 | 确定性复位 |

截图路径为 `output/playwright/source-map-wind-{r5,r6}-{t,palm,sumac}.png`，以及 `source-map-wind-r6-palm-{wind8,paused,reset}.png`。

## 验证范围与边界

`output/source-map-wind-final-tests.log`：6 files / 24 tests 通过，包含原 wind、foliage、loader 和新增 map-wind/真实 map owner 生命周期测试。新增 8 项覆盖 think 调度、重复 float32 时间、epoch、拒绝倒退/超长断点、显式 R5、加载失败和 PVS 后置失败的回滚；最终全量 TypeScript 检查 exit 0（`output/source-map-wind-typecheck.log`）。未重复已经完成的原 native wind 或树摆几何 oracle。

原指令依据和之前逐字段零误差 native 对照在 `research/source-wind.md`，原叶片 shader/VHV 证据在 foliage 研究文件。本次是组合 owner 的生命周期、时间、GPU 消费与视觉差异验收。未有原游戏同机位/同曝光对照，不称最终原作外观。其他尚未支持的植被分支、现存远景/背景缝隙、完整天空云层效果不在此轮范围内。
