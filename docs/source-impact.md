# 原作弹着（贴花）与表面撞击音效

原作里"打空的一枪"不是没有结果：它停在哪个面，那个面自己的材质就会给出一张贴花和一段撞击音。这一轮把这整条链路从发货文件里读出来、入库、接到真实射击路径并真机验收。

## 一条枪弹落在面上，原作是按这五步定的

| 步骤 | 发货文件 | 读到的字段 |
| --- | --- | --- |
| 1 这个面是什么材质 | 每个世界材质的 VMT | `$surfaceprop`（`WorldVertexTransition` 另有 `$surfaceprop2`） |
| 2 这个材质属于哪一组 | `scripts/surfaceproperties_cs.txt` | 组名 + `"base"` 继承链 |
| 3 这一组是什么"游戏材质"、放什么音 | 同上，按 `base` 继承后的字段 | `gamematerial`、`bulletimpact`、`penetrationmodifier`、`damagemodifier` |
| 4 这个字母对应哪一组贴花 | `scripts/decals_subrect.txt` 的 `TranslationData` | `"C" -> "Impact.Concrete"` 等；`"-"` 明确表示"这个面不贴" |
| 5 这一组用哪几张贴花、贴多大 | `decals_subrect.txt` 的 `Impact.*` 组 + 每张贴花自己的 `_subrect.vmt` | 贴花清单与权重；`$Material`（图集）、`$Pos`/`$Size`（图集矩形）、`$decalscale`、`$decalScaleVariation`、`$modelmaterial` |

组名在发货文件里是混合大小写（`Wood`、`Wood_Panel`），而引用它的材质写的是小写（`$surfaceprop "wood"`）。两边都在这份 build 里，且每个小写名只有一个组，所以查表按大小写不敏感做，并把"折叠后会不会撞名"作为拒绝条件之一。

## 贴花尺寸的约定是量出来的，不是猜的

`Subrect` 与 `DecalModulate` 都写 `$decalscale`，但发货文件没有一句话说明它乘什么。判据来自**同一张贴花的两种形态**：世界用的 `_subrect` 形态（`$Size` 给出它在图集里的texel范围）和模型用的独立材质（`$modelmaterial` + 它自己那张 VTF 的尺寸）。76 张两种形态都有的贴花里，**52 张的两个乘积逐位相等**，其余只是作者给模型形态另选了数字（比值仍在同一量级）。任何别的读法都不会让两份各自写的材质得到同一个数。

于是世界尺寸 = **该贴花自己的 texel 范围 × 它自己的 `$decalscale`**（单位是 Source 单位，按 1 单位 = 0.0254 m 换算）。这一条由 `tests/source-impact.test.ts` 对发货表逐项钉住。

## 数据落地

| 产物 | 内容 |
| --- | --- |
| `scripts/export-source-surface-props.py` | 读上面五个来源 + Dust2 自己的 BSP（texinfo/texdata/brushside/dispinfo/face、内嵌 pak）+ 静态道具 `.mdl` 头，写 `.reference-assets/source-exports/impact/surface-props.json`（完整）与 `research/source-surface-props.json`（受版本控制的回执） |
| `scripts/stage-source-impact.py` | 只入库运行时会取的东西：运行时表 `game/source-impact-table.json`（同时发一份到 `public/source/csgo-12426148/impact/surface-props.json` 供 Node 服务端读，两份字节相同由测试钉住）、贴花图集 PNG、原撞击音 wav、`provenance.json`、`game/source-impact-audio.json` |

面的来源分三层，键就是碰撞件自己写的字段：brush 用 `brush` 序号，置换面用 `grid`+`contents`（**重建出的 chunk 键顺序与原导出逐项相等**，这是导出脚本里的断言），静态道具用 `model` 路径（`.mdl` 头里的 `surface_prop`）。子弹打到的层只有 `brush`/`displacement`/`propPhy` 三种——`worldVphy` 只有 projectile 角色，`tests/source-impact.test.ts` 直接把这一点钉住。

覆盖（导出脚本自报）：brush 1515/2471、置换 101/101、道具 1246/1258，表面属性 28 种，贴花材质 83 张（其中本图弹着可达 42 张），图集 2 张，撞击事件 20 个（83 条原波形）。

## 拒绝路径（一律"什么都不画"，不拿别的顶替）

- 材质没写 `$surfaceprop`：这一面不参与（928 个 brush 属于此类，绝大多数是 `toolsnodraw`）。**没有**回退到 `default` 组。
- 一个 brush 的多个面声明了不同表面属性：整块记为 ambiguous（28 个），不按命中法线猜。
- 表面属性的名字在发货表里根本没有（本图只有 `stone`，12 个 autocombine 石头道具）：不解析。
- 游戏材质字母在 `TranslationData` 里没有（如 `X`＝`default_silent` 的 playerclip/天穹、`G`＝chainlink）：原文本就不贴，所以不画。
- 任何一张贴花的图集/矩形/缩放对不上、或表面指向未入库的贴花：装载时直接拒绝整张表。

## 运行时

- `game/source-impact-table.ts`：只放规则（校验、按 `base` 解析、按权重抽贴花、尺寸、按 shot 身份派生三个抽签值），不 import JSON，因此 Node 服务端可以共用。
- `game/source-impact-table-data.ts`：把入库表交给浏览器 bundle。
- `game/source-impact-decals.ts`：装载两张图集并按回执校验 SHA，再画。混合配方按发货的 `DecalModulate`：图集本身围绕**中性灰 128** 构建，`2 × texel × 帧缓冲` 在中性处不改动画面、在弹孔处压暗，所以淡出是"回到中性值"而不是 alpha 混合；矩形按 VMT 的左上原点转成 UV，四对角点的**配对顺序按 three 的 `PlaneGeometry` 实际给的顶点序**（左上、右上、左下、右下）——配错顺序会把贴花上下两半互相对调，见下；法线偏置 0.01 Source 单位 + polygonOffset。图集按**存储值**采样（`NoColorSpace`）：贴花是与帧缓冲相乘的**乘数**，必须与帧缓冲同一编码，而发货程序也没有任何 sRGB 解码（见下）。
- `game/source-impact-audio.ts`：像 AWP/Deagle 那样持有自己的一份，83 条波形全部取回、校验、解码后才允许发声。
- 权威端：`game/source-level.ts` 新增 `traceBullet`（castRayAndGetNormal + 碰撞件 `source` 记录），`simulation.ts` 在 **没有击中角色** 时把 `{点, 法线, 表面属性}` 放进 `shot` 事件。命中角色时不发 impact（原作给的是血肉效果，不是墙面贴花）；射程外空放也不发。
- 客户端：`scene.ts` 按 shot 自己的 `by`+`seq` 派生抽签值，所以**收到同一发的每个客户端画出同一张贴花**；`runtime.ts` 同时对同一表面播放它自己的原撞击事件。

## 真机验收

`scripts/run-playwright-impact-validation.mjs`（真实浏览器 + LAN 源服务 + 真 Dust2），证据 `output/playwright/source-impact-ingame.json`、截图 `source-impact-ingame.png`：

- 34 发真实按键射击，**画下 69 张贴花**（审计读到 64 张），两张图集都按 receipt 校验通过。
- 打到 3 种原表面并各自对上了原事件：`plaster` 52 张 → `drywall.ImpactHard` 57 次；`metal` 1 张 → `SolidMetal.BulletImpact` 1 次；`concrete` 11 张 → `Concrete.BulletImpact` 11 次。
- 共出现 8 张**互不相同**的原贴花（plaster01–04 / metal03 / concrete2–4），即不同表面真的画的是不同贴花。
- 每一张：法线是单位向量、落点与 authoritative 命中点相差 **≤0.001 m**（就是那 0.01 Source 单位偏置）、矩形在图集内、尺寸落在该贴花自己的 `$decalscale × (1 ± $decalScaleVariation)` 区间内。
- 83 条原波形全部校验通过；播放的事件种类与命中的表面一一对应。
- `refused: {"no-decal-group": 15}`：15 发落在原文本就不贴花的面上（playerclip 等），这正是拒绝路径在真机上的表现。
- `errors: []`。

## 局域网验收

`scripts/run-playwright-impact-lan-validation.mjs`（真实 LAN 房间：射手 + 占位 + **从不扣扳机的观察者**，三者同一台机器上的真实浏览器），证据 `output/playwright/source-impact-lan-evidence.json`：

- 22 发；**两个客户端各画下 70 张贴花**，审计逐项比对最近 64 张**完全相同**（按 `表面|贴花|世界坐标` 比对，`sharedDeficit: 0`）——包括射手自己的客户端和那个**一枪未开**的观察者。
- 两端命中同样的 **5 种原表面**（concrete / metal / plaster / solidmetal / wood）、同样的 **12 张原贴花**、同样的 **4 个原事件且次数逐项相同**（`Concrete.BulletImpact` 7、`SolidMetal.BulletImpact` 19、`Wood.BulletImpact` 3、`drywall.ImpactHard` 41）。
- 两端都校验了两张图集的 SHA 与全部 83 条原波形；`errors: []`。
- 这同时说明了**服务端那一半**是通的：观察者画的弹着完全来自权威 `shot` 事件，而权威端要用它自己那份（从 web root 读入、与浏览器 bundle 字节相同的）表才能给出表面——服务端没有表就两端都画不出。

截图：`source-impact-lan-shooter.png`（射手视角地面的弹着）、`source-impact-lan-observer.png`（观察者自己的机位）。

## 雾里的淡出：发货 `DecalModulate` 自己的算式，逐条读出并接进渲染

原作不只是把弹孔往雾色里染：雾越浓，它把贴花**淡出**（把 texel 往图集自身的中性值 0.5 拉，于是那张面回到"没被改过"），剩下的再往雾色染。两半都是发货程序自己的算术，`scripts/probe-source-decal-fog-fade.py` 把它们从发货件里读出来（`research/source-decal-fog-fade.json`）：

- **四个参数各自的声明**在 `bin/linux64/stdshader_dx9_client.so` 里按代码读：`$FOGEXPONENT` 声明了默认 `0.4`、`$FOGSCALE` 声明了 `1.0`（这个字面量被去重放到别处，只有读声明代码才看得出来），而 `$FOGFADESTART`/`$FOGFADEEND` **没有默认值**——这正是全部 14 个用到淡出的材质都自己写 `$fogfadeend 0.5` 的原因。
- **发货的 `decalmodulate_ps20b` 容器**：4 条静态组合 × 2 条动态组合。`ps_2_b` 的 token 带**目的/源修饰符**，仓库原有的 `ps_3_0` 走查器不读它们，而这里必须读：程序自己 `saturate` 了雾量与前程，而写出的那条 `mov` **没有任何 ×2 修饰符**——所以"2 × texel"是混合因子（`SRC=DstColor, DST=One`）而不是着色器指令。带淡出的那条与不带的那条逐条断言，`VERTEXALPHA` 那条也断言（本移植的贴花四边形不带顶点色，该因子恒为 1）。
- **算式**（逐条对应指令）：雾量 `min(saturate(距离 × g_FogParams.w + g_FogParams.x), g_FogParams.z)`；染色 `(saturate(雾量 × $FOGSCALE) ^ $FOGEXPONENT)²`；淡出 `saturate((雾量 − $FOGFADESTART) / ($FOGFADEEND − $FOGFADESTART))`；`texel = 混(texel, 0.5, 淡出)`，再 `texel = 混(texel, 雾色, 染色)`。距离是**眼睛到片元的距离**（`dp3`/`rsq`/`rcp`），不是沿视轴的深度。
- **哪张面要淡出**由材质自己决定：本移植画弹着用的两张图集材料里，`decals_bulletsheet.vmt` 写着 `$fogfadeend 0.5`（34 个可达贴花），`decals_mod2x.vmt` 什么都不写（8 个）——后者拿到的就是发货那条**没有淡出算术**的普通程序，本移植照它画。
- **采样编码是量出来的**：图集 VTF 带 sRGB 旗标，但 DX9 对这两张图用的 DXT 格式没有采样器 sRGB 解码，程序自己也没有任何解码（它的 `pow` 只有雾指数那一条）；于是原作的乘法是"存储值 × 帧缓冲"，本移植就把图集按存储值采样、雾色按字节取，与帧缓冲同一编码。真机里两个假设都算了一遍：按存储值预测与实测每个通道差 **0.002–0.004**，按"解码到线性"预测则差 **0.065–0.148**。

**顺带修掉一个真 bug**：贴花四边形的 UV 数组本来是按"左下、右下、右上、左上"配的，而 three 的 `PlaneGeometry` 实际给的顶点序是"左上、右上、左下、右下"——于是每张贴花的下半张与上半张**互相对调**（镜像蝴蝶结），此前几轮验收只查了"画下几张、画在哪、是否互不相同"，没查图案本身。探针里那条"四角 uv 反解出的四边形中心必须等于网格位置"的自检就是撞出它的地方，改成按 three 的顶点序配对后自检通过。

## 真机验收：雾淡出（逐像素）

`scripts/run-playwright-source-decal-fog-fade.mjs`（真实浏览器 + LAN 源服务 + 真 Dust2）：探针把一块受光的板停在高空已知距离上，用**真实贴花系统**在板上打真贴花（探针自己选组里哪一张，好让报告指名道姓说它量的是哪张面），先藏起贴花读一次板、再画上读一次，两者**相除**就是贴花对帧缓冲施加的因子（板本身与它身上的雾都被除掉）；相机按距离换视场，使贴花在画面里始终占三分之一，采样点落在图集里一块"够暗且邻域平坦"的像素上（这样读到的就是一个 texel，不是几个 texel 的模糊）。12 个测量点（两张面 × 6 个距离）全部与算式对上：

- 带淡出的那张（暗 texel `0.031/0.063/0.094`）因子随距离 0.22 → 0.40 → 0.63 → 0.82 → 1.00 → 1.00，逐通道与算式差 **≤ 0.0037**；不带淡出的那张（纯黑 texel）因子 0.11 → 0.22 → 0.37 → 0.49 → 0.74 → 0.80（只有染色、没有淡出）——**两张面在同一距离上确实不同**，且 90 m 以后带淡出的那张被完全淡掉（帧内 0 像素变化），而**把淡出从活材质上摘掉后同一张面又有 8414/7299 个像素变化**：说明它还在画，只是被淡出藏起来了。
- 地图自己的上限也被验到：120 m 之后雾量停在 `0.4`，因子不再变化。
- 证据 `output/playwright/source-decal-fog-fade-ingame.json`、截图 `source-decal-fog-fade-ingame.png`；`tests/source-decal-fog-fade.test.ts` 7 条把入库表与报告逐项比较、并把渲染用的那段 GLSL 按指令顺序钉住（表改了就会红）。
## 仍缺

- 原 `Subrect` 着色器自己的深度羽化仍未读（发货件里没找到它的算式）；**雾衰减与 `r_decals` 都已量出**（`scripts/probe-source-decal-pool.py`、`research/source-decal-pool.json`）：`DecalModulate` 的淡出算式已按上一节接进渲染并逐像素验收，贴花池子的发货默认是 **2048**，引擎自己的调试串 `%d decals: %d permanent, %d dynamic` 与 `R_FindDynamicDecalSlot: no slot available` 说明它分永久/动态两类并在池满时回收槽位；本移植仍保留自己那份更小的预算（每张贴花一个 quad，见上），这是**如实记下的差异**。
- 贴花只画在静态世界（brush/置换/静态道具 PHY）上；打到**动态物件**（掉落弹匣、投掷物）的表面仍无贴花。
- 弹壳（`eject_brass`）与曳光（`tracer_effect`）已按原数据实现并真机验收，见 [原作弹壳](source-shell-casings.md)、[原作曳光](source-tracers.md)，AWP 那两条另有 [AWP 自己的两条特效](source-awp-effects.md)。
- 7 个未声明 `$surfaceprop` 的材质（含 `hr_dust_wood_ceiling01_color`）不产生弹着；原作引擎对"未声明"的缺省组未被量出，因此没有回退。
- 远端路径已在 LAN 上验收（观察者一枪未开却画出逐项相同的弹着）；但两个客户端仍在同一台 Mac 上。
- 观察者画出的弹着是权威 `shot` 事件驱动的，没有做"射手预测先画、权威到达后再对齐"的本地先行表现。
