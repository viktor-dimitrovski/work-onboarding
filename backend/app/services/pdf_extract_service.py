from __future__ import annotations

import io

from pypdf import PdfReader


def extract_pdf_pages_text(pdf_bytes: bytes, *, max_pages: int | None = None) -> list[str]:
    """
    Best-effort text extraction for digitally-generated PDFs.
    For scanned PDFs, this will usually return empty strings (OCR not included in MVP).
    """
    reader = PdfReader(io.BytesIO(pdf_bytes))
    pages = reader.pages
    if max_pages is not None:
        pages = pages[: max(0, max_pages)]

    out: list[str] = []
    for page in pages:
        try:
            text = page.extract_text() or ""
        except Exception:
            text = ""
        out.append(text.strip())
    return out


def chunk_pages(pages: list[str], *, max_chars: int = 18_000) -> list[str]:
    """
    Chunk pages into roughly max_chars blocks, keeping page boundaries and labels.
    """
    chunks: list[str] = []
    buf: list[str] = []
    size = 0

    for idx, page_text in enumerate(pages):
        if not page_text:
            continue
        block = f"\n\n[Page {idx + 1}]\n{page_text.strip()}\n"
        if size + len(block) > max_chars and buf:
            chunks.append("".join(buf).strip())
            buf = []
            size = 0
        buf.append(block)
        size += len(block)

    if buf:
        chunks.append("".join(buf).strip())

    return chunks
