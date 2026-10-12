"""
Modal deployment of the conversion endpoint used by the web frontend.

Deploy from the repo root (Modal workspace bkdesigngmbh):
    modal deploy backend/app.py
The endpoint URL stays the same as long as app and function names are unchanged.
"""

from pathlib import Path

import modal

BACKEND_DIR = Path(__file__).parent

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install("pymupdf==1.26.7", "fastapi[standard]==0.115.14")
    .add_local_dir(BACKEND_DIR / "fonts", remote_path="/root/fonts")
    .add_local_python_source("processor")
)

app = modal.App("hmq-pdf-processor", image=image)


@app.function(timeout=300)
@modal.fastapi_endpoint(method="POST")
def process_pdf(data: dict) -> dict:
    import base64
    import traceback

    from processor import ConversionError, Partner, convert, decode_base64

    try:
        pdf_bytes = decode_base64(data.get("pdf_base64"), "PDF")
        logo_bytes = decode_base64(data.get("logo_base64"), "Partnerlogo")
        partner = Partner.from_dict(data.get("partner"))
        result, changes = convert(pdf_bytes, partner, logo_bytes)
    except ConversionError as exc:
        return {"success": False, "error": str(exc)}
    except Exception:
        traceback.print_exc()
        return {"success": False, "error": "Interner Fehler bei der Verarbeitung (Details im Modal-Log)."}

    return {
        "success": True,
        "pdf_base64": base64.b64encode(result).decode("ascii"),
        "changes": changes,
    }
