# Dust2 自带的环境：光照、雾、曝光与调色

Dust2 不把光照、雾、曝光交给渲染器决定——它自己带一整套环境实体。本页记录**从发货件里读出来的每一个数**、端口施加了哪些、没施加哪些以及为什么。

## 原数据在哪、怎么读

`scripts/probe-source-environment.py` 只用发货件，且**两份独立读取必须一致**才写文件：

- 冻结 BSP 自己的 entity lump（lump 0，`de_dust2.bsp` SHA `b91be410…6bcc`），本脚本用**字符串感知**扫描器解析（值里带 `\x1b` 输出分隔符，键名可能重复，例如 `logic_auto` 的 6 条 `OnMapSpawn`）；
- `.reference-assets/source-exports/dust2/source-metadata/entities.json`（已入库的 SourceIO 导出；它把键名统一小写，所以比较按大小写无关做）。

同时断言**发货二进制自己**把地图写的每个键对上客户端渲染用的网络成员与输入名，而不是靠记忆：

| 实体 | 断言方式 |
| --- | --- |
| `env_fog_controller` | `server.dll` 的 data-desc 里 `m_fog.colorPrimary`/`fogcolor`、`m_fog.enable`/`fogenable`、`m_fog.dirPrimary`/`fogdir`、`m_fog.start`/`fogstart`、`m_fog.blend`/`fogblend`、`m_fog.maxdensity`/`fogmaxdensity`、`m_fog.end`/`fogend` 逐对相邻 |
| `env_tonemap_controller` | `server_client.so` 载有地图 `logic_auto` 触发的 6 个输入名（`SetTonemapPercentTarget` 等）与 `m_flTonemapPercentTarget` 等成员 |
| 客户端雾 | `client.dll` 载有 `DT_FogController`、`m_fog.colorPrimary`、`m_fog.maxdensity` |
| 其它环境实体 | 地图里**不得**出现任何本探针读不了的会改变环境的实体（`trigger_fog`/`fog_volume`/`trigger_tonemap`/`env_cascade_light`…），出现即失败 |

`research/source-environment.json` 是逐条断言后的报告（含每个来源文件的 SHA、123 个键值与导出的逐项比对）。`scripts/stage-source-environment.py` 把运行时真正要用的数写进**生成表** `game/source-environment-data.ts` 与入库件 `public/source/csgo-12426148/dust2/environment.json`（manifest 键 `environment`），`tests/source-environment.test.ts` 把报告读回来逐项比对，所以生成表不会悄悄漂移。

## 读出来的数（Dust2）

| 项 | 值 | 备注 |
| --- | --- | --- |
| `light_environment._light` | `254 230 197` @ `575` | 太阳颜色 + 亮度 |
| `light_environment._ambient` | `211 226 248` @ `245` | 环境光（偏蓝） |
| `light_environment._lightscaleHDR` | **`1`** | 天空 shader 读的 `cLightScale`（c30） |
| `light_environment` 朝向 | `angles 0 43 0` + `pitch -50` | 单位向量 `[0.470105, 0.438380, 0.766044]`（Source 帧，指向太阳） |
| `env_fog_controller` | 开 | `fogenable 1`、`fogblend 0`、`use_angles 0`、`spawnflags 0` |
| 雾色 / 范围 / 上限 | `213 203 172` / `512`→`9000` u / `0.4` | 即 `13.0048 m`→`228.6 m`，峰值只到 **40%** |
| `logic_auto` → 曝光 | `min .5`、`max 1.25`、`rate .2`、`target 80`、`bright 3`、`bloom 0` | 地图在 `OnMapSpawn` 推给 tonemap 控制器 |
| `env_sun` | `sprites/light_glow02_add_noz`、`size 32`、`renderColor 255 245 217`、`use_angles 1`、`angles 0 47 0` + `pitch -43` | 太阳精灵。**它的成员表已按构建自己的 datamap 读出**（见下），**而 `glowdistancescale "0.1"` 这个键在全部 18 个发货二进制里都不存在**，即构建根本match不到它，属作者标注而非数据 |
| `shadow_control` | `angles 90 43 0`、`color 128 128 128`、`distance 72` | 投影阴影通道：**垂直向下**、72 单位可达、染 128 灰，见下 |
| `color_correction` | `materials/correction/cc_dust2.raw`、`maxweight 1.0`、无淡入淡出 | 32³×3 = **98,304 字节** |
| `postprocess_controller` | 全部强度 **0** | 地图要了实体但没要效果 |
| `sky_camera` | `scale 16`、独立雾 `-9`→`9000`、`maxdensity .6` | 3D 天空，见 [原作天空](source-sky.md) |

调色 LUT 的**格式是量出来的**：与它一起发货的中性表 `off.raw` 在同一存储顺序下就是恒等斜坡（逐条最大偏差 **0.677/255**，灰轴 0,33,66,…,231,255 与中性表逐项相同），而这个顺序是「输入轴序 (0,1,2)（r 最慢）+ 输出通道序 (2,1,0)」——于是 `cc_dust2.raw` 与中性表逐字节比较只差 **最多 1 级**、86.9% 的条目完全相同。也就是说 Dust2 的调色几乎不动画面，这既解释了为什么端口不接它，也把"接上能拿回多少"量成了 1/255。

## 端口施加了什么

### 1. 原作的雾（`game/source-fog.ts`）

Source 的线性雾是「`fogstart` 起、到 `fogend` 升到 `fogmaxdensity` 后**保持**」，而 three 的线性雾是 `smoothstep(fogNear, fogFar, depth)` 一路升到 1：两者在起点、在斜率、在峰值都不同——Dust2 的 `512/9000/.4` 用 three 的曲线会在射程内弱掉约一半、在射程外强到 2.5 倍。所以端口把 `fog_fragment` 换成原作那条：

```glsl
float fogFactor = min( fogMaxDensity.x,
    clamp( ( vFogDepth - fogNear ) / max( fogFar - fogNear, 1e-6 ), 0.0, 1.0 ) );
```

- `fogColor`/`fogNear`/`fogFar` 由渲染器每帧从 `scene.fog` 写入，所以色/起/止不需要新东西；
- **上限没有 uniform 可放**：three 每个材质在编译时从 `ShaderLib` 克隆一份 uniform 集，普通数值会被复制成每材质一份。端口的 `fogMaxDensity` 值是一个 `Vector2`，其 `clone()` 返回自身——于是所有材质共用同一个对象，一次写入就是全场生效。这条性质、以及被替换的两段 chunk 源码，都在装载时**断言**（three 改了就会抛错而不是静默改变雾），`tests/source-environment.test.ts` 用 `UniformsUtils.clone` 直接证明多份材料拿到的是同一个对象；
- 只有线性雾这一支被换掉：`FOG_EXP2` 那一支仍是 three 自己的，所以端口自带地图（指数雾）不受影响；
- 端口自己的烟雾是精灵云、不是原作的粒子体积；相机进入烟雾时用同一套坡道的「近全面」状态（`0 → 1.2 m`、上限 1）替代原来那个 `FogExp2(0.85)` 的临时值。

### 2. 天空的 `cLightScale`（c30）

`unlittwotexture` 云层那条程序的最后一步是 `rgb × c30`，而 `c30` 就是地图自己的 `_lightscaleHDR`。端口把它当参数传进 `game/source-sky-render.ts`：装载器从生成表取 `lightScaleHDR` 传给天空所有者，材质在第二张贴图之后乘上它（**只乘 rgb**，alpha 与程序一致）。Dust2 的这个数是 **1**，所以画面不变——但"是 1"现在是**读出来的**，而不是默认的。

### 3. 太阳的方向、颜色与跟着视野走的阴影盒（`applyMapLighting`）

`light_environment` 把太阳写成 Source 的 yaw/pitch 对（`angles 0 43 0` + `pitch -50`），方向是 `(cos p cos y, cos p sin y, −sin p)`。端口的世界帧是同一张图经 `(x, y, z) → (x, z, −y)` 旋转而来（世界、碰撞、动画共用这一约定），旋转不改长度，所以方向原样搬过来就是 `(0.470105, 0.766044, −0.438380)`——`environmentSunDirection` 里带单位长度断言，帧的换算错一位就抛错。

`applyMapLighting()` 一次做完四件事：

- 颜色：太阳 `_light` 的三字节 → `#fee6c5`，环境光 `_ambient` → `#d3e2f8`（`environmentColor` 就是"把地图写的字节印成十六进制"，不做色彩空间换算）；
- 同源：第一人称场景的那盏光（`weaponSun`）与世界主光**同色**，因为它是同一颗太阳在视图空间里的形态（每帧由 `lightingDirection` 送进视图空间），不是另一盏棚灯；
- 距离：光的位置 = 目标点 + 地图方向 × **58.5577 m**（`SOURCE_SUN_DISTANCE = hypot(30, 48, 15)`，即原端口那盏灯到自己目标点的距离——阴影相机的 near/far 是照这个距离调的），于是地图换的是**方向**，距离保持；
- 跟随：`update()` 每帧把 `sun.target` 搬到相机位置、`sun` 随之搬到「目标点 + 同一偏移」。这就是原作那条"阴影跟着视野走"的性质（原作的投影阴影盒跟着视图，不是钉在地图上的一块）；偏移方向来自地图，所以它只移动、不转身。`sun.target` 原先不在场景图里，为了这条被显式加入。

**这个世界自己不吃这盏灯**：Dust2 的世界批次是不受光的 `MeshBasicMaterial` + 烘焙光照贴图（`game/source-world-batch.ts`、`game/source-prop-batch.ts` 等），所以地图的太阳颜色/强度不改世界几何，它照的是**演员、动态道具与第一人称武器**（标准/Phong 材质）。

### 4. 地图自己的投影阴影（`game/source-projected-shadows.ts`）

上面那盏灯在 Dust2 上**不投阴影**——因为这张图**没有** `env_cascade_light`（57 个 `env_soundscape`、10 个 `light`、6 个 `light_spot`，一个级联光都没有），随包构建里也没有第二条沿太阳投阴影的通道。原作在这张图上给每个角色的是 `shadow_control` 那条**投影阴影**。整条读在 `scripts/probe-source-projected-shadows.py`（结果 `research/source-projected-shadows.json`，入库件的数与本文件的下表互相断言）：

- 该实体的客户端类在 64 位客户端里连着 `DT_ShadowControl` / `CShadowControl` 两个名字，成员只有 `m_shadowColor`、`m_flShadowMaxDist`、`m_bDisableShadows`、`m_bEnableLocalLightShadows`——**根本没有方向成员**（探针把这段名字整段读出来，出现任何 `Direction`/`Rotation` 就报错）。所以地图写的 `angles 90 43 0`（正下方）不是巧合：游戏里每一条投影阴影都朝下。服务器的同一段名字里还带着地图那个键 `disableallshadows` 与它驱动的输入（`SetDistance`/`SetShadowsDisabled`/`SetShadowsFromLocalLightsEnabled`），这就是"地图写的实体"与"客户端画的实体"是同一个的证据；
- 阴影是**投射者自己的剪影**：随包 `shadowbuildtexture_ps20b` 把模型自己的贴图 alpha 乘顶点 alpha（`mul r0.w, r0.wwww, v0.wwww`）并强制成白（`mov r0.xyz, c0.xxxx`，`def c0 (1,0,0,0)`）；随包 `shadowmodel_ps20` 再把它混到接收面上——`def c0.xyzw (-1.0, 1.0, 0.0, 0.0)`、`add r0.xyz, v0.xyzw, c0.xxxx`、`mad r0.xyz, a0.wwww, r0.xyzw, c0.yyyy`，即 **`1 + coverage × (modulation − 1)`**，alpha 写 1。两个容器都是单静态（`0x0`）+1 动态，地图对它们没有选择；
- 地图自己的数：色 `128 128 128`、`distance 72` 单位 = **1.8288 m**、阴影开着。于是站着的玩家在地上的影子就是自己那片 50% 的剪影。

端口照这条画：池里的每一格有一个自己的层（从 31 往下）和一个 128² 渲染目标，把**该角色单独**用不透明的黑 `overrideMaterial` 从正上方渲进那张目标（清成 `(0,0,0,0)`，于是回来的 alpha 就是模型自己的覆盖度），再把一张水平 quad 贴在角色下方第一块面上，按 `DstColor × Zero` 混合、片元写 `mix(1.0, shadowColor, coverage)`——就是随附程序那条表达式。**未读出的两处如实记下**：引擎的投影平面与高度淡出是每实体在运行时设的，端口不按高度淡出、也不画第一人称武器自己的影子（`audit().limitations` 里写着，单测钉住条数）。

复现这一节：`PYTHONPATH=.tools/source-binary-venv/lib/python3.9/site-packages python3 scripts/probe-source-projected-shadows.py`（该 venv 自己的解释器在本机已无法启动，用系统 3.10/3.9 直接跑——venv 里的 elftools/capstone 是纯 python，实测可用）。

## 太阳精灵：`env_sun` 是 `C_Sun`，成员表按构建自己的 datamap 读出

太阳精灵的数据与身份都读完了，缺的只有客户端那半条绘制算式，所以这里只入库不画。

**成员表是一对一对按重定位读出来的**，不是靠键名猜的：datamap 每条 `0x68` 字节，成员名与键都各自走一条重定位，所以探针在 `.rela.dyn` 里找"某个键的地址"与"某个成员名的地址"**同时出现在同一条目上**，再把这条目的偏移与类型码读出来核对。得到八对（`server_client.so` 的 64 位那份，`bin/server_client.so` 是 32 位 i386 的同一模块，探针只用 64 位那份读表并把这个来源写进报告）：

| 地图写的键 | 成员 | 偏移 | 类型码 |
| --- | --- | --- | --- |
| `material` | `m_strMaterial` | `0x4e0` | `0x00060001` |
| `overlaymaterial` | `m_strOverlayMaterial` | `0x4e8` | `0x00060001` |
| `use_angles` | `m_bUseAngles` | `0x4f0` | `0x00060001` |
| `pitch` | `m_flPitch` | `0x4f4` | `0x00060001` |
| `angle` | `m_flYaw` | `0x4f8` | `0x00060001` |
| `size` | `m_nSize` | `0x4fc` | `0x00060001` |
| `overlaysize` | `m_nOverlaySize` | `0x500` | `0x00060001` |
| `overlaycolor` | `m_clrOverlay` | `0x504` | `0x00060001` |

两处细节值得记下：**键是 `angle`（单数）**，映射到 `m_flYaw`（`0x4f8`），而地图写的 `angles`（复数）是**基类实体自己的旋转**——地图有 `use_angles 1`，所以朝向取实体的 `angles 0 47 0`、俯仰由 `m_flPitch`（地图的 `pitch -43`）替换，`m_flYaw` 没被地图写到、保持默认。另一处是**同一个成员名会出现在别的类里**（`m_bUseAngles` 有三处），所以探针把"偏移"当成问题的一部分来断言，而不是读回来就接受。

**`glowdistancescale "0.1"` 是这张表读不到的东西**：把安装里**全部 18 个发货二进制**（`bin/` 与 `bin/linux64/` 的 `.so`、以及 `client.dll`/`server.dll` 等 32/64 位 Windows 件，按路径去重）逐个按字节查过，这个键**一个都没有**；而 `hdrcolorscale` 只出现在 5 个客户端件里、`overlaysize` 在 9 个里。KeyValues 的键是逐字比较的，所以构建**无法匹配**这个键——地图这一行是**作者标注**，不是运行时数据。端口因此把它按原样记下（`glowDistanceScaleAsWritten`）并在 `note` 里写明它不能拿来算，**不拿它当表用**。

复现本节（**这一份探针跑在 Blender 里**，因为它的 LUT 一节要 `SourceIO`；而 Blender 默认不认 `PYTHONPATH`，必须带 `--python-use-system-env`）：

```
PYTHONPATH=.tools:.tools/source-binary-venv/lib/python3.9/site-packages \
  blender --background --python-use-system-env --python scripts/probe-source-environment.py
```

顺带一处工程改动：`scripts/source-binary-index.py` 把 capstone 的导入改成**用到时才导入**——ELF 那一半（节、重定位、函数边界、虚表、地址换算）只需要 pyelftools，因此这份共享读取器现在在**没有 capstone 的环境里也能 import**（反汇编那几个方法才需要 capstone）。

## 没有施加的（每条都有量出来的理由）

| 项 | 现状 | 理由 |
| --- | --- | --- |
| 自动曝光 | 端口用固定曝光 | 原作按 `target 80 / bright 3 / rate .2` 在 **0.5–1.25** 之间自动曝光；照做需要复现原作的 tonemap 算子，属于另一件事，现值已入库 |
| 太阳精灵 | 不画 | 地图的 `env_sun` 与**构建自己那张成员表**都已读出（`m_strMaterial` `0x4e0` … `m_clrOverlay` `0x504`，逐对按重定位读出，见下），`glowdistancescale` 已查明**任何发货二进制都不读**；缺的是**客户端的绘制算式**（`m_nSize 32` 怎么变成屏幕尺寸、`m_nOverlaySize -1` 时那条叠加画不画）与 `sprites/light_glow02_add_noz` 的导出，所以**不画而不是拿近似顶替** |
| 投影阴影的高度淡出与武器影子 | 剪影贴在下方第一块面上、只有角色的 | 引擎按接收面离影子平面的高度淡出、并让第一人称武器投自己的影子；两处都写在审计的 `limitations` 里并被单测钉住 |
| 调色 LUT | 不施加 | 与中性表逐字节比只差 1 级（见上），这四项一起写进 `declaredButUnapplied` 并被单测钉住条目数 |

## 真机验收

`scripts/run-playwright-source-environment.mjs`（真实浏览器 + 局域网服务 + 训练局，`?map=de_dust2`）：

- 活场景的雾就是地图自己的：`Fog`（不是 `FogExp2`）、`near 13.0048`、`far 228.6`、色 `#d5cbac`、共享上限 **0.4**；光线、环境光、太阳方向的每个数都与入库件逐项相等；
- **437 个吃雾的材质共用 1 个上限对象**（审计遍历全场材质，报出载体数与不同对象数）；
- 天空穹顶材质的 `lightScale` 是地图的 1，且**编译后的程序**（从 GL 取回源码）确实声明并乘上 `sourceSkyLightScale`、采样第二张贴图；
- **逐像素**：在已知距离放探针面片，7 个深度（5 / 20 / 60 / 99.3 / 130 / 228.6 / 260 m）上实况帧与「`off + (fogColor − off) × min(0.4, 坡道(d))`」**逐位相等（偏差 0）**——包含 `fogstart` 之前为 0、`fogend` 之后停在 0.4（three 自己的 smoothstep 在 60 m 会是 0.176 而不是 0.218，在 260 m 会是 1.0 而不是 0.4）；
- **在地图自己的几何上**：扫视到一条长视线后，567,924 个不透明单面像素里 125,375 个被雾霭改变；没有一个像素被雾霭推过地图自己的上限；1,610,692 个通道全部满足「上限更高时雾只多不少、且不多过 `0.4/0.25`」这条不依赖任何跨度的判据；567,883 个像素逐个满足 `min(0.25, 地图自己的坡道)`（最差 1 级），余下 41 个是「两帧对该像素自身系数的估计无法调和」的混合面（计数入库，不参与断言）；
- `errors=[]`。证据 `output/playwright/source-environment-ingame.json`、截图 `output/playwright/source-environment-ingame.png`。

`scripts/run-playwright-source-lighting.mjs`（同一装置，量太阳本身）：

- 活场景主光的单位方向与地图自己的方向**逐分量 1e-6 内相等**，颜色 `#fee6c5` / 环境光 `#d3e2f8` 与入库字节相同，光到目标点的距离 **58.5577 m**；`sun.target` 每帧等于相机位置（跟随视野），第一人称那盏光与世界太阳在**视图空间**的夹角 **0°**；
- **这盏灯不再投阴影**：审计里 `shadow.castShadow === false`（本轮起，因为这张图没有级联光、阴影改由下一条通道画），且遍历全场灯光时只有它没有阴影图。证据 `output/playwright/source-lighting-ingame.json`、截图 `source-lighting-ingame.png`。

`scripts/run-playwright-source-projected-shadows.mjs`（同一装置，量投影阴影，**逐像素**）：

- 审计给出的色 `0.501961` = 地图自己的 `128/255`、可达 **1.8288 m** = `72 × 0.0254`、`sunCasts` 为 false；一局里 **9 个角色全部画出**（`casters 9 / drawn 9`）、`refused={}`；
- 对其中一个角色（`bot-amber-1`）：关掉阴影组取一张参考帧、打开再取一张，**逐像素相除**得到影子自己的系数——最暗处 **0.5**，地图自己的颜色是 **0.502**；影子的质心离角色原点（垂直投影点）**0.037 m**；脚印 **1.395 m**；影子与角色下落距离 **0.215 m** 说明它确实落在脚下的面上；影子覆盖 **2.3%** 的像素、范围 0.3–0.75 m；
- **背阳侧系数 1**（太阳那边一点没被染），所以暗斑确实是"这一条向下投的影子"而不是别的灯的效果。证据 `output/playwright/source-projected-shadows-ingame.json`、截图 `source-projected-shadows-ingame.png`。

## 仍未做

原作的自动曝光、`env_sun` 太阳精灵、投影阴影的高度淡出与第一人称武器自己的影子（见上）；雾的 `fogdir`/`fogcolor2`/`fogblend` 在 `blend 0` 下不使用，端口同样不使用；`farz -1` 表示"用控制器自己的远平面"，端口不接管相机远平面。
