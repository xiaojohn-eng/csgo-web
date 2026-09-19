# 原 App740 Glock-18 普通命令合同

交付 `game/source-glock-command.ts`，用于同一服务器时间轴下的普通 Glock-18。未修改 Simulation、types、runtime、scene 或现有武器 owner，未启用菜单。模块为纯函数；不读取墙钟、不维护隐藏帧时钟、不发射网络消息。

证据是本机官方 App740 build **12426148** 的 i386 `csgo/bin/server.so`，SHA256 `7de235c31b2d645c5106cbd7358da3f3ac7964e87f870c4fe6ea31d93a714386`。`scripts/probe-source-glock-command.py` 在隔离 Unicorn 执行原指令，`output/tests/source-glock-command-native.json` 留有每例输入、原状态/事件输出和关键执行地址。不是把 TS 公式复制成 Python oracle。

## 最小接入与调用顺序

1. 每把实际持有 Glock 保留完整 `SourceGlockCommandState`；`ownerNextAttack` 是 **Player 共享时钟**，`shotsFired`、`waitForNoAttack` 也是 Player 字段，切枪时须在 Player 与当前武器记录之间明确同步，不能当各枪互不相干的 owner 时钟。
2. 初次装备与重新装备调用 `sourceGlockDeploy(state,{now,sequenceDuration: SOURCE_GLOCK_DRAW_SEQUENCE_DURATION})`。它清队列、归零扳机 latch、设 `waitForNoAttack=true`，写 Player 忙碌时钟，并保留旧 primary/secondary 时钟最大值。普通原 `glock_draw` 34 帧 / 30 FPS → `SequenceDuration=33/30`。这里的定时取自实际原 `DefaultDeploy` 对 `SequenceDuration` 的消费；不是看动画长度猜解锁。重甲加速不在本合同。
3. 每个游戏武器帧调用一次 `sourceGlockCommandFrame`，传 **当前权威 now、frametime、按钮、当前命令种子**。它包含原 Player 的 owner 时钟比较：未来忙碌则 `BusyFrame`；到时才 `PostFrame`。inactive/无 owner 不更新队列或精度。
4. 严格按 `result.events` 顺序消费。`weapon-tick` 事件携带原当时 `mode/reloading`；**只在该位置**调用武器精度更新。排队子弹在它之前，普通首发在它之后。Player punch 的每帧积分仍由 handling 单独调用一次，不能跟着每发 bullet 重复积分。
5. 每个 `bullet` 事件提供 `source:'primary'|'queued'`、TE 子弹 `mode`、`accuracyMode`、`recoilMode`、原 `scheduledTime`、剩余队列快照和当前 `commandSeed/serverSeed`。先用该点已有精度/punch算这一发，再做该点 accepted-shot penalty/recoil。queued 的 recoil 固定 mode1；其 penalty 使用事件中的 `accuracyMode`。**不要把原 scheduledTime 当 commandSeed，也不要用旧 primary 的 seed 重放第二、三发。** 高层普通单发 handling 不能直接套到 queued（queued 不写 lastShot）。
6. `activity=194` 只在接受换弹时输出；可以启动原 reload clip，并调用 handling 的 acceptedReloadIndex 更新。弹药转移已经由命令模块按原 owner 时钟完成，不能在模型 AE 完成事件重复加弹。最后把 `result.state.lastShot` 同步给 handling 的原 lastShotTime，包含干扣写时间、被门禁挡住不写时间、queued 不写时间三种情况。
7. 将返回完整 state 写回 snapshot/history/prediction；模式、队列数、nextBurst、三个攻击时钟、扳机 latch、reload flag 都不能只存在客户端。模式切换消耗的 IN_ATTACK2 在 `buttonsAfter` 被清除，不表示用户已实际松开物理按键。
8. 被接受的切枪先调用 `sourceGlockHolster(state,{now,sequenceDuration})`。普通原模型没有 ACT_VM_HOLSTER 对应的导出片段时，模型选择适配应显式提供实际失败/零时长行为；本函数不自行推测。Holster 取消 reloading，但 **保留队列字段**。从此停止该枪武器帧；下次 Deploy 原前缀才清队列。完整 Deploy 已提供；`sourceGlockBeginDeploy` 仅供另有完整原 base Deploy 的调用者使用，不能单独冒充完整拔枪。

最小用法（事件处理器由父任务实现；没有假装现存 API）：

```ts
let command = createSourceGlockCommandState();
command = sourceGlockDeploy(command, {
  now, sequenceDuration: SOURCE_GLOCK_DRAW_SEQUENCE_DURATION,
}).state;

const frame = sourceGlockCommandFrame(command, {
  now, dt: frameTime, buttons, commandSeed, serverSeed,
  reloadDuration: SOURCE_GLOCK_RELOAD_SEQUENCE_DURATION,
});
for (const event of frame.events) {
  if (event.kind === 'weapon-tick') updateAccuracyAtThisPoint(event.mode, event.reloading);
  else if (event.kind === 'bullet') emitThenApplyShotAtThisPoint(event);
  else if (event.kind === 'activity') playOriginalActivity(event.activity);
  else presentOriginalEvent(event);
}
command = frame.state;
synchronizeHandlingLastShot(command.lastShot);
```

## 实际状态转换

| 操作 | 本 build 原行为 |
| --- | --- |
| 普通首发 | due 检查为 `now>=nextPrimary`；clip>0 且规则/Player gate、shotsFired、waitForNoAttack 都允许才发一枚。 |
| 按住扳机 | Glock 原 `is full auto=0`，普通/三连发模式都不能仅因 cooldown 到时再次首发；须走 no-attack 复位。 |
| 首发时钟 | `delta=f32(now-oldNextPrimary)`，0≤delta≤frametime 时沿旧 nextPrimary，否则基准为 now；两枪械攻击时钟写基准+.15（普通）或+.5（burst）。 |
| 切模式 | 普通/三连发切换 A9c 与 A6c；只写 nextSecondary=now+.3，不写 nextPrimary，不清 pending burst，不另发枪械 activity。 |
| burst 首发 | 先写 remaining=2、nextBurst=now+.05，再测 clip。空仓也可能暂有2枚排队；下一 due queue 检测空仓后清除。 |
| burst 后续 | 每个 PostFrame **最多一枚**，scheduledTime=原 nextBurst；下一枚写 oldNextBurst+.05。迟帧不从 now 重排、不 while 连补。 |
| 仅余1或2发 | 不制造额外子弹；最后合法子弹射出后，后续 due queue 清空剩余计数。普通空仓自动换弹随后可启动。 |
| 干扣 | due primary 经过 gate 后输出 empty，dryFireCount++，nextPrimary=now+.2；nextSecondary 保留；lastShot=now。没有 accepted bullet。 |
| 换弹按钮 | primary、secondary 优先；reload 要求 **now>nextPrimary**、不正在 reload、clip<20、reserve>0。 |
| 换弹开始 | 原 selected ACT_VM_RELOAD SequenceDuration 写 ownerNextAttack/nextPrimary/nextSecondary=now+duration；shotsFired归零，不清 queued fields。 |
| 换弹完成 | PostFrame 开头（queued 后）若 owner clock已到，转移 min(20-clip,reserve) 并清 reloading。原 default69帧30FPS → duration68/30。 |
| 自动换弹 | no-attack复位后，now>nextPrimary、clip0、reserve>0、非reloading、原 HasWeaponFlags(2)=false 才开始；异常游戏模式 auto-drop 不在本合同。 |
| 忙碌帧 | 有 weapon-tick；没有 queued bullet、弹药完成或输入攻击。无 attack 输入只清 waitForNoAttack，不清 shotsFired。 |
| Holster / Deploy | Holster清reload、保pending；inactive不执行；Deploy先清pending，再按原selected draw时长写owner gate并保旧primary/secondary最大值。 |

`mode-message` 原字符串从 burst 切回时竟是 `#Cstrike_TitlesTXT_Switch_To_FullAuto`。它不能当武器变成全自动的证据；本 build 的独立 full-auto consumer 仍返回0。UI应根据已验 mode语义显示普通/三连发，可保原字符串作审计。

## Activity 与时标边界

原主攻击与 queued 都请求 **192 = ACT_VM_PRIMARYATTACK**，包括 clip从1减0。当前实证应选 `glock_firesingle`。原模型 `glock_firelast` 标 **195 = ACT_VM_DRYFIRE**；不能因为弹匣变0自行选择它。本轮尚未证明原 client/viewmodel 的专有活动或序列转换会改为 firelast，也未执行带所有 modelcache/weighted-sequence/econ activity modifiers 的动画选择器。此缺口不影响已执行的服务器命令分支，但不能声称最后一发视觉已完全还原。

原 draw请求183，reload194，holster184。模式切换无 activity。Muzzle/ejection、5004音频和reload/inspect body layers仍由已导出原模型/事件时轴驱动，本模块不把它们当命令锁或子弹数量来源。

`scheduledTime` 是 TE_FireBullets 传入值；普通首发可能是纠偏后的旧 due time，queued 是旧排队时刻。处理命令时的 `now`、TE scheduled time 和当前预测命令 seed必须分别保留。多发事件需要逐发消费，不能只看最终clip差并重复同一个随机样本。

## 原指令定位与 oracle 适配

- RTTI `12CWeaponGlock`：name12e7470 → typeinfo12e7480 → vtable12ec7ac。vt+4ac Deploy=d4d5c0；+4b0 Holster=d4cc60；+4d0 PostFrame=d4ac70；+4d4 Busy=d4aaf0；+4f8 Reload=d4ca70；+4fc Primary=d4b7e0；+500 Secondary=d4bd20。
- Player调用门禁：61be70 内61bf19..61bf2a读取+6e4并比较 curtime；future去61bf30后+4d4，due去61c1b0后+4d0。oracle执行这个实际比较块；正常活动持有者以外的 vehicle/use gate由caller负责。
- 枪队列：d4ac70→d49b70；普通PostFrame d443d0；input gate d43820；fire d4b1f0；时钟纠偏 d41980；模式 d4bd20；reload d4ca70→d41dd0→5dbc00（实际 timer stores5dbd22附近）。
- Deploy d4d5c0先清B04/B08 → d44d10 → 5d8ef0 → d406b0，d40818实际调用SequenceDuration、d40828乘播放倍率倒数并写ownerNextAttack，d40857起写两武器clock=now；返回d4d6db/d4d718分别max旧clock。模型Query/SequenceDuration是明确适配，实际乘加/门禁/存储仍跑原指令。
- items属性：SHA读取原 `scripts/items/items_game.txt` 并递归合并 prefab；burst周期.5、间隔.05。除了schema文字，还核了原属性执行者：a3fa40解析 `description_format` 并由表1721040得到 enum2/additive、enum12/replace，存def+20；CAttributeManager→a23b30→**a21c30** 原float消费者，经表12768bc到**a21c70 addss**或**a21c5a replace**。oracle真正调用原a21c30，只有属性名/资源查找是host适配。
- 查找适配包括 weapon owner/info、原默认配置和name→attribute、弹药reserve API、模型资源/音频/网络dirty；球弹transport只捕获参数。精度、后坐、punch、血量、世界射线不在本command oracle，另有pistol handling与伤害oracle。无须启动server进程、登录或改系统设置。

## 复现与验收

```sh
.tools/source-binary-venv/bin/python scripts/probe-source-glock-command.py
npx vitest run tests/source-glock-command.test.ts
npx tsx scripts/validate-source-glock-command.ts
```

最终 **1,290 个原指令 cases，TS state/event/dispatch/buttonsAfter逐值严格相等，0差异；10/10专项测试通过，`tsc --noEmit`通过**。执行结果见 `output/source-glock-command-probe.log` 和 `output/tests/source-glock-command-validation.json`（含原数据/脚本/module SHA）。原 oracle覆盖相邻float32时钟、primary/secondary/reload输入竞争、owner忙碌边界、1/2发弹药、迟到队列、按住与松开、换弹完成、自动换弹、Holster/Deploy、当前命令种子保留和原事件顺序。独立主题测试检查队列一次性、不可变输入、lastShot差别、无猜测firelast与非法输入拒绝。

边界明确：原完整实体生命周期、重甲特殊倍率、econ运行时属性覆写、inspect/idle动作状态机、特殊第三攻击/特殊自动换弹按钮、原client firelast选择和所有 Source AnimState图不在本次普通命令合同。不存在泛化到USP或其它枪的承诺。

补证修正：原info parser证明+124为has silencer、+23d为is revolver。Glock fixture现均取0；旧1281案例逐项输出未变。另原成功Reload尾部d3f530会清aa4，已执行该原函数并加入9个旧完成bit为true的边界，纯模块同步清位。新最终1290案例SHA为`0d8e179d33c243d9bef1cf8bfd8e5ea403dc38a049f82b2c031a8f521a8dbb3b`。默认Glock缺失Holster序列的实际0时长路径已由另12原指令案例关闭，见`docs/source-glock-holster.md`。
