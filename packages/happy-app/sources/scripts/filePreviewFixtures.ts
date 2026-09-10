import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import {
    buildStaticDocument,
    buildSvgDocument,
} from '../components/FilePreview/staticDocument';
import { en } from '../text/_default';

const require = createRequire(import.meta.url);
require('./buildFilePreview.cjs')();
const output = resolve(
    process.argv[2] || '../../output/playwright/file-preview'
);
mkdirSync(output, { recursive: true });

// A deterministic two-page fixture includes searchable text and a vector drawing.
function pdfFixture() {
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R /OpenAction << /S /JavaScript /JS (app.alert("unexpected")) >> >>',
        '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 500] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 500] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
        ...[
            'BT /F1 24 Tf 30 430 Td (PDF preview - page one) Tj ET 0.1 0.6 0.45 rg 30 240 320 120 re f',
            'BT /F1 24 Tf 30 430 Td (Searchable second page) Tj ET 0.8 0.2 0.3 rg 30 240 320 120 re f',
        ].map(
            (stream) =>
                `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
        ),
    ];
    let pdf = '%PDF-1.7\n';
    const offsets = [0];
    objects.forEach((object, i) => {
        offsets.push(Buffer.byteLength(pdf));
        pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xref = Buffer.byteLength(pdf);
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
        .slice(1)
        .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
        .join(
            ''
        )}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return Buffer.from(pdf).toString('base64');
}
const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 260"><rect x="30" y="30" width="340" height="180" rx="8" fill="#139d78"/><circle cx="200" cy="110" r="45" fill="#ffffff"/><text x="200" y="242" text-anchor="middle" font-size="20">SVG preview</text><script>fetch("https://example.invalid/svg-script")</script><image href="https://example.invalid/svg-image" width="10" height="10"/></svg>'
).toString('base64');
const pages = {
    'html-dark': buildStaticDocument(
        '<style>body{background:white;color:black}h1{color:#168467}</style><h1>HTML dark preview</h1><p style="background:white;color:black">Author colors are overridden for reading.</p><pre>const answer = 42;</pre><table><tr><th>Format</th><th>Status</th></tr><tr><td>HTML</td><td>Dark</td></tr></table>',
        'html',
        true
    ),
    svg: buildSvgDocument(svg, false, 1),
    html: buildStaticDocument(
        '<style>h1{color:#168467}.sample{border-left:4px solid #d04b64;padding:12px;background:#f2f3f4}body{background-image:url(https://example.invalid/css)}</style><h1>HTML preview</h1><p class="sample">Static styles and embedded content.</p><script>parent.hacked=true;fetch("https://example.invalid/script")</script><img src="https://example.invalid/image" alt="External image"><meta http-equiv="refresh" content="0;url=https://example.invalid/navigation">',
        'html'
    ),
    markdown: buildStaticDocument(
        '# Markdown preview\n\n**Bold** and *italic* text.\n\n- First item\n- Second item\n\n> A quotation\n\n| Format | Status |\n| --- | --- |\n| SVG | Preview |\n| MD | Preview |\n\n```ts\nconst answer = 42;\n```\n\n![External image](https://example.invalid/md-image)\n\n<script>parent.hacked=true</script>',
        'markdown'
    ),
    pdf: readFileSync(
        new URL(
            '../components/FilePreview/generated/pdfReader.html',
            import.meta.url
        ),
        'utf8'
    ).replace(
        '__HAPPY_DOCUMENT__',
        JSON.stringify({ base64: pdfFixture(), labels: en.files.preview })
    ),
    damaged: readFileSync(
        new URL(
            '../components/FilePreview/generated/pdfReader.html',
            import.meta.url
        ),
        'utf8'
    ).replace(
        '__HAPPY_DOCUMENT__',
        JSON.stringify({
            base64: Buffer.from('not a pdf').toString('base64'),
            labels: en.files.preview,
        })
    ),
};
for (const [name, html] of Object.entries(pages)) {
    writeFileSync(resolve(output, `${name}.html`), html);
    writeFileSync(
        resolve(output, `${name}-sandbox.html`),
        `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%}iframe{border:0;width:100%;height:100%;display:block}</style></head><body><iframe title="${name}" sandbox="${name === 'pdf' || name === 'damaged' ? 'allow-scripts' : ''}" srcdoc="${html.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></iframe></body></html>`
    );
}
console.log(`Preview fixtures: ${output}`);
