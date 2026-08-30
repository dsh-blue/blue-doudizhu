# @dsh-blue/blue-doudizhu

Blue 斗地主：核心牌面以 **overlay** 呈现——`Esc` 只是暂时收起、不打断牌局，`/poker resume` 随时恢复，`/poker stop` 才真正停止。Bot 复用本地配置的模型，支持积分与排行榜、记牌器。

本项目基于 [Blue](https://github.com/dsh-blue/blue) 构建：Blue 是 DeepSeek Harness 的终端 UI，插件以 Cordis 插件包 + Cordis 补丁的形式挂载。更多资料见 [Blue 文档](https://dsh-blue.dev/)。

已对齐 Blue `0.1.1-rc` 线（插件协议 `1.0.0-beta.1`，capabilities：`commands` / `overlays` / `notifications.publish`）。

## 命令
- `/poker new` 开局（可带叫分 `/poker new 2`），自动弹出牌面 overlay
- `/poker <编码>` 出牌（`0`=10、`jqka2`=JQKA2、`sx`=王炸、`p`=不出）
- **`Esc`** 收起牌面 overlay——仅隐藏界面，牌局与 Bot 继续进行
- `/poker resume` 重新打开牌面 overlay（并解除暂停）
- `/poker stop` 真正停止当前牌局（不计分、收起牌面）
- `/poker pause` 暂停 Bot 出牌并收起牌面（`/poker resume` 恢复）
- `/poker score` 记分；`/poker end` 结束比赛看排行榜
- `/poker memo` 开关记牌器
- `/poker bot` 切模型Bot / `/poker heuristic` 切规则AI

## 前置条件：先安装 Blue

本插件是一个 **Blue 功能**（`cordis.patch.yml` + `bluePluginHost` 插件包），依赖 Blue 终端 UI 与 `bluePluginHost` 能力。**安装本插件前，你必须先装好 Blue**（`>=0.1.1-rc.2`）：

```sh
npm i -g @deepseek-ai/dsh
dsh plugin --profile blue add @dsh-blue/blue@rc
```

> 🔔 必须先有 `blue` profile 且已安装 `@dsh-blue/blue`，再执行下面的步骤；否则会提示 `bluePluginHost` 能力缺失 / `@dsh-blue/blue` 解析失败。Blue 的安装与首次配置参见 [Blue 仓库](https://github.com/dsh-blue/blue) 与 [Blue 文档](https://dsh-blue.dev/en/guide/)。

## 安装

### 方式一：npm
```sh
blue plugin install @dsh-blue/blue-doudizhu
```

### 方式二：GitHub 源
```sh
blue plugin install github:dsh-blue/blue-doudizhu@<commit>
```
也可以直接用 git URL：
```sh
blue plugin install git+https://github.com/dsh-blue/blue-doudizhu.git@<commit>
```

安装后重启 Blue（`dsh --profile blue`），即可使用 `/poker` 命令。

## 相关链接
- Blue 仓库：https://github.com/dsh-blue/blue
- Blue 文档：https://dsh-blue.dev/
