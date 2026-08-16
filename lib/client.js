/**
 * dsh-sfversion 浏览器端 bundle(手写 __ModuleLoader__ 格式,无需构建链)
 *
 * 功能:
 * - 输入框左侧 ↑ 上传按钮:图片压缩后作为原生草稿附件进入输入框,
 *   与输入内容同一条消息一次性发出(无确认步骤);
 * - 识别(描述 / 空间定位 / UI 还原)由宿主 visionTranslation 服务按问题意图自动选择,
 *   聊天里只显示图片,DeepSeek 后台获得分析;
 * - 设置页:配置指引。
 */

window.__ModuleLoader__.load({
  id: 'dsh-sfversion',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    const React = require('react')

    const CSS = [
      '.sfv-upload{display:inline-flex;align-items:center;gap:5px;cursor:pointer;user-select:none;position:relative;}',
      '.sfv-btn{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;font-size:13px;line-height:1;border-radius:6px;color:var(--ds-color-text-secondary,#667);}',
      '.sfv-upload:hover .sfv-btn{background:var(--ds-color-surface-hover,rgba(127,127,127,.16));color:var(--ds-color-text-primary,#222);}',
      '.sfv-upload:active .sfv-btn{transform:scale(.92);}',
      '.sfv-bar{box-sizing:border-box;display:flex;align-items:center;gap:8px;padding:4px 10px;border:1px solid var(--ds-color-border,rgba(127,127,127,.28));border-radius:12px;background:var(--ds-color-surface,#fff);font-size:12px;color:var(--ds-color-text-secondary,#667);min-height:24px;margin:0 auto 4px;width:calc(100% - var(--dsh-composer-side-clearance) - var(--dsh-composer-side-clearance) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset));max-width:calc(var(--dsh-composer-card-max-width) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset));}',
      '.sfv-bar-thumb{width:22px;height:22px;object-fit:cover;border-radius:5px;border:1px solid var(--ds-color-border,rgba(127,127,127,.28));display:block;background:#fff;flex:none;}',
      '.sfv-bar-label{flex:none;}',
      '.sfv-bar-label.ok{color:#2ea043;font-weight:600;}',
      '.sfv-bar-err-text{color:#f85149;font-size:11.5px;line-height:1.5;word-break:break-all;max-width:420px;}',
      '.sfv-spacer{flex:1;}',
      '.sfv-tool{font-size:12px;padding:1px 8px;border:1px solid var(--ds-color-border,rgba(127,127,127,.3));border-radius:7px;background:transparent;color:var(--ds-color-text-secondary,#555);cursor:pointer;line-height:1.5;flex:none;}',
      '.sfv-tool:hover{background:var(--ds-color-surface-hover,rgba(127,127,127,.1));color:var(--ds-color-text-primary,#222);}',
      '.sfv-settings{display:flex;flex-direction:column;gap:10px;max-width:640px;}',
      '.sfv-desc{margin:0;font-size:12px;line-height:1.7;color:var(--ds-color-text-secondary,#667);}',
      '.sfv-row{display:flex;align-items:center;gap:12px;}',
      '.sfv-label{flex:0 0 130px;font-size:13px;color:var(--ds-color-text-primary,#222);}',
      '.sfv-value{flex:1;font-size:13px;color:var(--ds-color-text-primary,#222);}',
      '.sfv-code{max-height:220px;overflow:auto;font-size:11.5px;line-height:1.6;font-family:ui-monospace,Consolas,monospace;white-space:pre-wrap;word-break:break-all;border:1px solid var(--ds-color-border,rgba(127,127,127,.24));border-radius:8px;padding:10px;background:#f6f7f9;color:#24292f;margin:0;}',
      '.sfv-input{box-sizing:border-box;width:100%;font-size:13px;line-height:1.5;color:var(--ds-color-text-primary,#222);background:var(--ds-color-surface,#fff);border:1px solid var(--ds-color-border,rgba(127,127,127,.3));border-radius:7px;padding:5px 9px;outline:none;}',
      '.sfv-input:focus{border-color:var(--ds-color-accent,#3b82f6);}',
      '.sfv-button{font-size:13px;line-height:1.5;padding:5px 18px;border:1px solid var(--ds-color-border,rgba(127,127,127,.3));border-radius:7px;background:var(--ds-color-surface,#fff);color:var(--ds-color-text-primary,#222);cursor:pointer;}',
      '.sfv-button:hover{background:var(--ds-color-surface-hover,rgba(127,127,127,.1));}',
      '.sfv-desc.ok{color:#2ea043;}',
      '.sfv-desc.error{color:#f85149;}',
      '.sfv-spinner{display:inline-block;width:14px;height:14px;box-sizing:border-box;border:2px solid var(--ds-color-text-secondary,#667);border-top-color:transparent;border-radius:50%;animation:sfv-spin .7s linear infinite;flex:none;}',
      '.sfv-spinner.small{width:12px;height:12px;border-width:2px;}',
      '.sfv-spinner.dark{border-color:var(--ds-color-text-secondary,#667);border-top-color:transparent;}',
      '@keyframes sfv-spin{to{transform:rotate(360deg);}}',
    ].join('')

    ;(function ensureCss() {
      const tagId = 'dsh-sfversion/client.css'
      if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="' + tagId + '"]') === null) {
        const tag = document.createElement('style')
        tag.dataset.plugin = 'dsh-sfversion'
        tag.dataset.pluginCss = tagId
        tag.textContent = CSS
        document.head.appendChild(tag)
      }
    })()

    const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

    function bytesToBase64(bytes) {
      let out = ''
      const len = bytes.length
      for (let i = 0; i < len; i += 3) {
        const b0 = bytes[i]
        const b1 = i + 1 < len ? bytes[i + 1] : undefined
        const b2 = i + 2 < len ? bytes[i + 2] : undefined
        out += B64[b0 >> 2]
        out += B64[((b0 & 3) << 4) | (b1 === undefined ? 0 : b1 >> 4)]
        out += b1 === undefined ? '=' : B64[((b1 & 15) << 2) | (b2 === undefined ? 0 : b2 >> 6)]
        out += b2 === undefined ? '=' : B64[b2 & 63]
      }
      return out
    }

    /** 大图压缩:宿主附件单图上限 5MB、像素上限 4000 万,超限压到安全范围。 */
    async function compressToFit(dataUrl, mime, targetBytes) {
      const headLen = ('data:' + mime + ';base64,').length
      const approx = Math.floor((dataUrl.length - headLen) * 3 / 4)
      if (approx <= targetBytes) return { dataUrl, mime }
      let img = null
      try { img = new Image() } catch { /* 忽略 */ }
      if (img === null || img === undefined) return { dataUrl, mime }
      await new Promise((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('图片解码失败,无法压缩'))
        img.src = dataUrl
      })
      let w = img.naturalWidth || img.width || 1024
      let h = img.naturalHeight || img.height || 1024
      const MAX_SIDE = 2560
      if (w > MAX_SIDE || h > MAX_SIDE) {
        const s = Math.min(MAX_SIDE / w, MAX_SIDE / h)
        w = Math.max(1, Math.round(w * s))
        h = Math.max(1, Math.round(h * s))
      }
      let quality = 0.85
      let last = null
      for (let i = 0; i < 6; i++) {
        const forced = i === 5
        const maxSide = forced ? 1600 : Math.max(w, h)
        const scale = Math.min(1, maxSide / w, maxSide / h)
        const cw = Math.max(1, Math.round(w * scale))
        const ch = Math.max(1, Math.round(h * scale))
        const cq = forced ? 0.45 : quality
        const canvas = document.createElement('canvas')
        canvas.width = cw
        canvas.height = ch
        const g = canvas.getContext('2d')
        if (g === null || g === undefined) throw new Error('canvas 2d 上下文不可用')
        g.drawImage(img, 0, 0, cw, ch)
        const out = canvas.toDataURL('image/jpeg', cq)
        last = out
        const b64len = out.length - 'data:image/jpeg;base64,'.length
        if (Math.floor(b64len * 3 / 4) <= targetBytes) break
        w = Math.max(1, Math.round(w * 0.8))
        h = Math.max(1, Math.round(h * 0.8))
        quality = Math.max(0.45, quality - 0.1)
      }
      if (last === null || last === undefined) return { dataUrl, mime }
      return { dataUrl: last, mime: 'image/jpeg' }
    }

    function documentMime(file) {
      const name = typeof file?.name === 'string' ? file.name.toLowerCase() : ''
      if (/\.doc$/.test(name)) return 'application/msword'
      if (/\.docx$/.test(name)) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      if (/\.ppt$/.test(name)) return 'application/vnd.ms-powerpoint'
      if (/\.pptx$/.test(name)) return 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      if (/\.xls$/.test(name)) return 'application/vnd.ms-excel'
      if (/\.xlsx$/.test(name)) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      if (/\.xmind$/.test(name)) return 'application/x-xmind'
      if (/\.pdf$/.test(name)) return 'application/pdf'
      if (/\.(?:md|markdown)$/.test(name)) return 'text/markdown'
      return ''
    }
    function dataUrlToFile(dataUrl, mime, name) {
      const comma = dataUrl.indexOf(',')
      const b64 = dataUrl.slice(comma + 1)
      const bin = atob(b64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      return new File([bytes], name, { type: mime })
    }

    // 插件 ctx(apply 时注入,组件/回调内使用)
    let pluginCtx = null
    let pluginSettings = null

    // 每个会话独立的状态(会话隔离)
    const stores = new Map()
    // 文档原始字节只存在客户端内存；发送时通过 Connection RPC 注册到宿主，draft/会话历史只保留短文件引用。
    const documentRefs = new Map()
    let documentRefBytes = 0
    const DOCUMENT_REF_TTL_MS = 30 * 60 * 1000
    const DOCUMENT_REF_MAX_ENTRIES = 64
    const DOCUMENT_REF_MAX_BYTES = 128 * 1024 * 1024
    const DOCUMENT_SOURCE = 'sfv-document'

    function deleteDocumentRef(ref) {
      const item = documentRefs.get(ref)
      if (item !== undefined) documentRefBytes = Math.max(0, documentRefBytes - (item.bytes?.byteLength || 0))
      documentRefs.delete(ref)
    }

    function pruneDocumentRefs(now = Date.now()) {
      for (const [ref, item] of documentRefs) {
        if (now - (item.lastUsedAt || item.createdAt || now) > DOCUMENT_REF_TTL_MS) deleteDocumentRef(ref)
      }
      while (documentRefs.size > DOCUMENT_REF_MAX_ENTRIES || documentRefBytes > DOCUMENT_REF_MAX_BYTES) {
        const oldest = documentRefs.keys().next().value
        if (oldest === undefined) break
        deleteDocumentRef(oldest)
      }
    }

    function storeDocumentRef(ref, item) {
      pruneDocumentRefs()
      deleteDocumentRef(ref)
      const now = Date.now()
      documentRefs.set(ref, { ...item, createdAt: now, lastUsedAt: now })
      documentRefBytes += item.bytes?.byteLength || 0
      pruneDocumentRefs(now)
    }

    function sessionIdOf(props) {
      if (props !== undefined && props !== null && props.session !== undefined && props.session !== null
        && typeof props.session.sessionId === 'string' && props.session.sessionId !== '') return props.session.sessionId
      if (props !== undefined && props !== null && typeof props.sessionId === 'string' && props.sessionId !== '') return props.sessionId
      return 'unknown'
    }

    // Slot 注入的组件不一定属于 conversation composer 的组件树，因此不能只依赖
    // props.inputActions。通过公开的 conversation.input resolver 获取当前会话 facade，
    // 既兼容 input.left/input.dock，也避免访问 DSH 私有实现。
    function sessionInputFor(sessionId) {
      const sessions = pluginCtx !== null ? pluginCtx.get('sessions') : undefined
      if (sessions === undefined || sessions === null || typeof sessions.binding !== 'function') return null
      let binding
      try { binding = sessions.binding(sessionId) } catch { return null }
      const sessionCtx = binding?.ctx
      if (sessionCtx === undefined || sessionCtx === null || typeof sessionCtx.get !== 'function') return null
      let conversation
      try { conversation = sessionCtx.get('conversation') } catch { return null }
      const resolver = conversation?.input
      if (resolver === undefined || resolver === null || typeof resolver.for !== 'function') return null
      try { return { ctx: sessionCtx, input: resolver.for(sessionCtx) } } catch { return null }
    }

    function inputStateSnapshot(input) {
      const state = input?.state
      if (state === undefined || state === null) return null
      try {
        const snapshot = state.getSnapshot?.() || state.get?.()
        return snapshot === undefined || snapshot === null ? null : snapshot
      } catch { return null }
    }

    function storeFor(sessionId) {
      const key = typeof sessionId === 'string' && sessionId !== '' ? sessionId : 'unknown'
      let st = stores.get(key)
      if (st === undefined) {
        st = {
          sessionId: key,
          status: 'idle', // idle | working | done | error
          error: '',
          fileName: '',
          thumb: '',
          listeners: new Set(),
          update(patch) {
            const keys = Object.keys(patch)
            for (let i = 0; i < keys.length; i++) this[keys[i]] = patch[keys[i]]
            const list = [...this.listeners]
            for (const fn of list) {
              try { fn() } catch { /* 忽略 */ }
            }
          },
          subscribe(fn) {
            this.listeners.add(fn)
            return () => { this.listeners.delete(fn) }
          },
          clear() {
            this.update({ status: 'idle', error: '', fileName: '', thumb: '' })
          },
        }
        stores.set(key, st)
      }
      return st
    }

    function useStore(props) {
      const st = storeFor(sessionIdOf(props))
      const [, setTick] = React.useState(0)
      React.useEffect(() => st.subscribe(() => setTick((t) => t + 1)), [st])
      return st
    }

    function UploadButton(props) {
      const st = useStore(props)
      const [busy, setBusy] = React.useState(false)

      const onPick = async (evt) => {
        const target = evt && evt.target
        const file = target && target.files ? target.files[0] : null
        if (target) target.value = ''
        if (file === null || file === undefined) return
        const rawMime = typeof file.type === 'string' ? file.type.toLowerCase() : ''
        const docMime = documentMime(file)
        const isImage = /^image\/(png|jpeg|jpg|webp|gif)$/.test(rawMime)
        if (!isImage && !docMime) {
          st.update({ status: 'error', error: '仅支持 png/jpeg/webp/gif 图片或 doc/docx/ppt/pptx/xls/xlsx/xmind/pdf/md/markdown 文档' })
          return
        }
        const maxBytes = isImage ? 60 * 1024 * 1024 : 25 * 1024 * 1024
        if (typeof file.size === 'number' && file.size > maxBytes) {
          st.update({ status: 'error', error: `${isImage ? '图片' : '文档'}超过 ${isImage ? 60 : 25}MB,无法处理` })
          return
        }
        const name = typeof file.name === 'string' && file.name !== '' ? file.name : (isImage ? 'image' : 'document')
        setBusy(true)
        st.update({ status: 'working', error: '', fileName: name })
        try {
          const buffer = await file.arrayBuffer()
          const bytes = new Uint8Array(buffer)
          if (!isImage) {
            const resolved = sessionInputFor(st.sessionId)
            const sessionInput = resolved?.input
            const inputActions = props !== undefined && props !== null ? props.inputActions : undefined
            const inputState = sessionInput?.state || inputActions?.state
            const snapshot = inputStateSnapshot({ state: inputState })
            if (snapshot === null || typeof snapshot.draft !== 'string' || typeof snapshot.draftRev !== 'number') {
              throw new Error('当前 DSH 输入引用接口不可用，请升级 DSH 后重试')
            }
            const ref = `${st.sessionId}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`
            storeDocumentRef(ref, { name, mime: docMime, bytes })
            const reference = { source: DOCUMENT_SOURCE, ref, label: name, clipboardText: `[文档:${name}]` }
            const at = snapshot.draft.length
            let accepted = false
            if (sessionInput !== undefined && sessionInput !== null && typeof sessionInput.insertReference === 'function') {
              accepted = sessionInput.insertReference(reference, {
                start: at, end: at, draftRev: snapshot.draftRev,
              })
            } else if (resolved?.ctx !== undefined && typeof resolved.ctx.bail === 'function') {
              // 旧版输入引用事件仍可用时保留兼容路径；不再写入 Base64 或长文本。
              accepted = resolved.ctx.bail(resolved.ctx, 'slash/input-insert-reference', {
                reference,
                span: { start: at, end: at, draftRev: snapshot.draftRev },
              })
            }
            if (accepted === undefined || accepted === false) {
              deleteDocumentRef(ref)
              throw new Error('文档引用未能加入输入框，请确认 DSH 输入引用插件已启用')
            }
            st.update({ status: 'done', fileName: name, thumb: '' })
            return
          }
          let mime = rawMime === 'image/jpg' ? 'image/jpeg' : rawMime
          let dataUrl = 'data:' + mime + ';base64,' + bytesToBase64(bytes)
          let sendFile = file
          try {
            const fit = await compressToFit(dataUrl, mime, 4 * 1024 * 1024)
            dataUrl = fit.dataUrl
            mime = fit.mime
            if (dataUrl.indexOf('data:image/jpeg;base64,') === 0) {
              sendFile = dataUrlToFile(dataUrl, 'image/jpeg', name)
            }
          } catch { /* 压缩失败用原文件 */ }

          // 原生草稿附件:图片与文字同一条消息发出,无确认步骤
          const resolved = sessionInputFor(st.sessionId)
          const sessionInput = resolved?.input
          let conversation
          if (resolved?.ctx !== undefined && resolved.ctx !== null && typeof resolved.ctx.get === 'function') {
            conversation = resolved.ctx.get('conversation')
          }
          const inputActions = props !== undefined && props !== null ? props.inputActions : undefined
          if ((sessionInput === undefined || sessionInput === null || typeof sessionInput.addImages !== 'function')
            && (inputActions === undefined || inputActions === null || typeof inputActions.addImages !== 'function')) {
            throw new Error('无法把图片加入输入框(原生附件接口不可用)')
          }
          if (sessionInput !== undefined && sessionInput !== null && typeof sessionInput.addImages === 'function') {
            if (conversation === undefined || conversation === null || typeof conversation.createDraftImages !== 'function') {
              throw new Error('无法把图片加入输入框(原生草稿附件接口不可用)')
            }
            const attachments = conversation.createDraftImages([sendFile])
            const attachmentIds = Array.isArray(attachments) ? attachments.map((a) => a.id).filter(Boolean) : []
            if (!attachmentIds.length) throw new Error('无法创建图片草稿附件')
            try {
              const accepted = sessionInput.addImages(attachmentIds)
              if (accepted === false) throw new Error('当前输入框正在提交,图片未能加入')
            } catch (error) {
              try { conversation.releaseDraftImages?.(attachmentIds) } catch { /* 清理失败不覆盖原错误 */ }
              throw error
            }
          } else {
            const result = inputActions.addImages([sendFile])
            if (result === false) throw new Error('当前输入框正在提交,图片未能加入')
            if (typeof result === 'string' && result.trim() !== '') throw new Error(result)
          }
          st.update({ status: 'done', fileName: name, thumb: dataUrl })
        } catch (error) {
          st.update({ status: 'error', error: String(error && error.message ? error.message : error) })
        } finally {
          setBusy(false)
        }
      }

      const arrow = React.createElement('svg', { viewBox: '0 0 24 24', width: '15', height: '15', fill: 'none', stroke: 'currentColor', strokeWidth: '2.2', strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
        React.createElement('path', { d: 'M12 19V5' }),
        React.createElement('path', { d: 'M5 12l7-7 7 7' }))

      // 处理中:把箭头换成真正的转圈,避免用户把 ↑ 箭头误当成"加载动画"
      const icon = busy
        ? React.createElement('span', { className: 'sfv-spinner dark', 'aria-hidden': 'true' })
        : arrow

      return React.createElement('div', { className: 'sfv-upload', title: '上传图片或文档:发送后自动分离文字、图片和位置上下文' },
        React.createElement('label', null,
          React.createElement('input', {
            type: 'file',
            accept: 'image/png,image/jpeg,image/webp,image/gif,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.xmind,.pdf,.md,.markdown',
            style: { position: 'absolute', width: '1px', height: '1px', opacity: '0', overflow: 'hidden' },
            onChange: onPick,
            disabled: busy,
          }),
          React.createElement('span', { className: 'sfv-btn' }, icon)))
    }

    /** 最近一条用户消息里是否含图片(用于判断当前回合是否需要识别)。 */
    function lastUserHasImage(session) {
      if (session === undefined || session === null || !Array.isArray(session.nodes)) return false
      for (let i = session.nodes.length - 1; i >= 0; i--) {
        const node = session.nodes[i]
        if (node === undefined || node === null || node.kind !== 'user') continue
        const content = node.content
        if (!Array.isArray(content)) return false
        for (let j = 0; j < content.length; j++) {
          const b = content[j]
          if (b !== undefined && b !== null && b.type === 'image') return true
        }
        return false
      }
      return false
    }

    function StatusBar(props) {
      const st = useStore(props)
      const session = props !== undefined && props !== null ? props.session : undefined
      const running = session !== undefined && session !== null && session.running === true
      // 识别阶段:模型请求在跑,且最近一条用户消息带图片 → StepFun 正在后台识别
      const recognizing = running && lastUserHasImage(session)
      const doneFlag = st.status === 'done' && !recognizing

      // 提示条:加入成功后 3 秒自动消失(一次性)
      React.useEffect(() => {
        if (!doneFlag) return
        const timer = pluginCtx !== null ? pluginCtx.get('timer') : undefined
        if (timer === undefined) return
        const t = timer.timeout(3000)
        t.then(() => { st.clear() })
        return () => {}
      }, [doneFlag, st])

      let kind = null
      let label = ''
      let errText = ''
      if (st.status === 'working') {
        kind = 'working'
        label = '正在处理图片…'
      } else if (st.status === 'error') {
        kind = 'error'
        label = '处理失败'
        errText = st.error
      } else if (recognizing) {
        kind = 'working'
        label = '正在识别图片…(按问题选择描述、空间定位或 UI 还原)'
      } else if (st.status === 'done') {
        kind = 'done'
        label = '图片已加入输入框 ✓ 发送后自动识别'
      }
      if (kind === null) return null

      const spinner = kind === 'working'
        ? React.createElement('span', { className: 'sfv-spinner small', 'aria-hidden': 'true' })
        : null

      return React.createElement('div', { className: 'sfv-bar', title: errText !== '' ? errText : undefined },
        st.thumb !== '' ? React.createElement('img', { src: st.thumb, className: 'sfv-bar-thumb', alt: st.fileName || '已选择的图片' }) : null,
        spinner,
        React.createElement('span', { className: 'sfv-bar-label' + (kind === 'done' ? ' ok' : '') }, label),
        errText !== '' ? React.createElement('span', { className: 'sfv-bar-err-text' }, errText) : null,
        React.createElement('span', { className: 'sfv-spacer' }),
        React.createElement('button', { className: 'sfv-tool', onClick: () => st.clear(), title: '关闭' }, '✕'))
    }

    function SettingsPage() {
      const [apiKey, setApiKey] = React.useState('')
      const [model, setModel] = React.useState('step-3.7-flash')
      const [baseUrl, setBaseUrl] = React.useState('https://api.stepfun.com/v1')
      const [message, setMessage] = React.useState('')
      const [messageKind, setMessageKind] = React.useState('info')

      React.useEffect(() => {
        if (pluginSettings === null) return
        let mounted = true
        const refresh = () => {
          const snap = pluginSettings.getSnapshot()
          const value = snap !== undefined && snap !== null ? snap.value : undefined
          if (!mounted || value === undefined || value === null) return
          // 安全设计:apiKey 声明为 role('secret'),host 会在发给页面的数据里抹掉它的值,
          // 因此这里永远读不到已保存的 Key——输入框保持空白(只写不回显)。
          if (typeof value.model === 'string' && value.model !== '') setModel(value.model)
           if (typeof value.baseUrl === 'string' && value.baseUrl !== '') setBaseUrl(value.baseUrl)
        }
        refresh()
        const off = pluginSettings.subscribe(refresh)
        return () => {
          mounted = false
          off()
        }
      }, [])

      const save = async () => {
        if (pluginSettings === null) {
          setMessageKind('error')
          setMessage('settings 服务不可用,请改用 dsh credentials set STEPFUN_API_KEY')
          return
        }
        try {
          const key = apiKey.trim()
          // 留空 = 不改动已保存的 Key(已保存的值不会回显,不能误写成空串覆盖)
          if (key !== '') await pluginSettings.set('apiKey', key)
          const endpoint = baseUrl.trim()
           if (!/^https?:\/\//i.test(endpoint)) throw new Error('接口地址必须以 http:// 或 https:// 开头')
           await pluginSettings.set('model', model.trim() === '' ? 'step-3.7-flash' : model.trim())
           await pluginSettings.set('baseUrl', endpoint.replace(/\/+$/, ''))
          setMessageKind('ok')
          setMessage(key !== ''
            ? '已保存:接口地址、模型和 API Key 均存储在本机 settings,不会上传 GitHub'
            : '已保存接口/模型设置(API Key 留空,未改动)')
          setApiKey('')
        } catch (error) {
          setMessageKind('error')
          setMessage(String(error && error.message ? error.message : error))
        }
      }

      const clearKey = async () => {
        if (pluginSettings === null) return
        try {
          await pluginSettings.unset('apiKey')
          setApiKey('')
          setMessageKind('ok')
          setMessage('已清除设置页保存的 API Key,识别将回退到 DSH Credential: STEPFUN_API_KEY')
        } catch (error) {
          setMessageKind('error')
          setMessage(String(error && error.message ? error.message : error))
        }
      }

      const row = (label, child) => React.createElement('div', { className: 'sfv-row' },
        React.createElement('div', { className: 'sfv-label' }, label),
        React.createElement('div', { className: 'sfv-value' }, child))

      return React.createElement('div', { className: 'sfv-settings' },
        React.createElement('p', { className: 'sfv-desc' },
          'dsh-sfversion 给纯文本模型装上眼睛:图片作为原生附件加入输入框,发送后按用户问题自动选择描述/OCR、空间定位或 UI 还原,再注入 DeepSeek 上下文。默认不会为普通图片生成 HTML。'),
        React.createElement('p', { className: 'sfv-desc' },
          '直接粘贴/拖入输入框的图片,以及 Agent 通过 read_image 读取的图片,同样支持这些模式。空间定位会返回 0~1000 归一化坐标和九宫格区域;识别结果按图片、问题、模型和接口地址隔离缓存。'),
        row('API Key', React.createElement('input', {
          type: 'password',
          className: 'sfv-input',
          placeholder: '留空 = 不改动;已保存的 Key 出于安全不回显',
          value: apiKey,
          onChange: (e) => setApiKey(e.target.value),
          autoComplete: 'off',
        })),
        row('视觉模型', React.createElement('input', {
          type: 'text',
          className: 'sfv-input',
          value: model,
          onChange: (e) => setModel(e.target.value),
        })),
        row('接口地址', React.createElement('input', {
           type: 'url',
           className: 'sfv-input',
           value: baseUrl,
           onChange: (e) => setBaseUrl(e.target.value),
           placeholder: 'https://api.stepfun.com/v1',
         })),
        React.createElement('div', { className: 'sfv-row' },
          React.createElement('div', { className: 'sfv-label' }, ''),
          React.createElement('div', { className: 'sfv-value' },
            React.createElement('button', { className: 'sfv-button', onClick: save }, '保存'),
            React.createElement('button', {
              className: 'sfv-button sfv-button-plain',
              style: { marginLeft: 8 },
              onClick: clearKey,
            }, '清除已保存的 Key'))),
        message !== '' ? React.createElement('p', { className: 'sfv-desc ' + messageKind }, message) : null,
        React.createElement('p', { className: 'sfv-desc' },
          '兼容说明:接口地址可填写 /v1 基地址或完整 /chat/completions。自定义接口需兼容 OpenAI Chat Completions、多模态 image_url data URL、Bearer Key 和 choices[0].message.content。'),
        React.createElement('p', { className: 'sfv-desc' },
          '更多信息见项目 README:https://github.com/sparkmio/dsh-sfversion'))
    }

    const inject = ['slots', 'settingsScope', 'sessions', 'connection', 'inputTriggers']

    function registerDocumentReferenceSource(ctx) {
      const inputTriggers = ctx.get('inputTriggers')
      if (inputTriggers === undefined || inputTriggers === null || typeof inputTriggers.registerSource !== 'function') return
      const source = {
        trigger: '/',
        name: DOCUMENT_SOURCE,
        order: -100,
        candidates: async () => [],
        onPick: () => undefined,
        codec: {
          clipboardText(ref) {
            pruneDocumentRefs()
            const item = documentRefs.get(ref)
            return item?.name ? `[文档:${item.name}]` : '[文档]'
          },
          async serialize(ref, signal) {
            pruneDocumentRefs()
            const item = documentRefs.get(ref)
            if (!item) throw new Error('文档引用已失效，请重新上传文档')
            item.lastUsedAt = Date.now()
            const connection = ctx.get('connection') || ctx.connection
            if (connection?.rpc === undefined || typeof connection.rpc.call !== 'function') throw new Error('文档解析通道不可用，请重启 DSH 后重试')
            // DSH 的文档引用 codec 最终只接受字符串。不要把 inspect 返回的
            // 完整解析上下文当作字符串返回，否则它会被记录成用户消息正文。
            // 这里只把文件注册到宿主内存，并返回不含 URI 的短文件标签；
            // 宿主会在 llm/stream 的模型请求边界把标签展开成文档上下文。
            const result = await connection.rpc.call('/sfv', 'attach', {
              name: item.name,
              mime: item.mime,
              base64: bytesToBase64(item.bytes),
            }, signal)
            if (!result?.ok) throw new Error(result?.error?.message || '文档附件注册失败')
            const marker = result.value?.marker
            if (typeof marker !== 'string' || marker.trim() === '') throw new Error('文档附件引用无效，请重启 DSH 后重试')
            return marker
          },
        },
      }
      try { inputTriggers.registerSource(source) } catch (error) { console.warn('[dsh-sfversion] 文档引用源注册失败:', error) }
    }

    function apply(ctx) {
      pluginCtx = ctx
      registerDocumentReferenceSource(ctx)
      try {
        pluginSettings = ctx.settingsScope.bind({ namespace: 'dsh-sfversion' })
      } catch {
        pluginSettings = null
      }
      const slots = ctx.get('slots')
      if (slots === undefined) return

      slots.inject('conversation.input.dock', () => slots.register(
        { name: 'conversation.input.dock', id: 'dsh-sfversion-bar', order: 0 },
        (props) => React.createElement(StatusBar, props),
      ))

      slots.inject('conversation.input.left', () => slots.register(
        { name: 'conversation.input.left', id: 'dsh-sfversion-upload', order: 60 },
        (props) => React.createElement(UploadButton, props),
      ))

      slots.inject('settings.section', () => slots.register(
        { name: 'settings.section', id: 'dsh-sfversion', order: 90, label: 'StepFun 视觉' },
        () => React.createElement(SettingsPage),
      ))
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
