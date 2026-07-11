import sqlite3
import os

def run_sql(sql):
    # Security Check: Ensure only SELECT or WITH (read-only) queries are executed
    clean_sql = sql.strip().upper()
    if not (clean_sql.startswith("SELECT") or clean_sql.startswith("WITH")):
        raise ValueError("Security violation: Only SELECT and WITH queries are permitted.")
    
    # Path to database file
    db_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fir.db")
    
    # Open connection in read-only mode using sqlite URI
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        cursor = conn.cursor()
        cursor.execute(sql)
        rows = cursor.fetchmany(500)  # Limit result size to 500 rows to prevent memory exhaustion
        return rows
    finally:
        conn.close()