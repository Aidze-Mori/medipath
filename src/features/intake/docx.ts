import { unzipSync } from 'fflate';
import { extractImage } from './image';
import {
  checkAbort,
  INTAKE_LIMITS,
  IntakeError,
  releaseBlocks,
  type ExtractedBlock,
  type ExtractionOptions,
} from './types';
import { imageFormat } from './validation';
import type { OcrSession } from './worker';

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** Validate the central directory before the inflater can allocate buffers. */
export function inspectDocxArchive(bytes: Uint8Array): Map<string, number> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65_557); index--) {
    if (
      view.getUint32(index, true) === 0x06054b50 &&
      index + 22 + view.getUint16(index + 20, true) === bytes.length
    ) {
      end = index;
      break;
    }
  }
  if (end < 0) throw new IntakeError('corrupt', 'DOCX повреждён: структура архива не читается.');
  const count = view.getUint16(end + 10, true);
  if (
    view.getUint16(end + 4, true) ||
    view.getUint16(end + 6, true) ||
    count !== view.getUint16(end + 8, true)
  )
    throw new IntakeError('unsupported', 'Многотомные Word-архивы не поддерживаются.');
  if (count > INTAKE_LIMITS.zipEntries)
    throw new IntakeError('too_large', 'DOCX содержит слишком много вложений. Сохраните его как PDF.');
  const entries = new Map<string, number>();
  let offset = view.getUint32(end + 16, true);
  const directoryEnd = offset + view.getUint32(end + 12, true);
  if (directoryEnd !== end) throw new IntakeError('corrupt', 'DOCX содержит некорректную структуру архива.');
  let unpacked = 0;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50)
      throw new IntakeError('corrupt', 'DOCX повреждён.');
    if (view.getUint16(offset + 8, true) & 1)
      throw new IntakeError('password', 'DOCX зашифрован. Загрузите доступную копию без пароля.');
    const compressed = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (next > end) throw new IntakeError('corrupt', 'DOCX повреждён.');
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (name.includes('..') || name.startsWith('/') || name.includes('\\') || entries.has(name))
      throw new IntakeError('corrupt', 'DOCX содержит неоднозначные пути вложений.');
    unpacked += size;
    if (
      unpacked > INTAKE_LIMITS.unpackedBytes ||
      size > INTAKE_LIMITS.fileBytes ||
      size > Math.max(compressed, 1) * 200 ||
      (name.endsWith('.xml') && size > INTAKE_LIMITS.xmlBytes)
    )
      throw new IntakeError('too_large', 'Распакованный DOCX слишком велик. Сохраните документ как PDF.');
    if (/vbaProject|word\/embeddings\//i.test(name))
      throw new IntakeError(
        'unsupported',
        'DOCX содержит активные или встроенные объекты. Сохраните безопасную копию как PDF.',
      );
    entries.set(name, size);
    offset = next;
  }
  if (offset !== end || !entries.has('[Content_Types].xml') || !entries.has('word/document.xml'))
    throw new IntakeError('mismatch', 'Это ZIP-архив, а не поддерживаемый DOCX.');
  const images = [...entries.keys()].filter((name) => name.startsWith('word/media/') && !name.endsWith('/'));
  if (images.length > INTAKE_LIMITS.pages)
    throw new IntakeError('too_many_pages', 'DOCX содержит больше 5 изображений. Разделите документ.');
  return entries;
}

function xmlDocument(bytes: Uint8Array): XMLDocument {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    throw new IntakeError(
      'unsupported',
      'XML с внешними сущностями не поддерживается. Сохраните документ как PDF.',
    );
  const xml = new DOMParser().parseFromString(text, 'application/xml');
  if (xml.getElementsByTagName('parsererror').length)
    throw new IntakeError('corrupt', 'Внутренняя структура DOCX повреждена.');
  return xml;
}

function paragraphText(node: Element): string {
  if (node.namespaceURI === WORD_NS && node.localName === 't') return node.textContent ?? '';
  if (node.namespaceURI === WORD_NS && node.localName === 'tab') return '\t';
  if (node.namespaceURI === WORD_NS && ['br', 'cr'].includes(node.localName)) return '\n';
  if (node.namespaceURI === WORD_NS && ['del', 'instrText'].includes(node.localName)) return '';
  return [...node.children].map(paragraphText).join('');
}

export async function extractDocx(
  bytes: Uint8Array,
  options: ExtractionOptions,
  ocr: OcrSession,
): Promise<ExtractedBlock[]> {
  checkAbort(options.signal);
  const entries = inspectDocxArchive(bytes);
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (entry) =>
        entry.name === 'word/document.xml' ||
        entry.name === 'word/_rels/document.xml.rels' ||
        entry.name.startsWith('word/media/'),
    });
  } catch {
    throw new IntakeError('corrupt', 'Не удалось распаковать DOCX. Загрузите исходный документ.');
  }
  for (const [name, data] of Object.entries(files))
    if (data.length !== entries.get(name))
      throw new IntakeError('corrupt', 'Размер вложения DOCX не соответствует его описанию.');
  const xml = xmlDocument(files['word/document.xml']);
  const body = xml.getElementsByTagNameNS(WORD_NS, 'body')[0];
  if (!body) throw new IntakeError('corrupt', 'В DOCX отсутствует содержимое документа.');
  if (body.getElementsByTagNameNS(WORD_NS, 'altChunk').length)
    throw new IntakeError(
      'unsupported',
      'DOCX содержит встроенный документ. Сохраните все страницы как PDF.',
    );
  const relationships = new Map<string, { target: string; external: boolean }>();
  if (files['word/_rels/document.xml.rels']) {
    const rels = xmlDocument(files['word/_rels/document.xml.rels']);
    for (const rel of [...rels.documentElement.children])
      relationships.set(rel.getAttribute('Id') ?? '', {
        target: rel.getAttribute('Target') ?? '',
        external: rel.getAttribute('TargetMode') === 'External',
      });
  }
  const blocks: ExtractedBlock[] = [];
  let imageCount = 0;
  let textChars = 0;
  const addText = (text: string, label?: string) => {
    if (!text.trim()) return;
    textChars += text.length;
    if (textChars > INTAKE_LIMITS.textChars)
      throw new IntakeError('too_large', 'В DOCX больше 20 000 символов. Разделите документ.');
    const anchor = `block-${blocks.length + 1}`;
    blocks.push({
      id: anchor,
      anchor,
      method: 'native',
      originalText: text.trim(),
      warnings: label ? [label] : [],
    });
  };
  async function extractParagraph(node: Element): Promise<void> {
    checkAbort(options.signal);
    addText(paragraphText(node));
    const drawings = [
      ...node.getElementsByTagNameNS('*', 'blip'),
      ...node.getElementsByTagNameNS('*', 'imagedata'),
    ];
    for (const drawing of drawings) {
      const id =
        drawing.getAttributeNS(REL_NS, 'embed') ??
        drawing.getAttributeNS(REL_NS, 'link') ??
        drawing.getAttributeNS(REL_NS, 'id') ??
        '';
      const relationship = relationships.get(id);
      const anchor = `block-${blocks.length + 1}`;
      const target = relationship?.target.replace(/^\//, '');
      const path = target?.startsWith('word/') ? target : `word/${target ?? ''}`;
      const image =
        relationship && !relationship.external && !target?.includes('..') ? files[path] : undefined;
      imageCount++;
      if (imageCount > INTAKE_LIMITS.pages)
        throw new IntakeError('too_many_pages', 'В DOCX больше 5 изображений. Разделите документ.');
      if (!image || !imageFormat(image)) {
        blocks.push({
          id: anchor,
          anchor,
          method: 'ocr',
          originalText: '',
          warnings: [
            'Встроенное изображение недоступно или его формат не поддерживается. Внешние ссылки не загружаются.',
          ],
        });
        continue;
      }
      try {
        const block = await extractImage(
          image,
          options,
          ocr,
          imageCount,
          Math.max(1, [...entries.keys()].filter((name) => name.startsWith('word/media/')).length),
        );
        delete block.pageNumber;
        blocks.push({ ...block, id: anchor, anchor });
      } catch (error) {
        checkAbort(options.signal);
        if (error instanceof IntakeError && ['too_large', 'cancelled', 'timeout'].includes(error.code))
          throw error;
        blocks.push({
          id: anchor,
          anchor,
          method: 'ocr',
          originalText: '',
          warnings: [
            'Не удалось прочитать встроенное изображение. Сохраните документ как PDF или загрузите изображение отдельно.',
          ],
        });
      }
    }
  }
  async function walk(node: Element): Promise<void> {
    for (const child of [...node.children]) {
      if (child.namespaceURI !== WORD_NS) continue;
      if (child.localName === 'p') await extractParagraph(child);
      else if (child.localName === 'tbl') {
        for (const row of [...child.children].filter((entry) => entry.localName === 'tr')) {
          for (const cell of [...row.children].filter((entry) => entry.localName === 'tc')) await walk(cell);
        }
      } else if (['sdt', 'sdtContent'].includes(child.localName)) await walk(child);
    }
  }
  try {
    await walk(body);
    checkAbort(options.signal);
    if (!blocks.length) throw new IntakeError('empty', 'В DOCX нет доступного текста или изображений.');
    blocks[0].warnings.push(
      'DOCX прочитан по абзацам и ячейкам таблиц. Номера страниц и исходная вёрстка без рендера не определены.',
    );
    return blocks;
  } catch (error) {
    releaseBlocks(blocks);
    throw error;
  }
}
