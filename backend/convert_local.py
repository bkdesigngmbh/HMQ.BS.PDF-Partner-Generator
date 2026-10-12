"""
Local conversion run with the partner profiles of the frontend, for tests.

Usage (from the repo root):
    python3 backend/convert_local.py <report.pdf> <output.pdf> --partner jermann
"""

import argparse
import json
import sys
from pathlib import Path

from processor import ConversionError, Partner, convert

REPO_ROOT = Path(__file__).resolve().parent.parent
PARTNERS_FILE = REPO_ROOT / "src" / "config" / "partners.json"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("source", type=Path)
    parser.add_argument("target", type=Path)
    parser.add_argument("--partner", required=True, help="partner id from src/config/partners.json")
    args = parser.parse_args()

    profiles = {profile["id"]: profile for profile in json.loads(PARTNERS_FILE.read_text(encoding="utf-8"))}
    if args.partner not in profiles:
        parser.error(f"unknown partner '{args.partner}', known: {', '.join(profiles)}")
    profile = profiles[args.partner]
    logo = (REPO_ROOT / "public" / profile["logo"].lstrip("/")).read_bytes()

    try:
        result, changes = convert(args.source.read_bytes(), Partner.from_dict(profile), logo)
    except ConversionError as exc:
        print(f"FEHLER: {exc}", file=sys.stderr)
        return 1
    args.target.write_bytes(result)
    print("\n".join(changes))
    return 0


if __name__ == "__main__":
    sys.exit(main())
