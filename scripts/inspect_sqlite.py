import argparse
import sqlite3
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description="Inspect a SQLite file's schema.")
    parser.add_argument("path", help="Path to SQLite file")
    args = parser.parse_args()

    p = Path(args.path).resolve()
    con = sqlite3.connect(str(p))
    try:
        cur = con.cursor()
        cur.execute("SELECT sqlite_version()")
        print(f"file: {p}")
        print(f"sqlite: {cur.fetchone()[0]}")

        cur.execute("SELECT name, type FROM sqlite_master WHERE type IN ('table','view') ORDER BY type, name")
        objs = cur.fetchall()
        print(f"objects: {len(objs)}")
        for name, typ in objs:
            print(f"{typ}: {name}")

        tables = [name for name, typ in objs if typ == "table" and not name.startswith("sqlite_")]
        print("")
        print("table_columns_preview:")
        for t in tables[:20]:
            safe_t = t.replace("'", "''")
            cur.execute(f"PRAGMA table_info('{safe_t}')")
            cols = cur.fetchall()
            col_str = ", ".join([f"{c[1]}:{c[2]}" for c in cols])
            print(f"- {t}: {col_str}")
    finally:
        con.close()


if __name__ == "__main__":
    main()

