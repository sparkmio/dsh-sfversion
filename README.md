![SF视觉桥 —— 给纯文本模型的 DeepSeek Harness 装上眼睛](index.png)

# dsh-sfversion

**SF视觉桥** 为纯文本模型接入按需多模态能力：图片或文档先经过结构化解析，再把结果注入 DeepSeek Harness。普通图片不会默认生成 HTML，系统会根据用户问题自动选择描述/OCR、空间定位或 UI 还原；文档会把原文文字和内嵌图片分层处理，并保留页码、段落、幻灯片、Sheet、单元格和坐标锚点。

## 一键安装

把下面这段话发给你的Harness：
请直接帮我把这个插件安装到当前的 DeepSeek Harness 环境中：
https://github.com/sparkmio/dsh-sfversion  
请自行检查 Harness 的版本和目录结构，阅读插件说明，完成依赖安装、配置注册及必要的代码调整。不要只给出操作建议，请实际执行安装流程。完成后运行测试验证插件是否可用，并简要说明你做了哪些修改、如何使用，以及是否存在需要我手动处理的问题。

## 特性

- **图片与文档上传**：输入框左侧 ↑ 支持 png/jpeg/webp/gif 图片和 doc/docx/ppt/pptx/xls/xlsx/xmind/pdf/md/markdown 文档；图片走 DSH 原生附件；文档在输入区显示为带文件类型、文件名和删除按钮的文件卡片，不把 `[📎 文件名]`、URI、解析提示词或 Base64 写到可见正文；
- **原生图片体验**：输入框左侧 ↑ 按钮把图片作为原生草稿附件加入输入框，与文字一起发送；直接粘贴/拖入图片也支持；
- **按意图识别**：普通问题使用描述/OCR；出现“哪里、位置、左上、附近、坐标”等空间问题时使用独立定位链路；明确要求网页、HTML、UI 复刻时才生成 HTML；
- **空间定位**：`vision_ground` 返回目标 `bbox`、中心点、0～1000 归一化坐标、九宫格区域、OCR 文字和相对关系，适合复杂图片中的“某元素大概在哪里”；
- **UI 还原**：`vision_restore_ui` 输出内联 CSS、无外部资源的完整 HTML；要求从 `<!DOCTYPE html>` 开始并以 `</html>` 结束，不完整结果不会写入缓存；
- **模型工具**：`vision_glance`（描述/OCR）、`vision_ground`（空间定位）、`vision_restore_ui`（HTML 还原）、`document_inspect`（文档结构化解析）；
- **可靠缓存**：按图片内容、识别模式、模型、问题、接口地址和缓存版本隔离，避免更换模型/API 后复用旧结果；
- **文档空间上下文**：原文文字、图片 OCR、彩色图片描述分别放入明确区块；PPTX 使用形状坐标，XLSX 使用单元格/图片范围，PDF 使用页码和文字坐标，DOCX/Markdown 在无法得到真实像素坐标时明确标注精度，不伪造位置；
- **文档图片分流**：文字型图片优先 OCR；彩色/混合图片输出详细描述并保留 OCR；图片 OCR 明确标注为图片内容，不会覆盖正文；
- **稳健性**：处理 429/5xx/网络抖动自动重试；识别 `finish_reason=length`，拒绝缓存被截断的结果；大图在浏览器端自动压缩。

## 文档支持格式

点击输入框左侧 **↑** 后可选择以下格式：

| 格式 | 原文文字 | 内嵌图片 | 位置精度 |
|---|---|---|---|
| `.doc` | 正文、页眉页脚、脚注/批注（若解析器提供） | 旧版二进制 DOC 暂不保证可靠提取 | 仅文档顺序，不伪造页码/坐标 |
| `.docx` | 段落、表格单元格 | `word/media` 图片（包括表格单元格内图片） | 段落/表格锚点；DOCX XML 本身不保证真实分页 |
| `.pptx` | 文本框、形状文字 | 幻灯片图片 | 幻灯片 + 0～1000 归一化形状坐标 |
| `.xls` | Sheet、单元格、公式 | 旧版 XLS 内嵌图片不保证可靠提取 | Sheet + 单元格 |
| `.xlsx` | Sheet、单元格、共享字符串 | drawing 图片 | Sheet + 单元格/图片覆盖范围 |
| `.pdf` | PDF.js 文字层（含页码和文字 bbox） | 可提取的嵌入式栅格图片会转为 PNG；无文字层的扫描页由内置渲染器转为 PNG | 页码/文字/嵌入图片 bbox；扫描页会保留“无文字层”提示 |
| `.xmind` | `content.json` / `content.xml` 主题、备注 | 过滤 `attachments/`、缩略图等资源，避免误当正文 | 主题树路径，例如“中心主题 > 分支” |
| `.md` / `.markdown` | Markdown 原文、标题、列表、代码块 | `data:image/...` 图片；相对路径图片当前保留引用 | 行号/文档顺序 |

旧版 `.doc/.ppt/.xls` 的定位精度低于 OOXML；XMind 的“位置”是主题树路径而不是像素坐标。旧版二进制 Office 的内嵌图片提取能力有限，若必须识别其中图片，建议另存为 `.docx/.pptx/.xlsx` 或 PDF。

处理时不会把文档简单拼成一段无序文本，而是生成四层上下文：

1. **原文文本层**：可提取的正文直接交给 DeepSeek，不先让视觉模型重新识别；
2. **图片内容层**：每张图片有唯一 ID，文字型图片保留 OCR，彩色/混合图片由视觉模型生成详细描述并保留 OCR；
3. **位置层**：每个文字块和图片都带页码、段落、幻灯片、Sheet、单元格、图片范围或 bbox；
4. **位置约束**：明确告诉 DeepSeek 图片 OCR 不是正文，禁止跨页/跨图片/跨 Sheet 混合内容。

### 文档卡片与官方附件能力

文档上传完成后，输入区会显示一个带**文件类型图标、文件名、扩展名和删除按钮**的文件卡片；它是本插件的 UI，不是将 `[📎 文件名]` 当作普通文本显示。点击删除会同时移除该文档，发送后卡片会清空。

截至 **2026 年 8 月 16 日**，DeepSeek Harness 官方 `master`（`47f943859bef60e4160492346772ded9b24f765a`）的公开附件协议只定义 PNG/JPEG/WebP/GIF 图片，浏览器附件 UI 的已知限制也明确说明非图片文件尚无输入框文件卡片与历史渲染；其 prompt wire 目前只有 `text` 和 `image`，没有通用 `{ type: 'file' }` 或 `{ type: 'document' }`。所以这里不能假装调用不存在的“原生文档附件 API”。

本插件的后备链路是：文档字节经 Connection RPC 临时保存在宿主内存，输入草稿仅携带不可见的关联标记，`llm/stream` 在模型请求边界把它替换为已解析的文档上下文。用户可见的聊天正文不会出现 `[📎 文件名]`、`sfv-document://...`、`[[SFV_DOCUMENT_V1 ...]]`、Base64 或内部解析提示词；旧版客户端/历史中的可见引用仍可被兼容解析。由于 Harness 尚没有通用的可持久化文件协议，发送后的历史消息也不会由官方历史渲染器显示“原生文件卡片”。

单个文档限制为 **25MB**，最多分析 32 张内嵌图片，过长上下文会明确截断并提示分段上传。PDF.js 会提取文字层和可访问的嵌入式栅格图片；图片会单独送入图片识别链路。整页扫描 PDF 没有文字层且没有可分离的图片对象时，插件会自动用内置页面渲染器把页面转成 PNG，再交给已配置的视觉模型做 OCR/内容识别，不需要用户手动部署 OCR 服务或提供工作区文件路径。普通 PDF 文字层不需要视觉模型。

### 发布

项目使用 GitHub Actions 自动发布。将版本写入 `package.json` 后提交并推送，再创建并推送对应的 `vX.Y.Z` tag（例如 `v1.2.1`），发布管线会校验版本、运行测试、由 `scripts/release-notes.mjs` 按 Conventional Commits 生成更新日志，并创建 GitHub Release。无需手动编写 changelog；本地可用 `npm run release:notes -- --from <旧 tag> --to HEAD` 预览日志。

## 引用与参考项目

本项目的代码、文档解析和发布脚本均维护在当前仓库中；下面区分**直接使用的依赖/平台接口**与**设计参考**，避免把参考项目误认为运行时必需项。

### 直接使用的依赖与平台接口

- **DeepSeek Harness / Cordis**：插件宿主、生命周期、设置、工具注册、`llm/stream` 模型请求边界以及客户端会话输入 facade。
- **`@deepseek-ai/dsh-client-connection`**：浏览器与宿主之间的 Connection RPC；文档通过这条受控通道注册到宿主短期内存。
- **`@deepseek-ai/dsh-attachment` / `@deepseek-ai/dsh-client-ui-attachment`**：图片附件的 DSH 原生附件协议；本插件只将图片接入这条原生链路。
- **`pdfjs-dist`**：PDF 文字层、页码、文字 bbox 和页面渲染后备链路。
- **`xlsx`**：XLS/XLSX 工作簿、Sheet、单元格及图片关系解析。
- **`fflate`**：DOCX/PPTX/XLSX/XMind 等 ZIP/XML 容器解包。
- **`word-extractor`、`cfb`**：旧版二进制 DOC/XLS 等格式的兼容解析。
- **`@napi-rs/canvas`**：PDF 扫描页的 PNG 页面渲染后备。
- **StepFun / OpenAI Chat Completions 兼容接口**：视觉识别请求的外部模型接口，不是本项目内置的模型。

### 设计参考

- **`dsh-vision-toolkit`**：参考其在 DeepSeek Harness 中组织视觉能力、工具入口和模型适配的思路；本项目针对文档结构化解析、PDF 页面渲染和引用安全链路独立实现。
- **DeepSeek Harness 自带的图片输入实现**：参考其原生图片草稿附件的交互与可访问性；非图片文档没有伪造 `{type: 'file'}`，而是由本插件绘制文件卡片，并使用宿主内存 + 模型边界展开。

参考项目仅用于架构和交互设计，不会在安装时额外拉取；运行所需版本以 `package.json` 和当前 DSH 环境为准。

### 出现“当前 DSH 输入引用接口不可用”怎么办

这个提示通常不是文档格式或文件内容错误，而是旧版本实现只从上传按钮的 `props.inputActions` 读取输入操作。上传按钮位于 `conversation.input.left/dock` 槽位时，DSH 不保证把 composer 组件树里的 props 自动注入进来，于是旧实现会误判为“接口不可用”。

当前版本通过 DSH 公开的会话输入 facade（`conversation.input.for(sessionCtx)`）写入输入草稿，并由插件文件卡片反映该文档；文档原始字节不会写入输入框。升级插件后请**完全重启 DSH Web**，避免浏览器继续使用旧的 `lib/client.js` 缓存。如果升级后仍提示该错误，说明当前 DSH 版本没有公开会话输入 facade，需要升级 DSH，而不是重复上传文件。

## 为什么不再为每张图片生成 HTML

完整 HTML 往往比描述或定位结果长很多，容易触发视觉模型输出上限，并且会把大量无关内容塞进 DeepSeek 上下文。现在普通图片只做必要的识别：

- “这张图有什么/文字是什么？” → 描述/OCR；
- “红色按钮在哪里/位于哪个区域？” → 空间定位；
- “按这张图还原网页/生成 HTML” → 描述 + UI 还原。

因此可以降低截断概率、减少 token 消耗，也避免把半截 HTML 写入缓存。

## 自定义接口与其他多模态模型

设置页可以自行修改 **接口地址** 和 **视觉模型**。插件会把填写的地址规范化为：

- 填 `https://example.com/v1` → 请求 `https://example.com/v1/chat/completions`；
- 填完整的 `.../chat/completions` → 不会重复拼接。

仅修改地址即可适配满足以下条件的服务，不能保证任意多模态 API 都能直接使用。自定义接口需要：

1. 使用 `POST {baseUrl}/chat/completions`；
2. 接受 OpenAI Chat Completions 风格的 `model`、`messages`、`max_tokens`；
3. 支持 `messages[].content` 中的 `image_url.url`，并能接收图片 `data:image/...;base64,...`；
4. 使用 `Authorization: Bearer <API Key>` 鉴权；
5. 返回 `choices[0].message.content`，内容是字符串或常见的文本数组；
6. 接口允许发送 `reasoning_effort` 时才建议在兼容服务上使用；不支持该字段的服务可能需要在服务端忽略它或后续增加 adapter。

如果目标服务使用不同的路径、鉴权方式、图片字段、请求字段或响应结构，仅改接口地址不够，需要为它增加 adapter。切换接口地址后缓存会自动隔离。

## 思考链路

```
用户上传/粘贴图片或文档
      │
      ▼
原生图片消息 / 插件文件卡片（不可见关联标记）
      │
      ▼  模型请求前的 llm/stream 文档展开（图片仍走 visionTranslation）
按问题选择：describe / ground / restore_ui；文档走 text-layer + document-image 分层
      │
      ▼
描述、空间 JSON 或完整 HTML 注入 DeepSeek 上下文
```

`llm/stream` 监听器遵循 Harness waterfall 契约，必须同步返回 `AsyncIterable`；文档解析延迟到该流开始迭代后异步执行，避免把 `Promise` 返回给下游的 `yield* next()` 链路。

## 安装

1. 把本目录安装为 dsh profile 可解析的包（任选其一）：

   ```bash
   cp -r dsh-sfversion "$DSH_HOME/profiles/node_modules/dsh-sfversion"
   # 或开发时使用符号链接/junction
   ```

2. 在 profile 的 `cordis.patch.yml` 中插入插件：

   ```yaml
   - insert:
       - id: dsh-sfversion
         name: 'dsh-sfversion'
   ```

3. 配置 API Key（任选其一）：

   - 打开 Web 界面 → **设置 → StepFun 视觉**，填写 API Key、接口地址和模型；或
   - 使用 DSH Credential：

   ```bash
   dsh credentials set STEPFUN_API_KEY sk-你的密钥
   ```

4. 重启 `dsh web`。

## 使用

- 点 ↑ 选图，输入问题后发送；系统会根据问题自动选择识别模式；
- 直接粘贴/拖入图片，同样会在请求前翻译；
- 让 Agent 分析工作区图片：`vision_glance <路径>`；
- 让 Agent 分析工作区文档：`document_inspect <路径>`；支持 `doc/docx/ppt/pptx/xls/xlsx/xmind/pdf/md/markdown`；
- 询问图片元素位置：`vision_ground <路径>`，例如“红色按钮位于哪里？”；
- 按图还原 UI：`vision_restore_ui <路径>`，成功后可让 DeepSeek 用 write 工具保存为 `restored-ui.html`；
- 设置页中的 API Key 是只写字段，保存后不会回显。

## 默认配置

| 项 | 值 |
|---|---|
| 视觉模型 | `step-3.7-flash` |
| 接口 | `https://api.stepfun.com/v1` |
| 描述输出上限 | 1800 tokens |
| 空间定位输出上限 | 1400 tokens |
| UI 还原输出上限 | 8000 tokens |
| 推理强度 | `low`（兼容接口不支持时应忽略该字段） |
| API Key | 设置页优先，或 DSH Credential `STEPFUN_API_KEY` |

## 包结构

```
dsh-sfversion/
├── lib/
│   ├── index.js      # 宿主插件：visionTranslation、视觉工具、缓存
│   ├── client.js     # 浏览器插件 bundle：上传按钮、状态条、设置页
│   └── document.js   # DOC/DOCX/PPT/PPTX/XLS/XLSX/XMind/PDF/Markdown 解析与位置锚点
├── cordis.patch.yml
└── package.json
```

## 要求

- DeepSeek Harness Web（或会消费 `visionTranslation` 的组合）；
- Node.js ≥ 18（宿主使用全局 fetch）；
- 运行时依赖 `fflate`（Office ZIP/XML 解包）和 `pdfjs-dist`（PDF 文字层解析）；
- 有效的 StepFun 或兼容 OpenAI Chat Completions 的多模态 API Key。

## License

MIT
