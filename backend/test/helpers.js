import JSZip from 'jszip';

// Builds a minimal but valid single-font PDF. `pages` is an array of pages, each an array of
// text lines; an empty string adds a blank line (a paragraph gap).
export function makePdf(pages, { title = 'Test PDF', author = 'Tester' } = {}) {
  const objects = [];
  const add = (body) => objects.push(body) && objects.length;

  const catalog = add(null);
  const pagesObj = add(null);
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const info = add(`<< /Title (${title}) /Author (${author}) >>`);

  const pageIds = pages.map((lines) => {
    let y = 750;
    const ops = ['BT', '/F1 12 Tf'];
    for (const line of lines) {
      if (line) ops.push(`1 0 0 1 72 ${y} Tm (${line.replace(/[()\\]/g, '\\$&')}) Tj`);
      y -= line ? 16 : 28;
    }
    ops.push('ET');
    const stream = ops.join('\n');
    const content = add(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
    return add(
      `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`,
    );
  });

  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objects[pagesObj - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => {
    const offset = Buffer.byteLength(pdf);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

// Builds a small EPUB 3 with a nav document, an optional cover image and the given chapters.
export async function makeEpub(chapters, { title = 'Test EPUB', author = 'Tester', withCover = true } = {}) {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  );
  const items = chapters.map((_, i) => `<item id="c${i}" href="text/ch${i + 1}.xhtml" media-type="application/xhtml+xml"/>`);
  const coverItem = withCover ? '<item id="cover" href="images/cover.png" media-type="image/png" properties="cover-image"/>' : '';
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="id">test</dc:identifier><dc:title>${title}</dc:title><dc:creator>${author}</dc:creator><dc:language>en</dc:language>
    <dc:description>&lt;p&gt;A test book.&lt;/p&gt;</dc:description>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    ${coverItem}
    ${items.join('\n    ')}
  </manifest>
  <spine>${chapters.map((_, i) => `<itemref idref="c${i}"/>`).join('')}</spine>
</package>`,
  );
  zip.file(
    'OEBPS/nav.xhtml',
    `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol>${chapters
      .map((c, i) => `<li><a href="text/ch${i + 1}.xhtml">${c.title}</a></li>`)
      .join('')}</ol></nav></body></html>`,
  );
  chapters.forEach((chapter, i) => {
    zip.file(
      `OEBPS/text/ch${i + 1}.xhtml`,
      `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title></head><body><h1>${chapter.title}</h1>${chapter.paragraphs
        .map((p) => `<p>${p}</p>`)
        .join('')}</body></html>`,
    );
  });
  if (withCover) zip.file('OEBPS/images/cover.png', Buffer.from('89504e470d0a1a0a', 'hex'));
  return zip.generateAsync({ type: 'nodebuffer' });
}
