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
const ctx = {
  settings: { register() { return { get: () => ({}) } } },
  tools: { register() {} },
  provide() {},
  logger: { info() {} },
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

console.log('llm/stream contract regression test passed')
