import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { zipSync, strToU8 } from 'fflate'
import * as XLSX from 'xlsx'
import { documentType, supportedDocument, parseDocument } from '../lib/document.js'

const bytes = (value) => new TextEncoder().encode(value)

assert.equal(documentType('report.doc'), 'doc')
assert.equal(documentType('slides.ppt'), 'ppt')
assert.equal(documentType('table.xls'), 'xls')
assert.equal(documentType('map.xmind'), 'xmind')
assert.equal(documentType('TABLE.XLS', 'application/octet-stream'), 'xls')
assert.equal(supportedDocument('notes.markdown'), true)
assert.equal(supportedDocument('archive.zip'), false)

const workbook = XLSX.utils.book_new()
const sheet = XLSX.utils.aoa_to_sheet([
  ['标题', '数值'],
  ['兼容格式', 42],
])
XLSX.utils.book_append_sheet(workbook, sheet, '数据')
const xls = XLSX.write(workbook, { bookType: 'xls', type: 'buffer' })
const xlsDoc = await parseDocument({ bytes: new Uint8Array(xls), name: 'table.xls' })
assert.equal(xlsDoc.type, 'xls')
assert.ok(xlsDoc.blocks.some((block) => block.text === '兼容格式' && block.location.sheet === '数据' && block.location.cell === 'A2'))
assert.ok(xlsDoc.blocks.some((block) => block.text === '42' && block.location.cell === 'B2'))

const jsonXmind = zipSync({
  'content.json': strToU8(JSON.stringify({ sheets: [{ title: '产品', rootTopic: { title: '中心', children: { attached: [{ title: '需求', notes: { plain: { content: '备注内容' } } }] } } }] })),
  'attachments/image.png': new Uint8Array([137, 80, 78, 71]),
  'thumbnail.png': new Uint8Array([137, 80, 78, 71]),
})
const jsonDoc = await parseDocument({ bytes: jsonXmind, name: 'map.xmind' })
assert.equal(jsonDoc.type, 'xmind')
assert.ok(jsonDoc.blocks.some((block) => block.text === '需求' && block.location.topicPath === '中心 > 需求'))
assert.ok(jsonDoc.blocks.some((block) => block.text.includes('备注内容') && block.location.topicPath === '中心 > 需求'))
assert.equal(jsonDoc.blocks.some((block) => block.type === 'image'), false)

const xmlXmind = zipSync({
  'content.xml': strToU8('<xmap-content><sheet><topic><title>中心</title><children><topics><topic><title>分支</title><notes><plain>说明</plain></notes></topic></topics></children></topic></sheet></xmap-content>'),
})
const xmlDoc = await parseDocument({ bytes: xmlXmind, name: 'legacy.xmind' })
assert.ok(xmlDoc.blocks.some((block) => block.text === '中心'))
assert.ok(xmlDoc.blocks.some((block) => block.text === '分支' && block.location.topicPath === '中心 > 分支'))
assert.ok(xmlDoc.blocks.some((block) => block.text.includes('说明') && block.location.topicPath === '中心 > 分支'))

await assert.rejects(() => parseDocument({ bytes: new Uint8Array([1, 2, 3]), name: 'broken.xmind' }))
const client = await fs.readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
assert.equal(client.includes('setDraft('), false)
assert.equal(client.includes('SFV_DOCUMENT_V1'), false)
assert.ok(client.includes('slash/input-insert-reference'))
assert.ok(client.includes("connection.rpc.call('/sfv', 'inspect'"))
assert.ok(client.includes('conversation.input'))
assert.ok(client.includes('resolver.for(sessionCtx)'))
assert.ok(client.includes('sessionInput.insertReference'))
assert.ok(client.includes('sessionInput.addImages'))

console.log('document smoke tests passed')
