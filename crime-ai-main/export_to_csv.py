import sqlite3
import csv
import os

db_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fir.db")
output_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "csv_export")
os.makedirs(output_dir, exist_ok=True)

print(f"Opening database: {db_path}")
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

# Get all table names in the database
cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';")
tables = [row[0] for row in cursor.fetchall()]

print(f"Found {len(tables)} tables to export.")

for table in tables:
    try:
        cursor.execute(f"SELECT * FROM {table}")
        # Get column headers
        headers = [description[0] for description in cursor.description]
        rows = cursor.fetchall()
        
        csv_path = os.path.join(output_dir, f"{table}.csv")
        with open(csv_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(headers)
            writer.writerows(rows)
            
        print(f"  -> Exported {table} ({len(rows)} rows) to {csv_path}")
    except Exception as e:
        print(f"  -> Failed to export {table}: {e}")

conn.close()
print(f"\nAll tables exported successfully to the '{output_dir}' directory!")
