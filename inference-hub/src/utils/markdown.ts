/**
 * A small Markdown parser for chat answers. It produces plain data that is rendered with React
 * elements, so model output can never inject HTML. Unterminated code fences (while streaming)
 * are rendered as code.
 */

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'bold'; children: Inline[] }
  | { type: 'italic'; children: Inline[] }
  | { type: 'link'; text: string; href: string };

export type Block =
  | { type: 'code'; lang: string; code: string }
  | { type: 'heading'; level: number; inline: Inline[] }
  | { type: 'list'; ordered: boolean; items: Inline[][] }
  | { type: 'quote'; inline: Inline[] }
  | { type: 'table'; header: Inline[][]; rows: Inline[][][] }
  | { type: 'hr' }
  | { type: 'paragraph'; inline: Inline[] };

const INLINE_PATTERN =
  /(`[^`\n]+`)|(\*\*[^*\n]+\*\*|__[^_\n]+__)|(\*[^*\s][^*\n]*\*|_[^_\s][^_\n]*_)|(\[[^\]\n]+\]\([^)\s]+\))/g;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  // A fresh regex per call: recursion for bold/italic must not share lastIndex.
  const re = new RegExp(INLINE_PATTERN.source, 'g');
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ type: 'text', text: text.slice(last, m.index) });
    const token = m[0];
    if (m[1]) out.push({ type: 'code', text: token.slice(1, -1) });
    else if (m[2]) out.push({ type: 'bold', children: parseInline(token.slice(2, -2)) });
    else if (m[3]) out.push({ type: 'italic', children: parseInline(token.slice(1, -1)) });
    else if (m[4]) {
      const [, label, href] = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token) || [];
      // Only web links are clickable; anything else stays text.
      if (/^https?:\/\//i.test(href || '')) out.push({ type: 'link', text: label, href });
      else out.push({ type: 'text', text: token });
    }
    last = m.index + token.length;
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) });
  return out;
}

const LIST_RE = /^\s*([-*+]|\d+[.)])\s+(.*)$/;

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(c => c.trim());
}

export function parseMarkdown(text: string): Block[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = /^\s*(```|~~~)\s*([\w+-]*)/.exec(line);
    if (fence) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) code.push(lines[i++]);
      i++; // closing fence (or end of text)
      blocks.push({ type: 'code', lang: fence[2] || '', code: code.join('\n') });
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, inline: parseInline(heading[2]) });
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) {
      const header = splitRow(line).map(parseInline);
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(splitRow(lines[i]).map(parseInline));
        i++;
      }
      blocks.push({ type: 'table', header, rows });
      continue;
    }
    if (LIST_RE.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items: Inline[][] = [];
      // A change between bullets and numbers starts a new list.
      while (i < lines.length && LIST_RE.test(lines[i]) && /^\s*\d/.test(lines[i]) === ordered) {
        items.push(parseInline((LIST_RE.exec(lines[i]) as RegExpExecArray)[2]));
        i++;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i]))
        quote.push(lines[i++].replace(/^\s*>\s?/, ''));
      blocks.push({ type: 'quote', inline: parseInline(quote.join(' ')) });
      continue;
    }
    // The first line always belongs to the paragraph, so the parser always advances.
    const para: string[] = [lines[i++]];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*(```|~~~|>)/.test(lines[i]) &&
      !/^#{1,6}\s/.test(lines[i]) &&
      !LIST_RE.test(lines[i])
    ) {
      para.push(lines[i++]);
    }
    blocks.push({ type: 'paragraph', inline: parseInline(para.join('\n')) });
  }
  return blocks;
}

/**
 * Separates "<think>…</think>" reasoning that some models emit inline. An open tag without a
 * closing one (still streaming) puts everything after it into the reasoning.
 */
export function splitThinking(content: string): { reasoning: string; answer: string } {
  const open = content.indexOf('<think>');
  if (open < 0) {
    // Some templates emit only the closing tag.
    const close = content.indexOf('</think>');
    return close >= 0
      ? { reasoning: content.slice(0, close).trim(), answer: content.slice(close + 8).trim() }
      : { reasoning: '', answer: content };
  }
  const close = content.indexOf('</think>', open);
  if (close < 0)
    return { reasoning: content.slice(open + 7).trim(), answer: content.slice(0, open).trim() };
  return {
    reasoning: content.slice(open + 7, close).trim(),
    answer: (content.slice(0, open) + content.slice(close + 8)).trim(),
  };
}
