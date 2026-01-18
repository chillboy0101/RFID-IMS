import sys
from pathlib import Path

from pypdf import PdfReader


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: python extract_pdf_text.py <input.pdf> [output.txt]", file=sys.stderr)
        return 2

    input_path = Path(sys.argv[1]).expanduser().resolve()
    if not input_path.exists():
        print(f"Input file not found: {input_path}", file=sys.stderr)
        return 2

    output_path = (
        Path(sys.argv[2]).expanduser().resolve()
        if len(sys.argv) >= 3
        else input_path.with_suffix(".extracted.txt")
    )

    reader = PdfReader(str(input_path))
    parts: list[str] = []

    for i, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""
        parts.append(f"--- PAGE {i} ---\n{text}")

    output_path.write_text("\n\n".join(parts), encoding="utf-8", errors="replace")
    print(f"Wrote {len(reader.pages)} pages to {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
