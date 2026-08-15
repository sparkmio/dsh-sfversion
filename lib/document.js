/**
 * 文档解析中间层：把 Office/Markdown/PDF 转成带来源锚点的有序区块。
 *
 * 该模块不调用视觉模型，也不把图片 OCR 混入正文；图片以 bytes + 位置元数据
 * 返回，宿主层再按图片类型选择 OCR 或详细视觉描述。
 */
import { unzipSync } from 'fflate'
import { deflateSync } from 'node:zlib'

const MIME_BY_EXT = {
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
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
  if (ext === '.docx' || /wordprocessingml\.document/i.test(mime)) return 'docx'
  if (ext === '.pptx' || /presentationml\.presentation/i.test(mime)) return 'pptx'
  if (ext === '.xlsx' || /spreadsheetml\.sheet/i.test(mime)) return 'xlsx'
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

function parseDocx(bytes, name) {
  const entries = zipEntries(bytes)
  const xml = entryText(entries, 'word/document.xml')
  if (!xml) throw new Error('DOCX 缺少 word/document.xml')
  const rels = relMap(entryText(entries, 'word/_rels/document.xml.rels'))
  const blocks = []
  let order = 0
  const body = /<w:body(?:\s[^>]*)?>([\s\S]*?)<\/w:body>/i.exec(xml)?.[1] || xml
  const children = [...body.matchAll(/<w:(p|tbl)(?:\s[^>]*)?>[\s\S]*?<\/w:\1>/gi)]
  for (const match of children) {
    const tag = match[1].toLowerCase()
    const raw = match[0]
    if (tag === 'tbl') {
      let rowNo = 0
      for (const row of blocksByTag(raw, 'w:tr')) {
        rowNo++
        const cells = blocksByTag(row.inner, 'w:tc')
        let colNo = 0
        for (const cell of cells) {
          colNo++
          const text = textFromRuns(cell.inner).trim()
          if (text) blocks.push({ type: 'text', id: `p-${++order}`, text, location: { kind: 'table-cell', table: `table-${order}`, row: rowNo, col: colNo, precision: 'document-order' } })
        }
      }
      continue
    }
    const text = textFromRuns(raw).replace(/\s+/g, ' ').trim()
    const paragraphId = `p-${++order}`
    if (text) blocks.push({ type: 'text', id: paragraphId, text, location: { kind: 'paragraph', paragraph: order, precision: 'document-order' } })
    let imageNo = 0
    for (const drawing of [...raw.matchAll(/<w:drawing[\s\S]*?<\/w:drawing>/gi)].map((m) => m[0])) {
      for (const embed of drawing.matchAll(/r:embed\s*=\s*["']([^"']+)["']/gi)) {
        const target = rels.get(embed[1]);
        if (!target) continue
        const path = joinPath('word', target)
        const image = mediaBlock(entries.get(path), path, { kind: 'paragraph-anchor', paragraph: order, anchor: paragraphId, precision: 'document-order' })
        if (image) { image.id = `img-${++imageNo}-${order}`; blocks.push(image) }
      }
    }
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
function pdfLiteral(value) { return xmlUnescape(String(value || '').replace(/\\([\\()])/g, '$1').replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t')) }
function fallbackPdf(bytes, name) {
  const raw = decoder(bytes)
  const pages = raw.split(/\/Type\s*\/Page\b/i)
  const blocks = []
  pages.slice(1).forEach((page, index) => {
    const text = [...page.matchAll(/\(([^()]*(?:\\.[^()]*)*)\)\s*Tj|\[([^\]]+)\]\s*TJ/gs)].map((m) => m[1] ? pdfLiteral(m[1]) : [...String(m[2] || '').matchAll(/\(([^()]*)\)/g)].map((x) => pdfLiteral(x[1])).join('')).join(' ').replace(/\s+/g, ' ').trim()
    if (text) blocks.push({ type: 'text', id: `pdf-${index + 1}-text`, text, location: { kind: 'pdf-page', page: index + 1, precision: 'page-level (fallback parser)' } })
  })
  if (!blocks.length) blocks.push({ type: 'text', id: 'pdf-empty', text: '[PDF 未发现可提取的文字层；扫描页需要安装 PDF 渲染/OCR 适配器]', location: { kind: 'pdf-document', precision: 'unknown' } })
  return { name, type: 'pdf', blocks, locationPrecision: 'page-level fallback; compressed/scanned pages need PDF.js adapter' }
}

async function parsePdf(bytes, name, signal) {
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const task = pdfjs.getDocument({ data: bytes, disableWorker: true, useWorkerFetch: false, isEvalSupported: false })
    const pdf = await task.promise
    const blocks = []
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
      if (signal?.aborted) throw signal.reason || new Error('操作已取消')
      const page = await pdf.getPage(pageNo)
      const viewport = page.getViewport({ scale: 1 })
      const content = await page.getTextContent()
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
      }
      const operatorList = await page.getOperatorList()
      let transform = [1, 0, 0, 1, 0, 0]
      let imageNo = 0
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
        const image = isNamedImage ? page.objs.get(args[0]) : args[0]
        const png = pdfImageToPng(image)
        if (!png) continue
        const bbox = pdfImageBbox(transform, viewport, Number(image.width || args[1] || 0), Number(image.height || args[2] || 0))
        blocks.push({ type: 'image', id: `pdf-${pageNo}-img-${++imageNo}`, name: `page-${pageNo}-image-${imageNo}.png`, bytes: png, mime: 'image/png', source: 'pdf-raster-image', location: { kind: 'pdf-image', page: pageNo, bbox, region: rectLabel(bbox), precision: 'image-coordinate' } })
      }
      if (!content.items.length) blocks.push({ type: 'text', id: `pdf-${pageNo}-scan`, text: `[第 ${pageNo} 页没有文字层，可能是扫描页；当前版本保留页码锚点]`, location: { kind: 'pdf-page', page: pageNo, precision: 'page-level' } })
    }
    return { name, type: 'pdf', blocks, locationPrecision: 'text/image-coordinate; scanned pages still need a PDF page renderer for OCR' }
  } catch (error) {
    if (signal?.aborted) throw signal.reason || error
    return fallbackPdf(bytes, name)
  }
}

export async function parseDocument({ bytes, name = 'document', mime = '', signal } = {}) {
  if (signal?.aborted) throw signal.reason || new Error('操作已取消')
  if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes || [])
  const type = documentType(name, mime)
  if (!type) throw new Error('不支持的文档格式，仅支持 docx/pptx/xlsx/pdf/md/markdown')
  if (type === 'docx') return parseDocx(bytes, name)
  if (type === 'pptx') return parsePptx(bytes, name)
  if (type === 'xlsx') return parseXlsx(bytes, name)
  if (type === 'markdown') return parseMarkdown(bytes, name)
  return parsePdf(bytes, name, signal)
}

export function imageBlockToDataUrl(block) { return dataUrl(block.bytes, block.mime) }
