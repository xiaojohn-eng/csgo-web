# 原 palm/sumac 风摆与静态光照候选

已完成默认关闭的独立候选，覆盖原 Dust2 `palm_frond_01` 与 `sumac_01` 的 **70 个 mesh / 170,118 三角**。原 alpha test `.3`、double-sided、底图、顶点、法线、UV、索引和节点 TRS 保持。私有实际 GPU 对照已查看；尚未接生产、未 stage 到 public。远处 olive 的 `vertexcolorpower=.7`、树皮、云层双纹理、env_wind 随机状态与完整原引擎曝光不在此次完成范围。

## 原指令证据

只读官方 App 740 build 12426148 的 `stdshader_dx9_client.so`（1,440,902 B，SHA256 `0383c51766a4681b5de26aa79b67ade5d3a867a8622185abe8a090877bac7c2e`）。`scripts/inspect-source-treesway.py` 用 Unicorn 仅执行明确边界内的原 x64 算术/命令写入块，不启动引擎，不执行系统/虚函数调用。动态 getter 返回值作为显式输入注入；没有伪称已运行原 getter 或原 env_wind。

- `$TREESWAY` string xref `0x49920`，参数槽构造 `0xc41f9`，draw 从 `info+0x198` 读取（`0xc4dca`），其后 15 个字段连续到 `info+0x1d4`。
- 原值 clamp 到 0..2；`0xce58e` 的 `mode * 3 << 11` 给出 combined static index 0/6144/12288。VCS dynamic count 48，故 treesway 1 的 static record 为 **128**，不是探索时的 512。原 final VS selector block `0xc9ead..0xc9f4c` 对 -2/0/1/2/3 五案实际执行通过。
- 原静态 command writer 三段 `0xc5d81..0xc5e90`、`0xc63f8..0xc64d5`、`0xc8017..0xc824a`，用 100..115 不同 sentinel 证明每个参数来源，再用两材质原值执行。输出常量如下。

| 寄存器 | 原材质实际值 | 语义顺序 |
| --- | --- | --- |
| c14 | `[100,.5,200,0]` | height / startHeight / radius / startRadius |
| c15 | `[.2,.25,2,.5]` | speed / strength / scrumbleFrequency / scrumbleStrength |
| c51 | `[0,3,2,1.2]` | highWindMultiplier / scrumbleFalloffExp / falloffExp / scrumbleSpeed |
| c52 | `[200,600,0,0]` | speedLerpStart / speedLerpEnd / 0 / 0 |
| c12 | `[0,timeSeconds,windSourceX,windSourceY]` | 本构建动态命令实际布局 |

动态原程序先读取双精度时间，非-static 分支在 `0xc8deb` 传 rendering parameter index 3，读取风向 x/y；原命令写入块 `0xc6d8d..0xc6e1d` 在四组时间/风输入下验证 float32 上传结果。这里不能套用公共 SDK 的 c50 风参数：本程序 c50.x 参与静态光照/法线有效性门控，覆盖它会破坏已正确的 VHV。

固定官方 [tree_sway.h](https://raw.githubusercontent.com/ValveSoftware/source-sdk-2013/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/materialsystem/stdshaders/tree_sway.h) 用于解释树干、枝条与细摆的角色；具体寄存器和多项式由**安装包原 DX9 token**决定。VS128/dynamic0（无额外动态灯的有界分支）3,164 B，SHA256 `fd2c99952aeab40ff76657d19bba4140e9bb575061dafc3040b0b688670611e0`。VCS SHA256 `b4381c44139b52e41d7f954189ae4b608f1d1fb4b6eff4b6ed84d25547211127`。

- words 276..302 独立执行 `pow(2*COLOR1.rgb,2.2)`，输出第一路烘焙 diffuse；它不读取风和时间。原 BGRA 打包与既有 VHV 解码一致，alpha 不用于该 diffuse 项。
- words 338..700 计算 Source object-space 位移，依赖原 model-to-world translation 的 XYZ 和乘 19 的相位。风按原模型行矩阵转入局部空间；不能用浏览器米制坐标代替 Source 原单位。
- 原编译器将正弦展开为 fract 相位折叠与五阶多项式链。本候选逐指令转写该链，没有换成 GLSL `sin()`。
- 原 VS 使用未摆动的法线；此次候选也不重算/修改 normal。words 707/711/715 才将变形后的点乘原模型矩阵。

原 Dust2 `env_wind` 数据确有 min/max speed 2/4、gust 3/6、delay 10/20、duration 5、direction change 20。**零风不是已证的实际地图默认状态**。本 API 必须由调用者明确提供时间和 Source XY 风；本轮以合法量级固定输入验证消费公式，不声称已还原原随机种子、服务器时间同步或完整实时风场。

## 原顶点、矩阵与 CPU/GPU 分层验收

`scripts/inspect-source-treesway.py` 从原 VVD 精确索引流读位置/法线，从原 VHV 读颜色。采样 ID 先由已验证的叶片 GLTF→原硬件顶点 remap 限定，排除同模型树皮；对 70 实例各取 4 个真实叶顶点，五组 `(time,wind)` 总计 1,400 案。独立 `source-treesway-token-oracle.py` 是通用 float32 寄存器解释器，不是手抄 sway 公式。

采样输入包括 `(0,[0,0])`、`(0,[2,0])`、`(.125,[2,0])`、`(1.75,[-3,4])`、`(6.25,[4,-2])`。280 个零风案精确回到 rest；全部输出有限，COLOR1 与独立幂公式最大误差 `5.960464477539063e-8`。原 scalar oracle 最大采样位移约 2.582 Source units；这只是离散采样值，不是全域最大风摆幅度。

`scripts/build-source-foliage.py` 将原 `props.glb` 全部 70 个叶 mesh 的 **141,407 个实例顶点**乘真实 GLB 祖先矩阵，再与原 `AngleMatrix`/Source→browser 变换对比：最大误差 **0.00004566741952426848 m**。10 份独立几何均原坐标不变；所有实际叶位置有限且非零，最短向量 `0.524893045425415` Source units，避免把原 normalize(0) 之外的数据混入候选。70 实例 uniformScale 均为 1（float32 矩阵长度误差约 2.5e-8）。原 remap/光照只按精确字节区间压紧，未颜色重编码、最近点匹配或改原 `props.glb`。

实际 WebGL2 transform feedback 用生成的 GLSL 对全部 1,400 案回读：所有值有限、GL error 0、零风误差 0；与独立 scalar token 解释器的最大差 **0.007352099 Source units / 0.000186743316 m**。这是 WebGL 与明确 float32 标量执行之间的实测精度，不是原 GPU/FMA 位级一致承诺。

## API 与资源边界

新独立入口：

```ts
const foliage = await loadSourceFoliage(propsGltf, {
  enabled: true, // 不传时默认 disabled，且不 fetch/分配
  baseURL: '/assets/source-exports/dust2-vhv/foliage/',
  state: { timeSeconds: .125, windSourceXY: [2, 0] },
  maxTextureSize: renderer.capabilities.maxTextureSize,
  signal,
});
foliage.setState({ timeSeconds: 6.25, windSourceXY: [4, -2] });
foliage.dispose(); // 先于 propsGltf / 原材质的 owner
```

- `game/source-foliage-loader.ts`：manifest/全部 binary SHA、BSP/GLB/program identity、完整 70 实例、原几何 POSITION/NORMAL/UV/index SHA、原 mesh-to-scene 矩阵全部先校验；HTTP LAN 使用已有 browser-safe `sourceSha256`，fetch 一律 `cache:'no-cache'`。
- `game/source-foliage-lighting.ts`：独立 owner，最多 70 mesh、默认 16 MiB 上限。此次两张 lookup texture 共 **2,146,304 B**；只用每实例原 VHV 第一颜色。不会与 R5 共享一个可覆盖的 per-model color 数组。
- `game/source-prop-foliage.ts`：仅完整精确 palm/sumac 原参数集合通过。alpha `.3`、DoubleSide、opaque opacity 1、原白 material color 和原底图合同必须保持；任意 mode2、height99、未知 vertexcolorpower 或 static1 均不通过。
- `game/source-treesway-glsl.ts`：由 `scripts/build-source-treesway-glsl.py` 固定原程序 SHA 后逐指令生成。只追加 shader 位移，不改节点 TRS/几何；时间/风 uniform 共享，原模型矩阵每实例独立。
- 同一 mesh 不允许两个 foliage owner；坏的最后一条 binding 在任何场景修改前失败。dispose 恢复原 material 与 frustumCulled，并只销毁自己两张 lookup texture/替换材质，不销毁借用 geometry/原贴图。
- 有界候选暂时关闭这 70 个 mesh 的 Three frustum culling，避免使用未含风摆的旧 bounds 错裁；保留外层原 PVS visible gate。释放时恢复旧 flag。这不是重新修改碰撞或 PVS。

原 `source-prop-lighting-loader.ts` 与 `source-dust2.ts` 完全未改。早期 RED/GREEN 仅在 `sourcePropBranch` 增加默认 false 的第六个精确候选识别参数；原五参数调用/R5 行为不变，实际 foliage 资源和 shader 由上述独立 owner 管理。父任务集成时先加载 R5 原 VHV，再加载独立 foliage，最后按既有顺序释放 foliage→R5→原 GLTF。不要把独立 candidate 识别当作旧 loader 已会施加风摆。

## 已查看的实际 GPU 结果

独立 headless session `csgo-foliage-r1`，新私有入口 `http://127.0.0.1:27018/assets/source-exports/dust2-vhv/foliage/preview.html`。不修改原 asset-preview HTML、生产 27019、root browser session。预览调用现有 `loadSourceDust2({sky:true})` 与原 `sourceSky` owner，按 sky→清深度→主世界同路径合成；主/天空太阳与半球光采用当前生产值，曝光 `.98`。此处没有第一人称枪、玩法、完整雾/云双层，也没有原 CSGO 同机曝光对照。

亲自查看以下 7 张截图：

- `output/playwright/source-foliage-{t,palm,sumac}-{r5,r6}.png`
- `output/playwright/source-foliage-palm-r6-wind.png`

T 和 palm 近景原白亮的叶背恢复分层烘焙暗部；sumac 枝叶由均匀浅亮恢复深浅，原本灰黄的底图区域仍保留。原 alpha cutout 和双面都可见，未手工填透明像素或统一染绿。两组风输入产生小幅位置变化；远处 olive 黑色枝叶、其他未解材料仍原样，不声称已解决它们。高频 alpha 叶缘的原 mip/覆盖策略仍需要更完整原游戏 GPU 对照。

R5 仍 2325 mesh；foliage 额外 70 mesh，合计 **2395**。不改变地图 6,269,945 prop triangle 总数。真实加载校验读了 865,738 B 几何/索引，10 份独立几何、70 原实例矩阵均通过。

`output/playwright/source-foliage-gpu.json` 保存实际 probe、相机、材质/文件 SHA 和资源回读：`errors=[]`，释放后回到本独立预览空基线 **geometry 0 / texture 2 / program 0**。T 的 restored-R5 截图 SHA 与初始 R5 完全相同：`1595d6ac798962a3cf8da94f0bbe0cf61b03af7f64d5e3c2a8d97ebefc30906e`。

## 校验文件与复跑

私有 runtime 目录 `.reference-assets/source-exports/dust2-vhv/foliage/`：

| 文件 | 字节 | SHA256 |
| --- | ---: | --- |
| manifest.json | 196 | `a1ced706b85dc450a1193428855c938a5c2fe10dd04a39fd23f8c001fd06a5ab` |
| bindings.json | 121751 | `f03c5655f5fe5e5713cffdedc948f0b6078a420aed0cbcde2e98cbbb23d5c058` |
| remap.u32 | 88304 | `433f06cbcc106dea3442439cff6ee4d780c685bb6abafa634f49e7d4c243433e` |
| lighting.bin | 2048280 | `29d97fc8ecb895f20bb63fe760d5f891a81728d66505bd1d25f42b664c2d1d18` |

GPU receipt SHA256：`c88e31276cc0eafee890a02caa8cc498518603057fe27f9bf69efd4adb090aba`。原 token fixtures SHA256：`db523954173ab66c948e55fa76c6c2c1a0ce25dc811a2d4048bcbb7f9cba7fd6`。

```sh
.tools/source-binary-venv/bin/python scripts/inspect-source-treesway.py
python3 scripts/build-source-treesway-glsl.py
/Users/developer/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 scripts/build-source-foliage.py
npx vitest run tests/source-prop-lighting.test.ts tests/source-prop-lighting-preview.test.ts tests/source-prop-foliage.test.ts tests/source-foliage-lighting.test.ts tests/source-foliage-loader.test.ts
npx tsc --noEmit
```

上述原生/原顶点生成命令实际完成；最终五文件 **26/26 tests** 通过，全项目 `tsc --noEmit` 0 诊断。红日志 `output/source-prop-foliage-red.log` 与 `output/source-foliage-lighting-red.log` 保留未实现时的具体失败。GPU 可在该新页面调用 `window.foliage.probe()`、`load()`、`focus('t'|'palm'|'sumac')`、`enable(true|false)`、`setState(time,wind)`、`unload()`；生成的 private preview.js 是本次验收冻结 bundle，现有生产/default R5 未切换。
