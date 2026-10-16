// Fills public/ with the media the composition needs:
// - original.mp4: the English render. Its footage, photographic insets, logo
//   animation and soundtrack are reused; every text is redrawn by Remotion.
// - outro-tagline-bg.png: a clean background patch that hides the English
//   tagline of the logo animation so the localized one can be drawn on top.
// - Brand icons from the repository's assets/ folder.
//
// Usage: node scripts/prepare-media.mjs [path/to/original.mp4]
import {execFileSync} from 'node:child_process';
import {copyFileSync, existsSync, mkdirSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(root, '../..');
const pub = resolve(root, 'public');
const source = resolve(
	process.argv[2] ??
		resolve(repo, 'www/ibc_demostrations/Universal Mediasync For Youtube.mp4'),
);

if (!existsSync(source)) {
	console.error(`Original video not found: ${source}`);
	process.exit(1);
}
mkdirSync(pub, {recursive: true});

copyFileSync(source, resolve(pub, 'original.mp4'));
copyFileSync(resolve(repo, 'assets/icon.png'), resolve(pub, 'app-icon.png'));
copyFileSync(resolve(repo, 'assets/splash-icon.png'), resolve(pub, 'logo.png'));

// 124.9 s: the logo is complete but the tagline line has not appeared yet.
execFileSync('ffmpeg', [
	'-v', 'error', '-y', '-ss', '124.9', '-i', source, '-frames:v', '1',
	'-vf', 'crop=1000:110:860:722', resolve(pub, 'outro-tagline-bg.png'),
]);

console.log(`Media ready in ${pub}`);
