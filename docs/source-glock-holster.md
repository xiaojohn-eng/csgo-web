# Glock 缺失 Holster activity 的原失败路径

本次独立补证通过 **12 个实际原指令案例**：6 个原当前序列 × 正常/换弹状态。原默认 Glock 的 ACT_VM_HOLSTER=184 没有匹配序列。原 SelectWeightedSequence 返回 -1；SendWeaponAnim 返回 false，保留旧 activity 和 sequence。原 Holster 随后不查询旧 SequenceDuration（实际调用次数0），把 ownerNextAttack 写为 curtime。这里的0延迟来自原失败路径，不是把模型缺失理解为可以任意跳过动画。

父任务可据此调用已冻结 `sourceGlockHolster(state,{now,sequenceDuration:0})`。其中 activity184表示原请求，默认模型实际没有新clip，不能用旧 reload/fire clip 的剩余时长作 holster 延迟。queued字段继续保留，停止inactive武器帧，下次Deploy清除；本轮没有修改冻结Glock模块或共有文件。

复现：`.tools/source-binary-venv/bin/python scripts/probe-source-glock-holster.py`。完整收据 `output/tests/source-glock-holster-native.json`。

证据链：直接读官方 VPK archive87 offset38498027 的原 `v_pist_glock18.mdl`（30392 bytes，CRC5ce29c29，SHA48ab6740def0ad8d7d4a42476583a61c8aa7d9f9f784b2d2f167720f14875242）。raw header localnumseq6；逐个212B序列记录读取label/activity name。原server `0x4af090` 注册函数确认各 activity 数值。原文件里的activity数字初始-1，须按名称注册，不能直接把-1当无activity。

用全部5个真实named activity构成合法的一bucket活动缓存（只是缓存适配，不制造任何匹配）。原 `5a7160` 执行hash搜索、完整miss分支返回-1；原 `5db020` 返回0且不改旧序列；随后完整 `d4cc60→5d9df0` Holster执行到owner clock写入。观测12次均旧activity/sequence不变、SequenceDuration未调用、owner clock=curtime。映射有效/缓存初始化查询和资源缓存布局是明示适配；查找、失败返回与下游时钟消费者均是实际本build i386指令。
