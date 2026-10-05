import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOcrSession } from '../../src/features/intake/worker';

describe('OCR worker lifecycle', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('terminates immediately when cancelled during core initialization', async () => {
    const terminate = vi.fn();
    const postMessage = vi.fn();
    vi.stubGlobal('window', { location: { origin: 'https://medipath.example' } });
    vi.stubGlobal('Worker', class {
      terminate = terminate;
      postMessage = postMessage;
    });
    const controller = new AbortController();
    const session = createOcrSession({ signal: controller.signal });
    const operation = session.recognize({} as HTMLCanvasElement, 1, 1);
    const expected = expect(operation).rejects.toMatchObject({ code: 'cancelled' });
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ action: 'load', payload: expect.objectContaining({ options: expect.objectContaining({ corePath: 'https://medipath.example/ocr/core' }) }) }), []);
    controller.abort();
    expect(terminate).toHaveBeenCalledTimes(1);
    await expected;
    await session.terminate();
    expect(terminate).toHaveBeenCalledTimes(1);
  });

  it('does not create a worker for an already aborted operation', async () => {
    const constructor = vi.fn();
    vi.stubGlobal('Worker', class { constructor() { constructor(); } });
    const controller = new AbortController(); controller.abort();
    const session = createOcrSession({ signal: controller.signal });
    await expect(session.recognize({} as HTMLCanvasElement, 1, 1)).rejects.toMatchObject({ code: 'cancelled' });
    expect(constructor).not.toHaveBeenCalled();
    await session.terminate();
  });
});
