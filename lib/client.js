/**
 * dsh-sfversion 浏览器端 bundle(手写 __ModuleLoader__ 格式,无需构建链)
 *
 * 功能:
 * - 输入框左侧 ↑ 上传按钮:图片压缩后作为原生草稿附件进入输入框,
 *   与输入内容同一条消息一次性发出(无确认步骤);
 * - 识别(描述 + UI 还原)由宿主 visionTranslation 服务在发送后自动完成,
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
        const cw = forced ? Math.min(1600, w) : w
        const ch = forced ? Math.min(1600, h) : h
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

    // 每个会话独立的状态(会话隔离)
    const stores = new Map()

    function sessionIdOf(props) {
      if (props !== undefined && props !== null && props.session !== undefined && props.session !== null
        && typeof props.session.sessionId === 'string' && props.session.sessionId !== '') return props.session.sessionId
      if (props !== undefined && props !== null && typeof props.sessionId === 'string' && props.sessionId !== '') return props.sessionId
      return 'unknown'
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
        const rawMime = typeof file.type === 'string' ? file.type : ''
        if (!/^image\/(png|jpeg|jpg|webp|gif)$/.test(rawMime)) {
          st.update({ status: 'error', error: '仅支持 png/jpeg/webp/gif 图片' })
          return
        }
        if (typeof file.size === 'number' && file.size > 60 * 1024 * 1024) {
          st.update({ status: 'error', error: '图片超过 60MB,无法处理' })
          return
        }
        const name = typeof file.name === 'string' && file.name !== '' ? file.name : 'image'
        setBusy(true)
        st.update({ status: 'working', error: '', fileName: name })
        try {
          const buffer = await file.arrayBuffer()
          const bytes = new Uint8Array(buffer)
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
          const sessions = pluginCtx !== null ? pluginCtx.get('sessions') : undefined
          const binding = sessions !== undefined ? sessions.binding(st.sessionId) : undefined
          let conversation
          if (binding !== undefined && binding !== null && binding.ctx !== undefined && binding.ctx !== null
            && typeof binding.ctx.get === 'function') {
            conversation = binding.ctx.get('conversation')
          }
          const inputActions = props !== undefined && props !== null ? props.inputActions : undefined
          if (conversation === undefined || conversation === null || typeof conversation.createDraftImages !== 'function'
            || inputActions === undefined || inputActions === null || typeof inputActions.addImages !== 'function') {
            throw new Error('无法把图片加入输入框(原生附件接口不可用)')
          }
          const attachments = conversation.createDraftImages([sendFile])
          inputActions.addImages(attachments.map((a) => a.id))
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

      return React.createElement('div', { className: 'sfv-upload', title: '上传图片:加入输入框,与你的内容一起发送;DeepSeek 自动获得描述 + UI 还原' },
        React.createElement('label', null,
          React.createElement('input', {
            type: 'file',
            accept: 'image/png,image/jpeg,image/webp,image/gif',
            style: { position: 'absolute', width: '1px', height: '1px', opacity: '0', overflow: 'hidden' },
            onChange: onPick,
            disabled: busy,
          }),
          React.createElement('span', { className: 'sfv-btn' }, arrow)))
    }

    function StatusBar(props) {
      const st = useStore(props)
      const doneFlag = st.status === 'done'
      // 提示条:加入成功后 3 秒自动消失(一次性)
      React.useEffect(() => {
        if (!doneFlag) return
        const timer = pluginCtx !== null ? pluginCtx.get('timer') : undefined
        if (timer === undefined) return
        const t = timer.timeout(3000)
        t.then(() => { st.clear() })
        return () => {}
      }, [doneFlag, st])
      if (st.status === 'idle') return null
      const label = st.status === 'working' ? '正在处理图片…'
        : st.status === 'done' ? '图片已加入输入框 ✓ 发送后自动识别(描述 + UI 还原)'
        : '处理失败'
      const errText = st.status === 'error' ? st.error : ''
      return React.createElement('div', { className: 'sfv-bar', title: errText !== '' ? errText : undefined },
        st.thumb !== '' ? React.createElement('img', { src: st.thumb, className: 'sfv-bar-thumb' }) : null,
        React.createElement('span', { className: 'sfv-bar-label' + (st.status === 'done' ? ' ok' : '') }, label),
        errText !== '' ? React.createElement('span', { className: 'sfv-bar-err-text' }, errText) : null,
        React.createElement('span', { className: 'sfv-spacer' }),
        React.createElement('button', { className: 'sfv-tool', onClick: () => st.clear(), title: '关闭' }, '✕'))
    }

    function SettingsPage() {
      const row = (label, value) => React.createElement('div', { className: 'sfv-row' },
        React.createElement('div', { className: 'sfv-label' }, label),
        React.createElement('div', { className: 'sfv-value' }, value))

      return React.createElement('div', { className: 'sfv-settings' },
        React.createElement('p', { className: 'sfv-desc' },
          'dsh-sfversion(StepFun 视觉桥)给纯文本模型装上眼睛:输入框左侧的 ↑ 按钮把图片作为原生附件加入输入框,与你的内容作为同一条消息发送。发送后由 StepFun(step-3.7-flash)自动生成图片描述与 UI 还原代码,在后台注入 DeepSeek 上下文——聊天里只显示图片本身。'),
        React.createElement('p', { className: 'sfv-desc' },
          '直接粘贴/拖入输入框的图片,以及 Agent 通过 read_image 读取的图片,同样自动获得描述 + 还原。识别结果按图片内容缓存,重复图片不重复调用模型。'),
        row('视觉模型', 'step-3.7-flash(默认)'),
        row('接口地址', 'https://api.stepfun.com/v1'),
        row('API Key', 'DSH Credential:STEPFUN_API_KEY'),
        React.createElement('p', { className: 'sfv-desc' }, '配置 Key(一次性):'),
        React.createElement('pre', { className: 'sfv-code' }, 'dsh credentials set STEPFUN_API_KEY sk-...'),
        React.createElement('p', { className: 'sfv-desc' },
          '更多信息见项目 README:https://github.com/sparkmio/dsh-sfversion'))
    }

    const inject = ['slots']

    function apply(ctx) {
      pluginCtx = ctx
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
