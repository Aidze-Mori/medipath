# Local document intake

`extractDocument(file, { signal, onProgress, rotation })` returns source blocks,
page preview URLs, section arrays with anchors, missing sections, `unreadPages`
and `unreadAnchors`. DOCX anchors identify paragraphs/images, never invented page
numbers. `extractText(text)` uses the same shape. `extractImages(files, options)`
reads an explicitly ordered group of photos as one document. `extractPhotoPages`
accepts `{ file, rotation }` for each page; the rotation is applied before OCR and
to the retained original preview.

`PhotoBatch` validates a selected photo set before displaying bounded thumbnails.
Users explicitly reorder, rotate or remove pages, then start reading. Multi-file
PDF/DOCX/TXT or mixed format selection is rejected without reading only the first
file. Cancelling the system chooser leaves the selected set unchanged.

Keep the returned source separate from edits. Extraction is never patient
confirmation, clinical verification or permission to call an external service.
Block continuation if `unreadAnchors.length > 0`, including DOCX image failures
that have no page number. Call `disposeExtraction(result)` when replacing/resetting
the source to revoke its in-memory preview URLs.

Limits are centralized in `types.ts`: 5 MB, five PDF pages/photos/images, 20,000
text characters, 24 MP decoded image, 6 MP rendered page, 25 MB unpacked DOCX,
256 ZIP entries and a two-minute processing timeout. These are implementation
limits, not measured mobile performance promises. Oversized documents are rejected
without silently processing only their first pages.

PDF.js uses a worker emitted by Vite and the packaged `/pdfjs/` resources. Pages
containing raster drawing operations receive whole-page OCR, replacing rather than
concatenating native and OCR layers. Rendering previews are not a guarantee that a
damaged PDF reproduces every source object; users must compare the original.
Native text uses page coordinates to preserve lines and real word gaps instead
of inserting a space between every PDF font run. Wide horizontal gaps remain table
boundaries; the baseline tolerance scales down for small text. The section parser
recognizes explicit radiology labels, including full labels, numbering, wrapped
labels, inline labels after sentence/table boundaries and known labels followed
by a capitalized value without a colon. Ordinary lower-case prose mentioning a
heading remains body text. Unknown anatomy subheadings remain in their source
section; missing conclusions are never inferred. This is deterministic source
segmentation, not LLM reconstruction or a guarantee for every PDF layout.

Study metadata (location, date, study name, organization, patient/form fields)
keeps its original label in `DocumentSections.other`. Review shows the recognized
fields separately; edits replace exact offsets in the current `other` value,
retain adjacent/unknown text and go through normal revision invalidation. All
source blocks and section anchors remain available for comparison. The review's
optional `onSave` callback confirms/saves without requesting analysis; `onConfirm`
continues the immediate route flow. The owning flow implements those actions.

Regression coverage includes a real, in-memory synthetic radiology PDF rendered
by Chromium, uploaded through the regular UI at 1440 and 390 px. The two supplied
Telegram PDF paths could not be read because macOS returned `EPERM`; they were
not read, copied into fixtures or sent externally. An accessible copy is needed
to verify their exact layout.

Unclassified text keeps its source anchors and is shown as one editable document
body. The patient verifies recognition without having to create clinical sections.
The original preview can be expanded on desktop or mobile, zoomed up to 400%,
and reset to fit width; zoomed content scrolls within the viewer.

DOCX reads bounded OOXML paragraphs and table cells in source order. It never
inserts extracted HTML into the page, executes macros, follows hyperlinks or loads
external images. Embedded JPEG/PNG images have their own OCR blocks. DOCX layouts,
headers/footers and pagination are not reconstructed. Unsupported embedded objects
and external images are explicitly rejected or marked unreadable.

Tesseract uses the bundled same-origin `/ocr/worker.min.js`, `/ocr/core/` and
`/ocr/lang/` resources. The adapter owns the native worker from construction so
abort/reset terminates initialization as well as recognition. Its messages mirror
the pinned `tesseract.js@7.0.0` protocol; retain the startup cancellation unit test
and real OCR browser tests when upgrading that dependency. OCR confidence measures
character recognition, not clinical certainty. No document is persisted or uploaded.

DOC and HEIC/HEIF return explicit unsupported errors. There is no converter for
these formats in this implementation. Phone perspective correction and handwritten
text are not promised; rotate/retry and original comparison remain necessary.

The original research fixture set under `tests/fixtures/document-intake/` is
unchanged. Authored synthetic demo assets live in `public/examples/`, with exact
byte hashes in its manifest; the privacy layer owns authorization and confirmed
canonical variant binding. A similar-looking document is not a trusted fixture.
