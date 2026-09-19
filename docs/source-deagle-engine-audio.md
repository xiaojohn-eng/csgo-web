# 沙漠之鹰原音频接入

`await audio.prepareDeagle()` 复用 `loadSourceDeagleAudio` 的 22 个别名、21 个原 WAV 的逐 SHA 检查与共享解码；多次调用复用同一个准备 Promise。`audio.sourceDeagleHashes` 在整组准备完成后记录 22 项。原 `preparePistols()` 的 Glock/USP 范围保持兼容。空仓命令另外等待原有 `audio.preparePistolCommands()`。

预测已接受子弹和权威远端报告调用原有 `audio.shot('deagle',volume,pan,position,occluded)`。它仅从 `weapon_deagle.single` 原两个变体 `source_deagle_13/14` 中选择一次，原 gain/pitch 都为 1，并直接传入原有方向、遮挡与空间播放路径。Deagle 不使用 USP 消音器 mode；缺少原音频时不合成替代声，也不补发动画声音。

动画时间线和 `sourceWeaponSound` 命令事件继续各自由其现有游标和事件去重路径调用 `audio.sourcePistolEvent('deagle',event,volume,pan,position,occluded)`。该方法读取 Deagle 原事件目录和现有公共手枪命令声音，保留原 pitch / gain 范围，没有新增全局事件播放循环或第二条射击音轨。

针对性检查见 `tests/source-deagle-engine-audio.test.ts`：准备完成/解码共享、两个射击变体、空间参数、draw/empty/weaponmove 的原参数、未知跨枪事件、无合成替代及损坏 SHA 清理。实际 WebAudio/GPU/局域网听感随根集成验收；单元测试不声称真实设备声学一致。
