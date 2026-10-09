// redcolumn Help: an expanding contents tree (toc.js), pages written in Markdown (pages/*.md)
// and a search over every page. No build step and no dependencies, so it works offline.
(function () {
  'use strict';

  const TOC = window.HELP_TOC;
  const $ = (sel) => document.querySelector(sel);
  const pages = []; // { id, title, group: [titles] } in reading order
  const byId = new Map();
  const cache = new Map();

  function walk(nodes, trail) {
    for (const n of nodes) {
      if (n.children) walk(n.children, trail.concat(n.title));
      else {
        const p = { id: n.id, title: n.title, trail };
        pages.push(p);
        byId.set(n.id, p);
      }
    }
  }
  walk(TOC, []);

  // ---------- Markdown ----------

  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function href(target) {
    if (/^[a-z]+:|^\.\.\/|^\//i.test(target)) return target;
    return '#' + target.replace(/^#/, '');
  }

  /** Inline formatting: code, keys, menu paths, images, links, bold, italic. HTML tags pass through. */
  function inline(text) {
    const codes = [];
    // Backslash escapes: \* shows a star, and so on.
    text = text.replace(/\\([*_`[\]{}#\\])/g, (_, c) => {
      codes.push(esc(c));
      return '\u0000' + (codes.length - 1) + '\u0000';
    });
    text = text.replace(/`([^`]+)`/g, (_, c) => {
      codes.push('<code>' + esc(c) + '</code>');
      return '\u0000' + (codes.length - 1) + '\u0000';
    });
    // [[Ctrl+S]] -> keys
    text = text.replace(/\[\[([^\]]+)\]\]/g, (_, keys) =>
      keys
        .split(/\s*\+\s*(?=.)/)
        .map((k) => '<kbd>' + esc(k === 'Plus' ? '+' : k === 'BracketRight' ? ']' : k === 'BracketLeft' ? '[' : k) + '</kbd>')
        .join('+'),
    );
    // {{File > Save As}} -> menu path
    text = text.replace(/\{\{([^}]+)\}\}/g, (_, path) => '<span class="menu-path">' + path.split(/\s*>\s*/).map(esc).join('<span class="sep">›</span>') + '</span>');
    text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) => '<img src="' + src + '" alt="' + esc(alt) + '" loading="lazy">');
    text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, target) => {
      const ext = /^https?:/.test(target);
      return '<a href="' + href(target) + '"' + (ext ? ' target="_blank" rel="noopener"' : '') + '>' + label + '</a>';
    });
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/(^|[^*\w])\*([^*\s][^*]*)\*(?!\w)/g, '$1<em>$2</em>');
    return text.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[+i]);
  }

  function figure(line) {
    const m = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(line.trim());
    if (!m) return null;
    const cap = m[1] ? '<figcaption>' + inline(m[1]) + '</figcaption>' : '';
    return '<figure><img src="' + m[2] + '" alt="' + esc(m[1].replace(/[*_`]/g, '')) + '" loading="lazy">' + cap + '</figure>';
  }

  /** Renders Markdown lines to HTML (block level). */
  function blocks(lines) {
    const out = [];
    let i = 0;
    const indent = (l) => /^ */.exec(l)[0].length;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) {
        i++;
        continue;
      }
      let m;
      if ((m = /^(#{1,4})\s+(.*)$/.exec(line))) {
        const level = m[1].length;
        const text = m[2];
        const id = level > 1 ? ' id="' + slug(text) + '"' : '';
        out.push('<h' + level + id + '>' + inline(text) + '</h' + level + '>');
        i++;
        continue;
      }
      if (/^---+\s*$/.test(line)) {
        out.push('<hr>');
        i++;
        continue;
      }
      const fig = figure(line);
      if (fig) {
        out.push(fig);
        i++;
        continue;
      }
      if (/^\s*</.test(line) && !/^\s*<(kbd|code|strong|em|b|i|a|span)\b/.test(line)) {
        const html = [];
        while (i < lines.length && lines[i].trim()) html.push(lines[i++]);
        out.push(html.join('\n'));
        continue;
      }
      if (/^>/.test(line)) {
        const body = [];
        while (i < lines.length && /^>/.test(lines[i])) body.push(lines[i++].replace(/^>\s?/, ''));
        const first = body[0] || '';
        let kind = 'note';
        if (/^\*\*Tip/i.test(first)) kind = 'tip';
        else if (/^\*\*(Warning|Careful|Important)/i.test(first)) kind = 'warning';
        out.push('<div class="callout ' + kind + '">' + blocks(body) + '</div>');
        continue;
      }
      if (/^\|/.test(line)) {
        const rows = [];
        while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]);
        const cells = (r) =>
          r
            .trim()
            .replace(/^\||\|$/g, '')
            .split('|')
            .map((c) => c.trim());
        let html = '<table>';
        const hasHead = rows[1] && /^\|?\s*:?-{2,}/.test(rows[1]);
        if (hasHead) html += '<thead><tr>' + cells(rows[0]).map((c) => '<th>' + inline(c) + '</th>').join('') + '</tr></thead>';
        html += '<tbody>' + rows.slice(hasHead ? 2 : 0).map((r) => '<tr>' + cells(r).map((c) => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
        out.push(html);
        continue;
      }
      if ((m = /^(\s*)(\d+\.|[-*])\s+/.exec(line))) {
        const ordered = /\d/.test(m[2]);
        const base = m[1].length;
        const items = [];
        while (i < lines.length) {
          const l = lines[i];
          const im = /^(\s*)(\d+\.|[-*])\s+(.*)$/.exec(l);
          if (im && im[1].length === base && /\d/.test(im[2]) === ordered) {
            items.push([im[3]]);
            i++;
            continue;
          }
          if (!l.trim()) {
            // A blank line continues the item if the next line is indented under it.
            if (i + 1 < lines.length && indent(lines[i + 1]) > base && lines[i + 1].trim()) {
              items[items.length - 1].push('');
              i++;
              continue;
            }
            break;
          }
          if (indent(l) > base && items.length) {
            items[items.length - 1].push(l.slice(Math.min(indent(l), base + (ordered ? 3 : 2))));
            i++;
            continue;
          }
          break;
        }
        const tag = ordered ? 'ol class="steps"' : 'ul';
        out.push(
          '<' + tag + '>' +
            items
              .map((it) => {
                const [first, ...rest] = it;
                const firstFig = figure(first);
                const head = firstFig || '<p>' + inline(first) + '</p>';
                return '<li>' + (rest.length ? head + blocks(rest) : head) + '</li>';
              })
              .join('') +
            '</' + (ordered ? 'ol' : 'ul') + '>',
        );
        continue;
      }
      const para = [];
      while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|>|\||\s*(\d+\.|[-*])\s|---+\s*$|!\[)/.test(lines[i])) para.push(lines[i++].trim());
      if (para.length) out.push('<p>' + inline(para.join(' ')) + '</p>');
      else i++;
    }
    return out.join('\n');
  }

  function slug(text) {
    return text
      .toLowerCase()
      .replace(/<[^>]+>|[`*[\]{}]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  // ---------- Pages ----------

  function load(id) {
    if (!cache.has(id)) {
      cache.set(
        id,
        fetch('pages/' + id + '.md').then((r) => {
          if (!r.ok) throw new Error(r.status);
          return r.text();
        }),
      );
    }
    return cache.get(id);
  }

  function current() {
    const raw = decodeURIComponent(location.hash.slice(1));
    const [id, anchor] = raw.split('/');
    return { id: byId.has(id) ? id : pages[0].id, anchor };
  }

  async function show() {
    const { id, anchor } = current();
    const p = byId.get(id);
    document.title = p.title + ' · redcolumn Help';
    $('#crumbs').textContent = p.trail.join(' › ');
    const content = $('#content');
    try {
      const md = await load(id);
      content.innerHTML = blocks(md.replace(/\r/g, '').split('\n'));
    } catch {
      content.innerHTML = '<h1>' + esc(p.title) + '</h1><p class="missing">This page could not be loaded. If you are offline, open it once while online so it is saved for offline use.</p>';
    }
    const i = pages.indexOf(p);
    const prev = pages[i - 1];
    const next = pages[i + 1];
    $('#pager').innerHTML =
      (prev ? '<a class="prev" href="#' + prev.id + '"><small>← Previous</small>' + esc(prev.title) + '</a>' : '') +
      (next ? '<a class="next" href="#' + next.id + '"><small>Next →</small>' + esc(next.title) + '</a>' : '');
    markCurrent(id);
    const main = $('#main');
    const target = anchor && document.getElementById(anchor);
    if (target) target.scrollIntoView();
    else main.scrollTop = 0;
    document.body.classList.remove('nav-open');
  }

  // ---------- Contents tree ----------

  const OPEN_KEY = 'help.open';
  let open;
  try {
    open = new Set(JSON.parse(localStorage.getItem(OPEN_KEY) || '[]'));
  } catch {
    open = new Set();
  }
  const saveOpen = () => {
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify([...open]));
    } catch {}
  };

  function renderToc(nodes, path) {
    return nodes
      .map((n) => {
        if (!n.children) return '<li><a href="#' + n.id + '" data-id="' + n.id + '">' + esc(n.title) + '</a></li>';
        const key = path.concat(n.title).join('/');
        return (
          '<li class="group' + (open.has(key) ? ' open' : '') + '" data-key="' + esc(key) + '"><button type="button" aria-expanded="' + open.has(key) + '"><span class="caret">▶</span>' + esc(n.title) + '</button><ul>' +
          renderToc(n.children, path.concat(n.title)) +
          '</ul></li>'
        );
      })
      .join('');
  }

  function markCurrent(id) {
    document.querySelectorAll('.toc a.current').forEach((a) => a.classList.remove('current'));
    const a = document.querySelector('.toc a[data-id="' + id + '"]');
    if (!a) return;
    a.classList.add('current');
    // Open the groups that hold the current page.
    for (let g = a.closest('.group'); g; g = g.parentElement.closest('.group')) setOpen(g, true);
    a.scrollIntoView({ block: 'nearest' });
  }

  function setOpen(g, on) {
    g.classList.toggle('open', on);
    g.querySelector(':scope > button').setAttribute('aria-expanded', String(on));
    if (on) open.add(g.dataset.key);
    else open.delete(g.dataset.key);
    saveOpen();
  }

  $('#toc').innerHTML = renderToc(TOC, []);
  $('#toc').addEventListener('click', (e) => {
    const btn = e.target.closest('.group > button');
    if (btn) setOpen(btn.parentElement, !btn.parentElement.classList.contains('open'));
  });
  $('#expand-all').onclick = () => document.querySelectorAll('.toc .group').forEach((g) => setOpen(g, true));
  $('#collapse-all').onclick = () => document.querySelectorAll('.toc .group').forEach((g) => setOpen(g, false));

  // ---------- Search ----------

  let index = null;
  async function buildIndex() {
    if (index) return index;
    index = Promise.all(
      pages.map((p) =>
        load(p.id)
          .then((md) => ({ p, text: md.replace(/!\[[^\]]*\]\([^)]*\)|[#>*`|[\]{}]/g, ' ').replace(/\s+/g, ' ') }))
          .catch(() => ({ p, text: '' })),
      ),
    );
    return index;
  }

  async function search(q) {
    const results = $('#results');
    const toc = $('#toc');
    const tools = document.querySelector('.tree-tools');
    q = q.trim().toLowerCase();
    if (!q) {
      results.hidden = true;
      toc.hidden = false;
      tools.hidden = false;
      return;
    }
    const terms = q.split(/\s+/);
    const all = await buildIndex();
    const hits = [];
    for (const { p, text } of all) {
      const title = p.title.toLowerCase();
      const body = text.toLowerCase();
      if (!terms.every((t) => title.includes(t) || body.includes(t) || p.trail.join(' ').toLowerCase().includes(t))) continue;
      let score = 0;
      for (const t of terms) {
        if (title.includes(t)) score += 10;
        if (title.startsWith(t)) score += 5;
        score += Math.min(5, body.split(t).length - 1);
      }
      const at = body.indexOf(terms[0]);
      const snippet = at >= 0 ? (at > 40 ? '…' : '') + text.slice(Math.max(0, at - 40), at + 90) + '…' : p.trail.join(' › ');
      hits.push({ p, score, snippet });
    }
    hits.sort((a, b) => b.score - a.score);
    results.innerHTML = hits.length
      ? hits
          .slice(0, 40)
          .map((h) => '<a class="hit" href="#' + h.p.id + '"><b>' + esc(h.p.title) + '</b><small>' + esc(h.snippet) + '</small></a>')
          .join('')
      : '<div class="none">No pages match “' + esc(q) + '”. Try a shorter word.</div>';
    results.hidden = false;
    toc.hidden = true;
    tools.hidden = true;
  }

  const input = $('#search');
  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => search(input.value), 120);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      input.value = '';
      search('');
    }
    if (e.key === 'Enter') {
      const first = document.querySelector('#results .hit');
      if (first) location.hash = first.getAttribute('href');
    }
  });
  addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== input) {
      e.preventDefault();
      input.focus();
    }
  });

  // ---------- Images, phone menu ----------

  const box = $('#lightbox');
  $('#content').addEventListener('click', (e) => {
    const img = e.target.closest('figure img');
    if (!img) return;
    box.querySelector('img').src = img.src;
    box.hidden = false;
  });
  box.addEventListener('click', () => (box.hidden = true));
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') box.hidden = true;
  });
  $('.nav-toggle').addEventListener('click', () => {
    const on = document.body.classList.toggle('nav-open');
    $('.nav-toggle').setAttribute('aria-expanded', String(on));
  });

  addEventListener('hashchange', show);
  show();
})();
