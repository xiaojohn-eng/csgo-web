# CSGO Web LAN

基于 React、Three.js、Rapier 和 Colyseus 的浏览器战术射击开发项目。公开客户端、权威服务端、局域网房间、武器与皮肤逻辑、转换工具和测试源码。当前处于开发阶段，尚未实现与原作完全一致。

**这是源码发布，不包含 Valve 原版游戏素材，也不是下载即玩的完整游戏包。** 原版地图、角色、枪械、皮肤图片、音效、字体及本机验收素材均未上传。仅克隆仓库不能恢复本机的完整游戏画面；已公开的原创及开放许可资源可从下方资源包下载；仍有未确认来源的旧资源缺失。

## 公开资源包

[下载原创及开放许可资源包](https://github.com/xiaojohn-eng/csgo-web/releases/tag/assets-2026-09-20)，解压到仓库根目录即可恢复包内 `public/` 路径。包含 PORT SELENE 港口地图、FALCON 枪械、MIT 许可的修改人物、AI 菜单背景和项目生成纹理；上游许可与来源说明随包保留。

[逐文件清单及 SHA-256](docs/public-assets-manifest.json) 同时列出未发布文件。此包不包含 Valve 原作资源，也不代表完整游戏资源已齐备。下载后可用 Release 中的 `SHA256SUMS.txt` 校验 ZIP。

## 功能范围

- 浏览器第一人称控制、本地训练、AI、最多 10 人局域网房间。
- 权威服务器同步、回合与经济、购买、武器切换、掉落与拾取。
- AK-47、M4A4、Glock-18、USP-S、Desert Eagle、AWP 的运行逻辑。
- 皮肤选择与预览接口、图案/磨损参数、装备同步。
- 地图、动画、材质和音效导入工具及还原研究记录。

功能支持范围不等于全部验收通过；跨设备、性能和原作一致性仍有缺口。

## 开发

需要 Node.js 22.13 或更高版本。

```sh
npm ci
npm run dev
```

开发入口为 `http://127.0.0.1:27016/`。没有合法准备的资源时，依赖资源的模式不可正常游玩。资源准备说明见 [ASSETS.md](ASSETS.md)。

## 构建和局域网运行

先准备合法的 `public/` 资源，再运行：

```sh
npm run build
npm start
npm run status
# 停止服务
npm stop
```

默认服务端口为 27015。启动输出会列出当前网卡地址；同一局域网玩家访问该地址并创建/加入房间。服务器主机需要保持运行。

原版 Dust II 路径使用独立的 R4 发布流程，见 [发布说明](docs/source-release.md)。`npm run source:stage -- --id my-build` 只生成候选，不会自动切换正在运行的服务。

## 检查

```sh
npm run typecheck
npm run build
npm test
```

部分测试需要本机游戏资源、原生参考程序或未分发的验收数据；干净克隆不保证整个测试集通过。本次公开发布没有重新进行游戏验收。历史记录中的通过结论只对应当时的本地环境。

## 许可

项目原创代码采用 [MIT](LICENSE)；第三方代码、参考数据、游戏素材和商标不受该授权覆盖，详见 [第三方说明](THIRD_PARTY_NOTICES.md)。本项目不隶属于 Valve。
