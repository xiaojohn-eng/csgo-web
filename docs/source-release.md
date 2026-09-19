# R4 候选构建、运行资产清单与回退

本工具将 R4 检查和候选构建从现有正式目录分离。旧 `source:build` 会清空 `release/source-r4/web`，现已改为独立候选构建；普通 `qa` 仍调用 R3 默认 `build`。本工具直接调用 TypeScript、Vitest 和带独立输出覆盖的 Vite，不调用这两个入口，不修改 `scripts/lan-service.mjs`。

本工具**不发布、不启停服务、不清理旧版本**。`stage/check/verify/preflight/plan` 中没有执行发布或删除目录的动作。`plan` 返回供逐步审核执行的命令，不能把它当成已部署回执。

## 命令

在仓库根目录运行，Node 版本遵循 `package.json`（本次实测 Node 22.23.2）。

```sh
# 完整类型检查、完整测试、独立 Web/server 构建、复制运行资产、生成并核验 SHA。
node scripts/source-release.mjs check --id r4-20260913-example

# 仅准备候选：未执行完整测试，preflight 会明确阻止将其标为可发布。
node scripts/source-release.mjs stage --id r4-20260913-build-only

# 工作树可显式读取主树原有 public；不复制 .reference-assets，也不写入 public。
node scripts/source-release.mjs check --id r4-20260913-targeted \
  --public-root /absolute/main-repository/public \
  --test-file tests/source-release.test.ts

# 上条是定向检查，回执标 targeted-passed，不能替代 full-passed。
# TypeScript/其他测试读取 public 时，工作树仍须具有既有 public 的只读输入引用。

node scripts/source-release.mjs verify \
  --candidate release/source-candidates/r4-20260913-example

node scripts/source-release.mjs preflight \
  --candidate release/source-candidates/r4-20260913-example

# 从独立工作树只读核对主树 R4：
node scripts/source-release.mjs plan \
  --candidate /absolute/worktree/release/source-candidates/r4-20260913-example \
  --service-root /absolute/main-repository
```

工作树中的 `node_modules`/`public` 可以引用主树现有目录，作为构建输入使用；本工具不会安装依赖或写入这些目录。完整测试若引用原生研究资产，也需要既有 `.reference-assets` 输入。本工具不会将它加入运行包。

根部 `package.json` 已提供以下 aliases；`source:build` 同样指向 `stage`：

```json
{
  "source:check": "node scripts/source-release.mjs check",
  "source:stage": "node scripts/source-release.mjs stage",
  "source:verify": "node scripts/source-release.mjs verify",
  "source:preflight": "node scripts/source-release.mjs preflight",
  "source:plan": "node scripts/source-release.mjs plan"
}
```

## 目录、资源与验证范围

每次构建必须使用全新的 `release/source-candidates/r4-…/`。即使旧目录为空也拒绝复用。输出路径及中间目录不得是符号链接，不能指向 R3 `release/web` 或 R4 `release/source-r4`。失败候选保留 `candidate.json` 中的 `failed` 状态和日志，不能通过候选验证；工具不自动删除它。

Vite 的 `publicDir` 与 `copyPublicDir` 均关闭，显式复制以下公共资产：

| 输入 | 保留原因 |
| --- | --- |
| `public/source/csgo-12426148/**` | 已导出的 R4 地图、六枪、人物、动画、皮肤与粒子等公共资源变体 |
| `public/audio/**` | 当前 `game/audio.ts` 仍请求通用脚步/回退音频 |
| `public/images/**` | 当前 CSS 中仍存在的菜单图片引用 |
| `public/favicon.svg` | 页面图标 |

不包含原 depot/VPK 的 `.reference-assets`（约 42 GB），也不包含 `.tools`、`public/models`、`public/textures` 和任何旧 R3 发布目录。源公共资产约 3.4 GB 的目录采用保守集合，保留不同人物/动作/皮肤分支；**清单条目不是实际加载数量，更不是所有资源已经 GPU 绘制过的证明**。R4 入口使用 `/?map=de_dust2`；此候选不承诺兼容未打包的旧 R3 地图资产。

复制采用独立文件/APFS 可选写时复制，不使用硬链接。每份资源核对复制前 SHA 与候选文件 SHA。SHA 清单覆盖 `web/**`、`server/**`、`package.json`、`package-lock.json`，逐一记录相对路径、字节数、SHA-256，并验证缺失、额外文件、重复路径、总数、路径逃逸及符号链接。`.DS_Store` 不作为运行资源。

另外要求地图、12 套人物、环境探针、手雷、皮肤库存图的 16 份主要 manifest 存在，并把其中运行文件声明的 SHA/大小交叉核对到复制结果，拒绝给缺失/错误输入生成表面自洽的成功包。完整 `check` 还要求实际打包的 public 与测试读取的 public 是同一目录。主要 manifest 检查仍不是完整动态 URL 闭包证明，GPU/LAN 验收另行进行。

本次发现一项既有但当前不消费的旧声明：Dust2 manifest 中 `environment.json` 声明 2156 bytes / `fb09c6c6…`，实际文件为 3519 bytes / `08f5d249…`。`game/source-dust2.ts` 的 `FileKey` 和加载请求均不包含它，当前环境参数来自编译进包的 `source-environment.ts`。工具在 `candidate.json.declaredAssets.unconsumedDeclarations` 明确保存这个差异，复制文件仍纳入总 SHA 清单；没有修改/伪造旧原始声明，也不把它当成运行 SHA 已通过的文件声明。测试约束上述代码依据，未来如果恢复该加载必须调整策略。

- `candidate.json`：代码 commit/dirty 状态、依赖边界、命令及检查范围、完成/失败状态、清单 SHA。
- `runtime-manifest.json`：完整候选运行文件字节清单；复制/构建完再生成，随后重新读取核验。
- `checks/public-assets.json`：公共资产输入集合、复制后的每文件 SHA 与集合摘要。
- `checks/typecheck.log`、`tests.log`、`vitest.json`、`web-build.log`、`server-build.log`：实际命令日志（仅存在于运行过相应步骤的候选中）。

候选**未打包 `node_modules`**，依赖主仓库既有依赖安装。记录 Node 版本和 `package-lock.json` SHA，preflight 要求目标锁文件相同；这不等于已经验证跨机器可移植包或逐字节核对全部已安装依赖。完整 `check` 的测试总数、通过数、待处理数只记录该次实际 Vitest JSON，不累加以前的重复运行。

## 发布前核对与回退

`preflight/plan` 会重新核验候选全部运行字节，读取目标 `.lan-source-service/state.json`、PID 的启动时间/命令指纹，以及只读 `127.0.0.1:27019/health`。必须同时对应目标根目录、R4 entry、协议 `csgo-web-r4` 和同一 instanceId。候选与正式目录必须位于同一文件系统，目标的 previous/rejected 目录不得存在，依赖锁文件必须相同；源码 dirty 或只做定向测试会明确产生 blocker。任何阻塞返回退出码 **2**，数据/构建错误返回 **1**。

当前 `readyForOperatorReview=true` 仅表示构建与本地进程/文件前置检查通过。GPU、实际操作、候选 SDK/LAN、两个物理设备验收需要独立补回执，不能从这个标志推断通过；候选默认 `browser=false`、`lan=false`。本工具不启动任何候选服务器。

计划限定 `PORT=27019` 和 `lan-service.mjs … source`，不调用默认 R3 服务。人工或根部代理取得当前发布授权后，应立即重跑 preflight，并排除同时进行的启停/发布操作，再逐行执行计划；每一步失败就停下。

1. 使用现有 source 服务入口停止 R4，确认成功。
2. 把当前 `release/source-r4` 原目录改名为 `release/source-r4-backups/<candidate-id>-previous`，保留完整旧目录。
3. 把候选目录改名为 `release/source-r4`；重新执行候选 SHA 验证，再启动 source 服务并核对新 instanceId、页面、实际 GPU 和 LAN。
4. 若新版本失败，先停止该 R4，将新目录保留为 `<candidate-id>-rejected`，把 `previous` 改名回 `source-r4`，再启动和验收旧版。
5. 若第二次改名失败而 active 不存在，直接把 `previous` 恢复为 active；不要执行要求 active 存在的通用回退第一步。

生成的改名命令使用 `fs.renameSync` 并拒绝已存在的目的目录，避免 `mv` 把整个源目录意外嵌入已存在目录。单次同文件系统改名是原子的，**整个停止/两次改名/启动不是原子事务**；这里交付的是可审查、保留 previous/rejected 的顺序流程，不是自动故障恢复或并发发布协调器。严禁无检查地批量粘贴计划。

旧部署可能没有 `candidate.json/runtime-manifest.json`。preflight 仅对它的入口与页面保存 SHA，不虚称已获得其完整旧包清单；回退依靠保存整个旧目录及原部署回执。以后由本工具构建的 previous 目录可以直接用 `verify --candidate <previous>` 重新核验。工具不会删除任何旧目录。

## 本轮验证

详见本工作树 `output/goal-release-20260913/` 与实际候选 `checks/`。使用临时目录的测试覆盖目的路径隔离、符号链接逃逸、已有候选拒绝、R3/R4 原文件保护、独立资产副本、篡改/缺失/多余文件检测、清单路径/摘要验证、原 manifest 交叉核对，以及未完整检查候选的 preflight 拒绝。

首个真实候选 `r4-tool-smoke-20260913` 于 2026-09-13 20:21（北京时间）完成：全项目 typecheck、定向工具测试、Vite Web 与 NodeNext server 构建、复制及重新读取核验均通过；实际 2,093 个运行文件 / 3,682,045,623 bytes，其中 1,879 个公共资源 / 3,673,454,886 bytes。随后增加原声明检查并执行最终独立候选，详见 `r4-tool-final-20260913` 回执；定向工具测试不作为完整项目总测。本轮只读 preflight 确认正式 R4 仍为 instance `37f3048c-daf4-4b23-bfad-31d3f0b24c5f`，候选因非完整总测等原因被正确阻止标为可发布。未发布，未启停服务。
