# App740 原玩家 Hull / 运动默认值补证

> **2026-09-09 PHY 坐标纠正**：本文件早期 `dust2/collision/` 的世界/道具 PHY 验收已被后续真实 LAN 复现推翻：SourceIO 交换 IVP Y/Z 后遗漏符号，导致原 Source Z 反射。BSP brush/displacement/trigger 数据未受此错误影响。修正版及新完整回归见 [source-physics-axis-correction.md](source-physics-axis-correction.md)（research 内相对路径为 `../docs/source-physics-axis-correction.md`）；旧数据与结果保留为问题证据，不能继续当当前物理几何正确性证明。

这次证据来自当前完整下载的 `csgo/bin/server.so`，不是旧随包 `server_i486.so`，也不是 CS2 第三方数值。所有操作只读解析 ELF，没有加载执行原游戏服务器。

## 当前 CS:GO 专用视图向量

文件 SHA-256 `7de235c31b2d645c5106cbd7358da3f3ac7964e87f870c4fe6ea31d93a714386`；24,338,666 bytes；ELF32/i386；App740 installed build12426148。`scripts/probe-source-player.py` 对这个已核对二进制哈希锁定，未知文件主动失败。

证据链同时验证：

1. `0x4495af` 起 27 条连续 `MOV imm32 → absolute address`，目标 `0x181a680` 起的 108 bytes，按 float32 读取完整 CViewVectors。
2. getter `0xbab450` 返回同一对象地址；真实调用点 `0xbad18c` 从虚表 `+0x7c` 取函数，并与该 getter 比较。
3. 对应虚表 `0x12b389c` 的 slot 指向 getter，其 RTTI name 是 **12CCSGameRules**。因此是 CS 专用向量，不是仅在文件中碰巧搜到的浮点常量。

完整指令地址/值和 ConVar constructor 引用见 `output/tests/source-player-parameters.json`，反汇编核对分别在 `output/source1-current-viewvectors-asm.txt`、`output/source1-current-movevars-asm.txt`、`output/source1-current-jump-asm.txt`。

| 项目 | 原 Source 单位 | 当前地图 .0254 比例后的米 |
| --- | --- | --- |
| 站 hull min/max | `[-16,-16,0] / [16,16,72]` | X/Z 宽 .8128；高 1.8288 |
| 蹲 hull min/max | `[-16,-16,0] / [16,16,54]` | X/Z 宽 .8128；高 1.3716 |
| 站眼高 | 64 | 1.6256 |
| 蹲眼高 | 46 | 1.1684 |
| dead view | 14 | .3556 |

原移动使用世界轴对齐 hull，不随玩家 yaw 旋转。固定官方 SDK commit `b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474` 的 [TracePlayerBBox](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/game/shared/gamemovement.cpp) 以玩家 mins/maxs 初始化 Ray hull，并使用玩家碰撞 mask；这给出 Source AABB trace 的实现依据。相同固定版本的 [generic gamerules.cpp](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/game/shared/gamerules.cpp) 默认蹲高36/眼28，**不能替代本二进制的 CS 值54/46**。SDK文件哈希存 `output/source-sdk-player/receipt.json`。

## 移动参数的来源边界

每项都核对真实 `PUSH default_string / PUSH name / PUSH ConVar instance / CALL constructor`，不是取相邻字符串猜值。

| ConVar | 本 server.so constructor 默认值 | 注册指令 VA |
| --- | --- | --- |
| `sv_gravity` | `800` | `0x4310aa` |
| `sv_stepsize` | `18` | `0x431528` |
| `sv_accelerate` | `5.5` | `0x43124a` |
| `sv_airaccelerate` | `12` | `0x4312e3` |
| `sv_friction` | `5.2` | `0x431487` |
| `sv_stopspeed` | `80` | `0x4310e1` |
| `sv_maxspeed` | `320` | `0x431213` |
| `sv_jump_impulse` | `301.993377` | `0x448369` |
| `sv_maxvelocity` | `3500` | `0x4314f5` |
| `sv_accelerate_use_weapon_speed` | `1` | `0x43127d` |
| `sv_standable_normal` | `0.7` | `0x42ea2f` |
| `sv_walkable_normal` | `0.7` | `0x42e9fc` |
| `sv_timebetweenducks` | `0.4` | `0x4482e2` |
| `sv_enablebunnyhopping` | `0` | `0x44859c` |
| `sv_autobunnyhopping` | `0` | `0x4485d3` |

单位换算：gravity800u/s² → **20.32m/s²**，step18u → **.4572m**，jump301.993377u/s → **7.6706317758m/s**；standable normal .7 对应最大坡角约45.57°。acceleration/friction 常量不能直接视为 m/s²，它们参与 Source 的速度/表面摩擦/帧时算法。`sv_maxspeed=320` 是全局速度上限；原 `items_game` 的 `weapon_ak47_prefab.attributes` 明确 `max player speed=215`、alt=215，当前比例即5.461m/s。源数据位置为 `research/source-items-catalog.json` 原 prefab与loose items_game，不是当前游戏 WEAPONS 值。

提取器还记录所有随包 `gamemode*.cfg` 的哈希与相关覆写行。本次未见这些选定参数在这些文件中的覆写；**没有启动原引擎，所以这些仍是已安装二进制默认值，不能宣称是某场在线服务器的有效控制台值**。server.cfg、插件和模式代码仍可能改变它们。

## 同碰撞数据的 AABB / Capsule 对照

运行 `python3 scripts/probe-source-player.py` 后运行 `npx tsx scripts/source-player-hull-smoke.ts`。全程保持原 collision.json SHA `8edf9d1ecc0a27e73d10666ab976a708bdd6f7553515601f75308c54ee8c6999` 不变。固定60Hz，实际 Rapier sweep与KCC；沿用上一轮胶囊实验的2.8m/s恒定试验速度，以减少变量。原参数用于箱体尺寸、重力、跨阶与可站坡面；未复制完整 Source 加速、跳跃、空中移动、蹲过渡或武器跑速逻辑。

- 站立与蹲伏各30个原出生点，共 **60/60** 完整体积落地后无重叠；眼位置由各自实测高度从落地脚点计算。
- 保留原5条胶囊路线，原AABB对照如下；另新增B点向内退16u的终点对照，没有覆盖原终点证据。

| 路线 | Hull | 结果 | tick | 剩余水平距离 |
| --- | --- | --- | ---: | ---: |
| middle to doors | standing | 到达 | 527 | 0.0417m |
| long approach | standing | 到达 | 652 | 0.0788m |
| B site interior | standing | 原终点被挡 | 216 | 0.2474m |
| A site interior | standing | 到达 | 63 | 0.0392m |
| CT authored stair line | standing | 到达 | 134 | 0.0531m |
| B site inset endpoint (original endpoint retained above) | standing | 到达 | 144 | 0.0502m |
| middle to doors | crouching | 到达 | 527 | 0.0415m |
| long approach | crouching | 到达 | 652 | 0.0757m |
| B site interior | crouching | 原终点被挡 | 216 | 0.2473m |
| A site interior | crouching | 到达 | 64 | 0.0391m |
| CT authored stair line | crouching | 到达 | 139 | 0.0510m |
| B site inset endpoint (original endpoint retained above) | crouching | 到达 | 144 | 0.0498m |

B点原终点 Source `[-1440,2820]` 对32u宽的原AABB实际与 **PLAYERCLIP brush846** 相交；站/蹲均在终点前约 .247m 停止。现项目半径 .3m 的圆胶囊曾能到达，是外廓尺寸和圆角造成的真实边界差异。向内移动到 `[-1456,2804]` 后两种原 hull 均可到达。这个结果不能修成原AABB也“5/5同点通过”。

CT台阶在原18u step设置下，站134tick、蹲139tick可通过。上一轮项目胶囊+.28m step会停住，+.4572m可过。因此未来Dust2运动配置应独立于M01/C02；仍需原Source站蹲过渡与现人物完整可见身体的独立验证。当前脚本只验证 hull/KCC，无法据此宣称人体模型膝盖/头部动画与原 Source 完全一致。

证据 `output/tests/source-player-hull.json` 包含每30tick原碰撞来源、实际位置、原终点碰撞回执、最终范围；所有世界/角色/控制器已释放，无WASM borrow异常。
