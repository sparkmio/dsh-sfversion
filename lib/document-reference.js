/**
 * Invisible document-reference transport used until DeepSeek Harness exposes
 * a durable generic file/document content block.
 *
 * The marker contains only zero-width format characters. The browser renders
 * the actual file card separately, while the host resolves this marker at the
 * llm/stream boundary. Legacy visible references remain readable so existing
 * sessions do not break after upgrading.
 */

export const ZERO_WIDTH_ALPHABET = ['\u200B', '\u200C', '\u200D', '\u2060']
export const ZERO_WIDTH_START = '\u2063'
export const ZERO_WIDTH_END = '\u2064'

export function encodeZeroWidth(value) {
  let out = ''
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    for (let shift = 14; shift >= 0; shift -= 2) out += ZERO_WIDTH_ALPHABET[(code >> shift) & 3]
  }
  return out
}

export function decodeZeroWidth(value) {
  if (value.length === 0 || value.length % 8 !== 0) return undefined
  let out = ''
  for (let i = 0; i < value.length; i += 8) {
    let code = 0
    for (let j = 0; j < 8; j++) {
      const digit = ZERO_WIDTH_ALPHABET.indexOf(value[i + j])
      if (digit < 0) return undefined
      code = (code << 2) | digit
    }
    out += String.fromCharCode(code)
  }
  return out
}

export function documentReferenceMarker(_name, token) {
  const value = String(token || '')
  if (value === '') throw new Error('文档附件 token 不能为空')
  return ZERO_WIDTH_START + encodeZeroWidth(value) + ZERO_WIDTH_END
}

export function parseDocumentReference(text) {
  const value = typeof text === 'string' ? text : ''
  const hidden = new RegExp(`${ZERO_WIDTH_START}([${ZERO_WIDTH_ALPHABET.join('')}]+)${ZERO_WIDTH_END}`).exec(value)
  if (hidden) {
    const token = decodeZeroWidth(hidden[1])
    if (token !== undefined) {
      return {
        name: '',
        token,
        label: hidden[0],
        full: hidden[0],
        before: value.slice(0, hidden.index),
        after: value.slice(hidden.index + hidden[0].length),
      }
    }
  }

  const markdown = /\[📎\s+([^\]\n]+)\]\(sfv-document:\/\/([^\)\s]+)\)/i.exec(value)
  if (markdown) {
    let token = markdown[2]
    const name = markdown[1].trim()
    try { token = decodeURIComponent(token) } catch {}
    return { name, token, label: markdown[0], full: markdown[0], before: value.slice(0, markdown.index), after: value.slice(markdown.index + markdown[0].length) }
  }

  const short = /\[📎\s+([^\]\n]+)\]/i.exec(value)
  if (short) {
    const name = short[1].trim()
    return { name, token: undefined, label: short[0], full: short[0], before: value.slice(0, short.index), after: value.slice(short.index + short[0].length) }
  }

  // Compatibility with the oldest unbracketed form. It is accepted only as a
  // complete line so text after the filename is not mistaken for its name.
  const plain = /(?:^|\n)📎\s+([^\n]+?)\s*(?=\n|$)/i.exec(value)
  if (!plain) return undefined
  const full = plain[0].startsWith('\n') ? plain[0].slice(1) : plain[0]
  const index = plain.index + (plain[0].startsWith('\n') ? 1 : 0)
  const name = plain[1].trim()
  return { name, token: undefined, label: full, full, before: value.slice(0, index), after: value.slice(index + full.length) }
}
