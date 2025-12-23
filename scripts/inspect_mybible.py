import sqlite3
from pathlib import Path


def main() -> None:
    db_path = Path(__file__).resolve().parents[1] / "clarke.cmt.mybible"
    if not db_path.exists():
        raise SystemExit(f"File not found: {db_path}")

    con = sqlite3.connect(str(db_path))
    cur = con.cursor()

    print(f"db_path: {db_path}")
    print(f"sqlite_version: {sqlite3.sqlite_version}")

    cur.execute(
        "SELECT name, type FROM sqlite_master "
        "WHERE type IN ('table','view') "
        "ORDER BY type, name"
    )
    objs = cur.fetchall()
    print(f"objects: {len(objs)}")
    for name, typ in objs:
        print(f"{typ}: {name}")

    # Show columns for first few tables (excluding sqlite internal tables)
    tables = [name for name, typ in objs if typ == "table" and not name.startswith("sqlite_")]
    print("")
    print("table_columns_preview:")
    for t in tables[:10]:
        safe_t = t.replace("'", "''")
        cur.execute(f"PRAGMA table_info('{safe_t}')")
        cols = cur.fetchall()
        col_str = ", ".join([f"{c[1]}:{c[2]}" for c in cols])  # (cid, name, type, ...)
        print(f"- {t}: {col_str}")

    con.close()


if __name__ == "__main__":
    main()

