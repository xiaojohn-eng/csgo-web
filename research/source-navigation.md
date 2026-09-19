# 原 Dust2 NAV：数据、纯寻路接口与接入边界

2026-09-09。本阶段完成原 NAV 完整读取、逐字节重建、另一语言逐字段验证和纯 TypeScript 导航模块；没有修改 Simulation、SourceLevel、运行时、场景、浏览器或原资源。没有以 M01 二维格子代替 NAV。

## 输入与证据

输入为匿名安装并 validate 的 App740 build12426148 原 `.reference-assets/source-exports/dust2/source-metadata/de_dust2.nav`。实际 magic `0xFEEDFACE`，version16、subVersion1，analyzed1，记录 BSP size325,735,952 与本机原 BSP 一致。

| 项目 | 读回 |
|---|---:|
| NAV 大小 | 579,121 bytes |
| NAV SHA-256 | `82d46fb7d3618514e9897d87e5666c0c3f483c4a82060aac03313afad864b649` |
| BSP SHA-256 | `b91be410539fbbfc16300423f1e19c024f12addf1429c8cb2f72b53fe0fd6bcc` |
| 原 areas / 有向 connections | 1,118 / 4,526 |
| 无反向连接的原边 | 76 |
| 原 places | 26 |
| 原 ladders / area ladder links | 0 / 0 |
| 退化 area | 0 |
| 独立数值字段比较 | 217,555 |
| EOF / 剩余未解析 bytes | 579,121 / 0 |
| navigation.json | 2,667,919 bytes |
| JSON SHA-256 | `e51e5c25b2708bf030d02cea709a1fefcd18c951646589a173121789b53cfcf7` |

私有输出 `.reference-assets/source-exports/dust2/navigation/` 含完整 `navigation.json`、`manifest.json`、Python `route-fixtures.json` 和 TS `verification.json`。

`scripts/extract-source-navigation.py` 读取 NW/SE 的完整 XYZ、独立 NE/SW 高度、四方向有向 area IDs、原 flags、place、梯子连接及梯子端点/方向/连接区域，还保留 hiding spots、encounters、occupy times、lightIntensity、visible areas 和子版本尾部记录。它从解析后的 JSON 字段重新编码全部字段，**未复制原记录 bytes 代替重建**，与 579,121 原字节完全一致。

CSGO sub1 在每个基础 area 结尾有一个 byte count 与 `I,I,B,I,B` 记录列表，实际布局与 SDK 的旧 approach 记录形状一致。所有这些 ID 都能解析为原 area，完整 EOF 与 byte round-trip 通过。JSON 明确命名 `sub1ApproachRecords` 并保留记录/偏移；其 CSGO 专属完整语义未由公开 SDK 证实，寻路不使用这些数据，不把该推断扩展成已恢复原战术 AI。

`scripts/validate-source-navigation.ts` 不执行 Python parser/repacker，也不依赖其偏移跳过内容，而从 NAV header 起重新读取每个计数和字段，对原 JSON 逐项比较并走到原 EOF。prepare 阶段还验证 area ID 唯一、连接/梯子目标合法，任何损坏引用均不能生成备用格子路线。

## 纯 API

```ts
const nav = prepareSourceNavigation(navigationJson);
// Caller 同时核对 nav.sourceBspSha256/nav.sourceNavSha256 与 SourceLevel。
const near = nearestSourceNavArea(nav, { x, y, z }, {
  maxSnapDistance: 2,            // metres；默认 2，不无限吸附远处目标
  fromAreaId: currentAreaId,     // 可选：只考虑从该 area 原有向图可达的候选
  blockedFlags: 0,              // 可选：调用方有意排除特定原 flag
  allowLadders: false,          // 默认 false，缺攀爬控制器时不选梯子
});
const graph = findSourceNavAreaPath(nav, startAreaId, goalAreaId, options);
const route = findSourceNavPath(nav, fromFeetWorld3D, toFeetWorld3D, options);
```

模块为 `game/source-navigation.ts`。输入 position 和返回 waypoint 均为浏览器世界 metres：Source `(x,y,z)` 对应 `(.0254*x,.0254*z,-.0254*y)`。保留的 `sourcePoint/nw/se/neZ/swZ` 仍用 Source 原单位。`sourceNavHeight(area,sourceX,sourceY)` 按四角进行双线性高度采样，不能把该函数的第二轴误作浏览器 Y。

nearest 先在 area 的 Source XY 范围夹取，再按原四角采样 Z，用完整 3D 距离选最近者；这遵循 SDK 的 area 近点方法，不是 XY-only 选层，也不是对任意双线性曲面的全局欧氏优化。相同距离以较小原 area ID 决定。`fromAreaId` 表示**有向 NAV 图**可达约束，不表示从玩家当前位置到近点已经过 AABB 检查。

`findSourceNavAreaPath` 返回原 area IDs、原连接的 direction/kind/ladderId 与几何 cost。实现确定性 Dijkstra，不添加反向边、没有全局可变缓存。连接 cost 为 surface center 间 3D metres；梯子 cost 包含中心到端点及梯子端点间距离。这是可重复的几何代价，不是 CSGO 战术权重、实际步行长度或移动时长。

`findSourceNavPath` 的 destination 先按几何最近 area 选择，再检查图可达；**不会把不连通的目标悄悄换到起点可达层**。返回 `status`（`path/unreachable/invalid-data/invalid-endpoint/no-start-area/no-goal-area`）、`areaIds/edges/waypoints/graphCost/start/goal/staticOnly:true`。缺数据、损坏、太远或不通返回明确失败。

waypoint 保留 `x/y/z`、原 `sourcePoint`、`areaId/flags/kind/ladderId`。普通连接给出 `portal-exit/portal-enter` 两个原 area 边界点，分别使用本面与目标面真实 NAV 高度，垂直不同的同 XZ 点不能合并。若原连接跨越间隔，点对仍保留间隔，不填补可走地面。四方向为 Source NORTH(-Y)、EAST(+X)、SOUTH(+Y)、WEST(-X)。所有点都保留原 flags，包括本文件存在的 crouch/jump/no-jump/no-merge/obstacle-top 组合；模块不自动替玩家完成动作或抹去矛盾组合。

梯子输出独立 bottom/top 点与 ascent/descent 标记。按固定 SDK 搜索，向上可到 topForward/topLeft/topRight，保留 topBehind 字段但不把它添加为向上出口；向下使用原 bottomArea。原 Dust2 NAV 没有梯子，**这里的梯子行为只通过合成 fixture，不能称真实 Dust2 攀梯验收**。

## 实际验证

```sh
python3 scripts/extract-source-navigation.py
npx tsx scripts/validate-source-navigation.ts
npx vitest run tests/source-navigation.test.ts
npx tsc --noEmit
```

已经实际执行通过；导航 10/10 tests，与 PVS 相关总计 30/30，全项目 tsc 通过。原数据未修改。测试覆盖四角/坡面采样、同 XY 不同层、有向单行、原 flags、损坏数据、远端点、输入不变、确定性、同 area、梯子显式开关以及保留 topBehind 的边界。

30 个原出生点分别到原 NAV place `BombsiteA` 与 `BombsiteB` 共 60 条路线全部静态可达，cost 与另一 Python Dijkstra 实现一致；3,268 个 waypoint 都在所属原 area 的 XY 范围内，高度、原 flags、单位转换正确。A 诊断目标为 area1399，Source `[1062.5,2662.5,96.03125]`；B 为 area3748，Source `[-1737.5,2337.5,3.528818592429161]`。选择规则是原 place 的 area centers 均值附近的原 area 中心，**只是命名 NAV 区域的导航诊断终点，没有把它宣称为 bomb trigger 内合法下包点**。

| 原出发阵营 → NAV 目标 | 15 个出生点图 cost 范围 | area 数量 |
|---|---:|---:|
| CT → BombsiteA | 43.84–52.22 m | 16–18 |
| T → BombsiteA | 117.73–134.63 m | 31–38 |
| CT → BombsiteB | 53.47–64.78 m | 18–21 |
| T → BombsiteB | 105.75–118.63 m | 33–43 |

24 对原 XY 重叠且相差至少 50 Source units 的楼层，共 48 次近点查询，与独立 Python 3D 选层结果一致。UpperTunnel area5365 到 LowerTunnel area1289 经 13 个原 areas，起终点 Source 高度 32.03125→-111.96875，即 -3.6576 m；图 cost31.20 m，保留原高度路线，未用二维直线替代。

一次 CPU 记录 prepare4.67 ms，60 次完整路径查询平均0.387 ms、最大1.209 ms；不是运行时 AI 多人负载、实际通行、GPU 或帧率测试。

## 父任务后续接入点

1. 当前 `game/source-level.ts` 的 descriptor 和返回值仍是 `navigation:null`，并显式拒绝非 null。父任务可把本模块 index 单独注入 AI，或有序扩展 descriptor；必须同时比对 NAV SHA/BSP SHA/metresPerSourceUnit，不能把其他地图的 NAV 接进碰撞世界。
2. 当前 `game/simulation.ts` 约第1039行仍调用 `pathfind(p.x,p.z,tx,tz)`，其后仅用水平 `hypot(x,z)<0.23` 消费路径。接入必须传脚底 `p.y` 和目标真实高度，并按完整 3D/过渡完成条件消费 waypoint。否则同 XZ 不同高度的 portal 或 ladder endpoint 会被连续错误移除。
3. `flags`、portal 高差/间隔与 ladder kind 需交给对应的 crouch/jump/step/drop/climb 控制策略；未实现的动作可通过选项排除并明确无路径。原 NAV jump bit 的 SDK 注释包含生成阶段用途，不能仅凭它假定一次按跳即可通行。
4. 原 NAV 是静态可达候选；起点吸附、角色宽32u的通过宽度、站72/蹲54u净空、动态门/道具、地面支撑、坡度、跨区域 sweep、跳跃落点与实际 bomb sensor 仍由 SourceLevel/Rapier 权威碰撞检查。NAV 不能替代 AABB sweep，也不能证明最终 waypoint 可下包。

本阶段未把 14 个烘焙动作、旧 M01 ground grid、视觉帧率或静态 NAV 通过混作原 CS:GO AI 完成。

## 官方固定来源

使用 Valve Source SDK 固定 commit `b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474`，原始文件保存在私有 `.reference-assets/navigation-reference/`。源码版本与 CS:GO 私有实现之间仍有明确边界：原 NAV 数据布局和字节来自本机原包，sub1 后缀未冒认完全公开。

- [nav_file.cpp](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/game/server/nav_file.cpp)：基本 header、place directory、area 序列化和旧 approach 记录形状。
- [nav_area.cpp](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/game/server/nav_area.cpp)：`GetZ` 双线性高度和 `GetClosestPointOnArea`。
- [nav_ladder.cpp](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/game/server/nav_ladder.cpp)：梯子存储字段。
- [nav_pathfind.h](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/game/server/nav_pathfind.h)：有向邻接、上行 ladder forward/left/right 与下行 bottom。
- [nav.h](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/game/server/nav.h)：原方向枚举、基础 attribute bits。未知/custom bits 原样保留。
