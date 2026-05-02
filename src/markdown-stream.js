import kleur from 'kleur';

/**
 * Tracks code-block state and emits styled tokens during streaming.
 * Handles ```language\n...``` and ```...``` style fences.
 */
export class MarkdownStream {
  constructor(write) {
    this.write = write; // (token, style) => void
    this.inCode = false;
    this.fenceBuf = '';
    this.codeLines = [];
    this.codeIndent = 0;
    this.lang = '';
    this.lineBuf = '';
  }

  /** Called once per streaming token. Returns true if token was consumed (e.g. fence chars). */
  accept(token) {
    for (const char of token) {
      this._acceptChar(char);
    }
    return false;
  }

  /** Finalize any open block — call after stream ends. */
  flush() {
    if (this.inCode) {
      const line = this.lineBuf;
      if (line) this.codeLines.push(line);
      this._emitCode();
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
        for (const c of this.fenceBuf.slice(0, -1)) this.write(c, null);
        this.fenceBuf = '';
        this.write(char, null);
        return;
      }
      // Outside code: emit directly
      this.write(char, null);
      return;
    }

    // Inside code block
    if (this.lineBuf === '' && char === '`') {
      this.fenceBuf += char;
      if (this.fenceBuf === '```') {
        // End of code block
        this._emitCode();
        this.inCode = false;
        this.fenceBuf = '';
        return;
      }
      this.lineBuf += this.fenceBuf;
      this.fenceBuf = '';
      return;
    }

    if (this.lineBuf === '' && this.fenceBuf.length > 0) {
      this.lineBuf += this.fenceBuf;
      this.fenceBuf = '';
    }

    if (char === '\n') {
      this.lineBuf += char;
      this.codeLines.push(this.lineBuf.slice(0, -1)); // drop \n, store line
      this.lineBuf = '';
      this.fenceBuf = '';
      return;
    }

    this.lineBuf += char;
  }

  _emitCode() {
    // Flush any remaining line
    if (this.lineBuf || this.codeLines.length > 0) {
      const last = this.lineBuf;
      if (last) this.codeLines.push(last);
      this.lineBuf = '';
      this.fenceBuf = '';
      const style = kleur.bgBlack().white;
      const langStyle = kleur.cyan;
      const lines = this.codeLines.join('\n');
      const lang = this.lang ? ` ${this.lang} ` : ' ';
      const sep = langStyle(lang + '─'.repeat(Math.max(0, 40 - lang.length)));
      const content = lines ? '\n' + style(' ' + lines.split('\n').join('\n ')) + '\n' : '';
      const fence = kleur.bgBlack().cyan('```');
      this.write(`\n${fence}${sep}${content}${fence}`, null);
    }
  }
}
