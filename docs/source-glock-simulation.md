# Glock 共享 Simulation 接入

本切片将原 Glock 命令桥接入现有 Source Scenario，并保持旧非 Source 行为。没有另建可玩应用、构建发布物、修改运行候选或启动端口。主任务负责资源/相机/UI/网络入口和真实浏览器验收。

## 数据与调用合同

- `WeaponId='glock'` 的显示/库存元数据为 20/120、200、240 Source units/s。原伤害 profile 使用 `glock18`，普通距离/护甲/hitgroup 仍走已验 `computeSourceBulletDamage`。
- `SourceScenario.defaultSecondaryWeaponByTeam` 显式指定默认副武器。只有 scenario 加载列表含 Glock 才默认给 T 一把；CT 暂无默认副武器。两队都可购买已加载的 Glock。旧无 Glock 资源/fixture 的 Source 场景维持原 loadout。
- `Player.secondary / sourceGlock / sourcePistolPose` 保存完整库存、命令/handling/action、原全身手枪 pose。`sourceRifleHandling.punch` 是统一的玩家 punch 真值，持 Glock 时也保留它；每次移动/原 impulse 同步到 Glock 的 handling，切枪不会重置 punch。
- `sourcePistolShot` 附于既有 `type:'shot'` Event，保留原 command/server seed、BEFORE inaccuracy/spread/punch、scheduledTime 和浏览器输入角。共用一次 trace/damage，Glock command 桥已经扣过的 ammo/after-shot handling 不再扣第二次。
- `type:'weaponSound'` 携带 `sourceWeaponSound:{weapon:'glock',event:'Weapon.AutoSemiAutoSwitch'}` 和正常 by/seq/time/position。仅消费原 bridge 已证明的 sound 事件，不从客户端字段构造；empty 声音仍等待原指令证据。
- `SourceScenario.pistolSeed` 是内部 authority 依赖，不接受客户端 JSON。每玩家当前输入 seq 缓存一次 server seed；AI 使用当前权威 tick 作为正常命令编号。正常 `commandSeed` 仍由 `sourceCommandSeed(seq)` 计算。

实际帧顺序：Source slot 选择 → 玩家 punch 积分一次 → Source AABB 移动/retained fall sampler → 当前武器 OnLand → Glock 唯一 command/runtime 桥的原事件顺序 → pistol pose 刷新。Glock 不提前跑 rifle WeaponTick，queue/tick/primary/reload 顺序由 `source-glock-runtime.ts` 拥有。

输入复用 `slot=0/1` 和 `aim`（Glock 对应 IN_ATTACK2）。未新增客户端可写的命令内部状态、seed、punch、ammo 或 pose 字段；`validateInput` 白名单返回时剥除这些外加字段。

## 切枪、购买与生命

1/2 选择在 Source movement 前处理，使本命令的速度与 OnLand 属性属于同一把当前武器。Glock `Holster` 使用原缺失 holster clip 的 0 duration 分支；`Deploy` 使用原 1.1 秒和等松手门禁，清除旧排队。退回步枪只恢复 primary 库存与既有 rifle handling，不新增未证的 rifle 动画接受状态机。

买 Glock 保留 primary 身份/弹匣/备弹，扣 200，装备 slot1；再次购买也不能把 Glock 的 20 发写进 primaryAmmo。UI 必须让购买后的本地 slot 选择与权威 slot1 一致，否则下一条明确 slot0 输入会合法切回主武器。

回合重生将手持武器恢复 primary，不能将先前 Glock 的 20 发当步枪弹匣。存活者保有购买的副武器，死亡玩家恢复该队默认副武器；CT 的默认仍为空。训练原有“重生保已购主武器”语义保留，重建对应副武器的新生命状态。控位移交保留武器数值，仅清掉旧连接的 authority seed cache。

## 预测、历史与可见姿态

`predictSourceCommand` 与服务器走相同 Source slot/movement/OnLand/runtime 桥。预测 execution 不调用任何 authority seed supplier，不创建射线/伤害/Event；接受的确定 recoil/penalty 和 action 可以重放。

snapshot 深拷贝 `sourceGlock / sourcePistolPose / sourceRifleHandling / sourceViewmodelTime` 及 `sourcePistolShot`。历史帧同样保存 weapon、完整 pistol pose/Glock/rifle handling 的深拷贝。命中回溯调用 Source contract 指定的原手枪 bone provider，不用 C02 或旧 rifle pose 代替。`SourcePoseDriver.pistolPose(player,now)` 在移动后与武器事件后刷新；ended/match 仍可在权威时间结束已有动作。

主任务拥有 `pose-timeline.ts` 的原 body/world 动作插值与 runtime 网络恢复。不能因为这里有独立 snapshot 测试就声称所有网络渲染已验收。

## 当前证据

`tests/source-glock-simulation.test.ts` 当前 11 项覆盖：

- T 默认/CT 可买、重复购买、primary 弹药和回合/死亡 reset。
- 原 draw 的 held-fire/等松手门禁、单发按住不会连射。
- burst 队列在松手后继续、各发使用当前命令 seed、原伤害不重复施加。
- client 注入 seed/内部 command/pose 被剥除，重复当前 seq 只分配一个 authority seed。
- 在独立验证过的纯 bridge 之前只积分一次 punch。
- Glock→步枪→Glock 保留玩家 punch、主副弹药及 inactive penalty。
- 原 AE54 窗口提前转移 ammo、保留 reload/ownerNextAttack 门禁、deadline 不二次装填及 holster 取消。
- 400 条混合行走/蹲/跳/单发/burst/reload/切枪输入，从 JSON 恢复后，位置/速度/command/handling/ammo 全部严格同值。
- snapshot、回溯帧和 Event 的嵌套字段互不污染。
- 原 bridge `Weapon.AutoSemiAutoSwitch` 每次接受切换只由 authority 发出一个受控 `weaponSound` Event；预测不发，快照声音 metadata 独立复制。

真实 CPU smoke `scripts/source-glock-simulation-smoke.ts` 读取生产 SHA 校验 map、双队 AK/M4/Glock 图谱，使用当前真实 Dust2 碰撞。T/CT × 站/蹲 4 例由原 torso bone witness 经 accepted command、实际 spread、原完整 pistol pose hitbox 到伤害，目标 HP 分别 65/65/72/65；另 340 条真实 Dust2 双 Simulation JSON 重演包含同一 pistolPose，严格同值。所有世界释放完成，无 WASM borrow 错误。

回执：`output/tests/source-glock-simulation-smoke.json`；测试日志：`output/source-glock-shared-validation.log`（初次 6 文件 41/41；共享 VM clock 更新后 7 文件 46/46，见 `output/source-viewmodel-shared-validation.log`）；旧模拟、Source identity、时间线另 32/32，见 `output/source-glock-regression.log`。最新 `npx tsc --noEmit` exit 0，见 `output/source-glock-simulation-types.log`。这些是 CPU 游戏状态和原数据接线证据，不是浏览器帧率、声音、FP 操作或双端 LAN 体验验收。

## 原动画窗口已接与仍保留的边界

原 `AE_WPN_COMPLETE_RELOAD` event54 已经由原 StudioFrameAdvance/DispatchAnimEvents 消费，接在本 command/handling 后；Glock 原 event cycle=.411764711，提前转移 ammo 并置 aa4，不立即清 reloading。Player index0 的 animTime/previousAnimTime 跨 AK/M4/Glock 共享，普通 rifle 只推进已证实的时间字段，不借 Glock duration。详细合同见 `source-viewmodel-shared-clock.md`。

真实 Dust2 序列的过早 reload（seq260、4.333333 秒）因原 burst nextPrimary=4.633333 而拒绝；seq285 合法重试。seq341、5.683333 秒在 cycle=.4191177487373352 装填为20/114，reloading仍true，ownerNextAttack=7.016666412353516。340 条 JSON重演包含双时间与完整 animation，权威/预测相同。旧180帧smoke未覆盖到此窗口，本轮补证替代其reload覆盖边界。

原完整 CCSGOPlayerAnimState 过渡权重/IK 不在此 slice。主任务提供的 pistol pose 是显式地面选择器、原 sequence cycle rate 和同源 body/world action，纯 CPU 命中与视觉 pose 数值合同成立，不等于原所有状态图行为已还原。
