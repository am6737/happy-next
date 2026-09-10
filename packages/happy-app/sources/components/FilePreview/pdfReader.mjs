import {
    getDocument,
    GlobalWorkerOptions,
    TextLayer,
} from 'pdfjs-dist/legacy/build/pdf.mjs';

const config = JSON.parse(document.getElementById('payload').textContent);
const labels = config.labels;
// Accept only a display preference from the embedding window, never commands or content.
window.addEventListener('message', (event) => {
    if (event.source !== window.parent || event.data?.type !== 'preview-theme' || typeof event.data.dark !== 'boolean') return;
    document.documentElement.classList.toggle('preview-dark', event.data.dark);
});
const themeStyle = document.createElement('style');
themeStyle.textContent = `.preview-dark{color-scheme:dark}.preview-dark body,.preview-dark #viewport{background:#202124;color:#e5e7eb}.preview-dark .toolbar,.preview-dark #status{background:#292b30;color:#e5e7eb;border-color:#62666c}.preview-dark button,.preview-dark input{background:#303238;color:#e5e7eb;border-color:#62666c}.preview-dark button:hover{background:#44474e}.preview-dark #canvas{filter:invert(1) hue-rotate(180deg)}`;
document.head.append(themeStyle);
const bytes = (value) =>
    Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
const workerUrl = URL.createObjectURL(
    new Blob([__PDF_WORKER__], { type: 'text/javascript' })
);
GlobalWorkerOptions.workerPort = new Worker(workerUrl);
class CMaps {
    async fetch({ name }) {
        return {
            cMapData: bytes(__PDF_ASSETS__[`cmaps/${name}.bcmap`]),
            compressionType: 1,
        };
    }
}
class Fonts {
    async fetch({ filename }) {
        return bytes(__PDF_ASSETS__[`standard_fonts/${filename}`]);
    }
}
class Wasm {
    async fetch({ filename }) {
        return bytes(__PDF_ASSETS__[`wasm/${filename}`]);
    }
}
const $ = (id) => document.getElementById(id);
for (const element of document.querySelectorAll('[data-label]')) {
    element.title = labels[element.dataset.label];
    element.setAttribute('aria-label', element.title);
}
for (const element of document.querySelectorAll('[data-icon]'))
    element.textContent = String.fromCodePoint(
        __PDF_ICONS__[element.dataset.icon]
    );
$('search').placeholder = labels.search;
const status = $('status');
status.textContent = labels.loading;
for (const control of document.querySelectorAll('button,input'))
    control.disabled = true;
let pdf,
    pageNumber = 1,
    zoom = 1,
    rendering,
    generation = 0,
    searchGeneration = 0,
    highlightedQuery = '';
let textLayer;
const loading = getDocument({
    data: bytes(config.base64),
    isEvalSupported: false,
    enableXfa: false,
    useWorkerFetch: false,
    CMapReaderFactory: CMaps,
    StandardFontDataFactory: Fonts,
    WasmFactory: Wasm,
    maxImageSize: 16_777_216,
    canvasMaxAreaInBytes: 32 * 1024 * 1024,
});
config.base64 = '';
$('payload').remove();
loading.onPassword = () => {
    status.textContent = labels.encrypted;
    void loading.destroy();
};

async function render() {
    if (!pdf) return;
    const current = ++generation;
    rendering?.cancel();
    textLayer?.cancel();
    try {
        if (rendering) await rendering.promise.catch(() => {});
        const page = await pdf.getPage(pageNumber);
        if (current !== generation) return;
        const original = page.getViewport({ scale: 1 });
        const fit =
            Math.max(100, $('viewport').clientWidth - 24) / original.width;
        const viewport = page.getViewport({ scale: fit * zoom });
        const ratio = Math.min(
            devicePixelRatio || 1,
            2,
            Math.sqrt(8_000_000 / (viewport.width * viewport.height))
        );
        const canvas = $('canvas');
        canvas.width = Math.max(1, Math.floor(viewport.width * ratio));
        canvas.height = Math.max(1, Math.floor(viewport.height * ratio));
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        const container = $('page');
        container.style.width = `${viewport.width}px`;
        container.style.height = `${viewport.height}px`;
        container.style.setProperty('--scale-factor', String(viewport.scale));
        container.style.setProperty(
            '--total-scale-factor',
            String(viewport.scale)
        );
        $('text').replaceChildren();
        rendering = page.render({
            canvasContext: canvas.getContext('2d'),
            canvas,
            viewport,
            transform: [ratio, 0, 0, ratio, 0, 0],
            annotationMode: 0,
        });
        await rendering.promise;
        if (current !== generation) return;
        const textContent = await page.getTextContent();
        if (current !== generation) return;
        textLayer = new TextLayer({
            textContentSource: textContent,
            container: $('text'),
            viewport,
        });
        await textLayer.render();
        if (current !== generation) return;
        if (highlightedQuery) {
            for (const span of $('text').querySelectorAll('span')) {
                if (
                    span.textContent
                        .toLocaleLowerCase()
                        .includes(highlightedQuery)
                )
                    span.classList.add('match');
            }
        }
        $('number').value = String(pageNumber);
        $('total').textContent = `/ ${pdf.numPages}`;
        $('previous').disabled = pageNumber <= 1;
        $('next').disabled = pageNumber >= pdf.numPages;
        $('zoom-out').disabled = zoom <= 0.5;
        $('zoom-in').disabled = zoom >= 3;
        status.textContent = '';
        page.cleanup();
    } catch (error) {
        if (
            current === generation &&
            error.name !== 'RenderingCancelledException' &&
            error.name !== 'AbortException'
        )
            status.textContent = labels.renderError;
    }
}

$('previous').onclick = () => {
    pageNumber = Math.max(1, pageNumber - 1);
    void render();
};
$('next').onclick = () => {
    pageNumber = Math.min(pdf?.numPages || 1, pageNumber + 1);
    void render();
};
$('number').onchange = () => {
    pageNumber = Math.max(
        1,
        Math.min(
            pdf?.numPages || 1,
            Number.parseInt($('number').value, 10) || 1
        )
    );
    void render();
};
$('zoom-in').onclick = () => {
    zoom = Math.min(3, zoom + 0.25);
    void render();
};
$('zoom-out').onclick = () => {
    zoom = Math.max(0.5, zoom - 0.25);
    void render();
};
$('fit').onclick = () => {
    zoom = 1;
    void render();
};
$('find').onclick = async () => {
    if (!pdf) return;
    const query = $('search').value.trim().toLocaleLowerCase();
    if (!query) return;
    highlightedQuery = query;
    const current = ++searchGeneration;
    status.textContent = labels.loading;
    try {
        for (let i = 1; i <= pdf.numPages; i++) {
            if (current !== searchGeneration) return;
            const number = ((pageNumber - 1 + i) % pdf.numPages) + 1;
            const page = await pdf.getPage(number);
            const content = await page.getTextContent();
            if (current !== searchGeneration) return;
            const text = content.items.map((item) => item.str || '').join(' ');
            if (number !== pageNumber) page.cleanup();
            if (text.toLocaleLowerCase().includes(query)) {
                pageNumber = number;
                await render();
                return;
            }
        }
        status.textContent = labels.notFound;
    } catch {
        if (current === searchGeneration)
            status.textContent = labels.renderError;
    }
};
$('search').onkeydown = (event) => {
    if (event.key === 'Enter') $('find').click();
};
let resizeTimer,
    previousWidth = 0;
new ResizeObserver(() => {
    const width = $('viewport').clientWidth;
    if (width === previousWidth) return;
    previousWidth = width;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => void render(), 150);
}).observe($('viewport'));
window.addEventListener('pagehide', () => {
    ++searchGeneration;
    ++generation;
    rendering?.cancel();
    textLayer?.cancel();
    void loading.destroy();
    GlobalWorkerOptions.workerPort?.terminate();
    URL.revokeObjectURL(workerUrl);
});
loading.promise
    .then((document) => {
        pdf = document;
        for (const control of window.document.querySelectorAll('button,input'))
            control.disabled = false;
        $('number').max = String(pdf.numPages);
        return render();
    })
    .catch((error) => {
        if (!status.textContent.includes(labels.encrypted))
            status.textContent =
                error.name === 'PasswordException'
                    ? labels.encrypted
                    : labels.unsupported;
    });
