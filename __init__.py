"""UniCanvas 中文汉化层（运行时 DOM 翻译）。

不修改 vnccs-utils 任何源码：本扩展只向页面注入一段前端 JS，
按「英文原文 -> 中文」的精确词表替换 UniCanvas 界面上的文本。
"""

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
