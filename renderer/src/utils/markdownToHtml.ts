import { marked } from 'marked'

/**
 * 将 Markdown 转为可放入富编辑器的 HTML（用于从解读稿初始化 Quill）。
 */
export function markdownToHtml(md: string): string {
  const s = md || ''
  if (!s.trim()) {
    return '<p><br></p>'
  }
  try {
    const out = marked.parse(s, { async: false }) as string
    return out && out.trim() ? out : '<p><br></p>'
  } catch {
    const esc = s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
    return `<p>${esc.replace(/\r\n/g, '\n').split('\n').join('<br/>')}</p>`
  }
}
