import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "audit.db")

def init_audit_db():
    """Create the audit logs table if it does not exist."""
    conn = sqlite3.connect(DB_PATH)
    try:
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS audit_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT DEFAULT (datetime('now', 'localtime')),
                question TEXT,
                route TEXT,
                generated_sql TEXT,
                role TEXT,
                user_id TEXT
            )
        """)
        conn.commit()
    finally:
        conn.close()

def log_query(question, route, generated_sql=None, role="investigator", user_id="Anonymous"):
    """Log a query execution event to the audit database."""
    # Ensure database is initialized
    init_audit_db()
    
    conn = sqlite3.connect(DB_PATH)
    try:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO audit_logs (question, route, generated_sql, role, user_id)
            VALUES (?, ?, ?, ?, ?)
        """, (question, route, generated_sql, role, user_id))
        conn.commit()
        print(f"[Audit Log] Logged query: '{question}' (Route: {route}, Role: {role})")
    except Exception as e:
        print(f"[Audit Error] Failed to write audit log: {e}")
    finally:
        conn.close()

# Auto-initialize database on import
init_audit_db()
