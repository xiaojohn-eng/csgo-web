# Source Level 注入适配器与接入点

> **2026-09-09 PHY 坐标纠正**：本文件早期 `dust2/collision/` 的世界/道具 PHY 验收已被后续真实 LAN 复现推翻：SourceIO 交换 IVP Y/Z 后遗漏符号，导致原 Source Z 反射。BSP brush/displacement/trigger 数据未受此错误影响。修正版及新完整回归见 [source-physics-axis-correction.md](source-physics-axis-correction.md)（research 内相对路径为 `../docs/source-physics-axis-correction.md`）；旧数据与结果保留为问题证据，不能继续当当前物理几何正确性证明。

新增 `game/source-level.ts`，以及原数据生成脚本 `scripts/export-source-level.py`。私有小描述符 `.reference-assets/source-exports/dust2/level.json` 从原 entities、model bounds、30 spawn 和当前 App740 视图参数生成；32.8MB collision.json 始终单独由 caller 读取。没有修改 Simulation / Runtime / Scene / Server 或 M01 map.ts。

## 最小接口

```ts
await RAPIER.init();
// Caller loads these with fs/fetch and validates the artifact receipt.
const level = createSourceLevel(world, levelData, collisionData);
world.step();
const authoredSpawns = level.spawns.blue; // CT 15; amber = T 15
const settled = level.settleSourceSpawn(authoredSpawns[0], 'standing');
const d = level.wallDistance(x,y,z,dx,dy,dz,'bullet',maxMetres);
const clear = level.sight(eye,target,'bullet');
const sites = level.sitesForSourcePlayer(feet,'standing');
// Or sitesOverlappingShape(center, actualCallerShape, rotation).
level.dispose(); // idempotent, before world.free()
```

- `spawns` 保留原 Source classname/origin/angles、browser3D位置、yaw/pitch、hammerid。没有 `%5` 截断，authored y 不假称是落地脚点；`settleSourceSpawn` 对原站/蹲 AABB 完整向下扫掠后返回脚点，不能落地则返回 null。
- `player` 来自当前 server.so 的 CS 专用参数，见 `docs/source-player-hull.md`。stand / crouch 的 halfExtents 是不随 yaw 旋转的 AABB；eyeHeight 单独从脚点取。没有强行把 C02 胶囊替换成这些参数。
- `sites` 的 A/B 是对已核定 Dust2 BSP 的显式小数据绑定：A=`*26/hammerid2664093`、B=`*27/2664796`，记录原实体顺序与身份。原实体没有字面 A/B 字段；模块不按位置临时排序命名。A 原触发体由2个凸 brush构成，B由1个构成。
- `siteContainsPoint` 是原传感器凸体的真实 point containment；`sitesOverlappingShape` 是真实 shape overlap。Source 玩家触发应调用完整 AABB overlap，例如脚点略在触发体外仍可能接触，不能照搬旧M01 `isInsideSite` 的XZ矩形+脚点判断。是否允许下包、grounded、站蹲/手部动画、交互计时仍由 caller 决定。
- `wallDistance` 将direction归一化并返回米制距离，默认bullet，也可明确player/projectile。query predicate 限定本地图 owned colliders；玩家、另一个level、caller场景测试体不会混入原墙查询。没有命中返回Infinity。`sight` 要求真实3D点，不再默填 y=1.4；它只表达所选role的几何遮挡，不包含烟雾、PVS、动态角色或原CSGO穿透算法。
- 原 `worldBounds` 来自BSP model0；包括远处5个warmup arena与地下场景，所以范围很大。它是资源边界，不是可走区域、死亡边界或主图radar裁切。没有从spawn或M01 BOXES造主图边界。
- 当前 `navigation:null`，同时保留原NAV哈希与未实现说明。另一个任务正在实现原3D NAV，后续显式接入，当前没有矩形路径网格回退。

构造时校验地图id、BSP哈希、Source单位比例一致；查询/分配没有异步或网络副作用，caller掌握step与加载时间。类型和数据来源不等于完整JSON schema认证。元数据在分配资源前派生；原触发体找不到时只回收此次map资源。dispose以后查询主动报错。

## 当前验证

- `npx vitest run tests/source-level.test.ts tests/source-map-collision.test.ts`：**8/8通过**，覆盖斜面/非AABB体积、query排除caller actor、触发体shape接触、源身份不匹配、missing trigger中途回滚、坏JSON字段在创建资源前失败、双dispose。
- `npx tsx scripts/source-level-smoke.ts`：真实15CT/15T spawn的站/蹲落地、A/B原触发体包含及完整角色接触、两出生区16向wallDistance前后sight一致，全通过。证据 `output/tests/source-level.json`。
- 全量tsc exit0，记录 `output/source1-level-typecheck.log`；未再运行全项目大QA或浏览器。
- 独立审阅指出 `spawns:null` 在attach后抛错留下colliders，以及低层 `missingPHY:null` 在生成统计时抛错留下colliders。新增真实红绿：`output/source1-rollback-red.log`原先分别残4/2colliders；`output/source1-rollback-green.log`现8/8通过。没有吞掉异常或把失败状态报成功。

## 具体集成点（尚未改动）

| 当前依赖 | 后续替换/决策 |
| --- | --- |
| `simulation.ts:15` 导入BOXES/SPAWN_POSES/SITES/queries/pathfind | 增加 caller 注入 level；保留M01实现作为另一种明确level，不能换全局常量造成房间串图 |
| `simulation.ts:106` World / controller / BOXES construction | Dust2使用level碰撞与独立motion config；按role设actor/query groups，不额外加M01 floor/boundary boxes |
| `simulation.ts:194` spawn取模5与固定+0.05 | 使用实际队伍spawn长度与完整hull落地；保留原3D/yaw，失败必须处理 |
| `simulation.ts:38,388,398` authored step列表与BOXES support检查 | 这些是M01的台阶降级假设；Dust2不可继续拿旧BOXES决定净空或地面，源hull/完整角色姿态策略需独立实现 |
| `simulation.ts:675,747,834,968` 遮挡/枪线/可达性 | 指向同实例level查询，并根据用途明确bullet/player/projectile；角色命中与历史回溯仍走原战斗层 |
| `simulation.ts:844,1016,1060` SITES 与inside check | 原sensor shape overlap、明确A/B标签；site的展示bounds不能当碰撞 |
| `simulation.ts:1040` pathfind | 等原NAV接口；不要把null写成可走直线或造M01二维矩形网格 |
| `runtime.ts:9,653,732` wallDistance/sight用于本地开枪等 | 与该局Simulation使用同level / 同原碰撞数据，避免为runtime再复制一次14,696个colliders |

地图切换需要原map id/BSP hash与客户端资源选择一致；本模块没有替server决定房间协议/状态，也没有做地图动画、烘焙光照或网络接入。数据缺失的45个PHY实例和原virtualterrain未解码边界继续遵循碰撞报告。
