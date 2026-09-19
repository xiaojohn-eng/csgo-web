# 原手枪粒子 R2：随机链与首帧时间门控

本增量基于 `7b7dcf4`。只修改独立粒子模块、独立预览及本模块脚本/测试；没有修改 scene/runtime、启动或停止主 LAN。原 r1 20 份资源逐个重新校验，字节与 SHA256 保持不变。新增证据均放在 `.reference-assets/source-exports/pistol-particles-r2`，回执为 `output/source-pistol-particles-r2-delivery.json`。

## 原系统选择

原 `items_game.txt`（SHA256 `510e09b68a01d88edba2342972960025fd6484aaaa58365fcf47d8513de79623`）按 prefab 继承展开。原第一/第三人称 getter `0x5e11f0`、`0x5e1170` 共执行 8 例：

| 武器状态 | 第一人称 | 第三人称 |
| --- | --- | --- |
| Glock | weapon_muzzle_flash_pistol | weapon_muzzle_flash_pistol |
| Deagle | weapon_muzzle_flash_pistol | weapon_muzzle_flash_pistol |
| USP 未附着消音器 | weapon_muzzle_flash_pistol | weapon_muzzle_flash_pistol |
| USP 已附着消音器 | 空串（alt → legacy fallback） | 空串（alt → legacy fallback） |

附着布尔读取执行原 `0x5db720`，没有按动作名称猜测。USP 的 alt 字段缺省，原 legacy parser `0x5c92b6..0x5c930a` 的默认串为空，探针以这两个空默认缓冲区作适配。最终游戏触发函数未完整执行，因此证据表示 getter 返回空串，不等于已证明所有原渲染路径绝无任何光效。主工程应继续让消音 USP 不套用 main/core。

## 随机数与完整标量初始化链

原 client ELF SHA256：`21d2d652a3b2e07c44fa0a3b638886744af9d24ba0c91e64f97a0d8afc43d4cb`。

原静态表 `0x14c7da0` 含 4096 个 float32，16384 字节，SHA256 `355816ca0d97ac2d71ab5e710ad7b508a87c564a6f8772af460a6ea3ee5987c1`。生成脚本把原字节无损嵌入独立 TS 文件，浏览器同步读取；没有新增运行时 fetch，也不影响 root 的原 5 份资源完整性 loader。

原初始化调度包装 `0xd444d0` 在粒数 <=15 时选择 vtable+0x70 标量实现；main 4 粒、core 8 粒均在此分支。随机索引为 `(COL+0x348 seed + COL+0x344 counter) & 4095`。原初始化器按整批执行，零跨度和之后被覆盖的字段仍消费样本：

| 系统 | 原顺序 | 各阶段消费数 |
| --- | --- | --- |
| main | sequence → rotation → lifetime → alpha → sphere/velocity | 4, 8, 4, 4, 24 |
| core | sequence → rotation → alpha → color → lifetime → position remap → radius remap → alpha remap | 8, 16, 8, 8, 8, 0, 0, 0 |

main 的 sphere 半径为零仍调用 3 个样本；随后 local velocity 用 3 个样本。core 颜色三个通道共享一个插值样本。原角度转换、alpha 1/255 归一化、float32 运算顺序也已移植。

探针执行整条初始化链与原 CP matrix `0xd46a50`（forward、-right、up 列），在 seed 0、17、4090 上逐粒比较寿命、角度、序列、出生、alpha、颜色、半径、位置与 main previous position；测试逐字段精确相等。core fade duration 另执行原 `0xd2cee0`，在 `0xd2d0e6` 读取实际中间结果：它是原 particle ID + collection seed + operatorIndex*17 的表查找，不消费初始化器 counter。24 个 duration 也精确一致。

适配边界：原构造器 `0xd4da00` 保存显式 seed；ELF relocation 确认 `0xd4e382` 外部符号为 `Plat_MSTime`；未传 seed 分支 `0xd4e37b..0xd4e388` 使用 collection 地址和原平台毫秒时钟 Plat_MSTime() 的返回值。浏览器不复制原内存分配及原平台时钟相位。默认发射采用可重复的递增 presentation seed；提供 `{main,core}` 可指定两条原表流。此处保证给定 seed 下的初始化链，不声称跨原游戏逐发 seed 一致。

## 原时间门控

`probe-source-pistol-particle-scheduler.py` 执行完整原 collection `Simulate` `0xd481a0`，配置原定义字段，使用空 emitter/operator/child 列表、预分配 kill list，并关闭 profiling。原 `minimum rendered frames=1` 位于 definition+0xec；collection+0x33c 从零开始，比较条件为 `counter <= 1`，在 Simulate 内递增。

当门控仍有效且 `time + inputDelta > maximumSimTick` 时，原 delta 取 `max(minimumSimTick, maximumSimTick - time)`。main 两个 tick 字段均 7.5ms、core 均 15ms。输入为零不会推进或计数。该字段名不能直接解释成浏览器已呈现帧数：原计数就在 Simulate 方法内改变。

例如输入 `[0,50ms,50ms,50ms]`，main 的 collection time 为 `[0,7.5,15,65]ms`，core 为 `[0,15,30,80]ms`。每次小输入也遵循原条件分支，未统一硬改成固定 tick。10 组原机码序列包含零、1ms、5ms、16ms、50ms、120ms，JS 时钟与原 float32 time、计数及末子步逐项相等。原 child 递归 `0xd48779..0xd48793` 收到原输入 delta，因此 main/core 分别推进自己的门控时钟。

renderer 对每个 burst 保存 main/core 两个时钟，`update(now)` 传入与上一调用之差；清除使用模拟时钟，避免慢首帧先按墙钟删除粒子。没有移动出生时间、延长寿命或调整引擎 dt。同一时刻重复调用不会消费计数。

完整游戏触发、真实 render 调用相位、collection 创建器未闭合。当前 core 仍一次生成原已验证 8 粒 batch；第一模拟步小于原 emission duration 7ms 时，原应多批产生粒子，其 birth 分配与每批初始化调用尚未移植。120Hz/60Hz 常见首个完整发射跨度已覆盖；不可把此工作声明为任意帧率的完整粒子调度一致。

## 接线 API

```ts
fx.fire(muzzle, now);                            // 原表 + 明确的默认 seed 适配
fx.fire(muzzle, now, { main: 17, core: 4090 });   // 原表，显式 collection seeds
fx.fire(muzzle, now, customUnitSample);           // 保留原 callback API
const diagnostics = fx.update(now);              // 额外返回 clocks
program.emitWithSeeds({ main: 17, core: 4090 });
```

自定义回调保留兼容性，但其 core fade 仍需额外 8 个适配样本，不能声称原 collection indexed RNG。root 的 signal、SHA256/bytes、verified blob、hashVerified loader 不在本增量修改范围；合并仅应用 renderer imports 和 capacity 初始化之后的 fire/update 变更。

## 验证及仍存缺口

- 3 文件 12 项定向测试通过；`npm run typecheck` 通过。
- 独立 27024 WebGL 预览：输入 `[0,50ms]` 后 4 main + 8 core；时钟 7.5/15ms；50ms 三次后全部过期；+90° 后所有位置沿 +Z。浏览器 console 0 errors / 0 warnings。
- 截图 `output/playwright/source-pistol-native-gate-50ms.png` 已实际查看；原火焰在慢首帧保留，并沿原枪口方向分布。浏览器回执 `output/source-pistol-particles-r2-browser-readback.log`。
- 原 PCF/VTF/sheet 未更改；火花、枪烟、弹壳烟、fallback、原 SpriteCard depth feathering、HDR/tone mapping 仍未完整移植。

执行顺序：原 selection / initializers / scheduler 探针均使用 `scripts/source-pistol-particles-native.py` 只读 ELF harness；再执行 table export；最后目标测试、typecheck、浏览器。不要重跑旧 r1 defaults/operators 脚本来生成 R2，以免覆盖已交付资源。
