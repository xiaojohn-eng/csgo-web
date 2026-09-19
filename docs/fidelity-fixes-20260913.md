# 2026-09-13 画面与建模修复

本轮已继承 Trae 更新并修复地图标识、电线、世界分层材质、原枪械材质和皮肤、原手雷模型、尸体朝向、死亡掉枪及烟雾生命周期。完整回归 **232 个文件、1428 项全部通过**；足部严格贴地保留部分完成，R4 已部署，同机回环/LAN 双地址 SDK 联机已通过。两物理设备尚未验收。

冻结基线：`eb17a2c094eff40733c2da1040d697d7e898babd`；保留标签 `fidelity-audit-baseline-20260913`。原审查图片保持不变，所有后续截图和回执存于 `output/fidelity-fixes-2026-09-13`，各图属于本轮不同阶段。

[可拖动的三机位修复前后图](/path/to/csgo-web/output/fidelity-fixes-2026-09-13/review.html) · [完整文字报告](/path/to/csgo-web/output/fidelity-fixes-2026-09-13/report.md)。

## 生产版本与联机

生产 R4 已以 4ae0168 更新至 27019，并保留回滚目录；新实例健康回读成功。两个真实 Colyseus SDK 客户端从同一物理机分别连接回环和 LAN 网卡，完成建房/加入、购买、自然结束冻结期、射击事件同步与正常退出。两个客户端均无错误，实际共用同一服务实例；两物理设备和双浏览器手工操作尚未验收。 [部署回执](/path/to/csgo-web/output/fidelity-fixes-2026-09-13/deployment.json) / [SDK 联机回执](/path/to/csgo-web/output/fidelity-fixes-2026-09-13/sdk-lan.json)。

[本机游戏](http://127.0.0.1:27019/?map=de_dust2) · [局域网游戏](http://192.168.1.100:27019/?map=de_dust2)。

生产页面主渲染器已就绪，最终 M4A4 #695 原法线皮肤在完整持枪姿态实际绘制，frameErrors=0、glError=0；颜色1024²/指数256²、11/9级 mip。 [生产 GPU 回读](/path/to/csgo-web/output/fidelity-fixes-2026-09-13/r4-browser-final.json) / [M4A4 完整持枪图](/path/to/csgo-web/output/fidelity-fixes-2026-09-13/m4a4-complete-final.png)。

## 实施与已归档证据

| 项目 | 本轮结果 | 证据与适用范围 |
|---|---|---|
| 地图标识与电线 | 原壁画、A/B 标记、喷漆、电线链和原风场恢复。 | 三组网页 A/B；原 BSP 与执行原代码的绳索回执。 [证据](/path/to/csgo-web/tests/fixtures/source-rope-native-hang.json) |
| 世界材质与 mip | 原双层混合、方向性法线光照、位移面 alpha 字节；三种审查石材/屋檐用原 mip。 | 85 材质 CPU 绑定；三机位 glError=0。6 纹理/57 低级 mip 仅对应三种审查材质，不扩称全地图逐项 GPU 覆盖。 [证据](/path/to/csgo-web/research/source-world-layer-binding.json) |
| 天空、雾与曝光 | 原第二层云、滚动、独立雾控制、太阳遮挡、HDR 与自动曝光链路接入。 | 太阳/地图实际阶段截图与专项；尚需原客户端同条件核对最终明暗。 [证据](/path/to/csgo-web/output/fidelity-fixes-2026-09-13/depth-sun-tests.log) |
| 六枪默认材质 | 12 份原 VMT 分别应用；AWP albedoTint/40、枪体/镜片 mask、Fresnel、tint。 | 原 VMT 字节；16 个原 BSP HDR 反射探针/6 原 mip；46 组原 ambient 执行对照。 六枪默认→皮肤→默认主 GPU 回读 6/6 恢复原材质对象，glError=0。 [证据](/path/to/csgo-web/research/source-default-weapon-materials.json) |
| 238 张皮肤 | 原比例、低因子、normal、零 albedo、RGBA 调色板与默认恢复。 | 234+4 两批 GPU QA，无重叠，errors=0。颜色256²/指数128²，当前目录涉及8种 style。六枪1024²/256²真实draw在本页另列。 [证据](/path/to/csgo-web/output/paint-styles-preview/proof-2026-09-13T07-18-13-384Z-1.json) |
| 合成颜色/指数 mip | 手动实现原 gamma、取样源级与 RGBA8888 生成。 | 7 个原代码执行夹具、31 级未压缩字节；不包含最终 DXT 压缩或原客户端 GPU 底图。 [证据](/path/to/csgo-web/research/source-paint-mips.json) |
| 原手雷和死亡掉枪 | 三种手雷独立原模型；六枪从手部框架分离，携带弹匣/消音器和涂装状态。 | 三手雷 GPU；原地图两队三类 6/6 输入投掷、姿态序列化、接触/反弹通过；T 实际尸体与独立 AK 均休眠。掉枪24输入中21个当前分支实载验SHA，另外3个未用材质不计GPU覆盖。 [证据](/path/to/csgo-web/output/fidelity-fixes-2026-09-13/death-drop-integration.json) |
| 尸体、脚部与阴影 | 刚体朝向驱动；用可见加权几何取包络，消除远处辅助骨骼影响；Detached 位移修正。 | 可见加权几何安全包络和生命周期通过；脚部仅部分完成：CPU T 残余 -7.73mm、CT +1.85cm。原骨长保持；两处GPU各60帧漂移0、glError=0。物理解算器非原VPhysics。 [证据](/path/to/csgo-web/output/fidelity-fixes-2026-09-13/bounds-integrated-tests.log) |
| 烟雾、火花与深度 | 原步枪/AWP子系统、烟雾弹PCF、SpriteCard色彩、独立柔化深度；接入原地图局部采光。 | 主 GPU 0.45/2/18/25/32秒全 glError=0，32秒粒子归零；30个出生点60次CPU采光查询通过。完整原引擎 trace/动态光仍有边界。 [证据](/path/to/csgo-web/output/fidelity-fixes-2026-09-13/particle-lighting-map.json) |
| 渲染性能与所有权 | PVS索引在GPU提交前裁剪；阴影只画caster子树；探针跳过隐藏/错误层/覆盖通道，实例保留独立参数。 | 实际PVS提交量、材质/阴影专项。没有把单帧计数換算为通用FPS提升百分比。 [证据](/path/to/csgo-web/output/fidelity-fixes-2026-09-13/t-pvs-final.json) |

六枪目录 238 组武器/涂装键由 234+4 两批实际 GPU 合成覆盖，联合键无重叠、错误 0；该 QA 使用颜色256²、指数128²，当前目录实际涉及8种 style。[首批234](/path/to/csgo-web/output/paint-styles-preview/proof-2026-09-13T07-18-13-384Z-1.json) / [剩余4](/path/to/csgo-web/output/paint-styles-preview/proof-2026-09-13T07-35-24-689Z-2.json)。六枪随后在主游戏使用原法线、颜色1024²/指数256²、11/9级 mip 真实绘制，六张图片与回读见完整报告；这是受控诊断 draw，不能扩称238张全部实玩已逐张验收。

六枪随后逐一完成默认 → 法线皮肤 → 默认，exactDefaultMaterialOwnersRestored 全为 true；皮肤和恢复两阶段 glError 均为 0。 [默认恢复 GPU 回执](/path/to/csgo-web/output/fidelity-fixes-2026-09-13/six-default-restored.json)。

三姿态尸体诊断均无绘制错误；后续 T 阵营实际模拟死亡的尸体和独立 AK 均休眠，枪与人体在同一完整画面可辨认。[实际死亡与掉枪图片](/path/to/csgo-web/output/fidelity-fixes-2026-09-13/death-drop-amber-vandal.png) / [GPU 回读](/path/to/csgo-web/output/fidelity-fixes-2026-09-13/death-drop-amber-vandal.json)。掉枪的21是当前分支实际加载并验SHA的文件数（runtime目录24输入中的21），不是世界分层资源数；未使用的3个bodygroup材质不计GPU覆盖。

## 投掷、烟雾和局部采光

在原地图两队出生点，用实际 Simulation 输入分别投掷 HE、烟雾和闪光，6/6 通过接触、反弹、引爆与 MessagePack 姿态往返；覆盖 CT 的负世界高度。服务器烟雾遮挡半径在末段从 3.5 m 缩至约 0.039 m 后移除。此记录不等于实际 LAN 传输，也不等于原 VPhysics 弹道。 [原地图投掷 CPU 回执](/path/to/csgo-web/output/fidelity-fixes-2026-09-13/grenade-integration.json)。

新版烟雾使用相同街面机位，0.45 / 2 / 18 / 25 / 32 秒实际粒子依次为174 / 174 / 84 / 10 / 0；五帧 glError 均为0，32秒事件也归零。[0.45秒图](/path/to/csgo-web/output/fidelity-fixes-2026-09-13/smoke-final-0.45s.png) / [回读](/path/to/csgo-web/output/fidelity-fixes-2026-09-13/smoke-final-0.45s.json)；[2秒图](/path/to/csgo-web/output/fidelity-fixes-2026-09-13/smoke-final-2s.png) / [回读](/path/to/csgo-web/output/fidelity-fixes-2026-09-13/smoke-final-2s.json)；[18秒图](/path/to/csgo-web/output/fidelity-fixes-2026-09-13/smoke-final-18s.png) / [回读](/path/to/csgo-web/output/fidelity-fixes-2026-09-13/smoke-final-18s.json)；[25秒图](/path/to/csgo-web/output/fidelity-fixes-2026-09-13/smoke-final-25s.png) / [回读](/path/to/csgo-web/output/fidelity-fixes-2026-09-13/smoke-final-25s.json)；[32秒图](/path/to/csgo-web/output/fidelity-fixes-2026-09-13/smoke-final-32s.png) / [回读](/path/to/csgo-web/output/fidelity-fixes-2026-09-13/smoke-final-32s.json)。这些是受控原PCF生命周期 GPU 证据，和服务器16秒遮挡半径的 CPU 记录分开解释。

30 个原出生点完成 60 次查询（30 次首次计算、30 次缓存命中），使用原 leaf ambient、26 盏静态 worldlight 与照明遮挡几何；不是简单求 ambient 均值。主游戏新版烟雾已接该模块，完整原引擎 trace、动态光源与缓存时序尚未等价核对。 [30出生点采光回执](/path/to/csgo-web/output/fidelity-fixes-2026-09-13/particle-lighting-map.json)。

## 足部：部分完成

以原角色 GLB 的右脚权重 >0.5 顶点，逐顶点查询原地图地面；冻结 Run 0.45 姿态，不把脚骨高度冒充鞋底接触。T 的最低间隙从 +6.47 cm 改为 -7.73 mm（轻微穿入）；CT 从 +12.58 cm 改为 +1.85 cm，受原腿长限制仍悬空。该项保留“部分完成”，不声称完美贴地。

[测量原始记录](/path/to/csgo-web/output/fidelity-fixes-2026-09-13/foot-contact-cpu.json)保留原模型SHA、原碰撞SHA、鞋底顶点、原始/修复后测值和腿长误差。该结果来自两个冻结姿态的CPU诊断；尚未补齐原压缩 IK 误差曲线和接触锁定，不把有限姿态改善描述为全状态原版等价。两处最终 GPU 固定姿态均60帧、maxLocalTransformDrift=0、glError=0；这不消除上述严格接触残余。[T 阵营 · 坡面脚底近景](/path/to/csgo-web/output/fidelity-fixes-2026-09-13/foot-contact-final-0.png) / [回读](/path/to/csgo-web/output/fidelity-fixes-2026-09-13/foot-contact-final-0.json)；[CT 阵营 · 坡面脚底近景](/path/to/csgo-web/output/fidelity-fixes-2026-09-13/foot-contact-final-1.png) / [回读](/path/to/csgo-web/output/fidelity-fixes-2026-09-13/foot-contact-final-1.json)。

## 最终验收

| 最终事项 | 当前状态 | 证据与范围 |
|---|---|---|
| R4 生产部署 | 已通过 | 4ae0168 已切换至 27019，健康回读为新实例；保留旧版回滚目录，R3 未改变。 [回执](/path/to/csgo-web/output/fidelity-fixes-2026-09-13/deployment.json) |
| 双地址 SDK 联机 | 已通过 | 同一物理机的两个真实 Colyseus SDK 客户端，分别连接回环和 192.168.1.100；建房/加入、购买、自然开局、射击同步及退出通过。两物理设备尚未验收。 [回执](/path/to/csgo-web/output/fidelity-fixes-2026-09-13/sdk-lan.json) |
| 生产页面最终 GPU | 已通过 | 27019 主游戏就绪，M4A4 完整持枪、#695 原法线皮肤实际绘制，frameErrors=0、glError=0。 [回执](/path/to/csgo-web/output/fidelity-fixes-2026-09-13/r4-browser-final.json) |
| 最终全量回归 | 已通过 | 232 个文件、1428 项全部通过；本轮单一总数，不叠加专项批次。 [回执](/path/to/csgo-web/output/fidelity-fixes-2026-09-13/full-suite-final.log) |
| 六枪默认 → 皮肤 → 默认 | 已通过 | 6/6 原默认材质对象准确恢复；换装与恢复的 glError 均为 0。 [回执](/path/to/csgo-web/output/fidelity-fixes-2026-09-13/six-default-restored.json) |
| 坡面脚底接触 | 部分完成 | 两处原坡面：CPU T 最低顶点穿入 7.73 mm，CT 仍有 1.85 cm 间隙；GPU 各 60 帧变换漂移 0、glError=0。接触仍为部分完成。 [回执](/path/to/csgo-web/output/fidelity-fixes-2026-09-13/foot-contact-cpu.json) |

完整全套开始于2026-09-13 17:17:05，64.12秒，共232文件、1428项全部通过。原normal测试仅拆分独立预算，PNG/RGBA SHA断言保留，未修改生产decoder。

完整回归 1428/1428 之后，仅补 JSON import attribute 的 NodeNext 兼容；服务端构建通过，相关专项 2 文件/16 项通过。该专项单独记录，不累加到 1428，也不冒称补丁后另跑了一次完整全套。 [兼容专项日志](/path/to/csgo-web/output/fidelity-fixes-2026-09-13/node-json-import-regression.log) / [服务端构建日志](/path/to/csgo-web/output/fidelity-fixes-2026-09-13/r4-server-build.log)。

## 仍需保留的边界

- 未完成原客户端同 build、同机位、同状态的逐像素比较，不提供还原百分比。
- 原未压缩 RGBA8888 mip 算术已对照；最终 DXT1_RUNTIME / DXT5_RUNTIME 压缩字节尚未复现。
- 网页物理解算器并非原 VPhysics。原模型、骨骼和参数来源正确，不代表所有接触、休眠和死亡轨迹一致。
- 238 张通过的是实际 GPU 合成 QA；六枪最新图片是受控诊断的最终材质 draw，不替代逐张皮肤实玩、菜单手工操作和双客户端验收。
- 粒子取光已接原 ambient、26 盏静态 worldlight 与照明遮挡查询；浏览器射线数值、动态光源和完整原 lightcache 时序尚未证明与原引擎等价。
- 截图按阶段留存；最终生产 R4 的 M4A4 GPU 已回读。同机回环与 LAN 网卡的双 SDK 联机已通过，两物理设备、双浏览器手工操作和原客户端同状态帧缓冲尚未验收。

地图三组 A/B 均为本网页同机位实渲；Valve 2017 年 Source 1 宣传图只作场景资料，独立展示，不是本机原客户端 build12426148 的同状态帧缓冲。工作树分别负责人物、地图、武器材质，主树负责场景和服务端整合；新增素材使用原字节/导出记录，未生成或重绘证据图片。

## 对照报告浏览器验收

三组滑块与两端按钮实际驱动 0%/100% 裁切，27 张图片无损坏；[浏览器交互回读](/path/to/csgo-web/output/fidelity-fixes-2026-09-13/review-browser-final.json)和[页面截图](/path/to/csgo-web/output/fidelity-fixes-2026-09-13/review-browser-final.png)已归档。R4 最后健康检查仍为新实例、rooms=0，SDK 验收房间已正常移除。
