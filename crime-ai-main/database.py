import sqlite3

def run_sql(sql):

    conn = sqlite3.connect("fir.db")
    cursor = conn.cursor()

    cursor.execute(sql)

    rows = cursor.fetchall()

    conn.close()

    return rows