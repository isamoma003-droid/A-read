import path from 'node:path/posix';
import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import { convert } from 'html-to-text';
import { buildSection, paragraphsFromPlainText } from './text.js';

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  textNodeName: '#text',
  isArray: (name) => ['item', 'itemref', 'navPoint', 'meta', 'creator', 'title', 'language'].includes(name),
});

const toText = (node) => {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node).trim();
  if (Array.isArray(node)) return toText(node[0]);
  return toText(node['#text']);
};

const stripTags = (html) =>
  decodeEntities(html.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();

function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

const HTML_TO_TEXT_OPTIONS = {
  wordwrap: false,
  preserveNewlines: false,
  selectors: [
    { selector: 'img', format: 'skip' },
    { selector: 'svg', format: 'skip' },
    { selector: 'a', options: { ignoreHref: true } },
    ...['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map((selector) => ({
      selector,
      options: { uppercase: false, leadingLineBreaks: 2, trailingLineBreaks: 2 },
    })),
    { selector: 'table', format: 'dataTable', options: { uppercaseHeaderCells: false } },
    { selector: 'p', options: { leadingLineBreaks: 2, trailingLineBreaks: 2 } },
    { selector: 'div', options: { leadingLineBreaks: 2, trailingLineBreaks: 2 } },
    // Render list items as their own paragraphs (no bullets) so each is read as a unit.
    { selector: 'ul', format: 'block' },
    { selector: 'ol', format: 'block' },
    { selector: 'li', format: 'block', options: { leadingLineBreaks: 2, trailingLineBreaks: 2 } },
  ],
};

async function readZipText(zip, filePath) {
  const file = zip.file(filePath) || zip.file(decodeURIComponent(filePath));
  return file ? file.async('string') : null;
}

const withoutFragment = (href) => href.split('#')[0];

// EPUB 3 navigation document: <nav epub:type="toc"><ol><li><a href>…
function parseNavToc(html, navDir) {
  const navMatch =
    html.match(/<nav\b[^>]*epub:type\s*=\s*["'][^"']*\btoc\b[^"']*["'][^>]*>([\s\S]*?)<\/nav>/i) ||
    html.match(/<nav\b[^>]*>([\s\S]*?)<\/nav>/i);
  if (!navMatch) return [];
  const entries = [];
  let depth = -1;
  const tokens = /<ol\b[^>]*>|<\/ol>|<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of navMatch[1].matchAll(tokens)) {
    const token = match[0].toLowerCase();
    if (token.startsWith('<ol')) depth++;
    else if (token.startsWith('</ol')) depth--;
    else {
      const href = match[1].match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
      const title = stripTags(match[2]);
      if (href && title) entries.push({ title, href: path.join(navDir, decodeURIComponent(href)), depth: Math.max(depth, 0) });
    }
  }
  return entries;
}

// EPUB 2 NCX: <navMap><navPoint><navLabel><text/></navLabel><content src/>…
function parseNcxToc(ncxXml, ncxDir) {
  const doc = xml.parse(ncxXml);
  const entries = [];
  const walk = (points, depth) => {
    for (const point of points || []) {
      const title = toText(point.navLabel?.text);
      const src = point.content?.['@_src'];
      if (title && src) entries.push({ title, href: path.join(ncxDir, decodeURIComponent(src)), depth });
      walk(point.navPoint, depth + 1);
    }
  };
  walk(doc?.ncx?.navMap?.navPoint, 0);
  return entries;
}

function firstHeading(html) {
  const match = html.match(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/i);
  return match ? stripTags(match[2]) : '';
}

export async function extractEpub(buffer, { language } = {}) {
  let zip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch (err) {
    throw new Error('This EPUB file is damaged or not a real EPUB', { cause: err });
  }

  const container = await readZipText(zip, 'META-INF/container.xml');
  const rootfiles = xml.parse(container || '')?.container?.rootfiles?.rootfile;
  const opfPath = (Array.isArray(rootfiles) ? rootfiles[0] : rootfiles)?.['@_full-path'];
  if (!opfPath) throw new Error('This EPUB is missing its package file (META-INF/container.xml)');

  const opfXml = await readZipText(zip, opfPath);
  if (!opfXml) throw new Error(`This EPUB is missing ${opfPath}`);
  const pkg = xml.parse(opfXml).package;
  const opfDir = path.dirname(opfPath) === '.' ? '' : path.dirname(opfPath);
  const resolve = (href) => path.join(opfDir, decodeURIComponent(href));

  const manifest = new Map();
  for (const item of pkg.manifest?.item || []) {
    manifest.set(item['@_id'], {
      id: item['@_id'],
      href: item['@_href'],
      mediaType: item['@_media-type'],
      properties: item['@_properties'] || '',
    });
  }

  const meta = pkg.metadata || {};
  const bookLanguage = toText(meta.language) || language || '';
  const metadata = {
    title: toText(meta.title),
    author: (meta.creator || []).map(toText).filter(Boolean).join(', '),
    language: bookLanguage,
    description: stripTags(toText(meta.description)).slice(0, 5000),
  };

  // Table of contents (EPUB 3 nav first, EPUB 2 NCX as fallback).
  let tocEntries = [];
  const navItem = [...manifest.values()].find((item) => item.properties.split(/\s+/).includes('nav'));
  if (navItem) {
    const navHtml = await readZipText(zip, resolve(navItem.href));
    if (navHtml) tocEntries = parseNavToc(navHtml, path.dirname(resolve(navItem.href)));
  }
  if (!tocEntries.length) {
    const ncxItem = manifest.get(pkg.spine?.['@_toc']) ||
      [...manifest.values()].find((item) => item.mediaType === 'application/x-dtbncx+xml');
    if (ncxItem) {
      const ncxXml = await readZipText(zip, resolve(ncxItem.href));
      if (ncxXml) tocEntries = parseNcxToc(ncxXml, path.dirname(resolve(ncxItem.href)));
    }
  }

  // Sections follow the spine (reading order), one per content document.
  const spine = (pkg.spine?.itemref || []).map((ref) => manifest.get(ref['@_idref'])).filter(Boolean);
  if (!spine.length) throw new Error('This EPUB has no readable content (empty spine)');

  const indexByPath = new Map(spine.map((item, i) => [resolve(item.href), i]));
  const titleByIndex = new Map();
  const toc = [];
  for (const entry of tocEntries) {
    const sectionIndex = indexByPath.get(withoutFragment(entry.href));
    if (sectionIndex === undefined) continue;
    toc.push({ title: entry.title, sectionIndex, depth: entry.depth });
    if (!titleByIndex.has(sectionIndex)) titleByIndex.set(sectionIndex, entry.title);
  }

  const sections = [];
  for (const [i, item] of spine.entries()) {
    const html = (await readZipText(zip, resolve(item.href))) || '';
    const body = html.match(/<body\b[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? html;
    const text = convert(body, HTML_TO_TEXT_OPTIONS);
    sections.push(
      buildSection({
        title: titleByIndex.get(i) || firstHeading(body) || `Section ${i + 1}`,
        paragraphs: paragraphsFromPlainText(text),
        href: item.href,
        language: bookLanguage,
      }),
    );
  }

  return { metadata, sections, toc, cover: await findCover(zip, pkg, manifest, resolve) };
}

async function findCover(zip, pkg, manifest, resolve) {
  const items = [...manifest.values()];
  let coverItem = items.find((item) => item.properties.split(/\s+/).includes('cover-image'));
  if (!coverItem) {
    const coverMeta = (pkg.metadata?.meta || []).find((m) => m['@_name'] === 'cover');
    coverItem = coverMeta && manifest.get(coverMeta['@_content']);
  }
  if (!coverItem) {
    coverItem = items.find((item) => item.mediaType?.startsWith('image/') && /cover/i.test(`${item.id} ${item.href}`));
  }
  if (!coverItem?.mediaType?.startsWith('image/')) return null;
  const file = zip.file(resolve(coverItem.href));
  if (!file) return null;
  return { buffer: await file.async('nodebuffer'), mediaType: coverItem.mediaType };
}
