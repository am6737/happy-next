const fs = require('node:fs');
const path = require('node:path');
const { buildSync } = require('esbuild');

module.exports = function buildFilePreview() {
    const root = path.resolve(__dirname, '../..');
    const pdfRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));
    const iconsRoot = path.dirname(
        require.resolve('@expo/vector-icons/package.json')
    );
    const assets = {};
    for (const folder of ['cmaps', 'standard_fonts', 'wasm']) {
        for (const filename of fs.readdirSync(path.join(pdfRoot, folder))) {
            if (!/\.(bcmap|ttf|pfb|wasm)$/.test(filename)) continue;
            assets[`${folder}/${filename}`] = fs
                .readFileSync(path.join(pdfRoot, folder, filename))
                .toString('base64');
        }
    }
    const worker = buildSync({
        entryPoints: [path.join(pdfRoot, 'legacy/build/pdf.worker.mjs')],
        bundle: true,
        format: 'iife',
        minify: true,
        write: false,
    }).outputFiles[0].text;
    const icons = JSON.parse(
        fs.readFileSync(
            path.join(
                iconsRoot,
                'build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json'
            ),
            'utf8'
        )
    );
    const script = buildSync({
        entryPoints: [
            path.join(root, 'sources/components/FilePreview/pdfReader.mjs'),
        ],
        bundle: true,
        format: 'iife',
        minify: true,
        write: false,
        define: {
            __PDF_WORKER__: JSON.stringify(worker),
            __PDF_ASSETS__: JSON.stringify(assets),
            __PDF_ICONS__: JSON.stringify(icons),
        },
    }).outputFiles[0].text;
    const font = fs
        .readFileSync(
            path.join(
                iconsRoot,
                'build/vendor/react-native-vector-icons/Fonts/Ionicons.ttf'
            )
        )
        .toString('base64');
    const css = fs.readFileSync(
        path.join(pdfRoot, 'web/pdf_viewer.css'),
        'utf8'
    );
    const button = (id, label, icon) =>
        `<button id="${id}" data-label="${label}"><span class="icon" data-icon="${icon}"></span></button>`;
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-happy-pdf-reader' blob: 'wasm-unsafe-eval'; worker-src blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><style>${css}
@font-face{font-family:PreviewIcons;src:url(data:font/ttf;base64,${font})}*{box-sizing:border-box}html,body{height:100%;margin:0;font:14px system-ui,sans-serif;color:#202124;background:#eceeef;letter-spacing:0}body{display:flex;flex-direction:column}.toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:8px;border-bottom:1px solid #cdd1d5;background:#fff}.icon{font:20px PreviewIcons}button{width:34px;height:34px;border:1px solid #cdd1d5;border-radius:4px;background:white;color:#202124;cursor:pointer}button:hover{background:#eef2f5}button:disabled{opacity:.4;cursor:default}input{height:34px;min-width:0;border:1px solid #cdd1d5;border-radius:4px;padding:4px 8px;font:14px system-ui}#number{width:64px}#search{width:150px;flex:1;min-width:140px}#total{min-width:36px}#viewport{flex:1;min-height:0;overflow:auto;padding:12px}#page{position:relative;margin:auto;background:white}#canvas{display:block}#status{padding:0 12px;background:#fff;overflow-wrap:anywhere}#status:not(:empty){padding:8px 12px}.textLayer .match{background:#ffd85e99}
</style></head><body><div class="toolbar">${button('previous', 'previous', 'chevron-back')}<input id="number" data-label="page" type="number" min="1" value="1"><span id="total"></span>${button('next', 'next', 'chevron-forward')}${button('zoom-out', 'zoomOut', 'remove')}${button('zoom-in', 'zoomIn', 'add')}${button('fit', 'fit', 'scan-outline')}<input id="search" data-label="search" type="search">${button('find', 'search', 'search')}</div><div id="status" role="status"></div><div id="viewport"><div id="page"><canvas id="canvas"></canvas><div id="text" class="textLayer"></div></div></div><script id="payload" type="application/json">__HAPPY_DOCUMENT__</script><script nonce="happy-pdf-reader">${script.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
    const output = path.join(
        root,
        'sources/components/FilePreview/generated/pdfReader.html'
    );
    fs.mkdirSync(path.dirname(output), { recursive: true });
    if (!fs.existsSync(output) || fs.readFileSync(output, 'utf8') !== html)
        fs.writeFileSync(output, html);
};
if (require.main === module) module.exports();
