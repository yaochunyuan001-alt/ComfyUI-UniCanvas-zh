/**
 * UniCanvas 中文汉化层（运行时翻译）
 * ---------------------------------
 * 不修改 vnccs-utils 任何源码，只在 DOM 层按精确词表替换文本。
 *  词表  : ./i18n/*.json   {"English": "中文"}
 *  作用域: [class*="vnccs"] 容器内；整页处于 UniCanvas 独立模式时为整页
 *  例外  : 含 "UniCanvas"/"VNCCS" 或很长的专有句子，允许在容器外翻译（设置项、侧边栏 tab）
 *  跳过  : input/textarea/contenteditable、已含中文的文本（同时防止循环）
 *  画布  : CanvasRenderingContext2D.fillText/strokeText 只按 canvas.json 翻译，避免影响别的节点
 *  漏翻  : window.vnccsZhReport() 打印页面上尚未翻译的英文
 *  校验  : 生成前比对 模型/CLIP/VAE 是否配套（搭配表来自 /vnccs/unicanvas/presets，
 *          与当前版本自动同步）；不配套就拦下并给出中文原因，避免后端静默报错
 */
import { app } from "../../scripts/app.js";

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const LETTER = /[A-Za-z]/;
const ATTRS = ["title", "aria-label", "placeholder", "data-tip", "data-tooltip", "alt"];
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "TEXTAREA", "INPUT", "NOSCRIPT", "CODE", "PRE"]);
const I18N_BASE = new URL("./i18n/", import.meta.url);
const I18N_FILES = ["terms.json", "main.json", "modules.json", "extra.json", "guides.json"];
const CANVAS_FILE = "canvas.json";

/** @type {Map<string,string>} 归一化英文 -> 中文 */
const DICT = new Map();
/** @type {Map<string,string>} 画布绘制专用词表 */
const CANVAS = new Map();
/** 其它汉化包误译的兜底修正（成品中文 -> 正确中文），在己方词表之前执行 */
const FIXES = [
  [/DMD2 SDXL 灯光/g, "DMD2 SDXL 闪电"],
];
const FIX_RE = new RegExp(FIXES.map(([re]) => re.source).join("|"));
const misses = new Set();
const hits = new Set();

/** 动态拼接文案规则（渲染后的成品字符串 -> 中文） */
const RULES = [
  {
    re: /^(.+?) Settings$/,
    fn: (m) => {
      const head = translateDeep(m[1]);
      return head ? head + " 设置" : null;
    },
  },
  {
    re: /^(.+?) — missing model files$/,
    fn: (m) => {
      const head = translateDeep(m[1]);
      return (head || m[1]) + " — 缺少模型文件";
    },
  },
  {
    re: /^(\d+) of (\d+) model families have a system prompt$/,
    fn: (m) => m[1] + " / " + m[2] + " 个模型系列已配置系统提示词",
  },
  {
    re: /^(\d+) of (\d+) model families? (?:is|are) ready$/,
    fn: (m) => m[1] + " / " + m[2] + " 个模型系列已就绪",
  },
  {
    // "Krea2 Edit - Image to image - how to prompt"
    re: /^(.+?) - how to prompt$/,
    fn: (m) => m[1].split(" - ").map((part) => t(part)).join(" - ") + " - 提示词写法",
  },
  {
    // "Inpaint prompts differently: ..."
    re: /^(.+?) prompts differently: (.+)$/,
    fn: (m) => t(m[1]) + "的提示词写法不同：" + m[2],
  },
  {
    re: /^Tasks: (.+)$/,
    fn: (m) => "任务：" + m[1].split(", ").map((x) => t(x)).join("、"),
  },
  {
    re: /^Coming later: (.+)$/,
    fn: (m) => "后续版本：" + m[1].split(", ").map((x) => t(x)).join("、"),
  },
  {
    re: /^Sources: (.+)$/,
    fn: (m) => "来源：" + m[1],
  },
  {
    // 参考图说明（含槽位）
    re: /^Referring to images: (.+?) is the working area \(the canvas inside the bbox\); (.+?) are the reference images in upload \/ VNCSS Config order\.$/,
    fn: (m) => "图片指代：" + m[1] + " 是工作区（选框内的画布）；" + m[2] + " 是按上传 / VNCSS 配置顺序排列的参考图。",
  },
  {
    re: /^Write the tags exactly as shown \(with the angle brackets\), e\.g\. "(.+)"$/,
    fn: (m) => '按原样书写这些标签（含尖括号），例如 "' + exampleZh(m[1]) + '"',
  },
  {
    re: /^Write the names in plain words, e\.g\. "(.+)"$/,
    fn: (m) => '用普通词语书写名称，例如 "' + exampleZh(m[1]) + '"',
  },
  {
    re: /^Referring to images: this model has no image tags - describe what to change in the working area in plain words \("the woman", "the background"\)\.$/,
    fn: () => '图片指代：该模型没有图片标签——用普通词语描述工作区里要改什么（如 "the woman"、"the background"）。',
  },
  {
    re: /^(.+?): no reference tags - describe each reference in plain words \(e\.g\. "the character from the second image"\)\.$/,
    fn: (m) => t(m[1]) + "：没有参考标签——用普通词语描述每张参考图（例如“第二张图里的角色”）。",
  },
  {
    re: /^(.+?): references are (.+?) in the prompt; (.+?) is the working area\.$/,
    fn: (m) => t(m[1]) + "：在提示词中用 " + m[2] + " 指代参考图；" + m[3] + " 是工作区。",
  },
  {
    re: /^(.+?): say "(.+?)" in plain words; (.+?) is the working area\.$/,
    fn: (m) => t(m[1]) + "：用普通词语写 " + m[2] + "；" + m[3] + " 是工作区。",
  },
  {
    // 提示词指南按钮 tooltip
    re: /^How to prompt (.+)$/,
    fn: (m) => "如何为 " + t(m[1]) + " 写提示词",
  },
  {
    re: /^Model: (.+)$/,
    fn: (m) => "模型：" + m[1],
  },
  // 生成状态行（面板底部 setStatus 的文案）
  {
    re: /^GENERATE complete \((\d+) staged\)(?: - (.+))?$/,
    fn: (m) => {
      const perf = m[2] ? translateDeep(m[2]) || m[2] : "";
      return "生成完成（已暂存 " + m[1] + " 张）" + (perf ? " · " + perf : "");
    },
  },
  {
    re: /^GENERATE failed: (.+)$/,
    fn: (m) => "生成失败：" + m[1],
  },
  {
    re: /^Generating (.+?) (\d+×\d+)(?: ×(\d+))?\.\.\.$/,
    fn: (m) => {
      const mode = { txt2img: "文生图", img2img: "图生图", inpaint: "局部重绘", outpaint: "扩图" }[m[1]] || m[1];
      return "正在生成" + mode + " " + m[2] + (m[3] ? " ×" + m[3] : "") + "…";
    },
  },
  {
    re: /^Starting generation$/,
    fn: () => "开始生成",
  },
  {
    re: /^Generation stopped - VRAM freed$/,
    fn: () => "生成已停止 - 显存已释放",
  },
  {
    re: /^Stopped - VRAM freed$/,
    fn: () => "已停止 - 显存已释放",
  },
  // 独立工作区顶栏的系统状态（Comfy 的 stats 组件画在 VNCCS 容器里）
  {
    re: /^(\d+): (.+?) - (\d+)% - ([\d.]+ GB) \/ ([\d.]+ GB) Max: ([\d.]+ GB)$/,
    fn: (m) => "GPU" + m[1] + " " + m[2] + "：占用 " + m[3] + "% · 显存 " + m[4] + " / " + m[5] + "（上限 " + m[6] + "）",
  },
  {
    re: /^(\d+): (.+?) - (\d+)%$/,
    fn: (m) => "GPU" + m[1] + " " + m[2] + "：占用 " + m[3] + "%",
  },
  {
    re: /^(\d+): (.+?) - (\d+)°$/,
    fn: (m) => "GPU" + m[1] + " " + m[2] + "：温度 " + m[3] + "°C",
  },
  {
    re: /^([\d.]+) MP$/,
    fn: (m) => m[1] + " 百万像素",
  },
  {
    // 完成状态末尾的性能标签：attention pytorch · EasyCache off (8 steps) · VAE full
    re: /^attention (.+?) · (EasyCache (on|off)(?: ?\(([^)]*)\))?) · VAE (chunked|full)$/,
    fn: (m) =>
      "注意力 " + m[1] + " · EasyCache " + (m[3] === "on" ? "开" : "关") + (m[4] ? "（" + m[4] + "）" : "") + " · VAE " + (m[5] === "chunked" ? "分块" : "整块"),
  },
  {
    re: /^(\d+)% - ([\d.]+ GB) \/ ([\d.]+ GB) Max: ([\d.]+ GB)$/,
    fn: (m) => m[1] + "% · 显存 " + m[2] + " / " + m[3] + "（上限 " + m[4] + "）",
  },
];

/* ===================== 生成前校验：模型 / CLIP / VAE 搭配 ===================== */
const DRAW_URL = "/vnccs/unicanvas/draw";
/** 预览用小 VAE 不参与搭配校验（taesd 等本来就可以跨模型预览） */
const PREVIEW_VAE = /^(taesd|taesdxl|pixel_space)$/i;
/** 搭配表：扩散模型文件名 -> 预设里配套的 {vae, clip, clipType, title} */
const PAIRINGS = new Map();
let pairingsLoaded = false;

function loadPairings() {
  if (pairingsLoaded) return Promise.resolve();
  return fetch("/vnccs/unicanvas/presets", { cache: "no-store" })
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      const presets = (data && Array.isArray(data.presets) && data.presets) || [];
      for (const preset of presets) {
        const s = (preset && preset.settings) || {};
        const model = s.diffusion_model_name;
        if (!model || s.model_loader !== "diffusion_model") continue;
        PAIRINGS.set(norm(model), {
          vae: s.vae_name || "",
          clip: s.clip_name || "",
          clipType: s.clip_type || "",
          title: preset.title || preset.label || preset.id || model,
        });
      }
      pairingsLoaded = PAIRINGS.size > 0;
      if (pairingsLoaded) {
        console.log("[UniCanvas 汉化] 已载入模型搭配表:", PAIRINGS.size, "个模型");
      }
    })
    .catch((e) => console.warn("[UniCanvas 汉化] 搭配表加载失败:", e));
}

/** 返回拦截原因（中文）；null 表示放行 */
function validateDrawSettings(settings) {
  if (!settings || typeof settings !== "object") return null;
  if (localStorage.getItem("vnccs_zh_skip_guard") === "1") return null;
  if (settings.model_loader !== "diffusion_model") return null;
  const model = norm(settings.diffusion_model_name || "");
  const exp = model ? PAIRINGS.get(model) : null;
  if (!exp) return null;

  const vae = norm(settings.vae_name || "");
  const clip = norm(settings.clip_name || "");
  const vaeName = vae.split(/[\\/]/).pop();
  if (exp.vae && vae && vae !== exp.vae && !PREVIEW_VAE.test(vaeName)) {
    return (
      "已拦下这次生成：模型与 VAE 不配套。\n" +
      "模型：" + model + "（" + exp.title + "）\n" +
      "VAE 应为：" + exp.vae + "，当前是：" + vae +
      "\n解决：切回「预设」选「" + exp.title + "」会自动填好；或在「自定义」里把 VAE 改成 " + exp.vae + "。"
    );
  }

  // CLIP 不一致不会崩，只会明显影响出图质量 —— 提示但不拦截
  if (exp.clip && clip && clip !== exp.clip) {
    showZhToast(
      "提示：「" + exp.title + "」的文本编码器通常是 " + exp.clip + "，当前是 " + clip + "，出图效果可能异常。",
      12000
    );
  }
  return null;
}

/** 把后端英文异常翻译成人能看懂的中文；没有匹配时返回 null（保留原样） */
function translateBackendError(raw) {
  let msg = raw;
  try {
    const j = JSON.parse(raw);
    if (j && typeof j.error === "string") msg = j.error;
  } catch (e) {
    /* 不是 JSON，直接用原文 */
  }
  if (!msg || typeof msg !== "string") return null;
  const rules = [
    [/Required node '([^']+)' is not available/, (m) => "缺少外部节点「" + m[1] + "」：这是 vnccs 依赖的第三方节点，需要安装对应节点包后才能生成（后端日志里能看到来源）。"],
    [/tuple index out of range/, () => "解码阶段崩溃：所选 VAE 与模型不配套（典型情况是给 Z-Image / Flux 这类模型用了 Qwen-Image 的 Wan 架构 VAE）。请把 VAE 换成模型配套的那个，或直接切回「预设」。"],
    [/(CUDA )?out of memory/i, () => "显存不足：请减小推理尺寸或批量，关闭其它占显存的程序后重试。"],
  ];
  for (const [re, fn] of rules) {
    const m = re.exec(msg);
    if (m) return fn(m);
  }
  return null;
}

/** 页面右下角的提示条（不依赖 ComfyUI 内部 toast API） */
let toastBox = null;
function showZhToast(text, life = 9000) {
  if (!document.body) return;
  if (!toastBox || !toastBox.isConnected) {
    toastBox = document.createElement("div");
    toastBox.className = "vnccs-zh-toast-box";
    toastBox.style.cssText =
      "position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:99999;" +
      "display:flex;flex-direction:column;align-items:center;pointer-events:none;gap:8px;";
    document.body.appendChild(toastBox);
  }
  const item = document.createElement("div");
  item.textContent = text;
  item.title = "点击关闭";
  item.style.cssText =
    "pointer-events:auto;max-width:min(620px,80vw);padding:10px 14px;border-radius:8px;" +
    "background:rgba(43,29,16,.96);border:1px solid #c98b3a;color:#ffd9a3;" +
    "font:13px/1.55 system-ui,'Segoe UI',sans-serif;white-space:pre-wrap;cursor:pointer;" +
    "box-shadow:0 6px 18px rgba(0,0,0,.45);";
  item.addEventListener("click", () => item.remove());
  toastBox.appendChild(item);
  setTimeout(() => item.remove(), life);
  window.vnccsZhToast = showZhToast;
  return item;
}

function payloadSteps(init) {
  try {
    const payload = init && typeof init.body === "string" ? JSON.parse(init.body) : null;
    const s = (payload && payload.settings) || null;
    return s ? Number(s.steps) || 0 : 0;
  } catch (e) {
    return 0;
  }
}

function startFetchGuard() {
  if (window.__vnccsZhFetchHooked || typeof window.fetch !== "function") return;
  window.__vnccsZhFetchHooked = true;
  const origFetch = window.fetch;
  window.fetch = async function (input, init) {
    const url = typeof input === "string" ? input : input && input.url ? input.url : "";
    const isDraw = url.indexOf(DRAW_URL) !== -1;
    if (isDraw && init && typeof init.body === "string" && String(init.method || "GET").toUpperCase() === "POST") {
      let payload = null;
      try {
        payload = JSON.parse(init.body);
      } catch (e) {
        payload = null;
      }
      const blocked = payload ? validateDrawSettings(payload.settings) : null;
      if (blocked) {
        showZhToast(blocked, 15000);
        return new Response(JSON.stringify({ error: blocked }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
    }
    const t0 = window.performance.now();
    const res = await origFetch.apply(this, arguments);
    if (isDraw && res && res.ok) {
      // 后端不返回总耗时，这里自己算一份，补上「性能显示」
      const seconds = (window.performance.now() - t0) / 1000;
      const steps = Number(payloadSteps(init)) || 0;
      const perf = { seconds: Math.round(seconds * 10) / 10, steps: steps };
      if (steps > 0) perf.stepsPerSecond = Math.round((steps / seconds) * 100) / 100;
      window.vnccsZhLastPerf = perf;
      const parts = ["生成完成：" + perf.seconds + " 秒"];
      if (steps > 0) parts.push(steps + " 步");
      if (perf.stepsPerSecond) parts.push("平均 " + perf.stepsPerSecond + " 步/秒");
      showZhToast(parts.join(" · "), 5000);
    }
    if (isDraw && res && res.ok === false && typeof res.clone === "function") {
      try {
        const raw = await res.clone().text();
        const zh = translateBackendError(raw);
        if (zh) {
          showZhToast(zh, 15000);
          return new Response(JSON.stringify({ error: zh }), {
            status: res.status,
            statusText: res.statusText,
            headers: { "Content-Type": "application/json" },
          });
        }
      } catch (e) {
        /* 读取失败就按原响应返回 */
      }
    }
    return res;
  };
}

function norm(s) {
  return String(s).replace(/\s+/g, " ").trim();
}

/** 词表直译；没有条目时原样返回（用于拼接句里的名字/标签） */
function t(s) {
  const key = norm(s);
  return DICT.get(key) || key;
}

/** 参考图示例句 "Put the character from A into B, keep the lighting of C." */
function exampleZh(sentence) {
  const m = /^Put the character from (.+?) into (.+?), keep the lighting of (.+?)\.$/.exec(norm(sentence));
  if (!m) return sentence;
  return "把 " + m[1] + " 中的角色放入 " + m[2] + "，保持 " + m[3] + " 的光照。";
}

function isGlobalKey(key) {
  return /unicanvas|vnccs/i.test(key) || key.length >= 28;
}

/** 允许在任意位置翻译的短词（侧边栏 tab 名） */
const GLOBAL_EXACT = new Set(["unicanvas", "uni canvas", "vnccs", "vnccs unicanvas"]);

function splitPad(raw) {
  return [raw.match(/^\s*/)[0], raw.match(/\s*$/)[0]];
}

function translateDeep(key, depth = 0) {
  const direct = DICT.get(key);
  if (direct) return direct;
  if (depth > 1) return null;
  for (const rule of RULES) {
    const m = rule.re.exec(key);
    if (!m) continue;
    const out = rule.fn(m);
    if (out) return out;
  }
  return null;
}

function translateText(s) {
  const raw = String(s);
  if (!raw || CJK.test(raw) || !LETTER.test(raw)) return null;
  const key = norm(raw);
  if (!key) return null;
  const out = translateDeep(key);
  if (!out) return null;
  hits.add(key);
  const [pre, post] = splitPad(raw);
  return pre + out + post;
}

function translateCanvasText(s) {
  const key = norm(s);
  return key ? CANVAS.get(key) || null : null;
}

// 只翻译 VNCCS 自己的容器；不要用 body.vnccs-unicanvas-standalone-mode 把整页圈进来，
// 否则会去抢 ComfyUI 主体/其它插件的文案（那些由 chinese-translation 汉化包负责）。
const PACK_ROOT_SELECTOR =
  '[class*="vnccs"], .vnccs-unicanvas, .vnccs-uc2-standalone-shell, [data-vnccs-zh-scope]';

function inPackScope(el) {
  if (!el || !el.closest) return false;
  return !!el.closest(PACK_ROOT_SELECTOR);
}

function isExcluded(el) {
  if (!el) return true;
  if (SKIP_TAGS.has(el.tagName)) return true;
  if (el.isContentEditable) return true;
  if (el.closest('[contenteditable="true"]')) return true;
  return false;
}

function looksLikeUiText(key) {
  if (!LETTER.test(key)) return false;
  if (key.length < 3 || key.length > 200) return false;
  if (/^[\d\s.,:;+\-*/%=()<>[\]{}|&^~!?\\'"#@$]+$/.test(key)) return false;
  if (/^(?:https?:\/\/|\/[\w.-]+\/)/.test(key)) return false;
  return true;
}

function recordMiss(key, global) {
  if (!looksLikeUiText(key)) return;
  if (global && key.length < 4) return;
  misses.add(key);
}

/** 修正已被其它汉化包误译的成品文本；返回是否改动 */
function applyFixes(node) {
  const v = node.nodeValue;
  if (!v) return false;
  let out = v;
  for (const [re, to] of FIXES) out = out.replace(re, to);
  if (out === v) return false;
  node.nodeValue = out;
  return true;
}

function applyTextNode(node) {
  const parent = node.parentElement;
  if (!parent || isExcluded(parent)) return;
  applyFixes(node);
  const value = node.nodeValue;
  if (!value || CJK.test(value) || !LETTER.test(value)) return;
  const key = norm(value);
  if (!key) return;
  const global = isGlobalKey(key) || GLOBAL_EXACT.has(key.toLowerCase());
  if (!global && !inPackScope(parent)) return;
  const zh = translateText(value);
  if (zh != null) {
    if (zh !== value) node.nodeValue = zh;
  } else if (inPackScope(parent)) {
    recordMiss(key, global);
  }
}

const ATTR_SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT"]);

function applyAttributes(el) {
  if (!el || el.nodeType !== 1) return;
  if (ATTR_SKIP_TAGS.has(el.tagName)) return;
  let scoped = null;
  for (const attr of ATTRS) {
    const raw = el.getAttribute(attr);
    if (!raw || CJK.test(raw) || !LETTER.test(raw)) continue;
    const key = norm(raw);
    if (!key) continue;
    if (scoped == null) scoped = inPackScope(el);
    if (!scoped && !isGlobalKey(key) && !GLOBAL_EXACT.has(key.toLowerCase())) continue;
    const zh = translateText(raw);
    if (zh != null && zh !== raw) el.setAttribute(attr, zh);
    else if (zh == null && scoped) recordMiss(key, isGlobalKey(key));
  }
}

const walkerFilter = {
  acceptNode(node) {
    if (node.nodeType !== 3) return NodeFilter.FILTER_REJECT;
    const v = node.nodeValue;
    if (!v) return NodeFilter.FILTER_REJECT;
    if (CJK.test(v)) return FIX_RE.test(v) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    if (!LETTER.test(v)) return NodeFilter.FILTER_REJECT;
    return NodeFilter.FILTER_ACCEPT;
  },
};

function applyTree(root) {
  if (!root || root.nodeType !== 1) return;
  try {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, walkerFilter);
    const nodes = [];
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    for (const t of nodes) applyTextNode(t);
    applyAttributes(root);
    if (root.querySelectorAll) {
      for (const el of root.querySelectorAll("[title],[aria-label],[placeholder],[data-tip],[data-tooltip],[alt]")) {
        applyAttributes(el);
      }
      for (const el of root.querySelectorAll("option")) {
        const t = el.firstChild;
        if (t && t.nodeType === 3) applyTextNode(t);
      }
    }
  } catch (e) {
    /* 页面切换瞬间可能有游离节点，忽略 */
  }
}

function applyDocument() {
  if (document.body) applyTree(document.body);
}

function reportMisses() {
  const arr = [...misses].sort();
  console.groupCollapsed("[UniCanvas 汉化] 未翻译英文 " + arr.length + " 条 (window.vnccsZhMisses 可取数组)");
  console.log(arr.join("\n"));
  console.groupEnd();
  window.vnccsZhMisses = arr;
  return arr;
}

async function fetchJson(name) {
  try {
    const res = await fetch(new URL(name, I18N_BASE), { cache: "no-cache" });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.warn("[UniCanvas 汉化] 词表加载失败:", name, e);
    return null;
  }
}

async function loadDicts() {
  const results = await Promise.all(I18N_FILES.map(fetchJson));
  for (const obj of results) {
    if (!obj || typeof obj !== "object") continue;
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === "string" && v.trim()) DICT.set(norm(k), v);
    }
  }
  const cv = await fetchJson(CANVAS_FILE);
  if (cv && typeof cv === "object") {
    for (const [k, v] of Object.entries(cv)) {
      if (typeof v === "string" && v.trim()) CANVAS.set(norm(k), v);
    }
  }
  console.log("[UniCanvas 汉化] 词表已加载:", DICT.size, "条（画布专用 " + CANVAS.size + " 条）");
}

function hookCanvasText() {
  const proto = window.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype;
  if (!proto || proto.__vnccsZhHooked) return;
  proto.__vnccsZhHooked = true;
  for (const name of ["fillText", "strokeText"]) {
    const orig = proto[name];
    if (typeof orig !== "function") continue;
    proto[name] = function (text, ...rest) {
      if (typeof text === "string" && !CJK.test(text)) {
        const zh = translateCanvasText(text);
        if (zh != null) text = zh;
      }
      return orig.call(this, text, ...rest);
    };
  }
}

function startObserver() {
  const mo = new MutationObserver((records) => {
    for (const rec of records) {
      if (rec.type === "characterData") {
        const t = rec.target;
        if (!t || t.nodeType !== 3) continue;
        const tv = t.nodeValue || "";
        if (!CJK.test(tv) || FIX_RE.test(tv)) applyTextNode(t);
      } else if (rec.type === "attributes") {
        applyAttributes(rec.target);
      } else {
        for (const node of rec.addedNodes) {
          if (node.nodeType === 1) applyTree(node);
          else if (node.nodeType === 3) applyTextNode(node);
        }
      }
    }
  });
  mo.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ATTRS,
  });
}

app.registerExtension({
  name: "vnccs.zh.unicanvas",
  async setup() {
    if (window.__vnccsZhInstalled) return;
    window.__vnccsZhInstalled = true;
    await loadDicts();
    hookCanvasText();
    applyDocument();
    startObserver();
    loadPairings();
    startFetchGuard();
    setTimeout(applyDocument, 800);
    setTimeout(applyDocument, 2500);
    window.vnccsZhReport = reportMisses;
    window.vnccsZhDict = DICT;
    window.vnccsZhTranslate = translateText;
    window.vnccsZhPairings = PAIRINGS;
    window.vnccsZhToast = showZhToast;
    window.vnccsZhValidate = validateDrawSettings;
  // 重新审计用：清空已记录命中/漏翻
  window.vnccsZhClear = () => { misses.clear(); hits.clear(); return "cleared"; };
    if (localStorage.getItem("vnccs_zh_debug") === "1") {
      console.log("[UniCanvas 汉化] 调试模式：window.vnccsZhReport() 查看漏翻");
    }
  },
});
