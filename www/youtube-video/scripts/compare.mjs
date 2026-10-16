// Renders the given frames and stacks each one under the same frame of the
// original render, to check the recreation (top: original, bottom: Remotion).
//
// Usage: node scripts/compare.mjs [--lang=en] <frame> [frame...]
// Output: out/compare/<frame>.jpg
import {bundle} from '@remotion/bundler';
import {renderStill, selectComposition} from '@remotion/renderer';
import {execFileSync} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const lang = args.find((a) => a.startsWith('--lang='))?.slice(7) ?? 'en';
const frames = args.filter((a) => !a.startsWith('--')).map(Number);
const outDir = resolve(root, 'out/compare');
mkdirSync(outDir, {recursive: true});

const serveUrl = await bundle({entryPoint: resolve(root, 'src/index.ts')});
const composition = await selectComposition({serveUrl, id: `MediaSync-${lang}`});

for (const frame of frames) {
	const ours = resolve(outDir, `${frame}-ours.png`);
	await renderStill({serveUrl, composition, frame, output: ours});
	execFileSync('ffmpeg', [
		'-v', 'error', '-y',
		'-ss', String(frame / 30 + 0.001), '-i', resolve(root, 'public/original.mp4'),
		'-i', ours,
		'-filter_complex', '[0:v]trim=end_frame=1,scale=960:540[a];[1:v]scale=960:540[b];[a][b]vstack',
		'-frames:v', '1', resolve(outDir, `${frame}.jpg`),
	]);
	console.log(`out/compare/${frame}.jpg`);
}
