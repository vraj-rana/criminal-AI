import sqlite3
import os
import re
from collections import defaultdict
from datetime import datetime

def parse_year_month(date_str):
    """Robustly parse year and month from different date string formats."""
    if not date_str:
        return None
    
    date_str = date_str.strip()
    
    # Format: YYYY-MM-DD ...
    match1 = re.match(r"^(\d{4})[-/](\d{2})[-/](\d{2})", date_str)
    if match1:
        return f"{match1.group(1)}-{match1.group(2)}"
        
    # Format: DD-MM-YYYY ... or DD/MM/YYYY ...
    match2 = re.match(r"^(\d{1,2})[-/](\d{1,2})[-/](\d{4})", date_str)
    if match2:
        month = match2.group(2).zfill(2)
        year = match2.group(3)
        return f"{year}-{month}"
        
    # Fallback to general substring heuristics
    return None

def run_forecast(crime_type, district):
    # Path to database file
    db_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fir.db")
    
    # Establish read-only connection
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    cursor = conn.cursor()
    
    # Query case dates
    query = """
        SELECT CM.CrimeRegisteredDate
        FROM CaseMaster CM
        JOIN CrimeSubHead CS ON CM.CrimeMinorHeadID = CS.CrimeSubHeadID
        JOIN Unit U ON CM.PoliceStationID = U.UnitID
        WHERE CS.CrimeHeadName LIKE ?
          AND U.UnitName LIKE ?
    """
    
    # Use wildcards for robust matching
    crime_pattern = f"%{crime_type}%"
    district_pattern = f"%{district}%"
    
    cursor.execute(query, (crime_pattern, district_pattern))
    rows = cursor.fetchall()
    conn.close()
    
    # Group by month
    monthly_counts = defaultdict(int)
    for (date_str,) in rows:
        ym = parse_year_month(date_str)
        if ym:
            monthly_counts[ym] += 1
            
    # Sort months chronologically
    sorted_months = sorted(monthly_counts.keys())
    historical_data = [{"month": m, "count": monthly_counts[m]} for m in sorted_months]
    
    # Need at least 2 months of history to calculate a trend line
    if len(historical_data) < 2:
        avg_val = sum(monthly_counts.values()) / max(len(historical_data), 1)
        next_months = []
        
        # Project last month + 1..3
        base_year, base_month = 2026, 7
        if historical_data:
            last_m = historical_data[-1]["month"]
            try:
                base_year, base_month = map(int, last_m.split("-"))
            except:
                pass
                
        for i in range(1, 4):
            m = base_month + i
            y = base_year + (m - 1) // 12
            m = (m - 1) % 12 + 1
            next_months.append({
                "month": f"{y}-{str(m).zfill(2)}",
                "count": round(avg_val, 2)
            })
            
        explanation = (
            f"Note: Insufficient historical data found ({len(historical_data)} months of data). "
            f"A simple flat-average projection (value: {round(avg_val, 2)}) was used for future estimations. "
            "At least 2 data points are required to compute a statistical linear trend line."
        )
        
        return {
            "historical": historical_data,
            "forecast": next_months,
            "explanation": explanation
        }
        
    # Perform simple linear regression: y = m * x + c
    n = len(historical_data)
    x = list(range(n))
    y = [h["count"] for h in historical_data]
    
    mean_x = sum(x) / n
    mean_y = sum(y) / n
    
    num = sum((x[i] - mean_x) * (y[i] - mean_y) for i in range(n))
    den = sum((x[i] - mean_x) ** 2 for i in range(n))
    
    slope = num / den if den != 0 else 0
    intercept = mean_y - slope * mean_x
    
    # Forecast the next 3 months
    next_months = []
    last_ym = historical_data[-1]["month"]
    base_year, base_month = map(int, last_ym.split("-"))
    
    for i in range(1, 4):
        x_future = n - 1 + i
        y_pred = max(0.0, slope * x_future + intercept)  # Clamp at 0 to avoid negative crime predictions
        
        # Calculate target month string
        m = base_month + i
        y_val = base_year + (m - 1) // 12
        m_val = (m - 1) % 12 + 1
        
        next_months.append({
            "month": f"{y_val}-{str(m_val).zfill(2)}",
            "count": round(y_pred, 2)
        })
        
    explanation = (
        f"Forecast computed using simple linear regression (y = {round(slope, 4)}*x + {round(intercept, 4)}) "
        f"based on {n} months of historical records from the case database. "
        "This formula maps historical monthly case frequencies over time to project future caseloads. "
        "It assumes a continuous linear trend and is not a black-box model."
    )
    
    return {
        "historical": historical_data,
        "forecast": next_months,
        "explanation": explanation
    }

if __name__ == "__main__":
    # Test execution
    res = run_forecast("Burglary", "Mysuru")
    print(res)
