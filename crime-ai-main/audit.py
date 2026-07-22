import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "audit.db")

IS_CATALYST = os.environ.get("USE_CATALYST_DB") == "true" or "CATALYST_ENVIRONMENT" in os.environ

def init_audit_db():
    """Create the audit logs table if it does not exist."""
    if IS_CATALYST:
        # Tables are created via Zoho Catalyst Console, skip local DDL
        return
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
    # Ensure string values to prevent type or null issues in Zoho Data Store
    safe_question = str(question or "")
    safe_route = str(route or "")
    safe_sql = str(generated_sql or "")
    safe_role = str(role or "investigator")
    safe_user_id = str(user_id or "Anonymous")

    if IS_CATALYST:
        try:
            from zcatalyst_sdk.catalyst_app import CatalystApp
            import datetime
            app = CatalystApp.get_instance()
            datastore = app.datastore()
            table = datastore.table('audit_logs')
            
            row_data = {
                'timestamp': datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                'question': safe_question,
                'route': safe_route,
                'generated_sql': safe_sql,
                'role': safe_role,
                'user_id': safe_user_id
            }
            table.insert_row(row_data)
            print(f"[Audit Log] Logged query to Catalyst Data Store: '{safe_question}'")
            return
        except Exception as e:
            print(f"[Audit Error] Failed to write to Catalyst Data Store ({e}). Falling back to local SQLite.")


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
