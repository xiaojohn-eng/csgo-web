# 资源准备

## 已发布资源

[assets-2026-09-20](https://github.com/xiaojohn-eng/csgo-web/releases/tag/assets-2026-09-20) 提供原创与已有开放许可的资源 ZIP。解压到项目根目录，目录结构为 `public/`。模型、图像和纹理保留本机原始字节。

- PORT SELENE 港口地图：项目原创场景，包含 provenance.json 标注的 CC0 素材。
- FALCON P12、DMR，以及人物所持 M4：项目原创枪械。
- FALCON 人物与动作：Microsoft Rocketbox MIT 基础上的修改版，保留 Microsoft 许可及来源说明。
- 菜单背景：有 Image2 制作与哈希记录；generated 纹理按用户确认的项目生成资源发布。
- 原创贡献沿用项目 MIT 许可；第三方部分继续适用各自条款。

精确范围、哈希和待确认资源见 [公开资源清单](docs/public-assets-manifest.json)。本次只检查归档完整性和逐文件哈希，没有重新进行游戏验收，也不宣称完整可玩。

## 未包含资源

`public/source/` 中的 Valve 派生原作资源未发布；旧版音频、模型与部分纹理暂缺逐文件来源证据，列入清单 pending。`.reference-assets/`、`release/` 和私有 `output/` 也不公开。

有相应使用权的开发者可自行准备兼容资源。R4 使用 `public/source/csgo-12426148/` 中的 manifest 与配套文件，版本与哈希必须匹配。转换工具见 `scripts/`；工具链记录见 `research/source1-to-glb-toolchain.md` 和 `research/source1-map-pipeline.md`。这些不是经验证的一键资源安装器。
