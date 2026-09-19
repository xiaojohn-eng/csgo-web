# 开发工作流程

本文描述本工程从原作取证到可玩交付的完整开发流程。目标：完整复刻 CS:GO 网页版，可局域网联机，人物动作、枪械、特效、皮肤一致。该目标仍未完成，本文各环节的当前完成度见 [还原进度](parity.md)。

整体是「逆向取证 → 并行开发 → 多级验证 → 证据落盘」的闭环：

```
SteamCMD 原版安装 → 逆向取证(资产管线 + ELF 探针)
        ↓
  工作树并行开发（weapon / character / material / effects）
        ↓
  增量合入主目录（diff → apply --check → 逐文件整合）
        ↓
  多级验证（typecheck → 单测 → 构建 → 身份握手 → 真实浏览器 → LAN）
        ↓
  证据落盘 output/ → 更新 PROGRESS.md 恢复点 → 替换 27019 服务
```

## 一、目标管理与状态记录

每轮工作的中枢纪律，由四类文档承担：

| 文档 | 作用 |
| --- | --- |
| `docs/superpowers/plans/`、`specs/` | 任务级规划：目标、架构决定、任务拆解、全局约束 |
| `PROGRESS.md` | 时间线恢复点账本。每轮工作结束记录当前 PID/端口、已完成/未完成、证据路径、下一步；新会话从最新恢复点继续 |
| `docs/parity.md` | 还原进度对照表，每项范围「当前实际覆盖 vs 距原作仍缺」 |
| `WORKTREES.md` | 并行开发约定、各工作树责任与端口、各批次增量合入记录 |

核心纪律：**不虚报**。同机双浏览器不叫跨设备验收；资产交付不叫可玩接入；测试通过不叫原作对照。每个结论都要有 `output/` 内的证据支撑，失败证据同样保留。

## 二、逆向取证流水线

原版来源为 Valve 官方 SteamCMD 匿名下载的 App 740（构建 12426148，34.7 GB），回执见 `research/csgo-install-receipt.json`，原始文件保存在 `.reference-assets/`（只读，逐文件 SHA256）。

取证分两条路径：

**几何/材质路径**（SourceIO + Blender 后台模式）：

- BSP → GLB：地图几何与静态道具。`inventory-source-map.py` 清点 BSP lumps，固定 commit 的 SourceIO 经 Blender `--background --factory-startup` 导入，`verify-source-map.py` 校验三角索引/法线/UV 与原始 VVD/VTX 严格一致
- MDL → GLB：角色与武器模型 + 骨骼动画，按骨名建立 Action
- VTF/VMT：纹理解码与材质参数，映射到 Three.js shader
- 坐标规范：源单位 × 0.0254，`(0.0254*x, 0.0254*z, -0.0254*y)`

**逻辑路径**（Unicorn 执行原版 ELF）：

- 约 60 个 `scripts/probe-source-*.py` 探针，加载 `server.so` / `client_client.so`（校验 SHA256 后在 Unicorn 32 位 x86 虚拟机中执行）
- 钩住原函数直接取证：伤害衰减、命中部位表、护甲判定、武器命令状态机、散布、后坐、动画时钟、附件矩阵等
- 输出确定性 JSON，转录为 `game/source-*.ts` 的 TypeScript 常量/函数
- **没有原命令证据的事件不调度，绝不猜**（例：空仓 WAV 在拿到调度证据前不播放）

研究记录与工具链见 `research/source1-to-glb-toolchain.md`、`research/official-csgo-assets.md`，工具固定于 `.tools/SourceIO/`。

## 三、实现架构

- **共享仿真**：客户端预测 + 权威服务器（60 Hz 仿真、20 Hz 快照）+ 共享 `Simulation`。客户端只能提交输入与购买请求，不能上传生命/伤害/位置
- **仿真身份握手**：`simulationVersion` 由原始 level/collision/navigation 文件 SHA256 与各武器姿态/伤害/handling 版本按固定顺序拼成；创建与加入房间双方必须完全相等，旧客户端直接拒绝，见 [身份说明](source-simulation-identity.md)
- **服务端数据加载**：`server/source-*.ts` 只做 manifest、SHA、路径核验后加载结构化 pose/地图数据，不承载渲染

## 四、并行开发：工作树体系

四个 Git worktree 从统一 WIP 检查点出发，主目录保留集成权：

| 工作树 | 责任 | 预览端口 |
| --- | --- | --- |
| `.worktrees/weapon` | 武器（Deagle 已合入；AWP 推进中） | 27021 |
| `.worktrees/character` | 人物动作 | 27022 |
| `.worktrees/material` | 材质（红线皮肤、tint） | 27023 |
| `.worktrees/effects` | 特效（枪口粒子、附件矩阵） | 27024 |
| 主目录 | simulation/runtime/profiles/server、公共逻辑、入口、最终 LAN 验收 | 27019 |

约定：

1. 打统一 WIP 检查点（非发布版本），主 HEAD 与暂存区保留不动
2. `node_modules` 只读链接复用，禁止在工作树安装/升级依赖；public、reference-assets、output/tests 用 APFS 写时复制隔离
3. 工作树不得调用 `source:start/stop`、`start/stop`，不得改动主目录运行服务；使用 `source:stage` / `source:check`，候选输出落在当前工作树的 `release/source-candidates`
4. 每项交付必须列出：检查点之后的文件差异、针对性测试结果、限制说明
5. 合入：`git diff <checkpoint>..<worker-commit> -- <owned-files>` 导出增量 → `git apply --check` → 逐文件整合，不整树覆盖；主目录已有后续修改时逐项整合不强行覆盖

## 五、多级验证关卡

一个功能（如一把新枪）从代码到上线的完整链路：

```
1. typecheck        — npm run typecheck
2. 单元测试          — npm test（150+ 文件；先用探针 native JSON 做逐值比对）
3. 候选构建与资产SHA — npm run source:check -- --id r4-版本名
4. 身份握手测试      — 新数据进入 simulationVersion 后旧客户端拒入
5. 真实浏览器训练验收 — 真实桌面浏览器 GPU：截图、音频事件、页面错误检查
6. 双浏览器 LAN 验收 — 两客户端建房/加入/对战/清房，姿态与身份一致
7. 全部通过后才替换 27019 运行服务
```

要点：

- 开发期按影响范围跑相关测试；集成时运行 R4 专用 `npm run source:check`（类型检查、全量测试、独立前后端构建与资产 SHA）；普通 `qa` 属于 R3
- LAN 冒烟 `npm run test:lan` 用真实双 SDK 客户端走 Colyseus/WS，独占测试端口（如 27017），不占用运行服务
- 复验失败时修脚本等待时机，**不降低判据**；失败证据保留（例：`output/playwright/source-usp-gameplay-first.json`）
- 证据三处落盘：`output/tests/`（结构化测试 JSON）、`output/playwright/`（截图 + GPU JSON）、`output/worktrees/`（增量回执 receipt/patch/checkpoint）

## 六、服务生命周期与端口布局

| 端口 | 用途 |
| --- | --- |
| 27015 | R3 旧版（保留不动） |
| 27019 | R4 候选（当前主力），`npm run source:start/status/stop` |
| 27016 | dev 开发入口 |
| 27017 | LAN smoke 测试 |
| 27018 | 私有资产预览 |
| 27021–27024 | 四个工作树预览 |

`scripts/lan-service.mjs` 统一启停：进程身份核验（绝对路径 + PID + 启动指纹）、按当前网卡生成 Origin 白名单（无通配符）、R4 状态存 `.lan-source-service/state.json`（R3 为 `.lan-service/state.json`）、重复启动沿用同一实例、外部占端口不接管。源码变化后需独立候选检查及验收，再按 `docs/source-release.md` 中的逐步发布与回退流程替换运行版；碰撞/动画/库存规则更新会改变仿真身份，旧网页必须刷新才能加入新房间。

## 七、恢复点与续作

每轮结束把以下内容写入 `PROGRESS.md` 顶部新条目：当前运行 PID/端口、本轮实际通过/失败的验证及证据路径、未完成项、下一步。新会话先读 `PROGRESS.md` 最新恢复点与 `WORKTREES.md`，确认运行中服务与检查点状态，再继续开发。同一错误原样失败两次后禁止第三次原样重试，先复盘失败证据。
