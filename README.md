# dsh-sfversion

**StepFun 视觉桥(step-3.7-flash)** —— 给纯文本模型的 DeepSeek Harness 装上眼睛。

`#dsh-plugin`

图片先发给 StepFun 多模态模型转成文字,再把文字交给 DeepSeek 继续推理:自动生成 **图片描述 + UI 还原 HTML** 两段内容,在后台注入模型上下文——聊天记录里只显示图片本身,没有任何插件痕迹。

## 特性

- **原生体验**:输入框左侧 ↑ 按钮把图片作为**原生草稿附件**加入输入框,与输入内容作为**同一条消息**一次性发送,无确认步骤;
- **官方视觉翻译桥**:实现宿主 `visionTranslation` 服务——输入框直接**粘贴/拖入**的图片、`read_image` 工具读出的图片,在模型请求前自动替换为「描述 + UI 还原」两段干净文字,持久化历史保留原图;
- **UI 还原**:每张图都会同时生成可保存的完整 HTML/CSS 还原(内联样式、无外部资源、逐字保留可见文字);
- **模型工具**:`vision_glance`(描述/OCR)、`vision_restore_ui`(还原为 HTML 文件);
- **结果缓存**:按图片内容哈希缓存到工作区 `.dsh-sfversion-cache.json`,重复图片不重复调用模型;
- **稳健性**:503/429/超时/网络抖动自动重试;推理模型的思考过程绝不泄漏给 DeepSeek;大图(>5MB)浏览器内自动压缩。

## 思考链路

```
用户上传/粘贴图片
      │
      ▼
原生图片消息(聊天里显示图片)
      │
      ▼  模型请求前(宿主 visionTranslation)
StepFun step-3.7-flash 生成:描述 + UI 还原 HTML
      │
      ▼
两段纯文字注入 DeepSeek 上下文,继续推理/写代码
```

## 安装

1. 把本目录安装为 dsh profile 可解析的包(任选其一):

   ```bash
   # 方式 A:复制到 profile 的 node_modules
   cp -r dsh-sfversion "$DSH_HOME/profiles/web/node_modules/dsh-sfversion"

   # 方式 B(开发):符号链接
   ln -s /path/to/dsh-sfversion "$DSH_HOME/profiles/web/node_modules/dsh-sfversion"
   ```

2. 在 profile 的 `cordis.patch.yml` 里插入插件行(或启动加 `--patch`):

   ```yaml
   - insert:
       - id: dsh-sfversion
         name: 'dsh-sfversion'
   ```

3. 配置 API Key(一次性):

   ```bash
   dsh credentials set STEPFUN_API_KEY sk-你的StepFun密钥
   ```

4. 重启 `dsh web`。

## 使用

- **点 ↑ 选图** → 图片进入输入框 → 打字按发送 → 一条消息发出,DeepSeek 自动获得描述 + 还原;
- **直接粘贴/拖入**图片到输入框 → 同样自动翻译;
- 让 Agent 分析工作区图片:`vision_glance <路径>`;按图还原 UI:`vision_restore_ui <路径>` → 保存为 `restored-ui.html`;
- 设置 → **StepFun 视觉** 页面可查看配置与指引。

## 默认配置

| 项 | 值 |
|---|---|
| 视觉模型 | `step-3.7-flash` |
| 接口 | `https://api.stepfun.com/v1` |
| 推理强度 | `low` |
| 最大输出 tokens | 3000 |
| API Key | DSH Credential `STEPFUN_API_KEY` |

## 包结构

```
dsh-sfversion/
├── lib/
│   ├── index.js      # 宿主插件:visionTranslation 服务 + 工具 + 缓存(零构建,ESM)
│   └── client.js     # 浏览器插件 bundle:上传按钮/横条/设置页(手写 __ModuleLoader__ 格式)
├── cordis.patch.yml  # 部署补丁(insert 插件行)
└── package.json      # dsh.client 声明 + exports
```

## 要求

- DeepSeek Harness Web(或任何带 `visionTranslation` 消费方的组合);
- Node.js ≥ 18(宿主使用全局 fetch);
- 有效的 [StepFun 平台](https://platform.stepfun.com) API Key。

## License

MIT
