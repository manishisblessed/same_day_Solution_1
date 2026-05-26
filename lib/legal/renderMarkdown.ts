function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function inlineFormat(text: string): string {
  return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
}

function isTableRow(line: string): boolean {
  return line.trim().startsWith('|') && line.trim().endsWith('|')
}

function parseTableRow(line: string): string[] {
  return line
    .trim()
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim())
}

function isTableSeparator(line: string): boolean {
  const cells = parseTableRow(line)
  return cells.every((cell) => /^:?-+:?$/.test(cell))
}

export function renderMarkdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const html: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    if (!trimmed) {
      i += 1
      continue
    }

    if (trimmed === '---') {
      html.push('<hr class="my-6 border-gray-300 dark:border-gray-600" />')
      i += 1
      continue
    }

    if (trimmed.startsWith('### ')) {
      html.push(`<h3 class="text-lg font-semibold mt-6 mb-2 text-gray-900 dark:text-white">${inlineFormat(trimmed.slice(4))}</h3>`)
      i += 1
      continue
    }

    if (trimmed.startsWith('## ')) {
      html.push(`<h2 class="text-xl font-bold mt-8 mb-3 text-gray-900 dark:text-white">${inlineFormat(trimmed.slice(3))}</h2>`)
      i += 1
      continue
    }

    if (trimmed.startsWith('# ')) {
      html.push(`<h1 class="text-2xl font-bold mt-8 mb-4 text-gray-900 dark:text-white">${inlineFormat(trimmed.slice(2))}</h1>`)
      i += 1
      continue
    }

    if (isTableRow(trimmed)) {
      const tableLines: string[] = []
      while (i < lines.length && isTableRow(lines[i].trim())) {
        tableLines.push(lines[i].trim())
        i += 1
      }

      if (tableLines.length >= 2 && isTableSeparator(tableLines[1])) {
        const headers = parseTableRow(tableLines[0])
        const bodyRows = tableLines.slice(2).map(parseTableRow)
        html.push('<div class="overflow-x-auto my-4"><table class="min-w-full border border-gray-200 dark:border-gray-700 text-sm">')
        html.push('<thead class="bg-gray-50 dark:bg-gray-800"><tr>')
        headers.forEach((header) => {
          html.push(`<th class="border border-gray-200 dark:border-gray-700 px-3 py-2 text-left font-semibold">${inlineFormat(header)}</th>`)
        })
        html.push('</tr></thead><tbody>')
        bodyRows.forEach((row) => {
          html.push('<tr>')
          row.forEach((cell) => {
            html.push(`<td class="border border-gray-200 dark:border-gray-700 px-3 py-2 align-top">${inlineFormat(cell)}</td>`)
          })
          html.push('</tr>')
        })
        html.push('</tbody></table></div>')
      }
      continue
    }

    if (/^[-*]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
      const ordered = /^\d+\.\s+/.test(trimmed)
      html.push(ordered ? '<ol class="list-decimal pl-6 my-3 space-y-1">' : '<ul class="list-disc pl-6 my-3 space-y-1">')
      while (i < lines.length) {
        const item = lines[i].trim()
        if (ordered && /^\d+\.\s+/.test(item)) {
          html.push(`<li>${inlineFormat(item.replace(/^\d+\.\s+/, ''))}</li>`)
          i += 1
        } else if (!ordered && /^[-*]\s+/.test(item)) {
          html.push(`<li>${inlineFormat(item.replace(/^[-*]\s+/, ''))}</li>`)
          i += 1
        } else {
          break
        }
      }
      html.push(ordered ? '</ol>' : '</ul>')
      continue
    }

    const paragraphLines: string[] = []
    while (i < lines.length) {
      const current = lines[i].trim()
      if (
        !current ||
        current.startsWith('#') ||
        current === '---' ||
        isTableRow(current) ||
        /^[-*]\s+/.test(current) ||
        /^\d+\.\s+/.test(current)
      ) {
        break
      }
      paragraphLines.push(current)
      i += 1
    }

    html.push(`<p class="my-3 leading-relaxed text-gray-700 dark:text-gray-300">${inlineFormat(paragraphLines.join(' '))}</p>`)
  }

  return html.join('\n')
}
