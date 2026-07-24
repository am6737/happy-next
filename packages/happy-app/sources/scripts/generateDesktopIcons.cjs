const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const sharp = require('sharp');

const projectRoot = path.resolve(__dirname, '../..');
const assetsDirectory = path.join(projectRoot, 'sources/assets/images');
const iconsDirectory = path.join(projectRoot, 'src-tauri/icons');
const masterPath = path.join(assetsDirectory, 'icon.png');
const macosAdaptiveIconDirectory = path.join(iconsDirectory, 'HappyNext.icon');
const macosAdaptiveIconAssetsDirectory = path.join(macosAdaptiveIconDirectory, 'Assets');

const BACKGROUND = '#18171c';
const MASTER_SIZE = 1024;
const FULL_MARK_BOUNDS = { left: 282, top: 200, width: 460, height: 625 };

function roundedRectSvg(size, inset, radius) {
    const dimension = size - inset * 2;
    return Buffer.from(`
        <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
          <rect x="${inset}" y="${inset}" width="${dimension}" height="${dimension}"
            rx="${radius}" ry="${radius}" fill="${BACKGROUND}"/>
        </svg>
    `);
}

function simplifiedMarkSvg(width) {
    const height = Math.round(width * 456 / 334);
    return {
        height,
        input: Buffer.from(`
            <svg width="${width}" height="${height}" viewBox="0 0 334 456" xmlns="http://www.w3.org/2000/svg">
              <g fill="#fff">
                <rect x="0" y="0" width="96" height="456"/>
                <rect x="238" y="0" width="96" height="456"/>
                <rect x="0" y="184" width="334" height="88"/>
              </g>
            </svg>
        `),
    };
}

async function extractFullMark() {
    const { data, info } = await sharp(masterPath)
        .extract(FULL_MARK_BOUNDS)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    const output = Buffer.alloc(info.width * info.height * 4);
    const background = [24, 23, 28];

    for (let pixel = 0; pixel < info.width * info.height; pixel += 1) {
        const offset = pixel * 4;
        const alpha = Math.max(0, Math.min(1, (
            (data[offset] - background[0]) / (255 - background[0])
            + (data[offset + 1] - background[1]) / (255 - background[1])
            + (data[offset + 2] - background[2]) / (255 - background[2])
        ) / 3));
        output[offset] = 255;
        output[offset + 1] = 255;
        output[offset + 2] = 255;
        output[offset + 3] = Math.round(alpha * 255);
    }

    return sharp(output, {
        raw: { width: info.width, height: info.height, channels: 4 },
    }).png().toBuffer();
}

async function renderIcon({ size, plateRatio, radiusRatio, markRatio, simplified }, fullMark) {
    const plateSize = Math.max(1, Math.round(size * plateRatio));
    const inset = (size - plateSize) / 2;
    const radius = Math.max(1, plateSize * radiusRatio);
    const markWidth = Math.max(3, Math.round(plateSize * markRatio));
    const mark = simplified
        ? simplifiedMarkSvg(markWidth)
        : {
            height: Math.round(markWidth * FULL_MARK_BOUNDS.height / FULL_MARK_BOUNDS.width),
            input: await sharp(fullMark).resize({ width: markWidth }).png().toBuffer(),
        };
    const left = Math.round((size - markWidth) / 2);
    const top = Math.round((size - mark.height) / 2);

    return sharp({
        create: {
            width: size,
            height: size,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
    })
        .composite([
            { input: roundedRectSvg(size, inset, radius) },
            { input: mark.input, left, top },
        ])
        .png()
        .toBuffer();
}

async function renderMacLargeMaster(fullMark) {
    return renderIcon({
        size: MASTER_SIZE,
        plateRatio: 0.8125,
        radiusRatio: 0.2,
        markRatio: 0.449,
        simplified: false,
    }, fullMark);
}

async function renderMacIcon(logicalSize, scale, fullMark, largeMaster) {
    const size = logicalSize * scale;
    if (logicalSize >= 128) {
        return size === MASTER_SIZE
            ? largeMaster
            : sharp(largeMaster).resize(size, size).png().toBuffer();
    }

    // Finder and Activity Monitor request the 16pt/32pt representations at
    // either 1x or 2x. Keep those representations optically identical: the
    // dark plate fills the bitmap and the mark stays simplified. Leaving the
    // large-icon transparent margin here makes macOS render the tiny icon as
    // artwork sitting inside an additional light system tile.
    const useSimplifiedMark = logicalSize <= 32;
    return renderIcon({
        size,
        plateRatio: 1,
        radiusRatio: 0.14,
        markRatio: 0.54,
        simplified: useSimplifiedMark,
    }, fullMark);
}

async function renderWindowsIcon(size, fullMark) {
    return renderIcon({
        size,
        plateRatio: size <= 32 ? 1 : size <= 64 ? 0.96 : 0.94,
        radiusRatio: Math.max(1.5 / size, 2 / 48),
        markRatio: size <= 32 ? 0.6 : size <= 48 ? 0.56 : 0.52,
        simplified: size <= 48,
    }, fullMark);
}

function createIco(images) {
    const header = Buffer.alloc(6);
    header.writeUInt16LE(0, 0);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(images.length, 4);
    const entries = Buffer.alloc(images.length * 16);
    let offset = header.length + entries.length;

    images.forEach(({ size, data }, index) => {
        const entryOffset = index * 16;
        entries.writeUInt8(size === 256 ? 0 : size, entryOffset);
        entries.writeUInt8(size === 256 ? 0 : size, entryOffset + 1);
        entries.writeUInt8(0, entryOffset + 2);
        entries.writeUInt8(0, entryOffset + 3);
        entries.writeUInt16LE(1, entryOffset + 4);
        entries.writeUInt16LE(32, entryOffset + 6);
        entries.writeUInt32LE(data.length, entryOffset + 8);
        entries.writeUInt32LE(offset, entryOffset + 12);
        offset += data.length;
    });

    return Buffer.concat([header, entries, ...images.map(({ data }) => data)]);
}

async function writePng(filePath, data) {
    await fs.promises.writeFile(filePath, data);
}

async function generateMacIcons(fullMark) {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'happy-next-macos-icons-'));
    const iconsetDirectory = path.join(temporaryDirectory, 'HappyNext.iconset');
    fs.mkdirSync(iconsetDirectory);
    const representations = [
        [16, 1, 'icon_16x16.png'],
        [16, 2, 'icon_16x16@2x.png'],
        [32, 1, 'icon_32x32.png'],
        [32, 2, 'icon_32x32@2x.png'],
        [128, 1, 'icon_128x128.png'],
        [128, 2, 'icon_128x128@2x.png'],
        [256, 1, 'icon_256x256.png'],
        [256, 2, 'icon_256x256@2x.png'],
        [512, 1, 'icon_512x512.png'],
        [512, 2, 'icon_512x512@2x.png'],
    ];
    const largeMaster = await renderMacLargeMaster(fullMark);

    try {
        for (const [logicalSize, scale, filename] of representations) {
            const image = await renderMacIcon(logicalSize, scale, fullMark, largeMaster);
            await writePng(path.join(iconsetDirectory, filename), image);
        }
        execFileSync('iconutil', [
            '-c', 'icns',
            iconsetDirectory,
            '-o', path.join(iconsDirectory, 'icon.icns'),
        ]);
    } finally {
        fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }

    await fs.promises.mkdir(macosAdaptiveIconAssetsDirectory, { recursive: true });
    const adaptiveGlyph = await sharp({
        create: {
            width: MASTER_SIZE,
            height: MASTER_SIZE,
            channels: 4,
            background: { r: 255, g: 255, b: 255, alpha: 0 },
        },
    })
        .composite([{
            input: fullMark,
            left: FULL_MARK_BOUNDS.left,
            top: FULL_MARK_BOUNDS.top,
        }])
        .png()
        .toBuffer();
    await writePng(path.join(macosAdaptiveIconAssetsDirectory, 'glyph.png'), adaptiveGlyph);
    await fs.promises.writeFile(
        path.join(macosAdaptiveIconDirectory, 'icon.json'),
        `${JSON.stringify({
            fill: { solid: 'srgb:0.09412,0.09020,0.10980,1.00000' },
            groups: [{
                layers: [{
                    'image-name': 'glyph.png',
                    name: 'Happy Next',
                    fill: { solid: 'srgb:1.00000,1.00000,1.00000,1.00000' },
                }],
                specular: false,
                translucency: { enabled: false, value: 0 },
            }],
            'supported-platforms': { squares: ['macOS'] },
        }, null, 2)}\n`,
    );
}

async function generateWindowsIcons(fullMark) {
    const icoSizes = [16, 24, 32, 48, 64, 256];
    const icoImages = [];
    for (const size of icoSizes) {
        icoImages.push({ size, data: await renderWindowsIcon(size, fullMark) });
    }
    await fs.promises.writeFile(path.join(iconsDirectory, 'icon.ico'), createIco(icoImages));

    const pngOutputs = new Map([
        ['32x32.png', 32],
        ['128x128.png', 128],
        ['128x128@2x.png', 256],
    ]);
    for (const [filename, size] of pngOutputs) {
        await writePng(path.join(iconsDirectory, filename), await renderWindowsIcon(size, fullMark));
    }
}

async function main() {
    const metadata = await sharp(masterPath).metadata();
    if (metadata.width !== MASTER_SIZE || metadata.height !== MASTER_SIZE) {
        throw new Error(`Desktop icon master must be ${MASTER_SIZE}x${MASTER_SIZE}`);
    }
    const fullMark = await extractFullMark();
    await generateMacIcons(fullMark);
    await generateWindowsIcons(fullMark);
    console.log('Generated independent macOS and Windows desktop icons.');
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
