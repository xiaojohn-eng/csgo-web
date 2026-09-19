# 原步枪第三人称枪口

这次交付 `items_game.txt` 为 AK-47 与 M4A1 指定的第三人称枪口系统 `weapon_muzzle_flash_assaultrifle` 的**可见闪光、辉光与滚动火焰**，包含原 PCF 闭包、原生算子缺省、原材质、原贴图与原图集。它是该系统的**有界移植**：执行 `weapon_muzzle_flash_assaultrifle_vent`、`weapon_muzzle_flash_assaultrifle_glow` 与 `weapon_muzzle_flash_assaultrifle_main`（火焰），同一个原系统派发的其余子系统仍然只是数据，**不是完整 Source 粒子引擎，也不是完整的原枪口效应**。

## 原系统结构

`weapon_muzzle_flash_assaultrifle` 本身**不是**一个发光系统，而是一个派发器：它自己只有一个算子 `Set Control Point Positions`（`First Control Point Location [17.5, 0, 0]`），并挂 5 个子系统：

| 子系 | 材质 | 作用 |
| --- | --- | --- |
| `..._vent` | `particle/particle_muzzleflashx.vmt` | **枪口闪光本体**（instant，1 粒） |
| `..._main` | `particle/fire_particle_4/fire_particle_4` | **滚动火焰**（instant 8 粒，沿控制点路径铺开） |
| `..._glow` | `particle/particle_flares/particle_flare_004.vmt` | 加法辉光（instant，1 粒） |
| `weapon_muzzle_flash_smoke_small2` | `particle/vistasmokev1/vistasmokev4_nearcull.vmt` | 枪口烟 |
| `weapon_shell_eject_smoke_assrifle2/3` | `particle/vistasmokev1/vistasmokev1_emods.vmt` | 抛壳口烟 |

另有一条连续火焰 `weapon_muzzle_flash_assualtrifle_flame` 与两级 fallback。**本轮实现 vent 与 glow**，其余全部作为数据随图下发，未执行、未用近似效果顶替。

## vent 的原参数

| 项目 | 原值 | 来源 |
| --- | --- | --- |
| 发射 | `emit_instantaneously`，`num_to_emit 1`，出生时间 0 | PCF |
| 出生位置 | `Position Within Sphere Random`，距离 0–0.1，`bias in local system` | PCF + 原生缺省 |
| 旋转 | `Rotation Random`，±15°，`randomly_flip_direction` | PCF + 原生缺省 |
| 寿命 | `Lifetime Random` 0.025–0.025 s | PCF |
| 半径 | `Remap Noise to Scalar`，输出字段 3（radius），5–7 | PCF + 原生缺省 |
| 透明度 | `Alpha Random` 190–230 /255 | PCF |
| 运动 | `Movement Basic` 重力 0、阻力 0.2，但出生速度恒 0，故原地不动 | PCF |
| 淡出 | `Alpha Fade Out Random` 0.025 s、非 proportional、eased（原 `fade bias` 默认 0.5） | PCF + 原生缺省 |
| 渲染 | `render_animated_sprites`，`animation rate 4`，屏幕朝向，无 sheet | PCF + 原生缺省 |
| 材质 | `particle_muzzleflashx.vmt`：`$additive 1`、`$depthblend 0`、无 `$addself` | 原 VMT |
| 贴图 | `effects/muzzleflashx.vtf`：VTF 7.1、128×128、DXT1、单帧、**无资源字典** | 原 VTF |

VTF 7.1 的表头是 64 字节且早于资源字典，因此这张原贴图**结构上不可能有 sheet**；导出把这一点写成 `resourceTable: absent-before-7.2`，而不是"没找到动画"。

## glow 的原参数

| 项目 | 原值 | 来源 |
| --- | --- | --- |
| 发射 | `emit_instantaneously`，`num_to_emit 1`，出生时间 0 | PCF |
| 出生位置 | `Position Within Box Random`，`min/max` 全 0 → **零体积**，辉光落在控制点上 | PCF + 原生缺省 |
| 旋转 | `Rotation Random`，0–360°，`randomly_flip_direction` | PCF + 原生缺省 |
| 寿命 | `Lifetime Random` 0.015–0.015 s | PCF |
| 半径 | 系统自身 `radius 25`（不是噪声重映射） | PCF |
| 透明度 | `Alpha Random` 160–190 /255 | PCF |
| 运动 | `Movement Basic` 重力 0、阻力 0 | PCF |
| 颜色 | `Color Random`：`color1` `[255,188,189,128]`、`color2` `[130,92,75,128]`，逐通道按同一随机数插值 | PCF |
| 颜色淡出 | `Color Fade`（= `C_OP_ColorInterpolate`）到 `[0,0,0]`，`fade_start_time 0.7`、`fade_end_time 1`、`ease_in_and_out 1`、`output field 6` | PCF + 原生缺省 |
| 淡出 | `Alpha Fade Out Random` 0.025 s、非 proportional、eased | PCF + 原生缺省 |
| 渲染 | `render_animated_sprites`，`animation rate 30`，`sequence 2–2`，屏幕朝向 | PCF + 原生缺省 |
| 材质 | `particle_flare_004.vmt`（加法） | 原 VMT |
| 贴图 | `particle_flare_004-frame-0.png`（从原 VTF 解出，78,557 B） | 原 VTF |

`Color Fade` 是本 build 里**唯一**用到的颜色插值算子：它的两个时间参数都是**寿命的比例**（缺省 0 与 1 = 整个寿命），且缺省开启缓动，所以 glow 只覆盖了 `fade_start_time`。这三个事实不是猜的，是从本 build 自身注册表的 getter 里执行出来的；探针一次解出**这张闭包自己的 33 个算子**（早先按另一张闭包读出的 27 个是探针取错文件，已纠正）。

## 数据落地

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 --python scripts/export-source-muzzle-flash-particles.py
python3 scripts/stage-source-muzzle-particles.py
```

- 导出：`scripts/export-source-muzzle-flash-particles.py` 遍历 `particles/weapons/cs_weapon_fx.pcf` 中 `weapon_muzzle_flash_assaultrifle` 与 `weapon_muzzle_flash_awp` 两个根的闭包（21 个系统、7 张贴图、9 份材质），逐文件写字节数与 SHA-256 回执到 `.reference-assets/source-exports/muzzle-flash-particles/`。
- 一处原引用**省略了扩展名**（`particle\fire_particle_4\fire_particle_4`）。导出按"唯一解析"落库并记录 `materialResolutions`（解析到什么、为什么），运行时的图校验**按这份记录核对**，不在这里猜路径；两个原系统共用同一份材质记录，不重复入库。
- 入库：运行时真正会取的闭包图 `graph.json`、这份闭包用到的原生算子缺省子集 `native-defaults.json`（并记录未过滤原表的 SHA）、两个单帧贴图 `textures/muzzleflashx-frame-0.png` / `textures/particle_flare_004-frame-0.png`，以及三份原图集字节 `sheets/*.bin`。`game/source-muzzle-particle-resources.json` 列出每个文件的字节数与 SHA，渲染器只按名单取字节并逐个校验（图集字节由运行时自己解码，见下）。
- 图集：`VTF_RSRC_SHEET`（tag `0x10`）此前只被当原始字节存下，现在由 `decode_sheet()` 在导出时解码并按 `game/source-pistol-particles-graph.ts` 里那个**运行时解码器**的布局校验（外层头部 8 字节；序列 `int id, int flags(≤1), int frameCount, float duration`；帧 `float duration` + 四个 `TexCoord(left, top, right, bottom)`）。逐序列要求 id 唯一、每帧 duration>0 且其和等于该序列总时长、矩形落在单位方格内、**必须精确耗尽资源**。三份原图集（55 个序列、352 帧）全部通过；Python 解码与运行时解码逐帧逐矩形一致。

## 接线

```ts
const fx = await loadSourceRifleMuzzleRenderer('/source/csgo-12426148/muzzle-particles/');
```

- 纯决策在 `game/source-world-muzzle-flash.ts`：一枪是**跃迁**而不是电平，且只有**已入库并移植**的原系统才画。步枪系由角色自己发布的**开火层**判定（`fireWeight`/`fireCycle`），手枪系由**世界开火动作**判定（activity 192）——两种形态各自的判据不同，见 `game/source-world-muzzle-flash.ts` 的注入点 `sourceWorldMuzzleTrigger()`。
- 移植在 `game/source-rifle-muzzle-particles.ts`：**逐相位枚举**原 vent、glow 与 `_main` 火焰各自的算子集合（emitter/initializer/operator/renderer/force/constraint），任何一项对不上就抛错，不做部分应用。vent 的半径来自原 `Remap Noise to Scalar` 的 5–7 输出范围；glow 的半径是系统自身的 25，颜色走 `Color Fade`；火焰的路径取自派发器自己的控制点，半径与 alpha 走两条原 remap。
- 渲染在 `game/source-rifle-muzzle-renderer.ts`：三个实例化 draw call 挂在同一个组里——vent 用 `muzzleflashx` 贴图（`$additive`）、glow 用 `particle_flare_004` 贴图（`$additive`）、火焰用 `fire_particle_4` 图集（`$addself` + `overbright 6`，非加法），都是屏幕朝向精灵，锚在射手世界武器的 `muzzle_flash` **原附件**上；火焰的每粒沿该附件的 **+X（枪管轴）**按原距离铺开。精灵批处理与手枪共用 `game/source-sprite-card.ts`（同一份官方 `spritecard` 公式），图集取帧与手枪 core 共用**同一段已核对的 `CSheet` 修正**。
- 附件由 `game/source-character.ts` 的 `attachment()` 提供：`root.matrixWorld · (.0254) · C · 原世界枪骨矩阵 · 原附件矩阵`。取不到（尚无权威姿态、该原模型没有该附件、骨矩阵非有限）时返回 `null` 而**不抛错**——渲染循环不会因为一个只是还没就绪的角色崩掉。

### 发射与采样的同一 tick

角色姿态更新（`updateActors`）在 `frame()` 之前跑，而 `frame()` 内部才推进 `this.clock`。若在那时就按当时的时钟登记发射，这一枪会被打上**早一帧**的时间戳，等本帧真正采样时已经过去一个帧间隔（60 Hz 约 16.7 ms）——而 glow 的原寿命只有 **0.015 s**，比一个帧还短，于是它永远等不到被采样的那一帧：vent（0.025 s）画得出来、glow 一粒也画不出来。这正是真机验证在接入 glow 后立刻抓到的现象（`glowDrawn 0`）。

原版在一次 tick 内同时完成发射与仿真，渲染的就是这一 tick 的状态（age 0）。因此移植把这一枪**排队到渲染 tick**：`fireWorldMuzzleFlash` 只登记 `{position, forward, seeds}`，`frame()` 推进时钟后由 `emitWorldMuzzleShots()` 用它此刻的时钟取原参数并发射，同一帧随即采样，二者共用一个时刻。这与第一人称闪光已有的做法（`pendingFirstPersonFlashes`，手枪与 AWP 各自按武器自己的 `muzzle_flash_effect_1st_person` 取用）是同一条规矩，不是为 glow 特设的补丁。同一套 AWP 程序还以**第二个实例**跑在视图模型自己的场景里，作为射手自己的第一人称闪光（挂在视图模型的枪口附件上），见 [AWP 自己的两条特效](source-awp-effects.md)。

## 依据与验收

算子缺省由本 build 自身的注册表 getter 执行得到（`probe-source-pistol-particle-defaults.py`，这张闭包 33 个算子）；淡出用的是与手枪 main/core **同一段已对原机器码核对过**的 eased 分支，`Color Fade` 用的是它的原缺省窗口与缓动。

```sh
npx vitest run tests/source-rifle-muzzle.test.ts tests/source-world-muzzle-tick.test.ts
npm run typecheck && npm run lint
python3 scripts/stage-source-muzzle-particles.py
node scripts/run-playwright-muzzle-validation.mjs          # 确定性烘帧 + 局域网真机
node scripts/run-playwright-rifle-flash-validation.mjs     # 射手自己的第一人称那一次
node scripts/run-playwright-awp-effects-validation.mjs     # AWP 自己的弹壳 / 曳光 / 第一人称
node scripts/serve-source-rifle-muzzle.mjs                 # 手动看这份数据（27025）
```

- `tests/source-rifle-muzzle.test.ts` 23 条：入库回执与闭包结构、**本闭包自己的**算子表、vent 的原参数逐项、glow 的原参数与颜色窗口逐项、单粒子与原区间、同种子必同值、淡出曲线与寿命、`Color Fade` 的窗口/缓动/兜底、**火焰的路径/两条 remap/半径尺度逐项**、火焰八粒沿路径铺开且 alpha 按自身 `Alpha Random` 抽取结果缩放、**标量重映射按本 build 执行结果取值（覆盖式写 13.4444、缩放式写 0.4643×0.4583=0.2128）**、半径尺度在原始起点前保持不变、**任何算子/控制点/材质变化都被拒**、图集取帧与运行时解码器逐矩形一致、**遗留算子名的唯一规范化别名解析（含歧义 fail-closed 与「别名指向同一次注册」）**、**AWP 火焰/辉光与连续火焰三条链路被完整读出（含四条 remap 的字段号、窗口与各自的缩放标志）**、**派发器的另一条火焰被读出（`assualtrifle` 原拼写、alpha 100..120、自己的 color1、半径 8..1、逐粒沿出生时间扫出）**、**它只接受自己的 `vent` 游标、算子表或 remap 窗口一变即拒**、**它在世界里画在自己的批次上并与滚动火焰共用原材质配方**、原生缺省被真正读取（改 PCF 即改行为）、staged 字节 SHA 校验与容量溢出上报。
- `tests/source-world-muzzle-tick.test.ts` 2 条：发射被打上**本帧采样所用的时钟**（而非角色阶段那个更早的时钟）、两个原系统各记各的爆发、队列每帧排空、渲染器未就绪时丢弃而不是积压。
- 确定性烘帧（`scripts/serve-source-rifle-muzzle.mjs` + `scripts/run-playwright-muzzle-validation.mjs`，自起 27025）：同一枪在固定时钟 0 / 5 / 12 ms 各烘一帧，每帧附页面自己打印的读数。0 ms 一帧读出 `vent 1 · glow 1 · flame 8`、火焰半径 0.102–0.293 m、alpha 0.017–0.121、距枪口 0.029–0.482 m、图集序列 0；12 ms 一帧半径已长到 0.111–0.319 m、alpha 淡到 0.004–0.076——即原 `Radius Scale` 与原 `Alpha Fade Out Random` 在图像上可见，而 alpha 的量级正是"缩放式 remap"该有的样子（每粒都乘上自己的 `Alpha Random` 抽取结果，因此整体比覆盖式低）。**派发器的另一条火焰在同一批烘帧里逐粒出现**：0 ms 时为 0（它的每一粒都晚于这一枪出生，这是连续发射的定义）、5 ms 时 6 粒（半径 0.085–0.183 m、alpha 0.108–0.214、最远到 0.491 m）、12 ms 时满 9 粒（半径 0.025–0.183 m、最远到 0.737 m）——即它随出生时间**扫出去并同时变细变淡**，与 `remap scalar to vector` 和半径/alpha 两条 remap 都读出生时间完全吻合。三帧图像互不相同，产物 `output/playwright/source-rifle-muzzle-preview-*.png`。这一步的存在理由很直接：15 ms 的特效没法靠截图往返捕到，只有固定时钟烘帧才看得见、可比对。
- 真机（真实浏览器 + LAN 服务，3 个真人客户端）：观察者与射手同队，射手先用手枪（`Digit2`）再用主武器（`Digit1`）各开火 3 发，**两套原系统各画出 3 次**；步枪那 3 发里 **glow 画出 3 次**（原 `radius 25`、`color1/color2`、0.7–1 颜色淡出窗口）、**滚动火焰画出 24 粒**（每发 8 粒，与原 `num_to_emit 8` 一致）且**连续火焰画出 18 粒**（每发 9 粒里已成年的那部分，配置逐项为原值 `count 9 / alpha 100..120 / 半径 8..1 / 序列 5..20 / color1 [254,233,216,255]`）；滚动火焰配置逐项等于原值（`pathLength 17.5`、`endPoint [17.5,0,0]`、`distanceMax 19`、`radius 12→4`、`sequence 5..18`）；最后一次分别是 `glock / weapon_muzzle_flash_pistol` 与 `vandal / weapon_muzzle_flash_assaultrifle`，锚点距射手 1.70 m / 1.63 m，errors=[]。同一脚本还在观察者侧**抓到画出火焰的那一帧真实画面**（`canvas.toDataURL`，1.89 MB，帧内 flame 8 / glow 1），因为 15 ms 只能同帧捕获，不可能靠截图往返。证据 `output/playwright/source-muzzle-lan-evidence.json`，截图 `source-muzzle-third-person.png`、`source-muzzle-third-person-rifle.png`、同帧 `source-muzzle-third-person-frame.png`。

## 原图集（sheet）

除 vent 与 glow 之外，同一原系统派发的子系**全部**画在 `VTF_RSRC_SHEET` 上：`_main` 火焰（`fire_particle_4`，2048×128 的十六帧横条）、枪口烟（`smoke1`）、两条抛壳口烟（`vistasmokev1_emods`）、火花（`spark`）。因此图集是剩下每一块的前提，本轮先把它变成数据。

| 贴图 | 序列 | 帧 | 说明 |
| --- | --- | --- | --- |
| `fire_particle_4` | 5 | 80 | 5 个序列各 16 帧；十六帧横条（半纹素内缩矩形） |
| `smoke1` | 16 | 16 | 16 个单帧序列 |
| `vistasmokev1_emods` | 34 | 256 | 序列帧数不等（16/6/5/3…），双序列材质 |

布局（`decode_sheet()` 在导出时校验，运行时解码器 `decodeSourcePistolParticleSheet` 是权威）：

```
sheet:    int version=1, int sequenceCount
sequence: int id, int flags(<=1), int frameCount, float duration   // duration 是该序列总时长
frame:    float duration, TexCoord x4 (left, top, right, bottom)    // 半纹素内缩
```

校验是**穷尽式**的：id 唯一、flags ≤ 1、每帧 duration > 0、帧 duration 之和等于该序列总时长、每个矩形落在单位方格内、并且**必须精确耗尽资源**——三份原图集（55 序列、352 帧）全部满足，因此没有任何一处是靠名字或补零凑出来的。

每一帧存了**四个** `TexCoord`；在这三份图集的全部 352 帧上，这四个值**逐帧完全相同**。所以取帧只需要 `rects[0]`，四份冗余不是四张不同的图（`$dualsequence` 的第二个序列走的是**序列序号**，不是第二个矩形）。

### `Sequence Random` 选的是序列，越界由原作自己的修正处理

`Sequence Random` 选的是**图集的序列**：同一张 `vistasmokev1_emods` 上，`weapon_shell_eject_smoke_assrifle2` 写 `1..1`、`assrifle3` 写 `2..2`、`weapon_muzzle_flash_smoke_small2` 写 `0..0`，各自再配一个不同的 `Sequence Two Random`；两个系统共用一份材质却取不同序号，只能在序列表里选。而 `weapon_muzzle_flash_smoke_small3` 用 `smoke1`（16 个序列）写 `0..15`，正好铺满该表——这是最干净的一处印证。

**上一轮我把 `_main` 的 `5..18` 记成"未决问题"，那个判断是错的**：`weapon_muzzle_flash_pistol_core`（本工程**已经落地**、并按原机器码核对过每个 native 槽位的系统）用的就是同一张 `fire_particle_4`、同样的 `5..18`。仓库里既有的 `sourcePistolParticleSheetFrame` 已经实现了原作 `CSheet` 的修正规则——**请求的序列在表里不存在时，别名到首个有效序列**（连同它的槽位与插值语义一起核对过）。所以火焰的 `5..18` 在 5 个序列的表上落到序列 0，这不是近似，而是原作自身的行为，本移植直接复用同一段已验证的取帧函数。

### 遗留算子名与粒子字段

closure 里有两个算子用的是**作者工具的类名拼写**：`remap initial scalar`、`remap scalar to vector`。这两个字符串在 `client_client.so` 里**一个字节都不存在**——本 build 的注册表只有显示名（`Remap Initial Scalar`、`Remap Scalar to Vector`）与 C++ 类名（`C_INIT_RemapScalar`、`C_INIT_RemapScalarToVector`）。判据有三条：① 同一份 PCF 里同一个算子两种拼写并存（`_main` 写 `Remap Initial Scalar`，连续火焰写 `remap initial scalar`）；② 覆盖字段全都能被对应显示名的 schema 容纳（`input maximum`/`output field`/`output minimum`/`output maximum`/`output is scalar of initial random range`）；③ 语义吻合——`remap scalar to vector` 的 `output maximum` 是 `[29,0,0]`/`[25,0,0]` 这样的**向量**，与手枪 core 已实现的同名算子（`[14,0,0]`）完全同形。

因此解析规则写进运行时：**先精确匹配；不中则按规范化形式（忽略大小写、空格、下划线）唯一匹配；多候选或零候选一律 fail-closed**。探测器同步用同一条规则：从二进制字符串表里按规范化唯一匹配发现别名目标，再像普通算子一样读它的 schema——目标是被**发现**的，不是手写的。结果 `absentOperators` 从两项变成空，`aliasedOperators` 记下 `remap initial scalar → Remap Initial Scalar`、`remap scalar to vector → Remap Scalar to Vector`，入库名单也随之带上别名目标。

粒子字段号（本工程用到的全部）与它们的证据：

| 字段 | 含义 | 证据 |
| --- | --- | --- |
| 0 | 位置（Vector3） | 手枪 core 的 `Remap Scalar to Vector` 写 0；AWP 火焰同样写 0，输出 `[0,0,0]→[29,0,0]` 即"随出生时间沿 +X 前推" |
| 1 | **寿命** | 本 build 自身执行 `Lifetime Random` 后写 1（值 0.025 = 手枪 main 的原寿命，见 `native-initializers.json`）；AWP 火焰的第三个 remap 也写 1（0.025→0.0175 s） |
| 3 | 半径 | vent 的 `Remap Noise to Scalar` 写 3（5–7）；执行器里字段 3 的原缺省正是 5 |
| 6 | 颜色（Vector3） | `Color Fade`/`Color Random` 写 6；执行器里字段 6 的缺省是 (1,1,1) |
| 7 | 透明度 | 执行器里 `Alpha Random` 写 7；手枪 core 的 remap 写 7 |
| 8 | 出生时间（输入） | 执行器把出生时间放进字段 8；手枪 core 的 remap `input field` = 8 |

其中字段 1 的判定完全零成本：仓库里已有的原机器码 initializer 执行结果本身就显示了"哪个字段被写"。

### 火焰的路径与两个重映射

`_main` 全部取自原数据（`num_to_emit 8`、`Lifetime 0.015`、`Alpha Random 32..36`、`Color Random [126,87,20,255]/[120,92,75,255]`、`Radius Scale` 30% 处 1→1.125、材质 `fire_particle_4.vmt`：`$addself 1`、`$overbrightfactor 6`、`$depthblend 1`，**不是加法**），其中三处几何关系互相印证、因此不必猜：

- 路径是**原派发器自己设的控制点**：`Set Control Point Positions` 把 CP1 设在局部 `+X 17.5`（CP0 即效果原点，`Set positions in world space = false`）。`Position Along Path Sequential` 的 `start 0 / end 1`、`particles to map 8` 与发射数 8 一致，序号按 `i/(n−1)` 铺开，**最后一粒正好落在端点 17.5**。
- `Position Modify Offset Random` 给每粒叠加一个 `+X 1.0..1.5` 的随机前冲。
- 于是到 CP0 的距离落在 `[0, 19]`——**正是** `Remap Initial Distance to Control Point to Scalar` 声明的 `distance minimum 0 / maximum 19`。`17.5 + 1.5 = 19` 这一处数值吻合同时钉住了上面两条读法：路径铺到端点、偏移是叠加的。
- 半径由该距离重映射得到 `12..4`（近大远小），`Remap Initial Scalar` 再**读半径字段、写 alpha 字段**（`input field 3` → `output field 7`），输出窗口 `1 → 0.125`：近端最亮、远端最淡，即"枪口浓、火尾淡"。这条字段语义来自已验证的手枪 core（那里是 `input field 8`＝时间、`output field 7`＝alpha），本移植按同一个 `input field` 规则读字段。**写 alpha 的方式是缩放而不是覆盖**，见下节。

### `output is scalar of initial random range`：缩放还是覆盖

上面两条 `Remap Initial Scalar` 都带 `output is scalar of initial random range` 字段，它决定映射值是**乘到目标字段自身的初始随机值上**还是**直接写进目标字段**。这个语义不是读字段名推出来的，而是让**本 build 自己的机器码**跑一遍初始化器链得到的：`scripts/probe-source-muzzle-particle-initializers.py` 用 Unicorn 执行原二进制的 initializer，并把每个字段在出生后的实际值打印出来；产物 `native-initializers.json`（格式 `source-muzzle-particle-initializers-native-v1`）。两条分支在执行结果里都出现了：

| 系统 | remap | 该标志 | 目标字段自身初值 | 映射值 | 执行后实际值 | 判定 |
| --- | --- | --- | --- | --- | --- | --- |
| 连续火焰 | 半径 | `false` | 无（未抽样） | 出生 0.833 ms → `13.4444` | `13.4444` | **覆盖**：映射值原样写入 |
| 连续火焰 | 寿命 | `false` | 无（未抽样） | `0.0242` | `0.0242` | **覆盖** |
| 连续火焰 | 透明度 | `true` | `Alpha Random` 抽到 `0.4643` | 映射得 `0.4583` | `0.2128` = `0.4643 × 0.4583` | **缩放**：乘到自身初值上 |

于是实现的是一条通用函数 `sourceParticleRemapScalar(input, initialValue, window)`：按 `input` 落在 `[minimum, maximum]` 的位置求出映射值，再依 `scalesInitialValue` 决定乘还是写。**步枪火焰的 alpha 因此从"覆盖"改成了"缩放"**——它会把自己的 `Alpha Random` 抽取结果按"离枪口多近"缩放，而不是把窗口值直接写进去。这也是为什么 `Alpha Random` 的抽取必须保留：连续火焰那条 `remap initial scalar`（`input field 8`＝出生时间，`output field 7`＝alpha，窗口 `0.5 → 0`）与它叠加，两者缺一不可。

AWP 的四个 remap 按同一规则逐个读标志并在构造时断言：位置与半径窗口是赋值式（`false`），alpha 是缩放式（`true`）——不符即 fail-closed，不做部分应用。

### 派发器的另一条火焰：`weapon_muzzle_flash_assualtrifle_flame`

同一個步枪派发器除 `_main`（八粒瞬时、沿控制点路径）之外还挂了一条 `weapon_muzzle_flash_assualtrifle_flame`——**名字里是 `assualtrifle`（原文件自己的拼写）而不是派发器的 `assaultrifle`**，本移植按原拼写查表，不按拼写去猜。它在结构上是 AWP 那条 `huntingrifle_main` 的**同形系统**：无子级、`emit_continuously`、同样的算子表（`Movement Basic` / `Lifespan Decay` / `Movement Lock to Control Point`，**没有** `Color Fade`）、同样的 `render_animated_sprites`、同样的 `fire_particle_4.vmt`（addself、overbright 6，配同一张原图集）、同样的 `max_particles 8` 与同两条 sim tick rate。

差别**只在数字**，且每一条都从原图读出并被断言：

| 项 | 连续火焰 | AWP 火焰 |
| --- | --- | --- |
| 发射 | `1200/秒 × 7.5 ms` → 9 粒 | 同 |
| `Sequence Random` | `5..20` | 同（两者都越界，都由原作自己的 `CSheet` 修正落到序列 0） |
| `Alpha Random` | **`100..120`** | `70..100` |
| `Color Random` | `color1 [254,233,216,255]`，另有 `tint blend mode 4` | `color1 [255,217,186,255]`，无该覆盖 |
| 半径 remap | **`8..1`** | `15..1` |
| 位置 / alpha / 寿命 remap | `[0,0,0]→[29,0,0]`、`0.5→0`（缩放）、`0.025→0.0175` | 同 |

因此这两条链路共用同一套读取器 `createMuzzleContinuousProgram`：**规格只带身份**（系统名、材质、贴图、是否有 `Color Fade`、子级名单、自己那个种子字段名），**所有数字一律在读取器里从原图取**。这样调用方**在结构上不可能**与原图不一致——早先的写法允许调用方把 `sequenceMin`/`alphaMin`/`offsetMin` 之类当成参数传进来，那些数字虽然当下读对了，但没有任何断言在守着它们；现在这个口子已经关掉。



## AWP 的第三人称枪口（另一条原链路）

`items_game.txt` 给 AWP 的第三人称枪口写的是 `weapon_muzzle_flash_awp`，而它是一条**纯派发器**：自己不设任何算子、**也不设任何控制点**（与该步枪派发器不同），只挂 `weapon_muzzle_flash_smoke_small`、`weapon_muzzle_flash_smoke_small3`、`weapon_muzzle_flash_huntingrifle_main` 与 `weapon_shell_eject_smoke_awp3`；那个火焰自己又挂 `sparks2`、`sparks4` 与本轮的 `weapon_muzzle_flash_huntingrifle_glow`。

它与步枪 `_main` 最大的差别是**连续发射**：1200 发/秒 × 7.5 ms = 9 粒，出生时间从 0.83 ms 递增到 7.5 ms，而**四条 remap 全部读粒子自己的出生时间**：

| remap | 写字段 | 窗口 | 效果 |
| --- | --- | --- | --- |
| `remap scalar to vector` | 0 位置 | `[0,0,0] → [29,0,0]`，输入 0..7.5 ms | 随出生时间沿枪管轴前推 0→29 单位（0.74 m） |
| `remap initial scalar` | 3 半径 | 15 → 1 | 近端大、远端小 |
| `remap initial scalar` | 7 透明度 | 0.5 → 0，输入 0..10 ms | 近端亮、远端灭 |
| `remap initial scalar` | 1 寿命 | 0.025 → 0.0175 s | 先出生的活得久 |

三条 `remap initial scalar` 的 `output is scalar of initial random range` **并不一致**：半径与寿命是 `false`（把映射值直接写进字段），alpha 是 `true`（把映射值乘到该粒子 `Alpha Random` 的抽取结果上）。逐条读标志、逐条断言，是上一节由机器码证明的规则在本链路上的直接应用。

辉光 `_glow` 是同一形状的 3 粒（500 发/秒 × 7.5 ms 向下取整），位置到 25 单位、半径 22→6、alpha 1→0，另有 `Color Fade`（寿命 70%→100%）把颜色送去原目标；材质是 `particle_glow_04_additive.vmt`（原加法 unlitgeneric），贴图随之入库。

### `Movement Lock to Control Point` 怎么处理

这两个系统都带 `Movement Lock to Control Point`，而它的字段描述的是一个**锁定强度**：`start/end fadeout` 各三条、外加 `distance fade range`（按到控制点的**距离**淡出锁定强度）与 `lock rotation`。这套字段只有在"粒子保有自己到控制点的距离"时才说得通——也就是说它是把粒子绑到**控制点的坐标系**（保留自身偏移、跟随控制点运动），而不是把它吸附到原点；否则那位移 0→29 单位的扫掠就毫无意义，`distance fade range` 也无从谈起。AWP 派发器**不设控制点**（=默认原点/单位基），本移植又把一个爆发锚定在**固定的世界点**上，因此满强度锁定**没有东西可动**。

于是它的处理是**断言 + 论证**而不是近似：`control_point_number 0`、六条 fadeout 全为 1、`distance fade range 0`、`lock rotation` 关闭——任何一条不符即 fail-closed（单测逐个反例覆盖）。这条推理与其前提都写进了 `limitations`。

### 验收

`scripts/run-playwright-muzzle-validation.mjs` 的确定性烘帧现在同时烘两条链路（同一个真实 WebGL 场景、固定时钟）：AWP 在 4 / 10 / 22 ms 各一帧，`flame 4/1 → 9/3 → 9/3`（连续发射期间逐粒出现），火焰位置从 3.222 → 29.000 单位扫过、半径 0.341 → 0.025 m、alpha 0.178 → 0.043，图集帧号随 `animation rate 8` 从 0 推进到 2；三帧图像各不相同（并新增"烘帧之间必须不同"的断言，防止"烘出来但画面里什么都没有"）。产物 `output/playwright/source-awp-muzzle-preview-*.png`。

**房间内验证的前置条件（harness 限制，非实现缺口）**：局域网房间用原版竞技经济开局 800，首局买不起 AWP（4750），而现有验收脚本里没有任何买入路径，因此观察者看到 AWP 枪口那一幕还没有房间内样本；它走的是同一段渲染代码、同一个原系统名（决策层单测已断言 AWP 现在被判为 `ok` 而不是 `third-person-effect-not-staged`）。

## 尚未恢复的部分

1. 步枪侧只执行 vent、glow、`_main` 滚动火焰与派发器的另一条火焰 `weapon_muzzle_flash_assualtrifle_flame`（连续火焰）；AWP 侧只执行 `huntingrifle_main` 与 `huntingrifle_glow`。同一批原系统的枪口烟、三条抛壳口烟与火花都未执行（原参数、原材质与原图集已随图交付）。**这些子系统的原生算子缺省已全部入库**（`absentOperators` 为空）：`_main` 火焰需要的 `Position Along Path Sequential` 与 `Remap Initial Distance to Control Point to Scalar` 在表里，`weapon_muzzle_smoke` 需要的 `Velocity Noise`、`Oscillate Scalar`、`Movement Lock to Control Point` 同样，两个遗留名也已按下面的规则解析。

2. **连续火焰已落地**：`weapon_muzzle_flash_assualtrifle_flame` 是 `huntingrifle_main` 的同形系统（同样无子级、同样连续发射、同样三条 remap 读出生时间），差别只在数字——alpha `100..120`、自己的 `color1 [254,233,216,255]`、半径 remap 到 **8**（不是 15）。它与 AWP 链路共用同一套共享读取器，见上面的连续发射表与标量重映射一节。AWP 的 `huntingrifle_main` / `_glow` 带的是同一条 `Movement Lock to Control Point`，但它们的派发器不设控制点、本移植又锚在固定世界点上，因此那里的处理是**断言 + 论证**（`control_point_number 0`、六条 fadeout 全为 1、`distance fade range 0`、`lock rotation` 关闭，任一不符即 fail-closed，单测逐个反例覆盖），并把推理与前提写进 `limitations`。
3. 原 vent 的半径由一条对**绝对世界时间**取样的平滑噪声场决定。该噪声函数没有复刻；本移植按「射手 id + 该射手第几枪」从**原标量表**取一项落在原 5–7 区间内的值，两端因此必然一致——这是明确的适配器，不是原噪声实现。
4. 原派发器的控制点、首个仿真步的调度相位与逐 initializer 的 RNG 调用顺序未执行；vent 按其原粒子数与原参数区间取值。
5. 原 SpriteCard 的深度羽化与 HDR/tone-map 未复刻；加法混合、原贴图、半径/透明度/旋转是原值。
6. **AWP 链路已入库并绘制**：`weapon_muzzle_flash_awp` 没有 vent，它派发 `weapon_muzzle_flash_huntingrifle_main` 的连续火焰、`_glow` 与两团烟、一条抛壳口烟；决策层现在把 AWP 判为 `ok` 而不是 `third-person-effect-not-staged`，火焰与辉光按原参数、原材质、原图集绘制，另外三团烟与火花仍未执行。

## 枪口烟/抛壳口烟的前置已入库，两个未知已量出一个（2026-09-12）

派发器还挂着四条一次发射的烟系统：`weapon_muzzle_flash_smoke_small2`（`vistasmokev4_nearcull`）、`weapon_muzzle_flash_smoke_small3`（`smoke1`）、`weapon_shell_eject_smoke_assrifle2` 与 `assrifle3`（都走 `vistasmokev1_emods`）。它们此前只在图里，本轮的进展是**把画它们所需的东西全部备齐并把两个未知收掉一个**：

- **贴图与图集入库**：`scripts/stage-source-muzzle-particles.py` 的 `TEXTURES` 增加 `smoke1`、`vistasmokev1_emods`（34 序列、256 帧）与 `spark` 三张原图，连同本就在名单里的 `smoke1.bin` / `vistasmokev1_emods.bin` 两份图集字节，共 12 个文件入库，逐个带字节与 SHA 回执（`game/source-muzzle-particle-resources.json`）。渲染器只按名单取字节并逐个校验；本轮**没有任何系统开始画它们**，因此 `tests/source-rifle-muzzle.test.ts` 的"未取用但仍入库"名单同步加上了这三张图。
- **四条烟的全部原参数已按本 build 自己的原生缺省读出**：`scripts/probe-source-muzzle-smoke-parameters.ts` 用仓库既有的读取器把每条系统的 emitter / initializer / operator / renderer 逐字段解出来，快照 `research/source-muzzle-smoke-parameters.json`。要点：四条都是 `emit_instantaneously`（枪口烟 1 粒与 4 粒；抛壳口烟各 1 粒，每帧上限 2）；都有 `Position Modify Offset Random` 的局部偏移、`Movement Basic` 的**非零重力**（枪口烟 `[0,0,40]` 向上、抛壳口烟 `[0,0,-4]`/`[0,0,-10]` 向下）与 `0.05` 阻力；枪口烟有 `Position Modify Warp Random`、`Remap Noise to Scalar` 半径窗与 `Radius Scale`（`1→3`、`2→4`、bias 0.4/0.5）、`Alpha Fade Out Random` 0.18 s；抛壳口烟有 `Radius Random`、`Alpha Fade In Random` 0.1 s、`Set Control Point To Particles' Center` 与 renderer 的**距离透明度代理**（`Visibility Proxy Input Control Point Number 1`）。**这些数字没有一处需要猜。**
- **`$dualsequence` 混合语义已量出**：上一轮把"`$sequence_blend_mode` 是唯一未知"记在这里，现在它不是未知了。客户端二进制 `bin/stdshader_dx9_client.so` 里带着 SpriteCard 自己的参数文档字符串，逐条写着语义：`0 = avg, 1=alpha from first, rgb from 2nd, 2= first over second`；本工程的三个双序列材质都写 `$sequence_blend_mode 1`，即**取第一条序列那一帧的 alpha、第二条序列那一帧的 rgb**。同一段文档还给出 `$maxlumframeblend1/2`（"instead of blending between animation frames …, select pixels based upon max luminance"）与 `$blendframes`（"whether or not to smoothly blend between animated frames"）。`scripts/probe-source-spritecard-sequence-blend.py` 把这几条连同偏移、客户端文件 SHA 与分支条件写进 `research/source-spritecard-sequence-blend.json`。**边界**：这是读客户端随包下发的参数文档与分支条件，不是读编译后的着色器汇编；它说明客户端自己讲每种模式是什么，不是对混合本身的测量。
- **仍然挡在路上的一个未知：`Movement Basic` 的位置代数**。四条烟都有非零重力与阻力，而本工程对没读通过的算子一律 refuse。`scripts/probe-source-movement-basic.py` 已把这个算子定位到字节级：注册点 `0x403f2c`、definition 表 `0x11142e8`、实例工厂 `0xd2bbe0`（分配 `0x6c` 字节并写入实例 vtable `0x1110ca8`）、apply 方法 `0xd0d800`；实例里重力是 `+0x58/+0x5c/+0x60` 三个 float、阻力是 `+0x64` 一个 float；apply 开头先算 `1 - max(drag, 0)`（常量 `1.0` 与 `0.0`），乘 `30.0`（tick 率）与 `dt`，再走 `__expf_finite`，即**阻力是指数衰减而不是每帧线性相减**。但**位置更新本身（逐子步的位置历史如何由这个因子与逐子步重力数组算出来）还没读通**，`research/source-movement-basic.json` 的 `reading.boundary` 明确写着"不得据此写仿真"。下一步是把该方法后半段的逐粒子循环与粒子结构布局对上。

## 第一人称那一次：同一套程序，第二个实例（2026-09-12 21:00）

`items_game.txt` 的第一人称列给步枪系 `weapon_muzzle_flash_assaultrifle`、给 AWP `weapon_muzzle_flash_awp`——**与它们各自的第三人称列同名**，但画在两个地方：别人看到的锚在**世界武器**自己的 `muzzle_flash` 原附件上（本页上面那一整套），**射手自己看到的锚在视图模型自己的枪口附件上**（步枪 `muzzle`、AWP 第 1 号），而且画在**视图模型自己的场景**里（`gunScene`，与世界是两个渲染通道）。

此前射手自己看到的那一次**不是原件**：`this.muzzle` 一直是端口自己的圆锥替身（亮 0.22 秒），只有手枪那一系把它藏掉、改用原件粒子。现在步枪与 AWP 各用**同一套程序的第二个实例**（`loadSourceRifleMuzzleRenderer` / `loadSourceAwpMuzzleRenderer` 各再加载一次并加入 `gunScene`），原件画的那一刻就把替身藏掉；**哪条系统由武器自己那一列决定**（`game/source-first-person-muzzle.ts`，不是按武器名写死），武器自己的名字不在已入库那三条里就返回 null、**保留替身**，不借别人的系统。

真机验收 `scripts/run-playwright-rifle-flash-validation.mjs`（训练局出生主武器就是步枪，不需要买入；`output/playwright/source-rifle-flash-ingame.json`）：

| 断言 | 实测 |
| --- | --- |
| 是武器自己那一列点名的系统，锚在视图模型自己的枪口附件 | `weapon_muzzle_flash_assaultrifle`、`vandal`、附件 `muzzle`、锚点 `[0.1259, −0.0877, −0.9618]`（沿枪身 0.97 m） |
| 端口自己的圆锥没有顶替它 | `placeholderVisible = false` |
| **四个子系统各画出自己整份发射** | vent **1**、glow **1**、滚动火焰 **8**、连续火焰 **9**（与原 `num_to_emit` 逐项相等；总量 vent 5 / glow 3 / flame 24 / continuous 18，跨 5 帧多次开火） |
| glow 画在枪口**正上** | 距锚点 `0`（原系统的随机出生盒就是零） |
| vent 落在自己的出生球内 | 距锚点 ≤ 自己的 `0.1` 单位（0.00254 m） |
| 两条扫掠都向前 | 滚动火焰与连续火焰沿枪管轴 `along ≥ 0`，无一粒落在枪口后方 |
| 每粒的半径与 alpha 都在自己的窗口里 | 火焰半径取自己的 12→4、alpha 取自己的缩放式 remap；vent 半径 5..7、alpha 190..230；glow 半径 25、alpha 160..190 |
| **每一行带着自己被画出时的锚点** | 渲染器写精灵时一并写下 `anchor`/`forward`；第二枪会把枪口移动，拿最新锚点去量旧精灵就是量错了枪口（验收脚本第一次跑正是这样误报 4 mm） |
| 辅助：帧缓冲截图 | `output/playwright/source-rifle-flash-first-person-frame.png`（读回被拒绝时如实写明，不作证据） |
| 页面错误 | `errors = []` |

AWP 侧同理：同一个系统名的第二个实例、锚在 AWP 视图模型的第 1 号附件上，一次爆发画出 9 粒火焰 + 3 粒辉光（原件的 9 与 3），见 [AWP 自己的两条特效](source-awp-effects.md)。**仍缺**：开镜时整支视图模型枪都不画（`showGun` 为假），那一枪的闪光也随之不画——原件开镜时是否仍发射该系统没有录像对照；本页"尚未恢复的部分"里那些还没执行的子系统（枪口烟、抛壳口烟、火花）在第一人称同样没有；第一人称这一路同样只读端口自己画出的东西，与原件录像的逐帧对照仍然没有。
