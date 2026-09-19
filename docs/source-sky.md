# Dust2 原 3D 天空：区域、相机和独立渲染层

本次从 App 740 build `12426148` 的原 BSP 读取天空分组，生成可复用 CPU descriptor 和独立 Three 对象所有者。没有修改主 `scene.ts`、`source-dust2.ts`、`world-composite.ts`、原地图 GLB、碰撞或服务器，也没有启动端口或操控浏览器。主任务随后负责正式加载、主 PVS 排除和绘制顺序；本文的渲染验收是 CPU 回读，不是 GPU 截图验收。

## 原始数据与固定 SDK 依据

原 BSP SHA256：`b91be410539fbbfc16300423f1e19c024f12addf1429c8cb2f72b53fe0fd6bcc`。提取脚本先校验整文件，直接解析原 planes/nodes/leaves/leaffaces/VIS/areas/areaportals/sprp/disp 数据。相机实体也与原 entity lump 对照。逐 lump 哈希、脚本哈希和 descriptor 哈希在 `.reference-assets/source-exports/dust2/sky/receipt.json`。

相机唯一，`hammerid=12482060`；原文本 `origin=-27.1673 -478.122 -8231`，实际 float32 向量 `[-27.167299270629883,-478.12200927734375,-8231]`，scale `16`。原 `worldspawn.skyname=nukeblank`。相机落在 leaf `2497`、cluster `0`、area `1`。该 area 有 76 个 leaves；原 PVS 第 0 行只有 cluster 0；原 area 1 的 areaportal 数为 0。

相机/雾/深度规则依据 Valve 官方 SDK 固定提交 `b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474`，完整源码与 SHA 保存在 `output/source-sdk-sky/`，不拿通用 SDK 声称已经对本构建客户端指令逐条仿真：

- [SkyCamera.cpp](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/game/server/SkyCamera.cpp#L105)：Spawn 从实体位置取天空 origin，并查询原 area。`angles` 不旋转天空视图；`use_angles` 用于雾的方向。
- [viewrender.cpp](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/game/client/viewrender.cpp#L4869)：天空 area bits 仅打开相机 area。相机位置为 `skyOrigin + mainViewOrigin/scale`；朝向、视角和宽高比继承主视图。可见性查询位置固定为原 sky origin，不能使用移动后的天空相机查 PVS。该文件 Setup 让天空先清背景绘制，再让主世界单独清深度。
- [worldsize.h](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/public/worldsize.h#L29)：独立 near 为 2 Source units，far 为 `1.732050807569*32768` units。对应 `.0508m` 和 `1441.5983579054932m`；near/far 不再除以 16。
- [bspfile.h](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/public/bspfile.h#L791)：原 leaf `LEAF_FLAGS_SKY=1` 表示其 PVS 有 3D 天空。模块保留原 leaf flags 作为主视图启用条件；无法判定边界时保守绘制，并返回明确 reason。
- [viewrender.cpp 的天空雾](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/game/client/viewrender.cpp#L4806)：雾起止距离除以天空 scale；原 max density 独立保留。Dust2 原 RGB `[213,203,172]`、start `-9u`、end `9000u`、max density `.6`、非 radial、非双方向混色；天空坐标下起止为 `-.0142875m` 与 `14.2875m`。

## 分组结果

| 原始类别 | 天空层结果 | 判据 |
| --- | ---: | --- |
| 静态 prop | 75 个实例、76 个网格、31,109 三角形 | 原 sprp leaf links 与 area 1 / cluster 0 相交，无跨其他 area 的实例 |
| World 可绘制面 | faces `9711,9712,9713,9714`，共 896 三角形 | 原 displacement `8320–8323` 完整顶点包络只落在 area 1 |
| Sky 工具面 | 187 faces | 原直接 leaffaces，全部 flags `1028 = SURF_SKY | SURF_NOLIGHT`；不能当实心天空多边形画 |
| 其他区域 | 不纳入 | 不以模型名、坐标距离或世界大包围盒推断 |

总计 77 网格、32,005 三角形。`dust_skydome` 为原 prop 146，`nuke_skydome_003` 为 prop 164；它们是在原 leaf 链分类后识别出的资产，不是通过名字选入。原 PVS `alwaysVisiblePropIds` **恰好等于全部 75 个天空 ID**。主 PVS 排除仍须覆盖 all-visible/disabled 分支，不能只删除 always 列表。原 visibility 的 node ancestor 关联会把少量 sky 工具面保守关联到其他 cluster；本 descriptor 没有用这些宽泛关联选取可绘制面。

Displacement 采用与原 visibility 提取相同的完整源顶点 AABB / BSP-plane traversal 和 `0.01u` 保守容差。四块的所有包络叶子均属 area 1，因此没有混区歧义。起始角使用原四角中真正最近角，未沿用旧 SourceIO `np.isclose(...,0.5e-2)` 的相对容差错误。原地形碰撞不变。

## 模块契约与所有权

`prepareSourceSky(skyJSON, visibilityJSON)` 校验相同 BSP / 单位，校验原相机 leaf/cluster/area、PVS、完整 prop IDs，再冻结自己的 descriptor 副本。`querySourceSkyView(prepared, browserCameraPosition)` 返回原启用条件、天空相机位置、固定 PVS origin、near/far 和雾距离。变换统一为 `browser=(Source.x,Source.z,-Source.y)*.0254`，所以浏览器相机公式同样为 `browserSkyOrigin + browserMainPosition/16`。

`createSourceSkyRender({world,props,sky})` 在原 HDR / VHV 材质准备之后、主 PVS 首次过滤之前创建，返回：

```ts
{ scene, camera, excludedWorldFaceIds, excludedStaticPropIds,
  update(mainPerspectiveCamera), stats, dispose() }
```

`update` 读取主相机世界变换，继承旋转/FOV/aspect/视口设置，改用原天空位置和独立 near/far；`scene.visible` 对应原 leaf flag。调用方按 sky → clearDepth → main world → clearDepth → viewmodel 绘制。主 PVS 必须接收排除 IDs，所有回退模式同样排除。

复制的 prop 只共享原 geometry/material，保留完整祖先世界矩阵和原 render callbacks；原对象不移父节点、不改 visible。World 仅新建索引，原位置/法线/所有 UV 属性和原 HDR lightmap material 保持引用相同，重复与反绕三角形逐个保留。这里没有用一个局部实体平移去代替完整父变换。

当前 GLB 中两张原 unlit 天空材质实际仍导入为 MeshStandardMaterial；在独立无灯场景会变黑。所有者根据原 VMT 身份为 `sky_dust2` 与 `nuke_clouds_002` 创建两个独立 MeshBasicMaterial，借用原底图和 UV，遵从 `$nofog=1`；云原 `$alpha=.35` 被保留。其余材质包括已应用的原 VHV shader 借用调用方对象。释放时只释放新索引与这两个材质；先移除借用的 geometry attributes 再 dispose，避免 Three 删除主世界共用 GPU attribute buffers。纹理均不归此所有者释放。应在 HDR/VHV/GLTF 原所有者之前释放天空。

## 已跑验证与剩余边界

可重跑：

```sh
python3 scripts/extract-source-sky.py
npx vitest run tests/source-sky.test.ts tests/source-sky-render.test.ts
npx tsx scripts/validate-source-sky.ts
npx tsc --noEmit
```

7/7 专项通过，完整类型检查通过。包含原 30 出生点 eye+64 的 leaf flag 对照、移动相机但固定 PVS origin、坐标换轴、独立 near/far、错 BSP/区域/prop 集合拒绝、矩阵与所有 UV/回调共用、反绕重复面保留、重复释放、创建中途失败回收。

真实当前 public GLB 按 manifest bytes/SHA 回读，图像解码替换为空 Texture，仅用于 CPU 几何/材质所有权检查。三轮创建/释放每轮均核对 77 个原 mesh 世界矩阵、233 个属性引用、32,005 个三角形；主地图全部 3,834 个 mesh 的 geometry/index/material/parent/visible 未变；每轮恰释放 1 个自建 geometry 和 2 个自建材质，共用 geometry/material/texture dispose=0。详见 `output/tests/source-sky-verification.json`。这不是浏览器帧率或像素正确性验收。

本轮保留的真实缺口：原 `UnlitTwoTexture` 第二张贴图与其 alpha 分支已按发货件读出并接上（见下文"云层的分支与第二张贴图"一节，含浏览器内的逐像素复现），**它尾部的 `cLightScale` 因子也已施加**——那个数就是地图自己的 `light_environment._lightscaleHDR`（Dust2 为 **1**）见 [原作环境](source-environment.md)；原 GPU 实际选的 mip／各向异性／混合状态仍未测；**天空相机自己的雾**（`sky_camera` 的 `-9u`→`9000u`、max density `.6`）仍只暴露准确输入——主世界的雾已按 `env_fog_controller` 接上（`512u`→`9000u`、max density `.4`，见 [原作环境](source-environment.md)），而天穹那两个材质在原作里就是 `$nofog 1`，所以这层雾不落在它们身上；`nukeblank` 的独立 2D cube 没有新提取；其他 prop 的原 VHV 覆盖由调用方负责。云层原 VMT 参数与哈希完整保存到 `sky/skydome-materials.json`。当前代码不宣称已完成本构建客户端天空的全部 shader、2D 背景或 GPU 视觉验收。

## 云层的 TextureScroll：量出来再画（2026-09-12 21:40）

`nuke_clouds_002` 在 `proxies` 里点名两次 `texturescroll`（`$basetexturetransform` 与 `$texture2transform`），而发货材质只写 rate/angle/scale 三个数，**没有**写它们怎么组合成变换。上一轮把这件事记为"未实测前不写渲染"，本轮把它量了：

| 读法 | 结果 |
| --- | --- |
| 类与键 | `CTextureScrollMaterialProxy`（客户端 `csgo/bin/client_client.so`，类名 0x10ef51a）；`Init` 读 `textureScrollVar`（默认**空串**，材质不点名就没有可写对象）、`textureScrollRate`（默认 1）、`textureScrollAngle`（默认 0）、`textureScale`（默认 1） |
| 大小写 | 代码读的是 camelCase（`textureScrollRate`…），材质文件写的是小写（`texturescrollrate`…）——引擎的 KeyValues 查找**忽略大小写**，所以两者是同一批键（这也是为什么小写字符串在二进制里找不到） |
| 角度 | 用客户端自己的 double `0.017453292519943295`（π/180）转弧度，再过 `sincos`（该调用的目标由 `.rel.dyn` 里类型 2 的重定位给出，符号名就是 `sincos`） |
| 偏移 | `u = frac(curtime × rate × cos)`、`v = frac(curtime × rate × sin)`；`frac` 是"小数部分，负值时加客户端自己的 1.0"，所以两个偏移都落在 `[0,1)` |
| 矩阵 | `[scale 0 0 u; 0 scale 0 v; 0 0 1 0; 0 0 0 1]`，经材质变量的 `SetMatrixValue`（vtable +0x50）写入；变量类型不是矩阵（低 4 位 ≠ 7）时改写成两分量向量（vtable +0x30）。**角度只出现在偏移方向里，矩阵没有任何旋转项**——`scale` 只是把贴图放大/平铺，不是把贴图转过去 |
| 时钟 | `curtime` 取自客户端自己的 float 全局（`0x1492c10 + 0x10`） |

落地：`scripts/probe-source-texture-scroll-apply.py` 把上面每一条钉成断言（键地址、初始值、π/180 双精度常量、四条乘法、`frac` 的两条分支、矩阵的 16 个槽位、`SetMatrixValue` 槽位、`sincos` 重定位），写 `research/source-texture-scroll-apply.json`。入库时把材质的 `proxies` 原样带进 `sky.json`（`scrolls`，小写键），`game/source-texture-scroll.ts` 把它解析成数字并实现这条实测律，`prepareSourceSky` 装载即校验，`source-sky-render.ts` 给带 `$basetexturetransform` 的材质**克隆**一份底图（原贴图不动）、开 `RepeatWrapping`（发货 VTF 的 flags 是 `0x2000` / `0x0`，**没有** `CLAMPS`/`CLAMPT`，所以原件按重复取样）、`repeat = scale`，每帧按游戏时钟写 `offset`。审计把当前 `u/v/repeat/时刻` 一并报出。

真机验收 `scripts/run-playwright-sky-scroll-validation.mjs`（真实浏览器 + 局域网服务 + 训练局，抬头看地图自己的 3D 天空）：两次读数 u/v 与"实测律在**渲染器自己报出的时刻**上的取值"**逐位相等（偏差 0）**；2.52 s 内云层确实移动（UV 位移 0.00526）；漂移方向的比值 **5.671281819617706** 对 `tan(80°)` = 5.671281819617707（1e-15 内，且这个判据不依赖任何时钟读数）；`errors=[]`，证据 `output/playwright/source-sky-scroll-ingame.json`。

**仍然缺**：**天空相机自己的雾**仍只暴露准确输入（主世界的雾已按 `env_fog_controller` 接上，见 [原作环境](source-environment.md)）；天穹那两个材质在原作里就是 `$nofog 1`。第二张贴图与那条 alpha 分支的进展见下一节。

## 云层的分支与第二张贴图：量出来再画（2026-09-13）

云层材质写着 `$translucent 1`、`$alpha .35`、`$texture2`，而这条 shader 只发 10 条静态分支——**它落在哪一条、那一条算什么**，本轮从发货件里读出来：

| 读法 | 结果 |
| --- | --- |
| 静态旗标 | 三条，按表序：`TRANSLUCENT`、`LIGHTING_PREVIEW`、`CUSTOM_MODE`。`.data.rel.ro` 里的表（`{define, 值, 字段}` 16 字节一条，空指针收尾）给出 `(TRANSLUCENT,0,1)`、`(LIGHTING_PREVIEW,0,2)`、`(CUSTOM_MODE,0,5)`；shader 自己的调试打印语句按**同一顺序**走这三条（`bTranslucent` / `nLightingPreviewMode` / `nCustomMode`），而这三条**旗标名**在整份二进制里没有任何指针引用（combo 定义名有），说明它们是一张表而不是按地址加载的常量 |
| 发货分支 | 容器里正好 10 条静态键：`0x0 0x1 0x2 0x4 0x6 0xc 0xe 0x12 0x18 0x1e` |
| 云层那一条 | 只声明 `$translucent 1` 的材质只会落在"恰好一个旗标置位"的键上：`0x1`（读两张贴图）/ `0x2`（不读贴图，常量色）/ `0x4`（不读贴图，预视分支）——**只有 `0x1` 读两个采样器**，一个两张贴图的材质不可能是另外两条 |
| 动态分支 | 该静态有 4 条动态，其中**只有 `dynamic 1` 完全没有雾常量**（`c11`/`c12`/`c29`）——也就是 `$nofog 1` 拿到的那条 |
| 程序 | `r0 = tex0 × tex1; r0 = r0 × c1; r0.rgb ×= c30; oC0 = r0`，即 **alpha = tex0.a × tex1.a × c1.a**；`c1` 是 `g_DiffuseModulation`（引擎上传材质颜色与 `$alpha` 的寄存器），`c30` 是 `cLightScale` |
| 第二张贴图 | `$texture2` = `nuke_clouds_001`：256²、RGB 243–252、**alpha 0–209**（云形在 alpha 里）——正是"透明分支"才有意义的那张图 |

落地：`scripts/probe-source-cloud-layer-branch.py` 把上面每一条钉成断言（三条旗标与表序、调试语句顺序、10 个静态键、单旗标键各自的贴图读取数、`0x1/dynamic 1` 的逐条指令、两条静态的 CTAB 常量与寄存器、`0x2`/`0x4` 是常量色程序）→ `research/source-cloud-layer-branch.json`；`scripts/export-source-sky-cloud-texture.py`（Blender + 仓库自己的 SourceIO 读取器）把 `$texture2` 无损导出成 PNG，带字节/SHA/通道统计回执 → `sky/cloud-texture2.json`；`scripts/extract-source-sky.py` 把分支与第二张贴图一起写进 `sky.json`（`second` / `translucent` / `program`），`prepareSourceSky` **装载即校验**（键、动态、两条算式字符串、`$nofog` 与动态一致、第二张贴图的字节/SHA/尺寸/夹取位），`scripts/stage-source-map.py` 把它作为 `skyTexture2` 入 manifest（字节 + SHA）；`game/source-sky-cloud-loader.ts` 按回执校验字节与 SHA 后解码（sRGB、`flipY=false`、发货件无夹取位→重复取样），`game/source-sky-render.ts` 用 `onBeforeCompile` 在 `map_fragment` 之后把第二个采样乘进 `diffuseColor`（three 的 `diffuseColor` 初值就是材质颜色与 opacity，恰是 `c1`），并把这条层报进审计（`twoTexture`）。

真机验收 `scripts/run-playwright-cloud-layer-validation.mjs`（局域网服务 + 训练局，抬头看地图自己的 3D 天空）：读 `assetAudit().sourceSky.twoTexture` 与 `renderer.info.programs`——**云层穹顶确实由本移植装的那份双贴图材质绘制**（审计报出第二张贴图文件、`$alpha 0.35`、实测分支 static `0x1` / dynamic `1`，以及穹顶 mesh 名与顶点数），且这一帧**恰好编译了 1 个**带本移植 cache key 的着色器程序；证据 `output/playwright/source-cloud-layer-ingame.json`。

**像素级复现（本轮补上）**：同一次运行里还用穹顶自己的几何做了逐像素比较——两张贴图各单画一遍（这两遍就是 GPU 对两张发货贴图自己的采样）、再用装上去的材质画一遍，逐像素比 `贴图0 × 贴图1 × c1`。结果是 **1,021,440 个像素全部在 2/255 内**（最差 0.996/255、平均 0.897/255，`errors=[]`）。上一轮"没复现"的原因**不在发布代码**：**实况渲染器开着 ACES 影调映射**（`ACESFilmicToneMapping`、exposure 0.98），而移植把材质的 `toneMapped` 原样保留，于是"装了乘积的材质"输出影调映射后的值，而两张参考贴图没映射过——两边在两个域里。把三遍都关掉影调映射（并关 alpha test／剔除／深度测试、输出走 linear 直通）后，乘积就是唯一差别。另一个必须写下来的事实：这个上下文的**绘图缓冲不携带片元 alpha**（纯不透明的红色探针读回来也是 255），所以这次比较的是 **RGB 三个通道**；alpha 乘积（`贴图0.a × 贴图1.a × .35`）由代码与装载/契约测试保证，本轮不声称已用像素测过。仍然没测的还有：原 GPU 实际选的 mip／各向异性／混合状态。**程序尾部的 `cLightScale`（c30）已接上**：那个数是地图自己的 `light_environment._lightscaleHDR`（Dust2 为 **1**，见 [原作环境](source-environment.md)），装载器把它传给天空所有者、材质在第二张贴图之后**只乘 rgb**，真机同时验了"编译后的程序里确实声明并乘上它"。
