# 特效清理与真实输入证据独立复核

2026-09-08 22:14，只读检查当前 `scene.ts` / `runtime.ts` / `combat-effects.ts`、相关 mock 和主任务已录制的 `output/playwright/input-proof.json` / `effects-proof.json`，未操控浏览器或 27015。

结论：此次范围未发现关键缺陷。`Game.leave → Art.clearEffects → CombatEffects.clear` 清掉四个池的 active/count/visible 并重置 cursor，保留 geometry/material/instance buffer；后续能够正常再发射。`initial-sync` 的 Art mock 同名方法已补齐。独立复测 `tests/combat-effects.test.ts` **6/6**，覆盖清理后重新发射、缓存保留、owned dispose 与无效输入。

真实输入脚本使用浏览器键鼠事件；页面 evaluate 用于读取快照和暂存证据，没有直接改玩家状态。证据包含：A 键移动约 0.676 m；弹匣 30→28；R 触发 reload 2.1 秒并最终变成 30/88；F 检视权重 0.909；Ctrl 后 crouch=true、stancePhase≈0.999；Esc 后 pointer lock 解除。

真实特效证据包含：2 枚活跃弹壳；实际本地 throw / grenade 事件；爆炸时 smoke=10、debris=14、flash=1；返回主菜单后四池 count=0 / visible=false；该脚本记录的 errors=[]。脚本动作与快照顺序一致，支持“真实输入触发效果并在离场清理”的结论。

边界：这两份证据仍对应 316 textures 的先前构建，不代表最终 Skeleton 优化和步态合并后的 WebGL / FPS 验收；JSON 的实例数本身也不证明最终像素质量。Esc 的单帧记录证明已解锁，不足以单独证明任意时长暂停的所有行为。
