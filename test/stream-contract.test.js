import assert from 'node:assert/strict'
import { apply, createConcurrencyLimiter } from '../lib/index.js'

const limiter = createConcurrencyLimiter(3)
let active = 0
let peak = 0
const limited = await Promise.all(Array.from({ length: 8 }, (_, index) => limiter.run(async () => {
  active++
  peak = Math.max(peak, active)
  await new Promise((resolve) => setTimeout(resolve, 10))
  active--
  return index
})))
assert.deepEqual(limited, [0, 1, 2, 3, 4, 5, 6, 7])
assert.equal(peak, 3, '视觉请求必须受并发上限约束')

const listeners = new Map()
let sfvRpcHandler
const ctx = {
  settings: { register() { return { get: () => ({}) } } },
  tools: { register() {} },
  provide() {},
  logger: { info() {} },
  connection: { rpc: { handle(path, handler) { if (path === '/sfv') sfvRpcHandler = handler } } },
  on(name, listener) { listeners.set(name, listener) },
}

apply(ctx)
const streamListener = listeners.get('llm/stream')
assert.equal(typeof streamListener, 'function')

function downstream() {
  return (async function* () {
    yield { type: 'chunk', text: 'downstream-ok' }
  })()
}

async function readAll(stream) {
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

const plain = streamListener({ messages: [{ role: 'user', content: [{ type: 'text', text: '这章漫画讲了什么' }] }] }, downstream)
assert.equal(plain instanceof Promise, false, 'llm/stream 无文档时也必须同步返回 AsyncIterable')
assert.equal(typeof plain[Symbol.asyncIterator], 'function')
assert.deepEqual(await readAll(plain), [{ type: 'chunk', text: 'downstream-ok' }])

const withDocument = streamListener({ messages: [{ role: 'user', content: [{ type: 'text', text: '请总结 [📎 README.md] 的重点' }] }] }, downstream)
assert.equal(withDocument instanceof Promise, false, 'llm/stream 有文档时也必须同步返回 AsyncIterable')
assert.equal(typeof withDocument[Symbol.asyncIterator], 'function')
const documentChunks = await readAll(withDocument)
assert.equal(documentChunks.at(-1)?.text, 'downstream-ok', '文档展开后仍必须 yield* 下游流')

assert.equal(typeof sfvRpcHandler, 'function', '文档上传 RPC 必须已注册')
const attached = await sfvRpcHandler('attach', {
  name: 'codex-guide.md',
  mime: 'text/markdown',
  base64: Buffer.from('# Codex API Key\n在设置页配置 API Key。').toString('base64'),
})
assert.equal(attached?.ok, true)
const marker = attached.value.marker
let receivedOptions
function captureDownstream(options) {
  receivedOptions = options
  return downstream()
}
const stringContent = `根据这份文档说明如何配置 key：${marker}`
const stringStream = streamListener({ messages: [{ role: 'user', content: stringContent }] }, captureDownstream)
assert.equal(stringStream instanceof Promise, false, '字符串 content 的文档消息也必须同步返回 AsyncIterable')
await readAll(stringStream)
assert.ok(Array.isArray(receivedOptions?.messages?.[0]?.content), '字符串 content 的附件标记必须在 llm/stream 展开为内容块')
const injectedText = receivedOptions.messages[0].content.map((block) => block?.text || '').join('\n')
assert.match(injectedText, /Codex API Key/)
assert.match(injectedText, /设置页配置 API Key/)
assert.equal(injectedText.includes(marker), false, '隐藏附件标记不得进入下游模型消息')

const secondAttached = await sfvRpcHandler('attach', {
  name: 'second-guide.md',
  mime: 'text/markdown',
  base64: Buffer.from('# 第二份说明\n第二份文档也必须注入。').toString('base64'),
})
assert.equal(secondAttached?.ok, true)
const secondMarker = secondAttached.value.marker
const multipleStream = streamListener({ messages: [{ role: 'user', content: `请对比两份资料：${marker} 然后：${secondMarker}` }] }, captureDownstream)
await readAll(multipleStream)
const multipleText = receivedOptions.messages[0].content.map((block) => block?.text || '').join('\n')
assert.match(multipleText, /Codex API Key/)
assert.match(multipleText, /第二份说明/)
assert.equal(multipleText.includes(marker) || multipleText.includes(secondMarker), false, '多个隐藏附件标记都不得进入下游模型消息')

console.log('llm/stream contract regression test passed')
