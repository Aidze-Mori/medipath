import { INTAKE_LIMITS, IntakeError, type IntakeFormat } from './types';

function starts(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

export function imageFormat(bytes: Uint8Array): 'png' | 'jpg' | null {
  if (starts(bytes, [0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10])) return 'png';
  if (starts(bytes, [0xff, 0xd8, 0xff])) return 'jpg';
  return null;
}

export function detectFormat(name: string, mime: string, bytes: Uint8Array): IntakeFormat {
  if (!bytes.length) throw new IntakeError('empty', 'Файл пуст. Выберите другой документ.');
  if (bytes.length > INTAKE_LIMITS.fileBytes)
    throw new IntakeError('too_large', 'Максимальный размер файла — 5 МБ.');
  const extension = name.split('.').pop()?.toLowerCase();
  const expected = extension === 'jpeg' ? 'jpg' : extension;
  if (extension === 'doc' || starts(bytes, [0xd0, 0xcf, 0x11, 0xe0]))
    throw new IntakeError(
      'unsupported',
      'Старый DOC пока не поддерживается. Сохраните документ как PDF или DOCX.',
    );
  if (
    extension === 'heic' ||
    extension === 'heif' ||
    new TextDecoder().decode(bytes.subarray(4, 12)).startsWith('ftyphei')
  )
    throw new IntakeError(
      'unsupported',
      'HEIC/HEIF пока не поддерживается. Экспортируйте фото в JPEG или PNG.',
    );
  if (!['txt', 'pdf', 'docx', 'jpg', 'png'].includes(expected ?? ''))
    throw new IntakeError(
      'unsupported',
      'Поддерживаются TXT, PDF, DOCX, JPEG и PNG. Для фото нужен печатный документ.',
    );
  let actual: IntakeFormat | undefined = imageFormat(bytes) ?? undefined;
  if (starts(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) actual = 'pdf';
  if (starts(bytes, [0x50, 0x4b, 0x03, 0x04])) actual = 'docx';
  if (!actual && expected === 'txt') actual = 'txt';
  if (!actual || actual !== expected)
    throw new IntakeError(
      'mismatch',
      'Содержимое файла не соответствует расширению. Загрузите исходный файл без переименования.',
    );
  const allowed: Record<IntakeFormat, string[]> = {
    pdf: ['application/pdf'],
    docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip'],
    png: ['image/png'],
    jpg: ['image/jpeg', 'image/jpg'],
    txt: ['text/plain'],
  };
  if (mime && mime !== 'application/octet-stream' && !allowed[actual].includes(mime.split(';')[0]))
    throw new IntakeError(
      'mismatch',
      'Тип файла не совпадает с его содержимым. Выберите оригинальный документ.',
    );
  return actual;
}

export function decodeText(bytes: Uint8Array): { text: string; warnings: string[] } {
  let text: string;
  const warnings: string[] = [];
  if (starts(bytes, [0xff, 0xfe]) || starts(bytes, [0xfe, 0xff])) {
    try {
      text = new TextDecoder(bytes[0] === 0xff ? 'utf-16le' : 'utf-16be', { fatal: true }).decode(bytes);
    } catch {
      throw new IntakeError('encoding', 'Повреждена кодировка UTF-16. Сохраните текст в UTF-8.');
    }
  } else {
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      text = new TextDecoder('windows-1251').decode(bytes);
      warnings.push(
        'Текст прочитан как Windows-1251. Проверьте кириллицу; при ошибках сохраните TXT в UTF-8.',
      );
    }
  }
  if ([...text].some((character) => character.charCodeAt(0) < 32 && !['\t', '\n', '\r'].includes(character)))
    throw new IntakeError('encoding', 'Файл содержит двоичные данные. Нужен текстовый TXT в UTF-8.');
  if (!text.trim()) throw new IntakeError('empty', 'В файле нет текста.');
  if (text.length > INTAKE_LIMITS.textChars)
    throw new IntakeError('too_large', 'Максимальная длина текста — 20 000 символов.');
  return { text: text.replace(/\r\n?/g, '\n'), warnings };
}

/** Read dimensions before decoding pixels so a compressed image cannot allocate unbounded memory. */
export function imageDimensions(bytes: Uint8Array): { width: number; height: number } {
  const format = imageFormat(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  if (format === 'png' && bytes.length >= 24) {
    width = view.getUint32(16);
    height = view.getUint32(20);
  } else if (format === 'jpg') {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 0xff) break;
      const marker = bytes[offset + 1];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x00 || marker === 0xff || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
        continue;
      }
      const size = view.getUint16(offset + 2);
      if (size < 2 || offset + 2 + size > bytes.length) break;
      if (
        [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) &&
        size >= 7
      ) {
        height = view.getUint16(offset + 5);
        width = view.getUint16(offset + 7);
        break;
      }
      offset += 2 + size;
    }
  }
  if (!width || !height)
    throw new IntakeError(
      'corrupt',
      'Не удалось прочитать размеры изображения. Выберите исходный JPEG или PNG.',
    );
  if (width * height > INTAKE_LIMITS.imagePixels || width > 20_000 || height > 20_000)
    throw new IntakeError(
      'too_large',
      'Изображение больше 24 мегапикселей. Уменьшите разрешение перед загрузкой.',
    );
  return { width, height };
}
