# 原作曳光

`items_game.txt` 给每把武器写一个 `tracer_effect`，它指向 `particles/weapons/cs_weapon_fx.pcf` 里的一条系统。这几条系统画的不是一张贴图，而是**一条轨迹**：`render_sprite_trail` 把粒子走过的路画成一条带子，粒子本身由 `move particles between 2 control points` 在两点之间以一万三千单位/秒扫过去。这一轮把它们读出来、入库、接进真实射击路径并真机验收。

## 一个曳光由六组字段定出来

| 步骤 | 发货文件 | 读到的字段 |
| --- | --- | --- |
| 1 这把枪放哪条系统 | `items_game.txt` 的 `visuals.tracer_effect` | AK-47/M4A4 → `weapon_tracers_assrifle`；AWP → `weapon_tracers_rifle`；Glock/USP/Deagle → `weapon_tracers_pistol` |
| 2 它怎么画 | `render_sprite_trail` | `max length 500`、`min length 0`、`length fade in time 0.101`（手枪 0.0801）、`constrain radius to length false`、`animation rate 0.1`、`tail color and alpha scale factor 1 1 1 1` |
| 3 它怎么走 | `move particles between 2 control points` | 速度 `13000`（AWP `13000..14000`、手枪 `12000..13000`）、`end control point 1`、`end spread 0`、`start/end offset 0` |
| 4 它从哪多点开始 | `Position Modify Offset Random` | 局部偏移 `20 0 0`（AWP `80 0 0`）、`offset in local space 1`；**手枪没有这条算子**，所以它的带子就从线上开始 |
| 5 它多长、多宽、多亮 | `Trail Length Random` / `Radius Random` / `Alpha Random` / `Color Random` | 时长 `0.084..0.093`（AWP `0.19..0.20`、手枪 `0.044..0.05`）、半径 `3`（AWP `4..7`、手枪 `2..3`）、alpha `160..175`（AWP `140..180`、手枪 `140..205`）、`color1 247 188 94 255` → `color2 255 245 219 255` |
| 6 它怎么淡出 | `Alpha Fade and Decay for Tracers` | `start_alpha 0`、`end_alpha 0`（本 build 缺省）、`0.2 / 0.3 / 0.95 / 1.0` 四个时间 |

材质是 `particle_spark.vmt`：`spritecard`、`$additive 1`、`$splinetype 2`，贴图 `effects/spark.vtf`（32×64，VTF 7.4，7 级 mip，两轴 clamp）。三条系统的 `Movement Basic` **没有写任何重力与阻力**，本 build 的缺省也是 `0 0 0` / `0`，所以曳光是沿射击线走的，不是抛物线。

## 为什么轨迹可以直接画成一条带子

`move particles between 2 control points` 把粒子从控制点 0 扫到控制点 1，而这两个控制点就是这一枪的**起点与落点**。粒子的路径因此**就是**这条射击线，所以"记住粒子去过哪里"与"沿这条线画一条带子"是同一条曲线——端口画的是后者，它是精确的那条，不是近似。带子本身分段面向相机（每一段各自朝相机做侧向），贴图沿带子铺开。

## 两个数字是量出来的，一个读法是讲清楚的

**带子的长度是原件自己的两个数合出来的。** 时长 × 速度给出粒子这一瞬间身后拖了多长（步枪 `0.0885 × 13000 ≈ 1150` 单位），但 `render_sprite_trail` 的 `max length 500` 把它截到 **500 单位 = 12.7 m**；同时 `length fade in time` 让这条带子从出生起的 0.101 秒内**线性长到满长**。真机逐帧记录把这条斜坡量了出来：某发 55 m 的枪，带子在 age 0.0167/0.0333/…/0.1333 s 上分别是 `2.10 / 4.19 / … / 12.70 m`，与 `min(500×0.0254, 12.7/0.101 × age, 速度 × age)` 逐帧相符（斜率 125.7 m/s）。

**带子的宽是 `Radius Random` 的半径。** 3 单位 = 0.0762 m 是**半宽**（与端口既有的 spritecard 同一约定：半径是半边长）。

**四个淡出时间是按"粒子自己寿命的比例"读的，这一点写明了。** 读到的是 `0.2 / 0.3 / 0.95 / 1.0`。如果当成绝对秒数，它们比任何真实一枪的飞行时间都长（步枪 55 m 的一枪只飞 0.167 s，而窗口开到 0.3 s 与 1.0 s），带子就**永远不可能被看见**；而且本 build 自己给 `end_fade_out_time` 的缺省正好是 **1**。所以这张表把这四个时间读作**飞行进度的比例**，并把证据与边界一起写进 `fadeTimeBasis`：算子自己的算术**没有执行**，这是**讲清楚**的读法而不是量出来的。

按这个读法，一条带子的 alpha 在飞行前 20% 是 0（刚出膛那一段不画）、20%→30% 升到满、95% 之后降到 0。带子沿长度方向用一个 alpha（`tail color and alpha scale factor` 是 `1 1 1 1`，原件让尾端与头端一样亮）。

## 数据落地

| 产物 | 内容 |
| --- | --- |
| `scripts/export-source-tracers.py` | 读三条系统与它们的每个算子，写闭包图；再读本 build 自己的算子 schema 与缺省（`native-defaults.json`，由 `scripts/probe-source-pistol-particle-defaults.py` 从客户端注册表读出）；把材质、VTF 与其 PNG 一并留证 |
| `scripts/stage-source-tracers.py` | 入库 `public/source/csgo-12426148/tracers/spark.png`、`provenance.json`、运行时表 `game/source-tracers.json`、字节回执 `game/source-tracer-resources.json` |
| `game/source-tracers.ts` | 装载器 + 绘制：核对贴图字节、按系统建带子、按原件的速度与淡出推进、按 `maximum draw distance` 决定画不画 |
| `game/source-tracer-draw.ts` | 一发子弹自己的抽签（速度/半径/alpha/颜色/时长），由射手与这一枪的 seq 派生 |
| `tests/source-tracers.test.ts` | 7 条：表取自本 build、三套数字各自独立、算子闭包被本 build 自己的 schema 覆盖（含**一条小写算子名的解析来自客户端自己的别名表**）、四个淡出时间按比例读并有证据、GLB/贴图字节与回执一致、一发一签、长枪的飞行时间短于任何窗口 |

表的字段是**生效值**：PCF 写了就用 PCF 的，没写就用本 build 自己的缺省，两者都在导出回执里。比如 `end_alpha` 与 `end_fade_out_time` 在三条系统里都没写，表里就是本 build 的 `0` 与 `1`。

复现时的两步，以及一个会挡住第一步的环境问题：原生缺省由 `scripts/probe-source-pistol-particle-defaults.py` 从客户端的注册表里读出，它需要 `pyelftools` / `capstone` / `unicorn`。仓库里的 `.tools/source-binary-venv` 指向一个已经不存在的解释器（`/Library/Developer/CommandLineTools` 的 Python 3.9），而当前环境里的 `PYTHONHOME` 又指向一个不存在的 3.10 框架，任何解释器都会以 `No module named 'encodings'` 失败。可用的跑法是清掉这两个变量并用 `uv` 取依赖：

```
env -u PYTHONHOME -u PYTHONPATH uv run --python-preference only-managed --python 3.12 \
  --with pyelftools --with capstone --with unicorn \
  python scripts/probe-source-pistol-particle-defaults.py .reference-assets/source-exports/tracers
```

它会把 `native-defaults.json` 写在导出的目录里（连同把 PCF 的小写算子名解析到本 build 的注册名的 `legacyAliases`），`export-source-tracers.py` 下次运行就会取它。

## 拒绝路径（一律不画，不拿别的顶替）

- 武器指名的系统不在 PCF 里、或系统没有任何武器指名：拒绝整张表。
- 每次发射量小于 1、速度/半径/时长区间端点反向、`alpha` 区间反向、`maximum draw distance` 非正：拒绝整张表。
- 系统在射击线以外偏移（局部偏移的 y/z 非零）、或偏移在一个端口没有携带的轴上是随机的、或系统带重力/阻力：拒绝整张表（端口只画沿线的带子）。
- 材质不存在、贴图不是 VTF、帧数不是 1、解码尺寸与声明不符、PNG 不可复现：拒绝整张表。
- 暂存的贴图字节数与 SHA 与回执不符、或 HTTP 取不到：拒绝装载（不回退到"没有曳光"）。
- 一枪的起点与落点退化成零长度：拒绝这一发并计入 `refused`。

## 一枪只画一条

一枪在客户端会到两次——一次是本机预测，一次是权威的答复。`spawn` 用「射手:seq」认这一枪，已经有一条在飞就不再画第二条。真机证据里 `refused` 为空、`spawned 16 / finished 15`（最后一条在读取时还在飞）。

## 真机验收

`scripts/run-playwright-tracer-validation.mjs`（真实浏览器 + 局域网服务 + 训练局，`output/playwright/source-tracer-ingame.json`）：

| 断言 | 实测 |
| --- | --- |
| 系统与材质是持有武器自己那一条 | 步枪 → `weapon_tracers_assrifle`、`materials/particle/particle_spark.vmt`；手枪 → `weapon_tracers_pistol` |
| 带子落在这一枪自己的线上 | 起点在射击起点沿线的 `+0.508 m`（= 系统自己的 20 单位）、终点与权威落点差 0（1e-6 内）、线长 = 报告线长 + 偏移 |
| 速度、宽度、alpha 落在系统自己的区间里 | 330.2 m/s（13000 单位）、半宽 0.0762 m（3 单位）、alpha 0.648（165/255） |
| 颜色在系统自己的两色之间 | `color1 247 188 94` → `color2 255 245 219` 之间 |
| 带子长度是自己的上限 | 12.7 m（= `max length 500` 单位） |
| **带子真的是它自己那么长**（从写出的顶点量回） | 12.70000016 m，半宽 0.07619953 m |
| 逐帧：长度按 `length fade in time` 长起来、每帧都可见、都在视野内 | 55 m 的一枪飞 0.167 s，抓到 6 条带子的逐帧记录、32 帧在视野内；带子从 2.10 m 长到 12.70 m；没有任何一帧是"在飞但被藏起来" |
| 页面错误 | `errors = []` |

逐像素差分也在同一脚本里做（藏掉曳光后带子所在框内的像素确实变了），但**只作辅助**：同一对帧里画面自己也在动，两者分不开，所以脚本自己写明这一点，硬证据是上面那条逐帧记录。射击点在出生点正面，脚本先把视角转向空旷方向并抬高一点——否则一枪打在 3.6 m 外的墙上，曳光只飞 **11 ms**（比一次往返还短），根本抓不到。

AWP 自己那条（`weapon_tracers_rifle`，起点偏 80 单位、半径 `4..7`、速度 `13000..14000`）另有一次独立真机验收：从游戏自己的商店买枪后开枪，见 [AWP 自己的两条特效](source-awp-effects.md)。

## 仍然缺的

`$splinetype 2` 的样条平滑（路径本来就是直线，没有可平滑的东西）；`aggregation radius` 的批处理（端口各画各的）；贴图沿带子的方向（PCF 没有声明，端口让 v 从尾到头）；四个淡出时间的**算术本身**（按比例读，读法已写明而非实测）；控制点 0 在原件里到底是枪口附件还是别的（端口用权威射线自己的起点，系统自己的 20/80 单位偏移把它推到枪口之外）；与记录的逐帧对照。
