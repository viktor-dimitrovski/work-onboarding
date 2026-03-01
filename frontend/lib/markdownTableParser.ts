export type MarkdownTable = {
  headers: string[];
  rows: string[][];
};

function isProbablyVersionToken(token: string): boolean {
  const t = (token || '').trim();
  if (!t) return false;
  if (/^sha256:[0-9a-f]{12,}$/i.test(t)) return true;
  if (/^[vV]?\d+\.\d+(\.\d+)?([-.+][0-9A-Za-z._-]+)?$/.test(t)) return true;
  return false;
}

function looksLikeImageRef(token: string): boolean {
  const t = (token || '').trim().replace(/,$/, '');
  if (!t) return false;
  if (t.includes('@sha256:')) return true;
  const lastSlash = t.lastIndexOf('/');
  const lastColon = t.lastIndexOf(':');
  if (lastColon !== -1 && lastColon > lastSlash) {
    // Avoid time-like tokens
    if (/^\d{1,2}:\d{2}$/.test(t)) return false;
    // image:tag or registry/repo/image:tag
    if (t.includes('/')) return true;
    // short image refs like redis:7.2 or nginx:1.27.1
    return /^[a-z0-9][a-z0-9._-]*:[0-9A-Za-z][0-9A-Za-z._-]*$/i.test(t);
  }
  return false;
}

function extractVersionFromImageRef(token: string): string {
  const raw = (token || '').trim().replace(/^['"]|['"]$/g, '').replace(/,$/, '');
  if (!raw) return '';
  const first = raw.split(',')[0]?.trim() || raw;

  const atIndex = first.indexOf('@');
  if (atIndex !== -1) {
    const digest = first.slice(atIndex + 1).trim();
    return digest;
  }

  const lastSlash = first.lastIndexOf('/');
  const lastColon = first.lastIndexOf(':');
  if (lastColon !== -1 && lastColon > lastSlash) {
    return first.slice(lastColon + 1).trim();
  }

  if (isProbablyVersionToken(first)) return first;
  return '';
}

function stripImageRefToComponent(token: string): string {
  const raw = (token || '').trim().replace(/^['"]|['"]$/g, '').replace(/,$/, '');
  if (!raw) return '';
  const first = raw.split(',')[0]?.trim() || raw;

  const atIndex = first.indexOf('@');
  const base = atIndex !== -1 ? first.slice(0, atIndex) : first;
  const lastSlash = base.lastIndexOf('/');
  const lastColon = base.lastIndexOf(':');
  if (lastColon !== -1 && lastColon > lastSlash) {
    return base.slice(0, lastColon).trim();
  }
  return base.trim();
}

export function parseKubectlOutputToTable(input: string): MarkdownTable | null {
  const text = (input || '').trim();
  if (!text) return null;

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;

  const firstTokens = lines[0].split(/\s+/);
  const firstUpper = firstTokens.map((t) => t.toUpperCase());
  const hasHeader =
    firstUpper.includes('NAME') &&
    (firstUpper.includes('READY') ||
      firstUpper.includes('STATUS') ||
      firstUpper.includes('AGE') ||
      firstUpper.includes('IMAGES') ||
      firstUpper.includes('IMAGE') ||
      firstUpper.includes('TYPE'));

  const nameIdx = hasHeader ? firstUpper.indexOf('NAME') : 0;
  const namespaceIdx = hasHeader ? firstUpper.indexOf('NAMESPACE') : -1;
  const imagesIdx = hasHeader ? Math.max(firstUpper.indexOf('IMAGES'), firstUpper.indexOf('IMAGE')) : -1;

  const start = hasHeader ? 1 : 0;
  const rows: string[][] = [];
  const seen = new Set<string>();

  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    const upper = line.toUpperCase();
    if (upper.startsWith('NAME ') || upper === 'NAME') continue;

    let columns: string[] = [];
    if (line.includes('\t')) {
      columns = line.split(/\t+/).map((c) => c.trim()).filter(Boolean);
    } else {
      columns = line.split(/\s+/).map((c) => c.trim()).filter(Boolean);
    }
    if (columns.length === 0) continue;
    if (columns.length <= nameIdx) continue;

    const name = columns[nameIdx] || '';
    if (!name) continue;

    let component = name;
    if (namespaceIdx !== -1 && namespaceIdx < nameIdx && columns.length > namespaceIdx) {
      const ns = columns[namespaceIdx];
      if (ns && ns !== '<none>') {
        component = `${ns}/${name}`;
      }
    }

    let version = '';
    if (imagesIdx !== -1 && columns.length > imagesIdx) {
      version = extractVersionFromImageRef(columns[imagesIdx] || '');
    } else {
      const imageToken = columns.find((token, idx) => idx !== nameIdx && looksLikeImageRef(token));
      if (imageToken) {
        version = extractVersionFromImageRef(imageToken);
      } else if (columns.length >= 2 && isProbablyVersionToken(columns[1])) {
        version = columns[1];
      } else if (!hasHeader && looksLikeImageRef(name)) {
        // Support plain image-ref lists like: registry.company.com/team/service:1.2.3
        version = extractVersionFromImageRef(name);
        component = stripImageRefToComponent(name) || component;
      }
    }

    if (seen.has(component)) continue;
    seen.add(component);
    rows.push([component, version]);
  }

  return rows.length ? { headers: ['Component', 'Version'], rows } : null;
}

/**
 * Parse a plain list of image references (one per line), e.g.:
 *   registry.company.com/platform/localization:1.8.10
 *   registry.company.com/platform/shell-ui:15.1.19
 */
export function parseImageRefListToTable(input: string): MarkdownTable | null {
  const lines = (input || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;

  const rows: string[][] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const raw = line.trim();
    let component = raw;
    let version = '';

    const atIndex = raw.indexOf('@');
    if (atIndex !== -1) {
      const beforeAt = raw.slice(0, atIndex).trim();
      const digest = raw.slice(atIndex + 1).trim();
      if (beforeAt) component = beforeAt;
      if (digest) version = digest;
    } else {
      const lastSlash = raw.lastIndexOf('/');
      const lastColon = raw.lastIndexOf(':');
      if (lastColon !== -1 && lastColon > lastSlash) {
        component = raw.slice(0, lastColon).trim();
        version = raw.slice(lastColon + 1).trim();
      }
    }

    if (!component) continue;
    if (seen.has(component)) continue;
    seen.add(component);
    rows.push([component, version]);
  }

  return rows.length ? { headers: ['Component', 'Version'], rows } : null;
}

function splitRow(line: string): string[] {
  const trimmed = line.trim();
  const noEdges = trimmed.replace(/^\|/, '').replace(/\|$/, '');
  return noEdges.split('|').map((cell) => cell.trim());
}

function normalizeRow(row: string[], length: number): string[] {
  const next = [...row];
  while (next.length < length) next.push('');
  if (next.length > length) return next.slice(0, length);
  return next;
}

export function parseMarkdownTable(input: string): MarkdownTable | null {
  const lines = (input || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return null;
  const header = splitRow(lines[0]);
  const separator = lines[1];
  if (!header.length || !separator.includes('-')) return null;
  const rows = lines.slice(2).map((line) => normalizeRow(splitRow(line), header.length));
  return { headers: header, rows };
}

export function serializeMarkdownTable(table: MarkdownTable): string {
  const headers = table.headers.length ? table.headers : ['Column'];
  const headerLine = `| ${headers.join(' | ')} |`;
  const separator = `| ${headers.map(() => '---').join(' | ')} |`;
  const rows = table.rows.map((row) => `| ${normalizeRow(row, headers.length).join(' | ')} |`);
  return [headerLine, separator, ...rows].join('\n');
}
