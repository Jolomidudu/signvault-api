import { SignatureSvgRenderer } from './signature-svg.renderer';

describe('SignatureSvgRenderer', () => {
  const renderer = new SignatureSvgRenderer();
  const version = {
    displayText: 'Ada Lovelace',
    style: 'ELEGANT',
    design: {
      fontFamily: 'script',
      fontSize: 48,
      fontWeight: 400,
      letterSpacing: 1,
      slant: 8,
      rotation: -3,
      strokeWidth: 0.5,
    },
  };

  it('renders a transparent SVG with the supported designer styling', () => {
    const svg = renderer.render(version).toString('utf8');

    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('font-family="cursive"');
    expect(svg).toContain('Ada Lovelace');
    expect(svg).not.toMatch(/<rect|<script|foreignObject|@font-face/i);
  });

  it('escapes markup-shaped display text and emits no executable elements', () => {
    const svg = renderer.render({ ...version, displayText: '<script>alert("x")</script>' }).toString('utf8');

    expect(svg).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(svg).not.toMatch(/<(?:script|foreignObject)\b|\son[a-z]+\s*=|(?:href|src)=|url\(|@import/i);
  });

  it('rejects unsupported styles and designer values', () => {
    expect(() => renderer.render({ ...version, style: '<script/>' })).toThrow();
    expect(() =>
      renderer.render({ ...version, design: { ...version.design, fontFamily: 'url(https://evil)' } }),
    ).toThrow();
    expect(() => renderer.render({ ...version, design: { ...version.design, rotation: 999 } })).toThrow();
  });
});