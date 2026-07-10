"""pdf-metadata.py — FX-A-08 (SPEC-doc-fidelity-export.md): set PDF /Title and /Author metadata
in-place after Chromium print. Chromium's page.pdf() does not support setting /Author, and always
uses document.title as /Title regardless of what we ask for — so we post-process the buffer here.
Only rewrites the docinfo dictionary; page content bytes are untouched.

Usage: pdf-metadata.py <pdf_path> --title "<title>" --author "<author>"
Rewrites <pdf_path> in place.
"""
import argparse
import sys

import pikepdf


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('pdf_path')
    ap.add_argument('--title', default=None)
    ap.add_argument('--author', default=None)
    args = ap.parse_args()

    with pikepdf.open(args.pdf_path, allow_overwriting_input=True) as pdf:
        if args.title is not None:
            pdf.docinfo['/Title'] = args.title
        if args.author is not None:
            pdf.docinfo['/Author'] = args.author
        pdf.save(args.pdf_path)


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print(str(e), file=sys.stderr)
        sys.exit(1)
