const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const projectRoot = path.resolve(__dirname, '../..');
const repositoryRoot = path.resolve(projectRoot, '../..');
const images = path.join(projectRoot, 'sources/assets/images');
const colors = { background: '#18171C', white: '#FFFFFF', ink: '#18171C', green: '#32D74B', deepGreen: '#248A3D', red: '#FF3B30' };

function markPaths(hColor) {
    return `<path d="M80 70h45v70h70V70h45v180h-45v-70h-70v70H80z" fill="${hColor}"/><path d="M178 207l62-54v38l-62 54z" fill="${colors.green}"/><path d="M198 159l42-37v38l-42 37z" fill="${colors.deepGreen}"/>`;
}
function fullIconSvg(size = 1024, active = false) {
    return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 320 320"><rect width="320" height="320" fill="${colors.background}"/>${markPaths(colors.white)}${active ? `<circle cx="260" cy="60" r="44" fill="${colors.background}"/><circle cx="260" cy="60" r="35" fill="${colors.red}"/>` : ''}</svg>`);
}
function faviconArtwork(active = false) {
    const transform = 'matrix(5.2173913 0 0 5.4468085 -322.7826 -359.4894)';
    return `<g transform="${transform}" fill="#000000" stroke="#000000" stroke-width="8" stroke-linejoin="miter"><path d="M80 70h45v70h70V70h45v180h-45v-70h-70v70H80z"/><path d="M178 207l62-54v38l-62 54z"/><path d="M198 159l42-37v38l-42 37z"/></g><g transform="${transform}">${markPaths(colors.white)}</g>${active ? '<circle cx="812" cy="212" r="212" fill="#000000"/><circle cx="812" cy="212" r="194" fill="#FF2D2D"/>' : ''}`;
}
function faviconMarkSvg(size = 1024, active = false) {
    return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">${faviconArtwork(active)}</svg>`);
}
function standaloneMarkSvg(size, hColor) {
    return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024"><g transform="translate(0 512) scale(1 .954) translate(0 -512)"><g transform="matrix(4.15625 0 0 5.1 -149.5 -300)">${markPaths(hColor)}</g></g></svg>`);
}
function splashSvg(background, hColor) {
    const transform = background
        ? 'matrix(2.6625 0 0 3.27 86 -11.2)'
        : 'matrix(3.425 0 0 4.22778 -36.5 -163.56)';
    return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${background ? `<rect width="1024" height="1024" fill="${background}"/>` : ''}<g transform="${transform}">${markPaths(hColor)}</g></svg>`);
}
function wordmarkSvg(width, height, hColor, textColor) {
    if (width === 2670) {
        return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="2670" height="523" viewBox="0 0 2670 523"><g transform="matrix(2.1875 0 0 2.5722 -143 -159.05)"><path d="M80 70h46v70h68V70h46v180h-46v-70h-68v70H80z" fill="#808080"/><path d="M178 207l62-54v38l-62 54z" fill="${colors.green}"/><path d="M198 159l42-37v38l-42 37z" fill="${colors.deepGreen}"/></g><g transform="translate(403 -29.76) scale(.97 1.07126)"><text x="0" y="475" fill="#808080" stroke="#808080" stroke-width="16" paint-order="stroke fill" font-family="Arial, Helvetica Neue, sans-serif" font-size="590" font-weight="700" letter-spacing="-18">APPY</text></g><rect x="1941" y="226" width="668" height="258" fill="#808080"/><g transform="translate(1963 40) scale(.94 1)"><text x="0" y="407" fill="#FFFFFF" stroke="#FFFFFF" stroke-width="6" paint-order="stroke fill" font-family="Arial, Helvetica Neue, sans-serif" font-size="258" font-weight="700" letter-spacing="-8">NEXT</text></g></svg>`);
    }

    const compact = width === 1902;
    const nextX = compact ? 1326 : 1318;
    const nextSize = compact ? 137 : 145;
    const content = `<g transform="matrix(2.1875 0 0 2.3444 -125 -112.11)"><path d="M80 70h48v67.5h64V70H240v180h-48v-67.5h-64V250H80z" fill="${hColor}"/><path d="M178 207l62-54v38l-62 54z" fill="${colors.green}"/><path d="M198 159l42-37v38l-42 37z" fill="${colors.deepGreen}"/></g><g transform="translate(425 0) scale(.984 1)"><text x="0" y="475" fill="${textColor}" font-family="Helvetica Neue, Arial, sans-serif" font-size="590" font-weight="900" letter-spacing="-18">APPY</text></g><g transform="translate(${nextX} -12) scale(.94 1)"><text x="0" y="461" fill="${textColor}" font-family="Helvetica Neue, Arial, sans-serif" font-size="${nextSize}" font-weight="900" letter-spacing="-4">NEXT</text></g>`;
    return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${compact ? `<g transform="matrix(.98433 0 0 1 -42.2165 0)">${content}</g>` : content}</svg>`);
}
function webWordmarkSvg(hColor, textColor) {
    const panelText = hColor.toUpperCase() === colors.white ? colors.ink : colors.white;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="2670" height="509" viewBox="0 0 2670 509" role="img" aria-label="Happy Next"><g transform="scale(1 0.9732313576)"><g transform="matrix(2.1875 0 0 2.5722 -143 -159.05)"><path d="M80 70h46v70h68V70h46v180h-46v-70h-68v70H80z" fill="${hColor}"/><path d="M178 207l62-54v38l-62 54z" fill="${colors.green}"/><path d="M198 159l42-37v38l-42 37z" fill="${colors.deepGreen}"/></g><g transform="translate(403 -29.76) scale(.97 1.07126)"><text x="0" y="475" fill="${textColor}" stroke="${textColor}" stroke-width="16" paint-order="stroke fill" font-family="Arial, Helvetica Neue, sans-serif" font-size="590" font-weight="700" letter-spacing="-18">APPY</text></g><rect x="1941" y="226" width="668" height="258" fill="${textColor}"/><g transform="translate(1963 40) scale(.94 1)"><text x="0" y="407" fill="${panelText}" stroke="${panelText}" stroke-width="6" paint-order="stroke fill" font-family="Arial, Helvetica Neue, sans-serif" font-size="258" font-weight="700" letter-spacing="-8">NEXT</text></g></g></svg>\n`;
}
function faviconSvg() {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">${faviconArtwork(false)}</svg>\n`;
}
function coreIconSvg(kind) {
    const transforms = {
        small: 'matrix(1.6923 0 0 1.7667 241.23 229.33)',
        notification: 'matrix(2.1074 0 0 2.2 -81.18 -98)',
        large: 'matrix(3.3261 0 0 3.4722 -20.18 -43.55)',
    };
    if (kind === 'adaptive' || kind === 'monochrome') {
        return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><g transform="${transforms.small}">${markPaths(colors.white)}</g></svg>`);
    }
    if (kind === 'notification') {
        return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><g transform="${transforms.notification}">${markPaths(colors.white)}</g></svg>`);
    }
    if (kind === 'tauri') {
        return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><circle cx="512" cy="516" r="466" fill="#000000" opacity=".14"/><circle cx="512" cy="504" r="466" fill="#FCF8EE" stroke="#E7E2D7" stroke-width="3"/><g transform="${transforms.large}">${markPaths(colors.ink)}</g></svg>`);
    }
    return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="${colors.background}"/><g transform="${transforms.large}">${markPaths(colors.white)}</g></svg>`);
}
function createIco(images) {
    const header = Buffer.alloc(6); header.writeUInt16LE(0,0); header.writeUInt16LE(1,2); header.writeUInt16LE(images.length,4);
    const entries = Buffer.alloc(images.length * 16); let offset = 6 + entries.length;
    images.forEach(({size,data},i)=>{const p=i*16;entries.writeUInt8(size===256?0:size,p);entries.writeUInt8(size===256?0:size,p+1);entries.writeUInt8(0,p+2);entries.writeUInt8(0,p+3);entries.writeUInt16LE(1,p+4);entries.writeUInt16LE(32,p+6);entries.writeUInt32LE(data.length,p+8);entries.writeUInt32LE(offset,p+12);offset+=data.length;});
    return Buffer.concat([header, entries, ...images.map(x=>x.data)]);
}
async function png(svg, width, height, output) { await sharp(svg, {density:384}).resize(width,height).ensureAlpha().png().toFile(output); }

async function generateFavicons() {
    await png(faviconMarkSvg(1024, false), 1024, 1024, path.join(images, 'favicon.png'));
    await png(faviconMarkSvg(1024, true), 1024, 1024, path.join(images, 'favicon-active.png'));

    const activeIco = [];
    for (const size of [16,32,48]) {
        activeIco.push({size,data:await sharp(faviconMarkSvg(size, true), {density:384}).resize(size,size).png().toBuffer()});
    }
    await fs.promises.writeFile(path.join(projectRoot,'public/favicon-active.ico'),createIco(activeIco));
    await fs.promises.writeFile(path.join(repositoryRoot,'packages/happy-web/public/favicon.svg'),faviconSvg());
    await fs.promises.writeFile(path.join(repositoryRoot,'packages/happy-docs/favicon.svg'),faviconSvg());
}

async function generateCoreIcons() {
    await png(coreIconSvg('adaptive'), 1024, 1024, path.join(images, 'icon-adaptive.png'));
    await png(coreIconSvg('monochrome'), 1024, 1024, path.join(images, 'icon-monochrome.png'));
    await png(coreIconSvg('notification'), 512, 512, path.join(images, 'icon-notification.png'));
    await png(coreIconSvg('tauri'), 1024, 1024, path.join(images, 'icon-tauri.png'));
    await png(coreIconSvg('icon'), 1024, 1024, path.join(images, 'icon.png'));
}

async function generateStandaloneLogosAndSplashes() {
    await png(standaloneMarkSvg(1024, colors.ink), 1024, 1024, path.join(images, 'logo-black.png'));
    await png(standaloneMarkSvg(1024, colors.white), 1024, 1024, path.join(images, 'logo-white.png'));
    await png(splashSvg(null, colors.ink), 1024, 1024, path.join(images, 'splash-ios-light.png'));
    await png(splashSvg(null, colors.white), 1024, 1024, path.join(images, 'splash-ios-dark.png'));
    await png(splashSvg('#F5F5F5', colors.ink), 1024, 1024, path.join(images, 'splash-android-light.png'));
    await png(splashSvg('#1E1E1E', colors.white), 1024, 1024, path.join(images, 'splash-android-dark.png'));
}

async function main() {
    if (process.argv.includes('--favicons-only')) {
        await generateFavicons();
        console.log('Generated Happy Next favicon assets.');
        return;
    }
    if (process.argv.includes('--icons-only')) {
        await generateCoreIcons();
        console.log('Generated Happy Next core icon assets.');
        return;
    }
    if (process.argv.includes('--logos-splashes-only')) {
        await generateStandaloneLogosAndSplashes();
        console.log('Generated Happy Next standalone logos and splash assets.');
        return;
    }

    await png(fullIconSvg(), 1024, 1024, path.join(projectRoot, 'logo.png'));
    await generateCoreIcons();
    await generateFavicons();
    await generateStandaloneLogosAndSplashes();

    const variants = [
        ['logotype-dark', 1965, 523, colors.ink, colors.ink],
        ['logotype-light', 1965, 523, colors.white, colors.white],
        ['logotype', 1902, 523, colors.white, colors.white],
    ];
    for (const [name,w,h,hColor,textColor] of variants) {
        for (const scale of [1,2,3]) {
            const suffix = scale === 1 ? '' : `@${scale}x`;
            await png(wordmarkSvg(w,h,hColor,textColor), w*scale, h*scale, path.join(images, `${name}${suffix}.png`));
        }
    }
    await png(wordmarkSvg(2670,523,colors.ink,colors.ink),2670,523,path.join(repositoryRoot,'.github/logotype-dark.png'));

    const trayMark = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><defs><mask id="tray-mark"><rect width="64" height="64" fill="#000"/><path d="M7 4h14v21h22V4h14v56H43V39H21v21H7z" fill="#fff"/><path d="M43 39L57 27V35L43 47Z" fill="#000"/></mask></defs><g transform="translate(32 32) scale(.95) translate(-32 -32)"><rect width="64" height="64" fill="#000" mask="url(#tray-mark)"/></g></svg>`))
        .ensureAlpha().png().toBuffer();
    await fs.promises.writeFile(path.join(projectRoot,'src-tauri/icons/tray-icon.png'),trayMark);

    await fs.promises.writeFile(path.join(repositoryRoot,'packages/happy-web/public/images/logo-dark.svg'),webWordmarkSvg(colors.white,colors.white));
    await fs.promises.writeFile(path.join(repositoryRoot,'packages/happy-web/public/images/logo-light.svg'),webWordmarkSvg(colors.ink,colors.ink));
    await fs.promises.writeFile(path.join(repositoryRoot,'packages/happy-docs/logo/dark.svg'),webWordmarkSvg(colors.white,colors.white));
    await fs.promises.writeFile(path.join(repositoryRoot,'packages/happy-docs/logo/light.svg'),webWordmarkSvg(colors.ink,colors.ink));

    console.log('Generated cross-platform Happy Next brand assets.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
