import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { deflateSync } from 'node:zlib'
import { zipSync, strToU8 } from 'fflate'
import * as XLSX from 'xlsx'
import { documentType, supportedDocument, parseDocument } from '../lib/document.js'
import { classifyVisionMode, isStorySummaryQuery } from '../lib/vision-mode.js'
import { ZERO_WIDTH_ALPHABET, ZERO_WIDTH_START, ZERO_WIDTH_END, documentReferenceMarker, encodeZeroWidth, parseDocumentReference } from '../lib/document-reference.js'

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

const docxTable = zipSync({
  'word/document.xml': strToU8('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:tbl><w:tr><w:tc><w:p><w:r><w:t>cell</w:t></w:r><w:r><w:drawing><a:blip r:embed="rId5"/></w:drawing></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>'),
  'word/_rels/document.xml.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId5" Target="media/image1.png" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"/></Relationships>'),
  'word/media/image1.png': new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
})
const docxTableDoc = await parseDocument({ bytes: docxTable, name: 'table-image.docx' })
assert.ok(docxTableDoc.blocks.some((block) => block.type === 'text' && block.text === 'cell' && block.location.kind === 'table-cell'))
assert.ok(docxTableDoc.blocks.some((block) => block.type === 'image' && block.location.kind === 'table-cell-anchor' && block.location.row === 1 && block.location.col === 1))

function makeImagePdf() {
  const compressed = deflateSync(Uint8Array.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]))
  const encoder = new TextEncoder()
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
    null,
    '5 0 obj\n<< /Length 37 >>\nstream\nq 100 0 0 100 20 20 cm /Im1 Do Q\nendstream\nendobj\n',
  ]
  const imageObject = new Uint8Array([...encoder.encode('4 0 obj\n<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ' + compressed.length + ' >>\nstream\n'), ...compressed, ...encoder.encode('\nendstream\nendobj\n')])
  let out = encoder.encode('%PDF-1.4\n')
  const offsets = [0]
  const append = (part) => { offsets.push(out.length); out = new Uint8Array([...out, ...part]) }
  for (let i = 0; i < objects.length; i++) append(i === 3 ? imageObject : encoder.encode(objects[i]))
  const xref = out.length
  let tail = 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n'
  for (let i = 1; i < offsets.length; i++) tail += String(offsets[i]).padStart(10, '0') + ' 00000 n \n'
  tail += 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n'
  return new Uint8Array([...out, ...encoder.encode(tail)])
}
const pdfDoc = await parseDocument({ bytes: makeImagePdf(), name: 'scan.pdf' })
assert.ok(pdfDoc.blocks.some((block) => block.type === 'image' && block.location.page === 1 && block.bytes.length > 8))

function makeScanPdf() {
  const encoder = new TextEncoder()
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>\nendobj\n',
    '4 0 obj\n<< /Length 0 >>\nstream\n\nendstream\nendobj\n',
  ]
  let out = encoder.encode('%PDF-1.4\n')
  const offsets = [0]
  for (const object of objects) { offsets.push(out.length); out = new Uint8Array([...out, ...encoder.encode(object)]) }
  const xref = out.length
  let tail = 'xref\n0 5\n0000000000 65535 f \n'
  for (let i = 1; i < offsets.length; i++) tail += String(offsets[i]).padStart(10, '0') + ' 00000 n \n'
  tail += 'trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n'
  return new Uint8Array([...out, ...encoder.encode(tail)])
}
const scanPdfDoc = await parseDocument({ bytes: makeScanPdf(), name: 'scanned.pdf' })
const renderedScanPage = scanPdfDoc.blocks.some((block) => block.type === 'image' && block.source === 'pdf-rendered-page' && block.location.kind === 'pdf-rendered-page' && block.bytes.length > 100)
const scanNotice = scanPdfDoc.blocks.find((block) => block.type === 'text' && block.text.includes('没有文字层'))
assert.ok(renderedScanPage, '扫描 PDF 必须自动渲染为 PNG 页面')
assert.ok(scanNotice?.text.includes('已自动渲染整页'))

assert.deepEqual(classifyVisionMode('网页中红色按钮在哪里'), { describe: false, ground: true, restore: false })
assert.deepEqual(classifyVisionMode('请还原这个网页'), { describe: true, ground: false, restore: true })
assert.deepEqual(classifyVisionMode('红色按钮位于左上角吗'), { describe: false, ground: true, restore: false })
assert.equal(isStorySummaryQuery('这个漫画的这一章讲了什么'), true)
assert.equal(isStorySummaryQuery('把按钮放在哪里'), false)

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
const marker = documentReferenceMarker('README (1).md', 'sfv-test-token')
assert.equal(marker.startsWith(ZERO_WIDTH_START), true)
assert.equal(marker.endsWith(ZERO_WIDTH_END), true)
assert.equal([...marker.slice(1, -1)].every((char) => ZERO_WIDTH_ALPHABET.includes(char)), true)
assert.equal(marker.includes('README'), false)
assert.equal(marker.includes('[📎'), false)
const parsedMarker = parseDocumentReference(`请总结${marker}重点`)
assert.equal(parsedMarker?.token, 'sfv-test-token')
assert.equal(parsedMarker?.name, 'README (1).md')
assert.equal(parsedMarker?.mime, '')
assert.equal(parsedMarker?.before, '请总结')
assert.equal(parsedMarker?.after, '重点')
const richMarker = documentReferenceMarker('汇总报告.pdf', 'sfv-pdf-token', 'application/pdf')
assert.equal(parseDocumentReference(richMarker)?.name, '汇总报告.pdf')
assert.equal(parseDocumentReference(richMarker)?.mime, 'application/pdf')
const legacyHiddenMarker = ZERO_WIDTH_START + encodeZeroWidth('sfv-legacy-token') + ZERO_WIDTH_END
assert.equal(parseDocumentReference(legacyHiddenMarker)?.token, 'sfv-legacy-token')
assert.equal(parseDocumentReference(legacyHiddenMarker)?.name, '')
assert.equal(parseDocumentReference('[📎 README.md](sfv-document://legacy-token)')?.token, 'legacy-token')
assert.equal(parseDocumentReference('[📎 README.md]')?.name, 'README.md')

const client = await fs.readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
const host = await fs.readFile(new URL('../lib/index.js', import.meta.url), 'utf8')
const documentParser = await fs.readFile(new URL('../lib/document.js', import.meta.url), 'utf8')
const pdfRenderWorker = await fs.readFile(new URL('../lib/pdf-render-worker.js', import.meta.url), 'utf8')
const reference = await fs.readFile(new URL('../lib/document-reference.js', import.meta.url), 'utf8')
assert.equal(client.includes('SFV_DOCUMENT_V1'), false)
assert.equal(client.includes('sfv-document://'), false)
assert.equal(client.includes('slash/input-insert-reference'), false)
assert.equal(client.includes('sessionInput.insertReference'), false)
assert.equal(client.includes('registerDocumentReferenceSource'), false)
assert.ok(client.includes('.sfv-doc-card'))
assert.ok(client.includes('.sfv-history-doc-card'))
assert.ok(client.includes('function DocumentCard'))
assert.ok(client.includes('function HistoryDocumentCard'))
assert.ok(client.includes('documentAttachmentDefinition'))
assert.ok(client.includes("key: 'dsh-sfversion-document-attachment'"))
assert.ok(client.includes("conversationEvents.register(documentAttachmentDefinition)"))
assert.ok(client.includes("'conversationEvents'"))
assert.ok(client.includes('sessionInput.setDraft(draft.includes(marker) ? draft : draft + marker)'))
assert.ok(client.includes('removeDocumentMarker'))
assert.ok(client.includes("connection.rpc.call('/sfv', 'attach'"))
assert.equal(client.includes('const text = result.value?.text'), false)
assert.ok(client.includes('const marker = result.value?.marker'))
assert.ok(client.includes('conversation.input'))
assert.ok(client.includes('resolver.for(sessionCtx)'))
assert.ok(client.includes('sessionInput.addImages'))
assert.ok(client.includes('inputActions.addImages([sendFile])'))
assert.ok(host.includes("from './document-reference.js'"))
assert.ok(host.includes("ctx.on('llm/stream'"))
assert.ok(host.includes('maxVisionConcurrency: 3'))
assert.ok(host.includes('summaryMaxTokens: 700'))
assert.ok(host.includes('parseDocumentReference'))
assert.ok(host.includes('documentReferenceMarker(name, token, mime)'))
assert.ok(host.includes('async function translateDocumentContent(content, signal, query)'))
assert.ok(host.includes('typeof content === \'string\''), '字符串 content 必须能展开隐藏文档引用')
assert.ok(host.includes('SFV_DOCUMENT_V1'))
assert.ok(documentParser.includes("import { spawn } from 'node:child_process'"))
assert.equal(documentParser.includes("import('@napi-rs/canvas')"), false, '原生 Canvas 不得运行在宿主 PDF 解析进程')
assert.ok(documentParser.includes("ELECTRON_RUN_AS_NODE: '1'"))
assert.ok(pdfRenderWorker.includes("import('@napi-rs/canvas')"))
assert.ok(reference.includes('ZERO_WIDTH_ALPHABET'))
assert.ok(reference.includes('documentReferenceMarker'))
assert.ok(reference.includes("JSON.stringify({ v: 2"))
const manifest = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'))
assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-conversation'))
assert.ok(manifest.files.includes('lib/pdf-render-worker.js'))
console.log('document smoke tests passed')
