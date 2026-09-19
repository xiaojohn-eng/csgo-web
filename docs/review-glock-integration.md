# Glock 玩法接入独立审阅

范围：只读检查 `source-pistol-runtime-pose.ts`、`source-pistol-playback.ts`、`pose-timeline.ts` 与 assets/runtime/scene 的预测声音、切枪、生命、动作时钟接线。未修改这些 owner 文件、未启动浏览器或服务。共享 Simulation 测试与真实 CPU smoke 另见 `source-glock-simulation.md`。

## 可复现发现

### P2：同一动作跨 idle 边界回退会重放全部换弹音

原 `updateSourceGlockPlayback` 以 `actionKey + sequence` 的变化增加本地 generation。换弹真实动作 generation=3，elapsed 2.25 → 2.28 → 2.25 秒会依次得到 reload/gen1 → idle/gen2 → reload/gen3。`advanceSourceSoundEvents` 因 pose/generation 改变丢失原高水位，于第三次采样重新播 clipout、clipin、slideback、sliderelease。仅 30 ms 的权威校正即可触发，不需要新开火或新换弹。

已直接执行实际 playback + sound cursor、读取原 `source-pistol-audio.json`；只 stub GPU viewmodel I/O。证据 `output/tests/review-glock-playback.json`，一次性脚本 `output/review-glock-playback.test.ts`。主任务正在按真实动作身份保存独立声音游标；视觉姿态仍允许合法回退。

### P2：重复购买的新 Glock 动作可能与旧动作身份碰撞

Simulation 合法重复购买会创建新的 Glock state，Deploy 的 generation 从 1 开始。相同玩家/生命且尚在旧 draw 内，再买一把时 action.time 改变，但原 actionKey 只有 id/deaths/generation。旧 draw .8 秒 → 新 draw 0 秒时局部 generation 不变，声音游标认为是同一动作回退，漏新 draw0 音。

相同实际 playback/cursor 复现见 `output/tests/review-glock-rebuy-playback.json`。新动作游标身份需含足以区分此实例的 action.time/activity，不能仅保 generation。

## 已读回关闭与未发现阻塞的接线

- 网络 Object.assign 后，对权威省略的 secondary/sourceGlock/sourcePistolPose/sourcePose/version 显式删除；新快照不会保留死亡 CT 之前买来的幽灵 Glock。嵌套状态另做 structuredClone。
- 购买成功后再同步本地 slot；普通 1/2 的明确输入继续控制装备，避免购枪后下一条旧 slot0 立即切回主武器。
- Glock walking selector 使用原 240u 与 actual sourceWalking，包含 f32 .52 等号边界；不再按 AK 215u 把合法 Shift 判成 Run。
- 玩家 punch 的单一真值和 shared command bridge 顺序在 Simulation 专项内验证；runtime 的自己 predicted shot 音效去重后仍保留 authority Source ray。没有发现重复扣血或预测创建弹道的新增路径。
- sourcePistolPose body/world 来自权威 action 起点和原 sequence rate；FP 也读同一 pose clock，不使用本地 dt 推进枪械权威动作。inspect 是独立本地展示。
- 场景 team/weapon 更换会 retire 旧 actor；双队 viewmodel owner 按实际 arms profile 回收，声音 cursor 随 owner release 删除。只读检查没有发现新的跨队 skeleton/owner 生命周期阻塞。

## 边界

本次未做 GPU/LAN 取证。原完整 CCSGOPlayerAnimState 过渡/IK 仍是已声明还原度边界。AE54 的 ammo 提前转移还依赖本构建原 StudioFrameAdvance 事件窗口，当前不把 `elapsed/duration` 当原始动画时钟，也不把 deadline fallback 测试称为完整 reload 时序。

## 两项声音问题修复复核

两项 P2 已关闭。owner 将声音序列/身份与视觉序列分开：视觉 idle 或合法时钟回退仍照常采样，sound 保留原动作 pose/time；key 含 round/player/deaths/generation/activity/action.time，inspect 使用独立 key。GameAssets 为每把枪保留最多 8 个独立声音游标，原高水位比较继续由 `advanceSourceSoundEvents` 负责。换队/释放删除对应游标，clearEffects 重置缓存与播放状态，round 进入动作身份。

独立限定运行 `tests/source-pistol-owner.test.ts -t 'keeps each real action audio cursor'`，使用真实 Glock GLTF owner + GameAssets：1/1 通过。覆盖旧 2.25 → 2.28 → 2.25 fixture 的视觉仍回 reload 而四个音各一次、inspect 结束不重播旧 reload、同 generation 重新购买 draw 音两次。结果 `output/review-glock-playback-fix.log`。之前两份 review JSON 保留为修复前消费路径证据，不表示新 GameAssets 仍有该问题。

新增受控 mode 声音接线已读回：runtime 仅消费 authority `weaponSound`，按已有 event id 游标去重；自己预测不生产该事件。当前不将未知 empty 事件映射为任意声音。

本限定审阅未留下已复现未处理的 P1/P2；AE54 原动画窗口随后已按已证 helper 接入，共享调用点另由 reference 独立只读复核，见 `source-viewmodel-shared-clock.md`；此处保留当时的审阅范围记录。
