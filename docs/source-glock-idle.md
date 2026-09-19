# Glock 原始待机选择与计时

本补充恢复 App 740 / build 12426148 默认 Glock 的 `timeWeaponIdle`，接在已冻结的 command 结果之后、动作消费之前。原始文件 SHA 为 `7de235c31b2d645c5106cbd7358da3f3ac7964e87f870c4fe6ea31d93a714386`；没有采用 SDK 2013 的相似实现替代当前二进制。

`scripts/probe-source-glock-idle.py` 执行原 `WeaponIdle` 地址 `0xd47610`、动画包装 `0xd43530` 和计时存储 `0x5d62c0`，虚拟选择器/SequenceDuration 只提供原默认 MDL 的选中序列与时长。658 个样本覆盖空/非空弹匣、计时相等/越界、主副开火/换弹输入、BusyFrame、排队连发、部署/收枪与 320 帧连续命令。原始语料 SHA 为 `3ca2642015f4171e223c09b099ad7a77f45859d99d6f0b1577978b1f54695678`。

确认的次序：

- 选中动作先写 `curtime + SequenceDuration`；主射击随后覆盖为 `curtime + 2`，队列射击保留其 0.4 秒动作时长。
- 普通无攻击分支才调用 WeaponIdle。BusyFrame、攻击分支以及符合手动换弹尝试条件的分支不会调用，即使换弹最终未成功。
- 计时到达且弹匣非空时请求活动 185。先写原 info 的 20 秒 idle interval，再由真实 idle 动作的 1/30 秒时长覆盖。
- 已完成的开火序列可以继续停在末帧，不能把 `cycle === 1` 直接解释成已选择待机。原检视序列未到 cycle 0.98 时，待机请求不得重置它。

`sourceGlockRuntimeFrame` 消费这个补充；`idleTime` 随完整玩家快照序列化。活动 185 只改变第一人称原 VM 序列，不伪造新的开火/换弹事件，也不提前终止第三人称原动作层。部署写原 draw 时间，缺失 Holster 序列保持原 idle timer。新运行版本为 `csgo-glock-runtime-12426148-r2`，因此旧玩法客户端会被服务端版本门禁拒绝。

测试把全部 658 个原始样本分别送入纯 helper 和玩法 runtime，逐项比较命令状态、计时和有序事件；另有 161 帧完整 PostThink/JSON 重演，确认单发结束后一秒仍保持 fire 序列、两秒时原待机门禁打开。`tests/source-glock-runtime.test.ts` 的旧处理链语料没有原始 idle 字段，仍保留其原有验证范围。

当前检视仍由客户端本地展示控制，完整检视命令同步、全武器共用 VM 的动画 parity 和完整玩家 AnimState/IK 不属于这一补充的已验证范围。
