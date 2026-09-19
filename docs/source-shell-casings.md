# 原作弹壳（抛壳）

原作每一枪都会把一枚弹壳抛出枪身。它不是一张贴图，是一个**粒子系统**：`items_game.txt` 给每把武器写 `eject_brass_effect`，它指向 `particles/weapons/cs_weapon_fx.pcf` 里的一条系统；这条系统自带模型、重力、阻力、寿命、自转速率、初速、碰撞响应。这一轮把这套数据从发货文件里读出来、入库、接到真实射击路径并真机验收。

## 一个弹壳由七组字段定出来

| 步骤 | 发货文件 | 读到的字段 |
| --- | --- | --- |
| 1 这把枪抛哪条系统 | `scripts/items/items_game.txt` 的 `visuals.eject_brass_effect` | AK-47/M4A4 → `weapon_shell_casing_rifle`；AWP → `weapon_shell_casing_50cal`；Glock/USP/Deagle → `weapon_shell_casing_9mm` |
| 2 这条系统画哪个模型 | `cs_weapon_fx.pcf` 的 `Render models` | `models\weapons\shared\shell_{762,50cal,9mm}_hr.mdl`，材质 `particle\shells\particle_shells.vmt` |
| 3 它怎么动 | `Movement Basic` + `Lifespan Decay` + `Rotation Spin Roll`/`Yaw` | 重力 `0 0 -600`、阻力 `0.05`、寿命 `0.8`、自转 `85`/`125` deg/s 且各自 `spin_stop_time`、偏航 `20` deg/s |
| 4 它从哪出发、朝哪走 | `Position Within Sphere Random` + `Radius Random` + `emit_instantaneously` | 局部速度区间（步枪 `[120,-15,50]`..`[150,5,75]`）、半径 `0.08`、每次 1 粒 |
| 5 它撞到什么会怎样 | `Collision via traces` | `DEBRIS`、`brush only`、`amount of bounce`、`amount of slide` |
| 6 一粒能有多少 | 系统自己的 `max_particles` / `radius` / `maximum draw distance` | 步枪 `16 / 0.75 / 400`、.50 `32 / 3 / 512`、9mm `16 / 0.75 / 400` |
| 7 近处看不见时画什么 | 系统自己的回退定义 | `render_animated_sprites`，半径 `1.25 / 2.0 / 3.5` |

`Position Within Sphere Random` 的**速度就在发射器自己的坐标系里**。这一点由测量定案（见下），不是按名称推断的。

## 三个数字是量出来的，不是猜的

**模型单位是毫米。** `shell_9mm` 的几何体量出 `19.15 × 9.63`、`shell_762` 量出 `38.7 × 11.0`、`shell_50cal` 量出 `57.067`——分别就是 9×19、7.62×39、.50 三种真弹壳的长度与底缘直径。同样的三个弹壳在这个 depot 里**还有一份以英寸为单位的**（`models/shells/shell_9mm.mdl` = 0.893、`shell_762nato.mdl` = 2.355），而 Source 的单位就是英寸。第三条独立事实是每条系统自己的回退精灵：`radius 1.25 / 2.0 / 3.5` 画的是同一个物体。因此表里写明 **1 模型单位 = 1 毫米**，并且写清边界：**本 build 的客户端里没有 1/25.4 这个常量**（`client_client.so` 里按 float32 扫描 `1/25.4` 与 `25.4` 都是零次），所以原件在哪里做这次换算是**没量到**的，端口把它显式写在表里。

**重力是世界向量，速度是发射器局部向量。** 这两件事不能用同一条换算：重力 `0 0 -600` 是 Source 世界坐标（+Z 向上，负值向下），按端口既有的 Source→世界映射 `(x,y,z) → (x,z,−y)` 变成 `(0,−600,0)`；而速度分量属于发射器自身。把速度也过一遍那条映射会怎样，是**在 AK 自己的抛壳骨上量出来的**：

| 读法 | 右 | 上 | 前 |
| --- | --- | --- | --- |
| 分量直接用在发射器自己的轴上 | 0.821 | 0.410 | 0.398 |
| 分量先过 Source→世界映射 | 0.999 | −0.030 | 0.038 |

AK 抛壳是往右上、略朝前飞；第二种读法把每一粒都甩成**完全侧向、零抬升**。所以速度与出膛偏移都用第一种。同一支骨上还量出另一件事：**它带着模型自己的英寸→米缩放**（三个轴各长 `0.0254`），所以从它直接取旋转矩阵会把这个缩放折进四元数里——量到的四元数模长是 `0.517`，不是 1，方向也会翻（前向变成 `−0.482`，即朝玩家背后飞）。端口先把三个轴归一化再取四元数。

**碰撞要打整个关卡，不只是地面。** `Collision via traces` 写的是 `brush only`，即与世界的 brush 求交。上一版只对地面列采样，于是打向墙的弹壳会**穿进墙里消失**（真机截图里那一粒就看不见）。现在每一步都用关卡自己的 `traceBullet`（与子弹、弹着贴花同一条链路）取交点与法线，再按算子自己的两个数响应：法向分量掉头并乘 `amount of bounce`，切向分量保留 `amount of slide`。响应写成 `game/source-shell-casings.ts` 的 `shellCollisionTravel()`，单测把地面与墙面两种面各钉一次——**法向那一步必须掉头**，一开始写成只是缩放，测试立刻抓到。

## 每 1/30 秒怎么走一步

`Movement Basic` 的更新不是近似积分，而是**在原客户端里执行出来**的一条式子（`scripts/probe-source-movement-basic-apply.py`）：`新位置 = 位置 + dragFactor·(位置 − 上一个位置) + 重力·dt²`，`dragFactor = (1−max(drag,0))^(30·dt)·(dt/tickInterval)`。端口按原件的 `1/30 s` 步进（此时 `dragFactor` 恰好等于 `1−drag`），撞面后把"上一个位置"反解成刚算出的反弹位移，使下一 tick 的式子正好接上，而不是另塞一套速度变量。

自转照原字段走：`Rotation Spin Roll` 到自己的 `spin_stop_time` 就停，`Rotation Spin Yaw` 不停。`Lifespan Decay` 的 0.8 秒到点即移除——**原件没有"落地静止"这个状态**，所以端口也不冷冻弹壳；审计里的 `resting` 只是由"已经几乎不动"推出来的读数，不是原件有的状态，这一点写在表的 `limitations` 里。

## 数据落地

| 产物 | 内容 |
| --- | --- |
| `scripts/export-source-shell-casings.py` | 从 `cs_weapon_fx.pcf` 取三条系统的每个字段，写闭包图，再读本 build 自己的原生算子 schema（`native-defaults.json`），并把模型/MDL/顶点/材质/纹理的字节与 SHA 一并留证 |
| `scripts/import-source-shell-models.py` | Blender + 固定 SourceIO 把三个 `.mdl` 导成 GLB（11,664 / 11,676 / 10,084 字节）与 `shells.png`（256×256，119,858 字节） |
| `scripts/stage-source-shell-casings.py` | 入库运行时真正会取的东西：三个 GLB、贴图、`provenance.json`、运行时表 `game/source-shell-casings.json`、字节回执 `game/source-shell-resources.json` |
| `game/source-shell-casings.ts` | 装载器 + 模拟器：逐个字节核对回执、按系统自己的模型建池、按原 tick 步进、按原算子响应碰撞 |
| `tests/source-shell-casings.test.ts` | 11 条：表取自本 build、三套数字各自独立、算子闭包被本 build 自己的 schema 覆盖、单位换算带证据、**GLB 几何就是模型自己的毫米尺寸**、原地 tick 与阻力、单位向量的读法（含两种读法的对照）、碰撞响应的地面与墙面两种面、失效即拒绝 |

## 拒绝路径（一律不画，不拿别的顶替）

- 系统被任何武器引用不到：整张表拒绝（装载时逐条检查 `weapons` 是否点名了每个系统）。
- 粒子预算不是正整数、每次发射量小于 1、速度区间端点是反的、寿命不是区间、碰撞响应为负：拒绝整张表。
- 单位换算字段缺失或不正：拒绝整张表，不默认某个倍数。
- 暂存模型/贴图的字节数与 SHA 与回执不符、或 HTTP 取不到：拒绝装载（不回退到"没有弹壳"）。
- 抛壳附件退化成零基：拒绝该次生成并把原因计入 `refused`，不画在原点。

## 覆盖与仍然缺的

三条系统全部入库，六把已实现武器各自的 `eject_brass_effect` 逐条对表（AK/M4A4 → 步枪，AWP → .50，Glock/USP/Deagle → 9mm）。**弹壳已实现并真机验收**，见下节；**曳光也已实现并真机验收**，见 [原作曳光](source-tracers.md)，AWP 自己那两条系统另见 [AWP 自己的两条特效](source-awp-effects.md)。

表里显式声明的边界（`limitations`）：`Collision via traces` 的 `brush only` 落实为"打关卡，不打角色或动态道具"；`Alpha Fade Out Random` 在本 build 里每个字段的缺省都是 0，所以不做淡出；系统的回退定义已导出但任何距离都画主模型；抛壳附件用的是武器自己的抛壳骨（PCF 只说速度是发射器局部的，没有点名附件）；发射器旋转按纯旋转施加，原件对变换里非旋转部分的处理没有量到；弹壳一直模拟到自己的寿命结束，审计里的 `resting` 只是读数。

## 真机验收

`scripts/run-playwright-shell-validation.mjs`（真实浏览器 + 局域网服务 + 训练局，`output/playwright/source-shell-ingame.json`）：

| 断言 | 实测 |
| --- | --- |
| 每一发都抛出一枚原系统弹壳 | 3 波 ×4 发 = 12 发，抛壳 55 枚，`refused = {}` |
| 抛的是持有武器自己那条系统与模型 | `weapon_shell_casing_rifle` / `shell_762` |
| 初速落在系统自己的区间内、且是旋转后的向量而非归一化方向 | 4.117 m/s，区间 `3.324..4.262`；`\|velocity\| == speed` |
| 每一步都过了关卡自己的碰撞 | `landed 60` / `surfaceHits 60`（只对地面采样不可能得到这个数） |
| 飞行位移与寿命 | 在飞 7 枚、最远 1.85 m、无一枚超过自身 0.8 s 寿命 |
| 画出来的就是真弹壳 | 每枚模型 142 三角形；藏掉弹壳后帧内三角形正好少了 952（同帧自身漂移仅 2） |
| 单位换算被真正施加 | 画出的一枚 = `0.0387 × 0.0110 × 0.0112 m`（7.62×39 实弹 38.7 mm），与模型几何自身的尺寸逐位相符 |
| 页面错误 | `errors = []` |

同一脚本还会在**取得到静止帧**时额外留一张放大截图与逐像素差分（藏掉弹壳后弹壳自身像素处的变化必须远大于同尺寸对照框）。场景里机器人走动、被击杀重生都会让帧不稳定，这种帧被**丢弃并计入 `frameAttempts`**，绝不当作证据；差分只是**辅助**证据，硬门禁是上面那条"帧内三角形"的确定性断言。

## 仍然缺的

`.50cal` 自身的 `amount of bounce 0.8` 没有被真机执行到（真机那一枪 0 次弹跳，只由表值与单测钉住）；`Alpha Fade Out Random` 的淡出（本 build 缺省为 0，原件是否真的不淡出没有录像对照）；系统回退定义在远处的绘制；抛壳附件是不是 PCF 指定的那一个（PCF 只说速度是发射器局部的，没有点名附件，端口用武器自己的抛壳骨）；原件对发射器变换里非旋转部分的处理；与记录的逐帧对照。
