/**
 * 文档解析中间层：把 Office/Markdown/PDF 转成带来源锚点的有序区块。
 *
 * 该模块不调用视觉模型，也不把图片 OCR 混入正文；图片以 bytes + 位置元数据
 * 返回，宿主层再按图片类型选择 OCR 或详细视觉描述。
 */
import { unzipSync } from 'fflate'
import { deflateSync } from 'node:zlib'
import * as CFB from 'cfb'
import * as XLSX from 'xlsx'

const MIME_BY_EXT = {
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xmind': 'application/x-xmind',
  '.pdf': 'application/pdf',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
}
const IMAGE_MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  bmp: 'image/bmp', svg: 'image/svg+xml',
}

function extension(name) {
  const value = String(name || '').toLowerCase()
  const match = /\.[a-z0-9]+$/.exec(value)
  return match ? match[0] : ''
}

export function documentType(name, mime = '') {
  const ext = extension(name)
  if (ext === '.doc' || /(?:application\/msword|msword)/i.test(mime)) return 'doc'
  if (ext === '.docx' || /wordprocessingml\.document/i.test(mime)) return 'docx'
  if (ext === '.ppt' || /application\/vnd\.ms-powerpoint/i.test(mime)) return 'ppt'
  if (ext === '.pptx' || /presentationml\.presentation/i.test(mime)) return 'pptx'
  if (ext === '.xls' || /application\/vnd\.ms-excel/i.test(mime)) return 'xls'
  if (ext === '.xlsx' || /spreadsheetml\.sheet/i.test(mime)) return 'xlsx'
  if (ext === '.xmind' || /application\/x-xmind|xmind/i.test(mime)) return 'xmind'
  if (ext === '.pdf' || mime === 'application/pdf') return 'pdf'
  if (ext === '.md' || ext === '.markdown' || /(?:markdown|text\/plain)/i.test(mime)) return 'markdown'
  return undefined
}

export function supportedDocument(name, mime = '') {
  return documentType(name, mime) !== undefined
}

function decoder(bytes) { return new TextDecoder('utf-8', { fatal: false }).decode(bytes) }
function xmlUnescape(value) {
  return String(value || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&')
}
function stripXml(value) { return xmlUnescape(String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()) }
function attr(tag, key) {
  const re = new RegExp(`${key.replace(':', '\\:')}\\s*=\\s*["']([^"']*)["']`, 'i')
  const match = re.exec(tag)
  return match ? xmlUnescape(match[1]) : ''
}
function allTags(xml, tag) {
  const escaped = tag.replace(':', '\\:')
  return [...String(xml || '').matchAll(new RegExp(`<${escaped}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${escaped}>`, 'gi'))].map((m) => m[0])
}
function blocksByTag(xml, tag) {
  const escaped = tag.replace(':', '\\:')
  return [...String(xml || '').matchAll(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, 'gi'))].map((m) => ({ full: m[0], inner: m[1] }))
}
function textFromRuns(xml) {
  return xmlUnescape([...String(xml || '').matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>|<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/gi)].map((m) => m[1] ?? m[2] ?? m[3] ?? '').join(''))
}
function safePath(value) { return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/^\.\//, '') }
function joinPath(base, target) {
  const parts = [...String(base || '').split('/').filter(Boolean), ...safePath(target).split('/').filter(Boolean)]
  const out = []
  for (const part of parts) { if (part === '..') out.pop(); else if (part !== '.') out.push(part) }
  return out.join('/')
}
function imageMime(path) {
  const ext = extension(path).slice(1)
  return IMAGE_MIME[ext] || 'application/octet-stream'
}
function emu(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback }
function normalizedRect(x, y, w, h, width, height) {
  const sx = width > 0 ? 1000 / width : 0
  const sy = height > 0 ? 1000 / height : 0
  return [Math.round(Math.max(0, Math.min(1000, emu(x) * sx))), Math.round(Math.max(0, Math.min(1000, emu(y) * sy))), Math.round(Math.max(0, Math.min(1000, (emu(x) + emu(w)) * sx))), Math.round(Math.max(0, Math.min(1000, (emu(y) + emu(h)) * sy)))]
}
function rectLabel(rect) {
  if (!Array.isArray(rect)) return ''
  const x = (rect[0] + rect[2]) / 2
  const y = (rect[1] + rect[3]) / 2
  return `${y < 333 ? '上' : y > 666 ? '下' : '中'}${x < 333 ? '左' : x > 666 ? '右' : '中'}`
}
function dataUrl(bytes, mime) { return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}` }

function relMap(xml) {
  const map = new Map()
  for (const match of String(xml || '').matchAll(/<Relationship\b[^>]*>/gi)) {
    const id = attr(match[0], 'Id')
    const target = attr(match[0], 'Target')
    if (id && target) map.set(id, target)
  }
  return map
}
function zipEntries(bytes) {
  const raw = unzipSync(bytes)
  const entries = new Map()
  for (const [name, data] of Object.entries(raw)) entries.set(name, data)
  return entries
}
function entryText(entries, name) { const bytes = entries.get(name); return bytes ? decoder(bytes) : '' }
function mediaBlock(bytes, name, location) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) return undefined
  const mime = imageMime(name)
  if (!mime.startsWith('image/')) return undefined
  return { type: 'image', id: location.id, name: name.split('/').pop() || location.id, bytes, mime, location, source: 'embedded-image' }
}

function appendDocxImages(raw, entries, rels, blocks, idPrefix, location) {
  let imageNo = 0
  for (const drawing of [...String(raw || '').matchAll(/<w:drawing[\s\S]*?<\/w:drawing>/gi)].map((m) => m[0])) {
    for (const embed of drawing.matchAll(/r:embed\s*=\s*["']([^"']+)["']/gi)) {
      const target = rels.get(embed[1])
      if (!target) continue
      const path = joinPath('word', target)
      const imageId = `${idPrefix}-img-${++imageNo}`
      const image = mediaBlock(entries.get(path), path, { ...location, anchor: location.anchor || idPrefix, id: imageId })
      if (image) blocks.push(image)
    }
  }
}

function parseDocx(bytes, name) {
  const entries = zipEntries(bytes)
  const xml = entryText(entries, 'word/document.xml')
  if (!xml) throw new Error('DOCX 缺少 word/document.xml')
  const rels = relMap(entryText(entries, 'word/_rels/document.xml.rels'))
  const blocks = []
  let order = 0
  let tableNo = 0
  const body = /<w:body(?:\s[^>]*)?>([\s\S]*?)<\/w:body>/i.exec(xml)?.[1] || xml
  const children = [...body.matchAll(/<w:(p|tbl)(?:\s[^>]*)?>[\s\S]*?<\/w:\1>/gi)]
  for (const match of children) {
    const tag = match[1].toLowerCase()
    const raw = match[0]
    if (tag === 'tbl') {
      const tableId = `table-${++tableNo}`
      let rowNo = 0
      for (const row of blocksByTag(raw, 'w:tr')) {
        rowNo++
        const cells = blocksByTag(row.inner, 'w:tc')
        let colNo = 0
        for (const cell of cells) {
          colNo++
          const text = textFromRuns(cell.inner).trim()
          const cellId = `p-${++order}`
          const location = { kind: 'table-cell', table: tableId, row: rowNo, col: colNo, precision: 'document-order' }
          if (text) blocks.push({ type: 'text', id: cellId, text, location })
          appendDocxImages(cell.inner, entries, rels, blocks, cellId, { kind: 'table-cell-anchor', table: tableId, row: rowNo, col: colNo, precision: 'document-order' })
        }
      }
      continue
    }
    const text = textFromRuns(raw).replace(/\s+/g, ' ').trim()
    const paragraphId = `p-${++order}`
    if (text) blocks.push({ type: 'text', id: paragraphId, text, location: { kind: 'paragraph', paragraph: order, precision: 'document-order' } })
    appendDocxImages(raw, entries, rels, blocks, paragraphId, { kind: 'paragraph-anchor', paragraph: order, precision: 'document-order' })
  }
  if (!blocks.length) {
    const fallback = stripXml(xml)
    if (fallback) blocks.push({ type: 'text', id: 'p-1', text: fallback, location: { kind: 'document', precision: 'document-order' } })
  }
  return { name, type: 'docx', blocks, locationPrecision: 'document-order (DOCX XML 不保证真实分页)' }
}

function parsePptx(bytes, name) {
  const entries = zipEntries(bytes)
  const presentation = entryText(entries, 'ppt/presentation.xml')
  const size = /<p:sldSz\b[^>]*>/i.exec(presentation)?.[0] || ''
  const slideWidth = emu(attr(size, 'cx'), 9144000)
  const slideHeight = emu(attr(size, 'cy'), 5143500)
  const slideNames = [...entries.keys()].filter((p) => /^ppt\/slides\/slide\d+\.xml$/i.test(p)).sort((a, b) => Number(/slide(\d+)/i.exec(a)?.[1]) - Number(/slide(\d+)/i.exec(b)?.[1]))
  const blocks = []
  for (const slidePath of slideNames) {
    const slideNo = Number(/slide(\d+)/i.exec(slidePath)?.[1] || 0)
    const xml = entryText(entries, slidePath)
    const relPath = `ppt/slides/_rels/slide${slideNo}.xml.rels`
    const rels = relMap(entryText(entries, relPath))
    const tree = /<p:spTree[\s\S]*?<\/p:spTree>/i.exec(xml)?.[0] || xml
    let seq = 0
    const shapes = [...tree.matchAll(/<p:(sp|pic)(?:\s[^>]*)?>[\s\S]*?<\/p:\1>/gi)]
    for (const match of shapes) {
      const kind = match[1].toLowerCase()
      const raw = match[0]
      const xfrm = /<a:xfrm[\s\S]*?<\/a:xfrm>/i.exec(raw)?.[0] || ''
      const off = /<a:off\b[^>]*>/i.exec(xfrm)?.[0] || ''
      const ext = /<a:ext\b[^>]*>/i.exec(xfrm)?.[0] || ''
      const bbox = normalizedRect(attr(off, 'x'), attr(off, 'y'), attr(ext, 'cx'), attr(ext, 'cy'), slideWidth, slideHeight)
      const location = { kind: 'slide', slide: slideNo, bbox, region: rectLabel(bbox), precision: 'shape-coordinate' }
      const text = textFromRuns(raw).replace(/\s+/g, ' ').trim()
      if (text) blocks.push({ type: 'text', id: `slide-${slideNo}-text-${++seq}`, text, location })
      if (kind === 'pic') {
        const embed = /r:embed\s*=\s*["']([^"']+)["']/i.exec(raw)?.[1]
        const target = embed ? rels.get(embed) : ''
        const path = target ? joinPath(`ppt/slides`, target) : ''
        const image = mediaBlock(entries.get(path), path, location)
        if (image) { image.id = `slide-${slideNo}-img-${seq}`; blocks.push(image) }
      }
    }
    if (!blocks.some((block) => block.location?.slide === slideNo)) blocks.push({ type: 'text', id: `slide-${slideNo}-empty`, text: '[空白或未解析的幻灯片]', location: { kind: 'slide', slide: slideNo, precision: 'slide-level' } })
  }
  return { name, type: 'pptx', blocks, locationPrecision: 'shape-coordinate (0~1000 归一化)' }
}

function workbookSheetMap(entries) {
  const workbook = entryText(entries, 'xl/workbook.xml')
  const rels = relMap(entryText(entries, 'xl/_rels/workbook.xml.rels'))
  const out = []
  for (const match of workbook.matchAll(/<sheet\b[^>]*>/gi)) {
    const sheetName = attr(match[0], 'name') || `Sheet${out.length + 1}`
    const rid = attr(match[0], 'r:id')
    const target = rels.get(rid)
    if (target) out.push({ name: sheetName, path: joinPath('xl', target) })
  }
  return out
}
function parseXlsx(bytes, name) {
  const entries = zipEntries(bytes)
  const shared = blocksByTag(entryText(entries, 'xl/sharedStrings.xml'), 'si').map((v) => textFromRuns(v.inner).trim())
  const blocks = []
  for (const sheet of workbookSheetMap(entries)) {
    const xml = entryText(entries, sheet.path)
    let rowIndex = 0
    for (const row of blocksByTag(xml, 'row')) {
      rowIndex = Number(attr(row.full, 'r')) || rowIndex + 1
      let col = 0
      for (const cell of [...row.inner.matchAll(/<c\b[^>]*>([\s\S]*?)<\/c>|<c\b[^>]*/gi)]) {
        const full = cell[0]
        const inner = cell[1] || ''
        const ref = attr(full, 'r') || `${String.fromCharCode(65 + col)}${rowIndex}`
        col++
        const type = attr(full, 't')
        const value = /<v\b[^>]*>([\s\S]*?)<\/v>/i.exec(inner)?.[1] ?? ''
        const inline = /<is[\s\S]*?<\/is>/i.exec(inner)?.[0]
        let text = type === 's' ? (shared[Number(value)] || '') : inline ? textFromRuns(inline) : xmlUnescape(value)
        text = String(text).trim()
        if (text) blocks.push({ type: 'text', id: `sheet-${sheet.name}-${ref}`, text, location: { kind: 'cell', sheet: sheet.name, cell: ref, row: rowIndex, column: ref.replace(/\d/g, ''), precision: 'cell-coordinate' } })
      }
    }
  }
  const drawingPathForSheet = (sheet) => {
    const sheetName = sheet.path.split('/').pop() || ''
    const relPath = `xl/worksheets/_rels/${sheetName}.rels`
    const sheetXml = entryText(entries, sheet.path)
    const drawingId = /<drawing\b[^>]*r:id\s*=\s*["']([^"']+)["']/i.exec(sheetXml)?.[1]
    const target = drawingId ? relMap(entryText(entries, relPath)).get(drawingId) : ''
    return target ? joinPath('xl/worksheets', target) : ''
  }
  const mappedDrawingPaths = new Set()
  const drawingRefs = []
  for (const sheet of workbookSheetMap(entries)) {
    const drawingPath = drawingPathForSheet(sheet)
    if (drawingPath) {
      mappedDrawingPaths.add(drawingPath)
      drawingRefs.push({ sheet, drawingPath })
    }
  }
  for (const drawingPath of [...entries.keys()].filter((p) => /^xl\/drawings\/drawing\d+\.xml$/i.test(p) && !mappedDrawingPaths.has(p))) {
    drawingRefs.push({ sheet: undefined, drawingPath })
  }
  let imgNo = 0
  for (const { sheet, drawingPath } of drawingRefs) {
    const drawing = entryText(entries, drawingPath)
    const relsPath = drawingPath.replace(/^xl\/drawings\//, 'xl/drawings/_rels/') + '.rels'
    const rels = relMap(entryText(entries, relsPath))
    for (const anchor of [...drawing.matchAll(/<xdr:(?:twoCellAnchor|oneCellAnchor|absoluteAnchor)[\s\S]*?<\/xdr:(?:twoCellAnchor|oneCellAnchor|absoluteAnchor)>/gi)].map((m) => m[0])) {
      const embed = /r:embed\s*=\s*["']([^"']+)["']/i.exec(anchor)?.[1]
      const target = embed ? rels.get(embed) : ''
      const path = target ? joinPath('xl/drawings', target) : ''
      const from = /<xdr:from>([\s\S]*?)<\/xdr:from>/i.exec(anchor)?.[1] || ''
      const to = /<xdr:to>([\s\S]*?)<\/xdr:to>/i.exec(anchor)?.[1] || ''
      const cell = (part) => ({ col: Number(/<xdr:col>(\d+)/i.exec(part)?.[1] || 0) + 1, row: Number(/<xdr:row>(\d+)/i.exec(part)?.[1] || 0) + 1 })
      const start = cell(from); const end = cell(to)
      const location = { kind: 'sheet-anchor', range: `${start.row}:${start.col}-${end.row}:${end.col}`, precision: 'cell-range' }
      if (sheet?.name) location.sheet = sheet.name
      const image = mediaBlock(entries.get(path), path, location)
      if (image) { image.id = `xlsx-img-${++imgNo}`; blocks.push(image) }
    }
  }  return { name, type: 'xlsx', blocks, locationPrecision: 'cell-coordinate / cell-range' }
}

async function parseLegacyDoc(bytes, name) {
  const imported = await import('word-extractor')
  const WordExtractor = imported.default || imported['module.exports'] || imported
  const extracted = await new WordExtractor().extract(Buffer.from(bytes))
  const sections = []
  const add = (label, value) => {
    const text = String(value || '').trim()
    if (text) sections.push({ label, text })
  }
  add('正文', extracted.getBody?.())
  add('页眉', extracted.getHeaders?.())
  add('页脚', extracted.getFooters?.())
  add('脚注', extracted.getFootnotes?.())
  add('尾注', extracted.getEndnotes?.())
  add('批注', extracted.getAnnotations?.())
  add('文本框', extracted.getTextboxes?.())
  const blocks = []
  if (sections.length === 0) {
    blocks.push({ type: 'text', id: 'doc-empty', text: '[DOC 未发现可提取的文字]', location: { kind: 'doc-document', precision: 'document-order' } })
  } else {
    sections.forEach((section, index) => blocks.push({
      type: 'text', id: `doc-${index + 1}`, text: `[${section.label}]\n${section.text}`,
      location: { kind: 'doc-section', section: index + 1, label: section.label, precision: 'document-order' },
    }))
  }
  return { name, type: 'doc', blocks, locationPrecision: 'document-order; legacy binary DOC has no reliable page coordinates' }
}

function parseLegacyXls(bytes, name) {
  const workbook = XLSX.read(bytes, { type: 'array', cellFormula: true, cellHTML: false, cellNF: false, cellStyles: false })
  const blocks = []
  for (const sheetName of workbook.SheetNames || []) {
    const sheet = workbook.Sheets[sheetName]
    const ref = sheet?.['!ref']
    if (!ref) continue
    const range = XLSX.utils.decode_range(ref)
    for (let row = range.s.r; row <= range.e.r; row++) {
      for (let col = range.s.c; col <= range.e.c; col++) {
        const cellAddress = XLSX.utils.encode_cell({ r: row, c: col })
        const cell = sheet[cellAddress]
        if (!cell || (cell.v === undefined && !cell.f)) continue
        const display = cell.w !== undefined ? String(cell.w) : String(cell.v ?? '')
        const formula = cell.f ? `\n公式:${cell.f}` : ''
        blocks.push({
          type: 'text', id: `xls-${blocks.length + 1}`, text: display + formula,
          location: { kind: 'sheet-cell', sheet: String(sheetName), cell: cellAddress, row: row + 1, col: col + 1, precision: 'cell-coordinate' },
        })
      }
    }
  }
  if (!blocks.length) blocks.push({ type: 'text', id: 'xls-empty', text: '[XLS 未发现可提取的单元格]', location: { kind: 'xls-document', precision: 'document-order' } })
  return { name, type: 'xls', blocks, locationPrecision: 'cell-coordinate; legacy XLS embedded images are not guaranteed' }
}

function pptTextFromBytes(value) {
  const utf16 = Buffer.from(value).toString('utf16le').replace(/\u0000/g, '').replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f]/g, ' ')
  const latin = Buffer.from(value).toString('latin1').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ')
  const clean = (text) => text.replace(/\s+/g, ' ').trim()
  const a = clean(utf16)
  const b = clean(latin)
  return a.length >= 2 && /[\p{L}\p{N}]/u.test(a) ? a : b
}

function parseLegacyPpt(bytes, name) {
  const compound = CFB.read(Buffer.from(bytes), { type: 'buffer' })
  const entry = CFB.find(compound, 'PowerPoint Document')
  if (!entry?.content) throw new Error('PPT 缺少 PowerPoint Document 流')
  const data = entry.content instanceof Uint8Array ? entry.content : new Uint8Array(entry.content)
  const blocks = []
  let offset = 0
  let slide = 1
  let records = 0
  const maxRecords = 200000
  while (offset + 8 <= data.length && records++ < maxRecords) {
    const recType = data[offset + 2] | (data[offset + 3] << 8)
    const recLen = data[offset + 4] | (data[offset + 5] << 8) | (data[offset + 6] << 16) | (data[offset + 7] << 24)
    if (!Number.isSafeInteger(recLen) || recLen < 0 || offset + 8 + recLen > data.length) break
    const body = data.subarray(offset + 8, offset + 8 + recLen)
    if (recType === 0x03ee || recType === 0x03ef) slide++
    if (recType === 0x0fa0 || recType === 0x0fa8) {
      const text = recType === 0x0fa0 ? Buffer.from(body).toString('utf16le').replace(/\u0000/g, '').trim() : pptTextFromBytes(body)
      if (text) blocks.push({ type: 'text', id: `ppt-${blocks.length + 1}`, text, location: { kind: 'ppt-slide', slide, order: blocks.length + 1, precision: 'slide-order' } })
    }
    offset += 8 + recLen
  }
  if (records >= maxRecords) throw new Error('PPT 记录数超过安全上限')
  if (!blocks.length) blocks.push({ type: 'text', id: 'ppt-empty', text: '[PPT 未发现可提取的文字；旧版 PPT 的嵌入图片/坐标暂不保证]', location: { kind: 'ppt-document', precision: 'slide-order' } })
  return { name, type: 'ppt', blocks, locationPrecision: 'slide-order; legacy binary PPT has limited text coordinates and embedded image extraction' }
}

function xmindJsonTitle(topic) {
  if (!topic || typeof topic !== 'object') return ''
  return String(topic.title ?? topic.topic?.title ?? '').trim()
}
function xmindJsonNotes(topic) {
  const notes = topic?.notes
  if (typeof notes === 'string') return notes.trim()
  if (notes && typeof notes === 'object') {
    const plain = notes.plain?.content ?? notes.content ?? notes.text
    if (typeof plain === 'string') return plain.trim()
    const html = notes.html?.content
    if (typeof html === 'string') return stripXml(html)
  }
  return ''
}
function xmindJsonChildren(topic) {
  const children = topic?.children
  if (Array.isArray(children)) return children
  if (children && Array.isArray(children.attached)) return children.attached
  return []
}
function parseXmindJson(bytes, name) {
  const root = JSON.parse(decoder(bytes))
  const blocks = []
  const sheets = Array.isArray(root) ? root : (Array.isArray(root.sheets) ? root.sheets : [root])
  const visit = (topic, path, sheetName) => {
    const title = xmindJsonTitle(topic)
    const nextPath = title ? [...path, title] : path
    if (title) blocks.push({ type: 'text', id: `xmind-${blocks.length + 1}`, text: title, location: { kind: 'xmind-topic', sheet: sheetName, topicPath: nextPath.join(' > '), precision: 'topic-tree' } })
    const notes = xmindJsonNotes(topic)
    if (notes) blocks.push({ type: 'text', id: `xmind-${blocks.length + 1}`, text: `[备注]\n${notes}`, location: { kind: 'xmind-note', sheet: sheetName, topicPath: nextPath.join(' > '), precision: 'topic-tree' } })
    for (const child of xmindJsonChildren(topic)) visit(child, nextPath, sheetName)
  }
  for (const sheet of sheets) {
    const sheetName = String(sheet?.title || sheet?.name || `Sheet ${blocks.length + 1}`)
    const rootTopic = sheet?.rootTopic || sheet?.topic || sheet
    visit(rootTopic, [], sheetName)
  }
  if (!blocks.length) blocks.push({ type: 'text', id: 'xmind-empty', text: '[XMind 未发现可提取的主题]', location: { kind: 'xmind-document', precision: 'topic-tree' } })
  return { name, type: 'xmind', blocks, locationPrecision: 'topic-tree; media previews are excluded from正文' }
}

function parseXmindXml(bytes, name) {
  const xml = decoder(bytes)
  const blocks = []
  const stack = []
  const tokenRe = /<\/?topic\b[^>]*>|<title\b[^>]*>[\s\S]*?<\/title>|<notes\b[^>]*>[\s\S]*?<\/notes>/gi
  let match
  let n = 0
  const emit = (topic) => {
    const title = String(topic.title || '').trim()
    if (!title) return
    const topicPath = [...stack.map((item) => item.title).filter(Boolean), title].join(' > ')
    blocks.push({ type: 'text', id: `xmind-${++n}`, text: title, location: { kind: 'xmind-topic', topicPath, precision: 'topic-tree (XML fallback)' } })
    const note = String(topic.note || '').trim()
    if (note) blocks.push({ type: 'text', id: `xmind-${++n}`, text: `[备注]\n${note}`, location: { kind: 'xmind-note', topicPath, precision: 'topic-tree (XML fallback)' } })
  }
  while ((match = tokenRe.exec(xml)) !== null) {
    const token = match[0]
    if (/^<topic\b/i.test(token)) {
      stack.push({ title: '', note: '' })
      continue
    }
    if (/^<\/topic/i.test(token)) {
      const topic = stack.pop()
      if (topic) emit(topic)
      continue
    }
    const current = stack[stack.length - 1]
    if (!current) continue
    if (/^<title\b/i.test(token)) current.title = stripXml(token.replace(/^<title\b[^>]*>/i, '').replace(/<\/title>$/i, ''))
    if (/^<notes\b/i.test(token)) current.note = stripXml(token.replace(/^<notes\b[^>]*>/i, '').replace(/<\/notes>$/i, ''))
  }
  if (!blocks.length) blocks.push({ type: 'text', id: 'xmind-empty', text: '[XMind 未发现可提取的主题]', location: { kind: 'xmind-document', precision: 'topic-tree' } })
  return { name, type: 'xmind', blocks, locationPrecision: 'topic-tree; XML fallback' }
}

function parseXmind(bytes, name) {
  const entries = zipEntries(bytes)
  const json = entries.get('content.json')
  if (json) return parseXmindJson(json, name)
  const xml = entries.get('content.xml')
  if (xml) return parseXmindXml(xml, name)
  throw new Error('XMind 缺少 content.json 或 content.xml')
}

function parseMarkdown(bytes, name) {
  const text = decoder(bytes).replace(/\r\n?/g, '\n')
  const blocks = []
  const lines = text.split('\n')
  let paragraph = []
  let blockNo = 0
  const flush = () => {
    const value = paragraph.join('\n').trim()
    if (value) {
      const id = `md-${++blockNo}`
      blocks.push({ type: 'text', id, text: value, location: { kind: 'markdown-block', block: blockNo, precision: 'document-order' } })
    }
    paragraph = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const imageRe = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g
    let match
    let cursor = 0
    let found = false
    while ((match = imageRe.exec(line)) !== null) {
      found = true
      const before = line.slice(cursor, match.index).trim()
      if (before) paragraph.push(before)
      flush()
      const source = match[2]
      const data = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(source)
      const id = `md-img-${++blockNo}`
      if (data) {
        const binary = Uint8Array.from(Buffer.from(data[2], 'base64'))
        blocks.push({ type: 'image', id, name: match[1] || `image-${blockNo}`, bytes: binary, mime: data[1].toLowerCase(), source: 'markdown-data-url', location: { kind: 'markdown-image', line: i + 1, alt: match[1], precision: 'line-anchor' } })
      } else {
        blocks.push({ type: 'text', id: `md-img-ref-${blockNo}`, text: `[Markdown 图片: ${match[1] || source}]`, location: { kind: 'markdown-image-ref', line: i + 1, source, precision: 'line-anchor' } })
      }
      cursor = match.index + match[0].length
    }
    if (found) {
      const after = line.slice(cursor).trim()
      if (after) paragraph.push(after)
      flush()
      continue
    }
    if (line.trim() === '') { flush(); continue }
    paragraph.push(line)
  }
  flush()
  return { name, type: 'markdown', blocks, locationPrecision: 'line-anchor / document-order' }
}
function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}
function pngChunk(type, data) {
  const typeBytes = new TextEncoder().encode(type)
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  out.set(typeBytes, 4)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}
function pdfImageToPng(image) {
  const width = Number(image?.width || 0)
  const height = Number(image?.height || 0)
  const data = image?.data instanceof Uint8Array ? image.data : undefined
  if (!width || !height || !data) return undefined
  const kind = Number(image.kind || 2)
  let channels = kind === 3 ? 4 : kind === 2 ? 3 : kind === 1 ? 1 : 0
  if (!channels) return undefined
  const expected = channels === 1 ? Math.ceil(width * height / 8) : width * height * channels
  if (data.length < expected) return undefined
  const raw = new Uint8Array(height * (width * channels + 1))
  let sourceOffset = 0
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (width * channels + 1)
    raw[rowOffset] = 0
    if (channels === 1) {
      for (let x = 0; x < width; x++) {
        const bit = (data[sourceOffset + (x >> 3)] >> (7 - (x & 7))) & 1
        raw[rowOffset + 1 + x] = bit ? 255 : 0
      }
      sourceOffset += Math.ceil(width / 8)
    } else {
      raw.set(data.subarray(sourceOffset, sourceOffset + width * channels), rowOffset + 1)
      sourceOffset += width * channels
    }
  }
  const header = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = new Uint8Array(13)
  const view = new DataView(ihdr.buffer)
  view.setUint32(0, width); view.setUint32(4, height)
  ihdr[8] = 8; ihdr[9] = channels === 4 ? 6 : channels === 3 ? 2 : 0
  const compressed = deflateSync(raw)
  const idat = pngChunk('IDAT', compressed)
  const iend = pngChunk('IEND', new Uint8Array())
  const out = new Uint8Array(header.length + 12 + ihdr.length + idat.length + iend.length)
  let offset = 0
  out.set(header, offset); offset += header.length
  const ihdrChunk = pngChunk('IHDR', ihdr); out.set(ihdrChunk, offset); offset += ihdrChunk.length
  out.set(idat, offset); offset += idat.length
  out.set(iend, offset)
  return out
}
function multiplyMatrix(left, right) {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ]
}
function pdfImageBbox(matrix, viewport, width, height) {
  const points = [[0, 0], [width, 0], [0, height], [width, height]].map(([x, y]) => viewport.convertToViewportPoint(matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]))
  const xs = points.map((point) => point[0]); const ys = points.map((point) => point[1])
  const minX = Math.max(0, Math.min(...xs)); const minY = Math.max(0, Math.min(...ys))
  const maxX = Math.min(viewport.width, Math.max(...xs)); const maxY = Math.min(viewport.height, Math.max(...ys))
  return [Math.round(minX / viewport.width * 1000), Math.round(minY / viewport.height * 1000), Math.round(maxX / viewport.width * 1000), Math.round(maxY / viewport.height * 1000)]
}
function pdfObjectData(page, id) {
  if (!page?.objs || typeof page.objs.get !== 'function' || !id) return Promise.resolve(undefined)
  try {
    if (typeof page.objs.has === 'function' && page.objs.has(id)) return Promise.resolve(page.objs.get(id))
  } catch { /* 对象尚未解析,转为 callback 等待 */ }
  return new Promise((resolve) => {
    let settled = false
    const done = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    try { page.objs.get(id, done) } catch { done(undefined) }
  })
}
let pdfCanvasModulePromise
async function renderPdfPageToPng(page, viewport) {
  pdfCanvasModulePromise ||= import('@napi-rs/canvas')
  const { createCanvas } = await pdfCanvasModulePromise
  const maxSide = 1600
  const maxPixels = 4_000_000
  const scale = Math.min(1.5, maxSide / Math.max(viewport.width, viewport.height), Math.sqrt(maxPixels / Math.max(1, viewport.width * viewport.height)))
  const renderedViewport = page.getViewport({ scale: Math.max(0.1, scale) })
  const canvas = createCanvas(Math.max(1, Math.ceil(renderedViewport.width)), Math.max(1, Math.ceil(renderedViewport.height)))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('PDF 页面渲染器无法创建 2D 画布')
  await page.render({ canvasContext: context, viewport: renderedViewport, canvas }).promise
  return { bytes: new Uint8Array(canvas.toBuffer('image/png')), viewport: renderedViewport }
}
function pdfLiteral(value) { return xmlUnescape(String(value || '').replace(/\\([\\()])/g, '$1').replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t')) }
function fallbackPdf(bytes, name, reason = '') {
  const raw = decoder(bytes)
  const pages = raw.split(/\/Type\s*\/Page\b/i)
  const blocks = []
  pages.slice(1).forEach((page, index) => {
    const text = [...page.matchAll(/\(([^()]*(?:\\.[^()]*)*)\)\s*Tj|\[([^\]]+)\]\s*TJ/gs)].map((m) => m[1] ? pdfLiteral(m[1]) : [...String(m[2] || '').matchAll(/\(([^()]*)\)/g)].map((x) => pdfLiteral(x[1])).join('')).join(' ').replace(/\s+/g, ' ').trim()
    if (text) blocks.push({ type: 'text', id: `pdf-${index + 1}-text`, text, location: { kind: 'pdf-page', page: index + 1, precision: 'page-level (fallback parser)' } })
  })
  if (!blocks.length) {
    const detail = reason ? '；PDF.js 原因:' + String(reason).slice(0, 240) : ''
    blocks.push({ type: 'text', id: 'pdf-empty', text: '[PDF 未发现可提取的文字层；扫描页需要 PDF 页面渲染/OCR 适配器' + detail + ']', location: { kind: 'pdf-document', precision: 'unknown' } })
  }
  return { name, type: 'pdf', blocks, locationPrecision: 'page-level fallback; PDF.js failed or scanned page requires renderer' }
}

async function parsePdf(bytes, name, signal) {
  let pdf
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const task = pdfjs.getDocument({ data: bytes, disableWorker: true, useWorkerFetch: false, isEvalSupported: false })
    pdf = await task.promise
    const blocks = []
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
      if (signal?.aborted) throw signal.reason || new Error('操作已取消')
      const page = await pdf.getPage(pageNo)
      const viewport = page.getViewport({ scale: 1 })
      const content = await page.getTextContent()
      let pageTextCount = 0
      for (let i = 0; i < content.items.length; i++) {
        const item = content.items[i]
        const text = String(item.str || '').trim()
        if (!text) continue
        const x = Number(item.transform?.[4] || 0)
        const y = Number(item.transform?.[5] || 0)
        const w = Number(item.width || 0)
        const h = Math.abs(Number(item.height || item.transform?.[3] || 0))
        const bbox = [Math.round(x / viewport.width * 1000), Math.round((viewport.height - y - h) / viewport.height * 1000), Math.round((x + w) / viewport.width * 1000), Math.round((viewport.height - y) / viewport.height * 1000)]
        blocks.push({ type: 'text', id: `pdf-${pageNo}-text-${i + 1}`, text, location: { kind: 'pdf-text', page: pageNo, bbox, region: rectLabel(bbox), precision: 'text-coordinate' } })
        pageTextCount++
      }
      const operatorList = await page.getOperatorList()
      let transform = [1, 0, 0, 1, 0, 0]
      let imageNo = 0
      let extractedImageCount = 0
      for (let i = 0; i < operatorList.fnArray.length; i++) {
        const fn = operatorList.fnArray[i]
        const args = operatorList.argsArray[i] || []
        if (fn === pdfjs.OPS.transform && args.length >= 6) {
          transform = multiplyMatrix(transform, args.slice(0, 6).map(Number))
          continue
        }
        const isNamedImage = fn === pdfjs.OPS.paintImageXObject
        const isInlineImage = fn === pdfjs.OPS.paintInlineImageXObject
        if (!isNamedImage && !isInlineImage) continue
        let image
        try { image = isNamedImage ? await pdfObjectData(page, args[0]) : args[0] } catch { image = undefined }
        const png = pdfImageToPng(image)
        if (!png) continue
        const bbox = pdfImageBbox(transform, viewport, Number(image.width || args[1] || 0), Number(image.height || args[2] || 0))
        blocks.push({ type: 'image', id: `pdf-${pageNo}-img-${++imageNo}`, name: `page-${pageNo}-image-${imageNo}.png`, bytes: png, mime: 'image/png', source: 'pdf-raster-image', location: { kind: 'pdf-image', page: pageNo, bbox, region: rectLabel(bbox), precision: 'image-coordinate' } })
        extractedImageCount++
      }
      if (pageTextCount === 0 && extractedImageCount === 0) {
        try {
          const rendered = await renderPdfPageToPng(page, viewport)
          blocks.push({ type: 'image', id: `pdf-${pageNo}-rendered-page`, name: `page-${pageNo}-rendered.png`, bytes: rendered.bytes, mime: 'image/png', source: 'pdf-rendered-page', location: { kind: 'pdf-rendered-page', page: pageNo, bbox: [0, 0, 1000, 1000], region: 'full-page', precision: 'page-coordinate' } })
          blocks.push({ type: 'text', id: `pdf-${pageNo}-scan`, text: `[第 ${pageNo} 页没有文字层；已自动渲染整页并交给视觉模型 OCR]`, location: { kind: 'pdf-page', page: pageNo, precision: 'page-level' } })
        } catch (renderError) {
          blocks.push({ type: 'text', id: `pdf-${pageNo}-scan`, text: `[第 ${pageNo} 页没有文字层；整页渲染失败:${String(renderError?.message || renderError).slice(0, 240)}]`, location: { kind: 'pdf-page', page: pageNo, precision: 'page-level' } })
        }
      }
    }
    return { name, type: 'pdf', blocks, locationPrecision: 'text/image-coordinate; scanned pages are rendered to PNG and sent to the vision model for OCR' }
  } catch (error) {
    if (signal?.aborted) throw signal.reason || error
    return fallbackPdf(bytes, name, error?.message || String(error))
  } finally {
    try { await pdf?.destroy?.() } catch { /* 清理失败不影响已提取内容 */ }
  }
}

export async function parseDocument({ bytes, name = 'document', mime = '', signal } = {}) {
  if (signal?.aborted) throw signal.reason || new Error('操作已取消')
  if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes || [])
  const type = documentType(name, mime)
  if (!type) throw new Error('不支持的文档格式，仅支持 doc/docx/ppt/pptx/xls/xlsx/xmind/pdf/md/markdown')
  if (type === 'doc') return parseLegacyDoc(bytes, name)
  if (type === 'docx') return parseDocx(bytes, name)
  if (type === 'ppt') return parseLegacyPpt(bytes, name)
  if (type === 'pptx') return parsePptx(bytes, name)
  if (type === 'xls') return parseLegacyXls(bytes, name)
  if (type === 'xlsx') return parseXlsx(bytes, name)
  if (type === 'xmind') return parseXmind(bytes, name)
  if (type === 'markdown') return parseMarkdown(bytes, name)
  return parsePdf(bytes, name, signal)
}

export function imageBlockToDataUrl(block) { return dataUrl(block.bytes, block.mime) }
