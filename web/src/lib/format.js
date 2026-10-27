const esc = (s) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const inline = (s) =>
  esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');

/**
 * Minimal, safe markdown for assistant replies: paragraphs, bold/italic/code, bullet and numbered
 * lists, and small headings. Everything is HTML-escaped first, so model output can never inject markup.
 */
export function renderText(text) {
  const out = [];
  let list = null;
  const closeList = () => {
    if (!list) return;
    out.push(`<${list.tag}>${list.items.join('')}</${list.tag}>`);
    list = null;
  };
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const item = bullet ?? numbered;
    if (item) {
      const tag = bullet ? 'ul' : 'ol';
      if (list && list.tag !== tag) closeList();
      (list ??= { tag, items: [] }).items.push(`<li>${inline(item[1])}</li>`);
      continue;
    }
    closeList();
    const heading = line.match(/^#{1,4}\s+(.*)$/);
    if (heading) out.push(`<p class="h">${inline(heading[1])}</p>`);
    else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return out.join('');
}

export function formatDuration(ms) {
  if (ms == null || !Number.isFinite(ms)) return '';
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export function formatCost(usd, digits = 4) {
  if (usd == null || !Number.isFinite(usd)) return '';
  if (usd > 0 && usd < 10 ** -digits) return `<$${(10 ** -digits).toFixed(digits)}`;
  return `$${usd.toFixed(digits)}`;
}

export function timeAgo(timestamp, now = Date.now()) {
  if (!Number.isFinite(timestamp)) return '';
  const seconds = Math.max(0, (now - timestamp) / 1000);
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  if (seconds < 86400 * 7) return `${Math.floor(seconds / 86400)} d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
