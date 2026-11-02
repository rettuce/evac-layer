// Runs inside the rendered /screen page. Kept as plain JavaScript text so the bundler adds no helpers that do not
// exist in the browser. Returns a self-contained HTML document: every stylesheet rule inlined, no scripts, no
// external links, and only the font faces the visible text needs, picked the way the browser falls back: per
// character, the first family in the element's font-family list with a face of that weight covering it.
// The language rotation is frozen on the language showing at capture time.
export const INLINE_PAGE_SCRIPT = `(async () => {
  await document.fonts.ready;
  const norm = (v) => String(v || '').replace(/["']/g, '').trim().toLowerCase();
  const parseRanges = (v) => (v ? v.split(',') : ['U+0-10FFFF']).map((part) => {
    const t = part.trim().replace(/^U\\+/i, '').split('-');
    const lo = parseInt(t[0].replace(/\\?/g, '0'), 16);
    const hi = t[1] ? parseInt(t[1], 16) : parseInt(t[0].replace(/\\?/g, 'F'), 16);
    return [lo, hi];
  });
  const faces = [];
  const css = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules;
    try { rules = sheet.cssRules; } catch (e) { throw new Error('cannot read stylesheet ' + sheet.href); }
    for (const rule of Array.from(rules)) {
      if (rule.type === CSSRule.FONT_FACE_RULE) {
        faces.push({ family: norm(rule.style.getPropertyValue('font-family')), weight: Number(rule.style.getPropertyValue('font-weight') || 400), ranges: parseRanges(rule.style.getPropertyValue('unicode-range')), rule, base: sheet.href || location.href, needed: false });
      } else {
        css.push(rule.cssText);
      }
    }
  }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node.parentElement;
    if (!el || !node.textContent.trim()) continue;
    const variant = el.closest('.lang-variant');
    if (variant && !variant.classList.contains('is-current')) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const families = cs.fontFamily.split(',').map(norm);
    const weight = Number(cs.fontWeight) || 400;
    for (const ch of Array.from(node.textContent)) {
      const cp = ch.codePointAt(0);
      if (cp <= 32) continue;
      for (const fam of families) {
        const cands = faces.filter((f) => f.family === fam && f.ranges.some(([lo, hi]) => cp >= lo && cp <= hi));
        if (!cands.length) continue;
        cands.sort((a, b) => Math.abs(a.weight - weight) - Math.abs(b.weight - weight));
        cands[0].needed = true;
        break;
      }
    }
  }
  const toDataUrl = async (url) => {
    const buf = await (await fetch(url)).arrayBuffer();
    let bin = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return 'data:font/woff2;base64,' + btoa(bin);
  };
  let fontsKept = 0;
  for (const f of faces.filter((x) => x.needed)) {
    const m = f.rule.cssText.match(/url\\(["']?([^"')]+\\.woff2)["']?\\)/);
    if (!m) { css.unshift(f.rule.cssText); continue; }
    css.unshift(f.rule.cssText.replace(/src:[^;]+;/, 'src: url(' + (await toDataUrl(new URL(m[1], f.base).href)) + ') format("woff2");'));
    fontsKept++;
  }
  const root = document.documentElement.cloneNode(true);
  root.querySelectorAll('script, link, noscript, style').forEach((el) => el.remove());
  const head = root.querySelector('head');
  const style = document.createElement('style');
  style.textContent = css.join('\\n');
  head.prepend(style);
  const meta = document.createElement('meta');
  meta.setAttribute('charset', 'utf-8');
  head.prepend(meta);
  return { html: '<!doctype html>\\n' + root.outerHTML, fontsKept, fontsDropped: faces.length - fontsKept };
})()`;
