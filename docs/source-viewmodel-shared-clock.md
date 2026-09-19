# Player index0 共享 viewmodel 时间接入

本构建原程序已经证明 AK/M4/Glock 取同一个 Player index0 viewmodel。此移植仅跨枪共享 `animTime / previousAnimTime`，不声称 AK/M4 原 sequence 与三组 parity 已完整恢复。

## 唯一状态与执行位置

`Player.sourceViewmodelTime?:{animTime:number;previousAnimTime:number}` 是 Source 内部权威字段，不是客户端 Input。出生/重生将两值初始化为 f32(this.time)；Glock 武器构造也接收当前 time。购买新 Glock 保留玩家双时间，Deploy 只 reset 已接受活动，不将武器构造当新共享 VM 构造。

`Simulation.postSourceViewmodel` 对 Source 活人执行：

- Glock：`sourceGlockRuntimePostThink(state,{now,viewmodelTime})` 合入当前玩家双时间，原 advance/dispatch 一次；从返回 animation 回写两值，同步 ammo，再刷新 pistol pose。
- AK/M4：`advanceSourceViewmodelAnimTimes` 只执行与 weapon/duration/playbackRate 无关的原时间部分；不调用 Glock 全帧，也不改变 inactive Glock 的 sequence。

live 和预测都在本 command/handling 后执行一次；buy phase 在移动后执行动画 PostThink 而不消费武器命令；ended/match 在已有动作收尾处为活人执行一次。死亡不推进；死后 spawn 从新生命当前时间开始。实际 buy 操作只选择/重置活动，下一帧才执行 PostThink，避免每次购买额外推进。

snapshot、history 深拷贝双时间；正常 JSON 恢复不会隐式 reset。客户端 runtime 的 own/visual 同步由主任务负责。Glock 三组 parity 在自身动画状态保存；跨 rifle 的原 parity 重建仍未验，不以两时间的原值一致替代该证据。

## 核验

`tests/source-viewmodel-simulation.test.ts` 5项：非零出生时间、普通 rifle 命令推进、snapshot/history 不互染、持 rifle 3秒后首 Glock 帧只推进一次、重复购买保留共享times，以及 buy/ended/match 持续推进但不接受 held fire、dead不推进。

Glock 11项共享测试已把早装填改为实际 .411764711 事件窗口：触发前后扣留攻击命令，ammo提前转为20/119，reloading保留，deadline不二次补弹。400条混合模拟JSON序列包含共享times与完整animation。7文件46/46，`output/source-viewmodel-shared-validation.log`；typecheck exit0，`output/source-viewmodel-shared-types.log`。

真实生产 map/双队 pose/hitbox 数据的 CPU smoke仍为4组真实命中（站/蹲、T/CT），生命值65/65/72/65；JSON段扩为340条，跨完整早装填和deadline。原过早请求260被拒，合法285接受；341的5.683333秒发生AE54，ammo20/114、reloading=true、deadline7.016666秒。完整receipt：`output/tests/source-glock-simulation-smoke.json`。世界释放无WASM borrow错误。

reference agent 独立只读复核确认 phase 调用点无双推进、Deploy只reset、buy保共享时间。没有重复其3292帧native clock oracle；它们仍作为纯模块原始证据，而这里验证实际Simulation接线。本轮未build、未启动服务、未操作浏览器，不将CPU状态验收称为LAN/GPU体验验收。
