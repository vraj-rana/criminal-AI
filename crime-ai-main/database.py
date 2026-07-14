import sqlite3
import os

# Check if running in Zoho Catalyst environment
IS_CATALYST = os.environ.get("USE_CATALYST_DB") == "true" or "CATALYST_ENVIRONMENT" in os.environ

def run_sql(sql):
    # Security Check: Ensure only SELECT or WITH (read-only) queries are executed
    clean_sql = sql.strip().upper()
    if not (clean_sql.startswith("SELECT") or clean_sql.startswith("WITH")):
        raise ValueError("Security violation: Only SELECT and WITH queries are permitted.")
    
    if IS_CATALYST:
        try:
            from zcatalyst_sdk.catalyst_app import CatalystApp
            app = CatalystApp.get_instance()
            zcql = app.zcql()
            query_result = zcql.execute_query(sql)
            
            # Convert list of dicts to list of tuples for table renderer compatibility
            rows = []
            for row in query_result:
                # Row is a dictionary from ZCQL response: {"CaseMaster": {"CaseNo": "...", "Crime": "..."}}
                # Extract values from inner dictionaries
                row_vals = []
                for table_name, columns in row.items():
                    if isinstance(columns, dict):
                        row_vals.extend(columns.values())
                    else:
                        row_vals.append(columns)
                rows.append(tuple(row_vals))
            return rows
        except Exception as e:
            # Fallback to local SQLite if Catalyst SDK is not initialized/signed-in locally
            print(f"Catalyst ZCQL query failed ({e}). Falling back to local SQLite.")

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