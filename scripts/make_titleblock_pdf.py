"""Generate a sample A1 sheet carrying only a title block (no drawing content).

    python scripts/make_titleblock_pdf.py [output.pdf]
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from roadset.titleblock import build  # noqa: E402

if __name__ == "__main__":
    build(sys.argv[1] if len(sys.argv) > 1 else "titleblock-sample.pdf")
