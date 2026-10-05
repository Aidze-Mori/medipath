import type { TextItem } from 'pdfjs-dist/types/src/display/api';

export type PdfTextItem = Pick<TextItem, 'str' | 'transform' | 'width' | 'height' | 'hasEOL'>;

export function readablePdfText(items: PdfTextItem[]): string {
  const lines: Array<{ y: number; x: number; height: number; parts: Array<{ x: number; text: string; width: number; height: number }> }> = [];
  for (const item of items) {
    const x = item.transform[4];
    const y = item.transform[5];
    const height = item.height || Math.abs(item.transform[3]);
    let line = lines.find((candidate) => Math.abs(candidate.y - y) < Math.max(0.75, Math.min(2, height * 0.16, candidate.height * 0.16)));
    if (!line) {
      line = { y, x, height, parts: [] };
      lines.push(line);
    }
    line.parts.push({ x, text: item.str, width: item.width, height });
  }
  return lines
    .sort((a, b) => b.y - a.y || a.x - b.x)
    .map((line) => {
      const parts = line.parts.sort((a, b) => a.x - b.x);
      let text = '';
      for (let index = 0; index < parts.length; index++) {
        const part = parts[index], previous = parts[index - 1];
        // PDF font runs may split one word (or decimal number) into many items.
        // Insert a space only where the source geometry actually leaves a gap.
        const gap = previous ? part.x - previous.x - previous.width : 0;
        const space = previous && gap > Math.max(0.5, Math.min(previous.height, part.height) * 0.15);
        const tableGap = previous && gap > Math.max(18, Math.min(previous.height, part.height) * 1.8);
        text += `${tableGap ? '\t' : space && text && !/\s$/u.test(text) && !/^\s/u.test(part.text) ? ' ' : ''}${part.text}`;
      }
      return text.replace(/ +/g, ' ').replace(/ *\t */g, '\t').trim();
    })
    .join('\n')
    .trim();
}
