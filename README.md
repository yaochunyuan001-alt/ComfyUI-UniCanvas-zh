# UniCanvas 中文汉化（运行时翻译层）

给 [vnccs-utils](https://github.com/AHEKOT/ComfyUI_VNCCS_Utils) 的 UniCanvas / 3D Factory / Pose Studio 界面做中文汉化。

> 仓库：<https://github.com/yaochunyuan001-alt/ComfyUI-UniCanvas-zh>
**不改上游任何文件**，升级 vnccs-utils 后依然生效。

- 词表总计 **534 条**：节点面板、独立工作区（Unicanvas 全屏）、提示词指南弹窗、右键菜单、画布内文字
- 已验证：ComfyUI v0.45.3 + vnccs-utils 0.7.6 + chinese-translation 2026-11-12

## 安装

1. 把本目录整个放进 ComfyUI 的 `custom_nodes/` 下，命名为 `unicanvas-zh`：

   ```
   ComfyUI/custom_nodes/unicanvas-zh/
   ```

2. （可选，推荐）若装了 [chinese-translation](https://github.com/AIGODLIKE/ComfyUI-Chinese-Translation) 汉化包，
   把 `chinese-translation-patch/zh-CN/` 下的两个文件复制到对应位置，用于补全节点标题与分类名：

   ```
   custom_nodes/chinese-translation/zh-CN/Nodes/ComfyUI_VNCCS_UniCanvas.json
   custom_nodes/chinese-translation/zh-CN/Categories/VNCCS_UniCanvas_zh.json
   ```

3. 重启 ComfyUI（或刷新页面）。打开 UniCanvas 节点 / 独立工作区即为中文。

> 只装本插件也能用：面板文案、tooltip、提示词指南都会翻译；只有节点标题与分类名依赖第 2 步。

## 它做了什么

1. 本插件通过 `WEB_DIRECTORY = "./web"` 注入 `unicanvas_zh.js`。它在页面加载后：
   - 从 `web/i18n/*.json` 读取中英词表；
   - 只翻译带 `vnccs` 类名的容器（节点面板、独立工作区、提示词指南弹窗）里的文本节点、`title` / `aria-label` / `placeholder` 等属性、`<option>`；
   - 用 `MutationObserver` 追踪动态生成的 DOM；
   - 钩住 `CanvasRenderingContext2D.fillText`，翻译画布上画的少量文字（尺寸/不透明度/拖拽等，见 `canvas.json`）。
2. 节点标题、分类名由 `chinese-translation` 的数据补全（见上「安装」第 2 步）。

## 词表文件（web/i18n/）

| 文件 | 内容 |
| --- | --- |
| `terms.json` | 预留（当前为空） |
| `main.json` | 主界面词条（271 条） |
| `modules.json` | 模型模块/参数说明（178 条） |
| `extra.json` | 补充 UI 词、混色模式、模型预设说明（59 条） |
| `guides.json` | 提示词指南正文与说明句（30 条） |
| `canvas.json` | 画布 fillText 用词（10 条） |
| `misses_raw.json` / `skipped_*.json` | 采集记录与有意不翻的条目（参考用，不影响运行） |

键是英文原文（连续空白会被归一成一个空格），值是中文。**值是纯文本**，不要放 HTML。

## 改词表 / 补漏翻

1. 打开页面，控制台执行 `window.vnccsZhReport()` 打印当前页面上还没译到的英文；
   `window.vnccsZhMisses` 是数组，`window.vnccsZhClear()` 清空后重新收集。
2. 把要译的条目加进 `main.json`（或对应文件），刷新页面即可生效。
3. 动态拼接的句子（`X 个模型已就绪`、`X - 提示词写法` 等）写在 `unicanvas_zh.js` 的 `RULES` 里；
   已经译错的名词修正写在 `FIXES` 里（例如 `DMD2 SDXL 灯光` → `DMD2 SDXL 闪电`）。

## 临时关闭 / 卸载

- 临时关闭：把本目录重命名为 `unicanvas-zh.disabled`，重启 ComfyUI（或刷新页面）。
- 彻底卸载：删除本目录，同时删除 `chinese-translation/zh-CN/Nodes/ComfyUI_VNCCS_UniCanvas.json` 与 `chinese-translation/zh-CN/Categories/VNCCS_UniCanvas_zh.json`。

## 有意保留英文的内容

模型名（Anima / Krea2 / Flux Klein / Qwen Edit 2.1 …）、文件名（*.safetensors）、采样器/调度器名（euler / dpmpp_2m …）、
提示词示例正文（示例 prompt 本身是给人复制去用的）、标签 token（`<image1>`、`<Picture 2>`）、缩写（CFG / CLIP / VAE / PSD / LoRA / GGUF）。

## 已验证

- ComfyUI v0.45.3 + vnccs-utils 0.7.6 + chinese-translation 2026-11-12 环境实测：
  节点面板、独立工作区（Unicanvas 全屏）、提示词指南弹窗（Qwen Edit 2.1 / SDXL / MiniMax 等）全中文；
  重新收集漏翻为 0（剩余英文均为上面“有意保留”的类别）。

## 已知限制

- vnccs-utils 升级后新增的文案在补词表前会先显示英文（用 `vnccsZhReport()` 收集即可补齐）。
- 设置页的搜索索引、少量动态拼接句仍可能残留英文。
- 本插件只影响 `vnccs` 作用域内的界面，不改动 ComfyUI 本体与其他插件。