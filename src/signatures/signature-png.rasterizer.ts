import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const DISTRIBUTION_FONT_DIRECTORY = join(process.cwd(), 'dist', 'signatures', 'fonts');
const SOURCE_FONT_DIRECTORY = join(process.cwd(), 'src', 'signatures', 'fonts');
const FONT_DIRECTORY = existsSync(DISTRIBUTION_FONT_DIRECTORY)
  ? DISTRIBUTION_FONT_DIRECTORY
  : SOURCE_FONT_DIRECTORY;
const FONT_FILES = [
  join(FONT_DIRECTORY, 'caveat', 'Caveat.ttf'),
  join(FONT_DIRECTORY, 'noto-sans', 'NotoSans.ttf'),
  join(FONT_DIRECTORY, 'noto-serif', 'NotoSerif.ttf'),
];
const PNG_FONT_FAMILIES: Record<string, string> = {
  'Georgia, serif': 'Noto Serif',
  cursive: 'Caveat',
  'Arial, sans-serif': 'Noto Sans',
};

function useBundledFontFamilies(svg: Buffer) {
  const markup = svg.toString('utf8').replace(/font-family="([^"]+)"/g, (_attribute, family: string) => {
    const bundledFamily = PNG_FONT_FAMILIES[family];
    if (!bundledFamily) throw new Error('Unsupported canonical font family.');
    return `font-family="${bundledFamily}"`;
  });
  return Buffer.from(markup, 'utf8');
}

export function rasterizeSignatureSvg(svg: Buffer, scale: number) {
  if (!FONT_FILES.every(existsSync)) throw new Error('Bundled signature fonts are unavailable.');

  return new Resvg(useBundledFontFamilies(svg), {
    fitTo: { mode: 'width', value: 1200 * scale },
    font: {
      fontFiles: FONT_FILES,
      loadSystemFonts: false,
      defaultFontFamily: 'Noto Sans',
    },
  })
    .render()
    .asPng();
}