/**
 * Isolated PDF page renderer.
 *
 * PDF.js warnings and native canvas crashes must never take down the host
 * plugin process. This file is executed as a short-lived Node/Electron child.
 */
async function readRequest() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  const text = Buffer.concat(chunks).toString('utf8')
  const value = JSON.parse(text)
  if (typeof value?.pdf !== 'string' || !Number.isInteger(value?.page) || value.page < 1) throw new Error('PDF 渲染请求无效')
  return { bytes: new Uint8Array(Buffer.from(value.pdf, 'base64')), pageNo: value.page }
}

async function render() {
  const request = await readRequest()
  const warn = console.warn
  const log = console.log
  // Broken PDFs can emit one warning for every graphics operator. The parent
  // reports a concise rendering failure instead of flooding the host terminal.
  console.warn = () => {}
  console.log = () => {}
  let pdf
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const task = pdfjs.getDocument({ data: request.bytes, disableWorker: true, useWorkerFetch: false, isEvalSupported: false })
    pdf = await task.promise
    const page = await pdf.getPage(request.pageNo)
    const viewport = page.getViewport({ scale: 1 })
    const { createCanvas } = await import('@napi-rs/canvas')
    const maxSide = 1600
    const maxPixels = 4_000_000
    const scale = Math.min(1.5, maxSide / Math.max(viewport.width, viewport.height), Math.sqrt(maxPixels / Math.max(1, viewport.width * viewport.height)))
    const renderedViewport = page.getViewport({ scale: Math.max(0.1, scale) })
    const canvas = createCanvas(Math.max(1, Math.ceil(renderedViewport.width)), Math.max(1, Math.ceil(renderedViewport.height)))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('PDF 页面渲染器无法创建 2D 画布')
    await page.render({ canvasContext: context, viewport: renderedViewport, canvas }).promise
    return { ok: true, png: Buffer.from(canvas.toBuffer('image/png')).toString('base64') }
  } finally {
    console.warn = warn
    console.log = log
    try { await pdf?.destroy?.() } catch { /* Best-effort child cleanup. */ }
  }
}

try {
  const result = await render()
  process.stdout.write(JSON.stringify(result))
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, error: String(error?.message || error).slice(0, 800) }))
  process.exitCode = 1
}
