/** CAD text strings to plain Unicode: control codes, special characters and MTEXT formatting. */

/** %%c, %%d, %%p, %%nnn and \U+XXXX; drops %%u / %%o (underline / overline toggles). */
export function decodeSpecial(s: string): string {
  return s
    .replace(/\\U\+([0-9a-fA-F]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\M\+[0-9a-fA-F]{5}/g, '')
    .replace(/%%(\d{3})/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/%%([cdpCDPuUoOkK%])/g, (_, c: string) => {
      switch (c.toLowerCase()) {
        case 'c':
          return 'Ø';
        case 'd':
          return '°';
        case 'p':
          return '±';
        case '%':
          return '%';
        default:
          return '';
      }
    });
}

/**
 * MTEXT contents as paragraphs of plain text. Formatting (fonts, heights, colours, tracking,
 * alignment, underline) is dropped; stacked fractions become "a/b".
 */
export function mtextParagraphs(raw: string): string[] {
  let s = decodeSpecial(raw);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === '{' || ch === '}') continue;
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const code = s[i + 1];
    if (code === undefined) break;
    i++;
    switch (code) {
      case 'P':
        out += '\n';
        break;
      case 'X':
        out += '\n';
        break;
      case '~':
        out += ' ';
        break;
      case '\\':
      case '{':
      case '}':
        out += code;
        break;
      case 'S': {
        // \Sa^b; \Sa/b; \Sa#b;
        const end = s.indexOf(';', i + 1);
        const body = end < 0 ? s.slice(i + 1) : s.slice(i + 1, end);
        out += body.replace(/[\^#]/, '/').replace(/^\s+|\s+$/g, '');
        i = end < 0 ? s.length : end;
        break;
      }
      case 'A':
      case 'C':
      case 'c':
      case 'F':
      case 'f':
      case 'H':
      case 'Q':
      case 'T':
      case 'W':
      case 'p': {
        const end = s.indexOf(';', i + 1);
        i = end < 0 ? s.length : end;
        break;
      }
      case 'L':
      case 'l':
      case 'O':
      case 'o':
      case 'K':
      case 'k':
        break;
      default:
        out += code;
    }
  }
  s = out;
  return s.split('\n');
}
