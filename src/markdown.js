import kleur from 'kleur';
import { highlightLine, highlightLines } from './syntax-highlight.js';

/**
 * Parse markdown text into styled tokens for terminal rendering.
 * Handles: bold, italic, bold+italic, inline code, strikethrough,
 * headings, horizontal rules, blockquotes, bullet lists, and fenced code blocks.
 */
export class MarkdownRenderer {
  constructor(write) {
    this.write = write; // (text) => void
  }

  render(text) {
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      this._renderLine(lines[i], i === 0);
    }
  }

  _renderLine(line, isFirst) {
    const trimmed = line.trim();

    // Headings
    if (/^#{1,6}\s/.test(trimmed)) {
      const level = trimmed.match(/^(#+)/)[1].length;
      const style = level === 1 ? kleur.bold().cyan : level === 2 ? kleur.bold : kleur.bold;
      const text = trimmed.replace(/^#+\s*/, '');
      this.write(style(this._padLine(text, level)));
      return;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      this.write(kleur.gray('─'.repeat(Math.min(trimmed.length, 60))));
      return;
    }

    // Blockquote
    if (trimmed.startsWith('> ')) {
      const quoteText = trimmed.slice(2);
      this.write(kleur.gray('▌ ') + this._renderInline(quoteText, 'dim'));
      return;
    }

    // Bullet list item
    const listMatch = trimmed.match(/^(\s*)[-*+]\s(.+)/);
    if (listMatch) {
      const indent = listMatch[1];
      const item = listMatch[2];
      this.write(kleur.gray(indent + '• ') + this._renderInline(item, 'normal'));
      return;
    }

    // Ordered list item
    const orderedMatch = trimmed.match(/^(\s*)\d+\.\s(.+)/);
    if (orderedMatch) {
      const indent = orderedMatch[1];
      const item = orderedMatch[2];
      this.write(kleur.gray(indent) + this._renderInline(item, 'normal'));
      return;
    }

    // Indented code block continuation
    if (trimmed.startsWith('    ') || trimmed.startsWith('\t')) {
      this.write(kleur.bgBlack().white(' ' + trimmed.slice(4 || 1)));
      return;
    }

    // Blank line
    if (!trimmed) {
      this.write('');
      return;
    }

    // Regular paragraph
    this.write(this._renderInline(trimmed, 'normal'));
  }

  _padLine(text, headingLevel) {
    // Add spacing between heading and content
    const prefix = headingLevel <= 2 ? '\n' : '';
    return prefix + text;
  }

  /**
   * Render inline markdown spans within a line.
   * Handles: bold+italic, bold, italic, inline code, strikethrough, links.
   * @param {string} text
   * @param {'normal'|'dim'} mode
   */
  _renderInline(text, mode) {
    const parts = this._tokeniseInline(text);
    return parts.map(({ text: t, bold, italic, code, strike, dim }) => {
      if (code) {
        return kleur.bgBlack().white(` ${t} `);
      }
      let s = t;
      if (dim || mode === 'dim') s = kleur.gray()(s);
      if (strike) s = kleur.strikethrough()(s);
      if (bold && italic) s = kleur.bold().italic(s);
      else if (bold) s = kleur.bold(s);
      else if (italic) s = kleur.italic(s);
      return s;
    }).join('');
  }

  /**
   * Tokenise inline markdown into {text, bold, italic, code, strike} spans.
   * Uses a simple state machine to avoid greedy matching issues.
   */
  _tokeniseInline(text) {
    const tokens = [];
    let i = 0;
    let buf = '';

    function flush() {
      if (buf) {
        tokens.push({ text: buf, bold: false, italic: false, code: false, strike: false, dim: false });
        buf = '';
      }
    }

    while (i < text.length) {
      // Strikethrough: ~~text~~
      if (text.slice(i, i + 2) === '~~') {
        flush();
        const end = text.indexOf('~~', i + 2);
        if (end !== -1) {
          const inner = text.slice(i + 2, end);
          tokens.push({ text: inner, bold: false, italic: false, code: false, strike: true, dim: false });
          i = end + 2;
        } else {
          buf += '~~';
          i += 2;
        }
        continue;
      }

      // Inline code: `text`
      if (text[i] === '`') {
        flush();
        const end = text.indexOf('`', i + 1);
        if (end !== -1) {
          const inner = text.slice(i + 1, end);
          tokens.push({ text: inner, bold: false, italic: false, code: true, strike: false, dim: false });
          i = end + 1;
        } else {
          buf += '`';
          i++;
        }
        continue;
      }

      // Bold+italic: ***text*** or ___text___
      if ((text.slice(i, i + 3) === '***' || text.slice(i, i + 3) === '___') && text[i] === text[i + 2]) {
        const marker = text.slice(i, i + 3);
        flush();
        const end = text.indexOf(marker, i + 3);
        if (end !== -1) {
          const inner = text.slice(i + 3, end);
          tokens.push({ text: inner, bold: true, italic: true, code: false, strike: false, dim: false });
          i = end + 3;
        } else {
          buf += marker;
          i += 3;
        }
        continue;
      }

      // Bold: **text** or __text__
      if ((text.slice(i, i + 2) === '**' || text.slice(i, i + 2) === '__') && text[i] === text[i + 1]) {
        const marker = text[i] + text[i + 1];
        flush();
        const end = text.indexOf(marker, i + 2);
        if (end !== -1) {
          const inner = text.slice(i + 2, end);
          tokens.push({ text: inner, bold: true, italic: false, code: false, strike: false, dim: false });
          i = end + 2;
        } else {
          buf += marker;
          i += 2;
        }
        continue;
      }

      // Italic: *text* or _text_  (but not __ or **)
      if ((text[i] === '*' || text[i] === '_')) {
        flush();
        const end = text.indexOf(text[i], i + 1);
        if (end !== -1) {
          const inner = text.slice(i + 1, end);
          // Skip if the "end" is actually part of a bold marker
          if (inner && !(inner.endsWith(text[i]))) {
            tokens.push({ text: inner, bold: false, italic: true, code: false, strike: false, dim: false });
            i = end + 1;
          } else {
            buf += text[i];
            i++;
          }
        } else {
          buf += text[i];
          i++;
        }
        continue;
      }

      // Link: [text](url) — render as text with underline hint
      if (text[i] === '[') {
        flush();
        const closeBracket = text.indexOf(']', i);
        if (closeBracket !== -1 && text[closeBracket + 1] === '(') {
          const closeParen = text.indexOf(')', closeBracket);
          if (closeParen !== -1) {
            const label = text.slice(i + 1, closeBracket);
            const url = text.slice(closeBracket + 2, closeParen);
            tokens.push({ text: `${label} (${url})`, bold: false, italic: false, code: false, strike: false, dim: false });
            i = closeParen + 1;
            continue;
          }
        }
        buf += '[';
        i++;
        continue;
      }

      buf += text[i];
      i++;
    }

    flush();
    return tokens;
  }
}

/**
 * Stream markdown content token by token, applying formatting.
 * Returns an async generator that yields styled chunks.
 */
export class MarkdownStream {
  constructor(write) {
    this.write = write;
    this.md = new MarkdownRenderer(write);
    this.lineBuf = '';
    this.inCode = false;
    this.fenceBuf = '';
    this.codeLines = [];
    this.codeIndent = 0;
    this.lang = '';
  }

  accept(token) {
    for (const char of token) {
      this._acceptChar(char);
    }
  }

  flush() {
    if (this.inCode) {
      const last = this.lineBuf;
      if (last) this.codeLines.push(last);
      this.lineBuf = '';
      this.fenceBuf = '';
      this._emitCode();
    } else if (this.lineBuf) {
      this.md._renderLine(this.lineBuf, true);
      this.lineBuf = '';
    }
  }

  _acceptChar(char) {
    if (!this.inCode) {
      if (char === '`') {
        this.fenceBuf += char;
        if (this.fenceBuf === '```') {
          this.inCode = true;
          this.fenceBuf = '';
          this.lang = '';
          this.codeLines = [];
          this.lineBuf = '';
          this.codeIndent = 0;
          return;
        }
        // Not a fence — emit buffered backticks as plain
        for (const c of this.fenceBuf.slice(0, -1)) this.md._renderInline(c, 'normal');
        this.fenceBuf = '';
        this.md._renderInline(char, 'normal');
        return;
      }
      if (char === '\n') {
        this.md._renderLine(this.lineBuf, true);
        this.lineBuf = '';
        return;
      }
      this.lineBuf += char;
      return;
    }

    // Inside fenced code block
    if (char === '`') {
      this.fenceBuf += char;
      if (this.fenceBuf === '```') {
        this._emitCode();
        this.inCode = false;
        this.fenceBuf = '';
        return;
      }
      if (this.lineBuf === '' && this.fenceBuf.length < 3) {
        return;
      }
      this.lineBuf += this.fenceBuf;
      this.fenceBuf = '';
      return;
    }

    if (char === '\n') {
      if (this.lineBuf || this.fenceBuf) {
        this.codeLines.push((this.lineBuf + this.fenceBuf).slice(0, -this.fenceBuf.length));
        this.lineBuf = '';
        this.fenceBuf = '';
      } else {
        this.codeLines.push('');
      }
      return;
    }

    this.lineBuf += char;
  }

  _emitCode() {
    if (this.codeLines.length > 0 || this.lineBuf) {
      if (this.lineBuf) this.codeLines.push(this.lineBuf);
      this.lineBuf = '';
      this.fenceBuf = '';

      const highlighted = this.codeLines.length
        ? highlightLines(this.codeLines, this.lang).join('\n')
        : '';

      const lang = this.lang ? ` ${this.lang} ` : ' ';
      const sep = kleur.cyan(lang + '─'.repeat(Math.max(0, 36 - lang.length)));
      const content = highlighted
        ? '\n' + kleur.bgBlack().white(' ' + highlighted.split('\n').join('\n ')) + '\n'
        : '';
      const fence = kleur.bgBlack().cyan('```');
      this.write(`\n${fence}${sep}${content}${fence}`);
    }
  }
}