import argparse
import base64
import json
import sqlite3
from pathlib import Path


def export_details(cur: sqlite3.Cursor, out_dir: Path, source_key: str) -> None:
    """
    MyBible files usually contain a 'details' table, but some libraries may not.
    In that case we still write a minimal details.json so downstream tooling works.
    """
    try:
        cur.execute("SELECT * FROM details LIMIT 1")
        row = cur.fetchone()
        if row is None:
            raise sqlite3.OperationalError("details table is empty")
        cols = [d[0] for d in cur.description]
        data = dict(zip(cols, row))
    except sqlite3.OperationalError:
        cur.execute(
            "SELECT name, type FROM sqlite_master "
            "WHERE type IN ('table','view') "
            "ORDER BY type, name"
        )
        objs = [{"name": n, "type": t} for (n, t) in cur.fetchall()]
        data = {
            "title": source_key,
            "abbreviation": source_key,
            "description": None,
            "author": None,
            "version": None,
            "language": None,
            "comments": None,
            "editorialcomments": None,
            "righttoleft": 0,
            "customcss": None,
            "sqlite_objects": objs,
        }
    (out_dir / "details.json").write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def export_commentary_ndjson(cur: sqlite3.Cursor, out_path: Path, source_key: str) -> int:
    cur.execute(
        "SELECT id, book, chapter, fromverse, toverse, data "
        "FROM commentary "
        "ORDER BY book, chapter, fromverse, toverse, id"
    )
    cols = [d[0] for d in cur.description]
    count = 0
    with out_path.open("w", encoding="utf-8", newline="\n") as f:
        for row in cur:
            obj = dict(zip(cols, row))
            # Normalize field names for importer
            rec = {
                "source_key": source_key,
                "source_row_id": obj["id"],
                "book": obj["book"],
                "chapter": obj["chapter"],
                "from_verse": obj["fromverse"],
                "to_verse": obj["toverse"],
                "content": obj["data"] or "",
            }
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
            count += 1
    return count


def export_assets_ndjson(cur: sqlite3.Cursor, out_path: Path, source_key: str) -> int:
    cur.execute("SELECT rowid, id, filename, content FROM data ORDER BY rowid")
    cols = [d[0] for d in cur.description]
    count = 0
    with out_path.open("w", encoding="utf-8", newline="\n") as f:
        for row in cur:
            obj = dict(zip(cols, row))
            blob = obj["content"]
            rec = {
                "source_key": source_key,
                "source_rowid": obj["rowid"],
                "asset_key": obj["id"],
                "filename": obj["filename"],
                # base64 so we can safely store/transport in text
                "content_b64": base64.b64encode(blob).decode("ascii") if blob is not None else None,
            }
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
            count += 1
    return count


def export_dictionary_ndjson(cur: sqlite3.Cursor, out_path: Path, source_key: str) -> int:
    # dictionary schema variations:
    # - (word, data)
    # - (relativeorder, word, data)
    cur.execute("PRAGMA table_info('dictionary')")
    cols = [r[1] for r in cur.fetchall()]  # name
    has_relative = "relativeorder" in cols

    if has_relative:
        cur.execute("SELECT relativeorder, word, data FROM dictionary ORDER BY relativeorder, word")
    else:
        cur.execute("SELECT word, data FROM dictionary ORDER BY word")

    count = 0
    with out_path.open("w", encoding="utf-8", newline="\n") as f:
        for row in cur:
            if has_relative:
                relativeorder, word, data = row
            else:
                (word, data) = row
                relativeorder = None

            rec = {
                "source_key": source_key,
                "word": word,
                "relative_order": relativeorder,
                "content": data or "",
            }
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
            count += 1
    return count


def export_one(input_path: Path, out_dir: Path, source_key: str, include_assets: bool) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(str(input_path))
    try:
        cur = con.cursor()
        export_details(cur, out_dir, source_key)

        # Detect library type by presence of known tables
        cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
        table_names = {r[0] for r in cur.fetchall()}

        if "commentary" in table_names:
            count = export_commentary_ndjson(cur, out_dir / "commentary.ndjson", source_key)
            print(f"[{source_key}] Exported {count} commentary rows -> {out_dir / 'commentary.ndjson'}")
        elif "dictionary" in table_names:
            count = export_dictionary_ndjson(cur, out_dir / "dictionary.ndjson", source_key)
            print(f"[{source_key}] Exported {count} dictionary rows -> {out_dir / 'dictionary.ndjson'}")
        else:
            print(f"[{source_key}] Skipping (unknown MyBible schema; no commentary/dictionary table)")
            return

        if include_assets:
            try:
                assets_count = export_assets_ndjson(cur, out_dir / "assets.ndjson", source_key)
                print(f"[{source_key}] Exported {assets_count} assets rows -> {out_dir / 'assets.ndjson'}")
            except sqlite3.OperationalError as e:
                print(f"[{source_key}] Assets export skipped: {e}")
        print(f"[{source_key}] Wrote details -> {out_dir / 'details.json'}")
    finally:
        con.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Export MyBible SQLite libraries to NDJSON for Postgres import.")
    parser.add_argument(
        "--input",
        default=str(Path(__file__).resolve().parents[1] / "clarke.cmt.mybible"),
        help="Path to .mybible SQLite file",
    )
    parser.add_argument(
        "--out",
        default=str(Path(__file__).resolve().parents[1] / "exports" / "mybible"),
        help="Output directory (single export) or base directory (when using --all)",
    )
    parser.add_argument(
        "--source-key",
        default="clarke.cmt",
        help="Unique source key stored in Postgres",
    )
    parser.add_argument(
        "--include-assets",
        action="store_true",
        help="Also export the MyBible 'data' table blobs (base64) to assets.ndjson",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Export all MyBible files in --input-dir into subfolders under --out",
    )
    parser.add_argument(
        "--input-dir",
        default=str(Path(__file__).resolve().parents[1]),
        help="Directory to scan for *.mybible when using --all",
    )
    args = parser.parse_args()

    out_base = Path(args.out).resolve()

    if args.all:
        input_dir = Path(args.input_dir).resolve()
        patterns = ("*.mybible", "*.mybibole", "*.dct.mybible")  # include dictionary libs + common typo
        files: list[Path] = []
        for pat in patterns:
            files.extend(sorted(input_dir.rglob(pat)))

        # De-dupe (in case both patterns match same thing somehow)
        uniq: dict[str, Path] = {str(p): p for p in files}
        files = list(uniq.values())
        files.sort(key=lambda p: p.name.lower())

        if not files:
            raise SystemExit(f"No .mybible files found under: {input_dir}")

        print(f"Found {len(files)} MyBible files under {input_dir}")
        for p in files:
            source_key = p.stem  # e.g. clarke.cmt from clarke.cmt.mybible
            export_one(p, out_base / source_key, source_key, args.include_assets)
        return

    # Single-file export (backwards compatible)
    in_path = Path(args.input).resolve()
    out_dir = out_base
    # If --out is a base dir (exports/mybible), put the single export into a subfolder.
    # If the user provided a specific folder, use it as-is.
    if out_dir.name.lower() == "mybible" or out_dir.samefile(Path(__file__).resolve().parents[1] / "exports" / "mybible"):
        out_dir = out_dir / args.source_key
    export_one(in_path, out_dir, args.source_key, args.include_assets)


if __name__ == "__main__":
    main()

