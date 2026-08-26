# @dsh-blue/blue-doudizhu

Blue 斗地主：在 Blue 的 dock 面板用字符绘制牌局，Bot 复用本地配置的模型，支持积分与排行榜、记牌器、暂停/收起面板。

本项目基于 [Blue](https://github.com/dsh-blue/blue) 构建：Blue 是 DeepSeek Harness 的终端 UI，插件以 Cordis 插件包 + Cordis 补丁的形式挂载。更多资料见 [Blue 文档](https://dsh-blue.dev/)。

## 命令
- `/poker new` 开局（可带叫分 `/poker new 2`）
- `/poker <编码>` 出牌（`0`=10、`jqka2`=JQKA2、`sx`=王炸、`p`=不出）
- `/poker score` 记分；`/poker end` 结束比赛看排行榜
- `/poker memo` 开关记牌器
- `/poker pause` 暂停并收起面板；`/poker resume` 恢复并展开
- `/poker bot` 切模型Bot / `/poker heuristic` 切规则AI

## 前置条件：先安装 Blue

本插件是一个 **Blue 功能**（`cordis.patch.yml` + `bluePluginHost` 插件包），依赖 Blue 终端 UI 与 `bluePluginHost` 能力。**安装本插件前，你必须先装好 Blue**：

```sh
npm i -g @deepseek-ai/dsh
dsh plugin --profile blue add @dsh-blue/blue@rc
```

> 🔔 必须先有 `blue` profile 且已安装 `@dsh-blue/blue`，再执行下面的步骤；否则会提示 `bluePluginHost` 能力缺失 / `@dsh-blue/blue` 解析失败。Blue 的安装与首次配置参见 [Blue 仓库](https://github.com/dsh-blue/blue) 与 [Blue 文档](https://dsh-blue.dev/en/guide/)。

## 安装

### 方式一：npm
```sh
dsh plugin --profile blue add @dsh-blue/blue-doudizhu
```

### 方式二：GitHub 源
```sh
dsh plugin --profile blue add github:dsh-blue/blue-doudizhu
```
也可以直接用 git URL：
```sh
dsh plugin --profile blue add git+https://github.com/dsh-blue/blue-doudizhu.git
```

安装后重启 Blue（`dsh --profile blue`），即可使用 `/poker` 命令。

## 相关链接
- Blue 仓库：https://github.com/dsh-blue/blue
- Blue 文档：https://dsh-blue.dev/
