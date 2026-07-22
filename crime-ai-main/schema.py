import sqlite3

conn = sqlite3.connect("fir.db")
cursor = conn.cursor()

tables = cursor.execute(
    "SELECT name FROM sqlite_master WHERE type='table';"
).fetchall()

for table in tables:
    table = table[0]
    print(f"\n===== {table} =====")

    columns = cursor.execute(
        f"PRAGMA table_info({table})"
    ).fetchall()

    for column in columns:
        print(column[1], "-", column[2])

conn.close()