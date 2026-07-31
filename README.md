# kimi-mc

浏览器里的 Minecraft：生存、创造、探索——无需安装，打开网页即玩。
支持电脑与手机，**离线也能玩**（PWA）。

本项目由 **Kimi K3** 开发完成。

## 快速开始

```bash
pnpm install
pnpm dev         # 打开 http://localhost:3000
```

输入种子创建世界（留空随机），选生存或创造；相同的种子会生成相同的世界。
世界每 5 秒自动存档到浏览器本地，随时继续上次进度。

## 特性一览

- **两个完整维度 + 末地**：主世界 17 种群系（冰刺平原、蘑菇岛、恶地、樱花林……）、洞穴群系与紫水晶洞；下界五群系、堡垒与猪灵以物易物；末地末影龙 Boss 战与鞘翅滑翔
- **完整生存循环**：生命/饥饿/氧气、昼夜刷怪、工具五材质耐久、合成/烧炼/酿造/附魔/铁砧/锻造、盔甲减伤、村民交易、钓鱼
- **红石系统**：红石粉 15 级衰减、中继器、比较器、活塞/粘性活塞、TNT、红石灯、门
- **Boss 与终局**：凋灵、末影龙、信标金字塔、下界合金装备
- **创造模式**：291 种方块（含变体 406 种）、飞行、搜索选块界面
- **自定义**：内置 Faithful 32x 贴图、可导入自己的贴图包、像素风字体、WebGPU（自动降级 WebGL）

## 技术栈

- Next.js (App Router) + shadcn/ui + Three.js (@react-three/fiber)，pnpm 管理
- 多噪声场群系与山脊地形（lib/noise.ts）+ 确定性矿脉（lib/oregen.ts）+ 流体传播（lib/fluids.ts）
- chunk 网格化在 Web Worker 池中执行（lib/mesherPool.ts）
- 脚本：`pnpm dev` / `pnpm test`（vitest）/ `pnpm lint` / `pnpm typecheck` / `pnpm build`（静态导出 `out/`，可部署到任意静态托管）
- 离线缓存：`pnpm build` 前自动执行 `scripts/gen-sw-precache.mjs`，扫描 `public/` 生成 SW precache 清单（贴图/音效/字体），新增资产无需手改 `public/sw.js`
- CI：GitHub Actions（push/PR 跑 lint + test + build）
- 贴图工具：`scripts/build-pack.ts` 从 Faithful 源包重提取 atlas（需 python+PIL）

## 资源署名

方块贴图来自 **Faithful 32x**（© Faithful Resource Pack 团队，[Faithful License V3](public/textures/pack/LICENSE.txt)）：
按其许可证要求署名并链接回 <https://faithfulpack.net/>，许可原文随贴图附带于 `public/textures/pack/LICENSE.txt`，
本项目为完全免费的非盈利内容。详见 [public/textures/CREDITS.md](public/textures/CREDITS.md)。

音效来自 [Minetest Game](https://github.com/luanti-org/minetest_game)（`mods/default/sounds/`），
媒体资源采用 [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)，作者为 Various Minetest Game developers。
详见 [public/sounds/CREDITS.md](public/sounds/CREDITS.md)。

界面字体为本地自托管的像素字体（[OFL 1.1](https://openfontlicense.org/)）：
[Monocraft](https://github.com/IdreesInc/Monocraft)（拉丁/数字，© Idrees Hassan）与
[Fusion Pixel 缝合像素字体](https://github.com/TakWolf/fusion-pixel-font)（中文，© TakWolf 及上游作者），
许可文本见 `public/fonts/`。

设置中导入的自定义贴图包由用户自行获取并仅存于本地浏览器；导入第三方贴图包时请遵守其各自许可证。
