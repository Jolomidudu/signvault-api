import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

const FONT_FAMILIES: Record<string, string> = {
  serif: 'Georgia, serif',
  script: 'cursive',
  'modern-script': 'cursive',
  'sans-serif': 'Arial, sans-serif',
};

const STYLES = new Set(['CLASSIC', 'ELEGANT', 'MODERN', 'MINIMAL']);

export type RenderableSignatureVersion = {
  displayText: string;
  style: string;
  design: Prisma.JsonValue;
};

function escapeXml(value: string) {
  const validXmlCharacters = Array.from(value)
    .filter((character) => {
      const codePoint = character.codePointAt(0)!;
      return (
        codePoint === 0x9 ||
        codePoint === 0xa ||
        codePoint === 0xd ||
        (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
        (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
        (codePoint >= 0x10000 && codePoint <= 0x10ffff)
      );
    })
    .join('');

  return validXmlCharacters
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function boundedNumber(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
}

@Injectable()
export class SignatureSvgRenderer {
  render(version: RenderableSignatureVersion): Buffer {
    if (!STYLES.has(version.style) || typeof version.design !== 'object' || version.design === null) {
      throw new Error('Unsupported signature design.');
    }

    const design = version.design as Record<string, unknown>;
    const fontFamily = design.fontFamily;
    const fontSize = design.fontSize;
    const fontWeight = design.fontWeight;
    const letterSpacing = design.letterSpacing;
    const slant = design.slant;
    const rotation = design.rotation;
    const strokeWidth = design.strokeWidth;

    if (
      typeof fontFamily !== 'string' ||
      !Object.hasOwn(FONT_FAMILIES, fontFamily) ||
      !boundedNumber(fontSize, 8, 120) ||
      ![300, 400, 500, 600, 700].includes(fontWeight as number) ||
      !boundedNumber(letterSpacing, -10, 20) ||
      !boundedNumber(slant, -45, 45) ||
      !boundedNumber(rotation, -180, 180) ||
      !boundedNumber(strokeWidth, 0.1, 12) ||
      typeof version.displayText !== 'string' ||
      version.displayText.length === 0 ||
      version.displayText.length > 500
    ) {
      throw new Error('Unsupported signature design.');
    }

    const textLength = Math.min(1100, Math.max(1, version.displayText.length * fontSize * 0.72));
    const svg = [
      '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="300" viewBox="0 0 1200 300">',
      '<g transform="rotate(', rotation, ' 600 150) skewX(', slant, ')">',
      '<text x="600" y="150" dominant-baseline="middle" text-anchor="middle"',
      ' textLength="', textLength, '" lengthAdjust="spacingAndGlyphs"',
      ' font-family="', FONT_FAMILIES[fontFamily], '"',
      ' font-size="', fontSize, '" font-weight="', fontWeight, '"',
      ' letter-spacing="', letterSpacing, '" fill="#111111"',
      ' stroke="#111111" stroke-width="', strokeWidth, '" paint-order="stroke">',
      escapeXml(version.displayText),
      '</text></g></svg>',
    ].join('');

    const result = Buffer.from(svg, 'utf8');
    if (result.byteLength > 64 * 1024) {
      throw new Error('Rendered signature asset is too large.');
    }
    return result;
  }
}