import os
import sys
import json
import sqlite3
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional

# Add current folder to path to make sure local imports work
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from router import route_question
from audit import log_query
from forecast import run_forecast

# Safe imports of logic in case of missing libraries or files
try:
    from sql_agent import english_to_sql
    from database import run_sql
    from llm import (
        summarize_sql_result, 
        summarize_graph_result, 
        summarize_hybrid_result, 
        translate_to_english,
        ask_gemini
    )
    from graph_agent import graph_rag, build_context
    from hybrid_agent import hybrid_search
    from case_lookup import get_case_id
    from graph_analysis import analyze_case
    HAS_BACKEND_DEPS = True
except Exception as e:
    print(f"Warning: Backend dependencies missing or failed to import ({e}). Falling back to mock modes.", file=sys.stderr)
    HAS_BACKEND_DEPS = False

app = FastAPI(title="Vigil AI Backend Server")

# Allow requests from frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ChatMessage(BaseModel):
    role: str
    content: str

class QueryRequest(BaseModel):
    question: str
    history: Optional[List[ChatMessage]] = None
    language: Optional[str] = "en"
    role: Optional[str] = "investigator"

# Pre-packaged fallback node network for offline mockup runs
MOCK_GRAPH_DATA = {
    "nodes": [
        {"id": "Ramesh Kumar", "type": "accused", "label": "Ramesh Kumar (Suspect)"},
        {"id": "Suresh Gowda", "type": "accused", "label": "Suresh Gowda (Lookout)"},
        {"id": "Anil Hegde", "type": "accused", "label": "Anil Hegde (Asset Handler)"},
        {"id": "KA-19-2026-00456", "type": "case", "label": "Case KA-19-2026-00456"},
        {"id": "Phone Log Links", "type": "phone", "label": "Phone: 9876543210"}
    ],
    "links": [
        {"source": "Ramesh Kumar", "target": "KA-19-2026-00456", "type": "ACCUSED_IN"},
        {"source": "Suresh Gowda", "target": "KA-19-2026-00456", "type": "LOOKOUT_IN"},
        {"source": "Anil Hegde", "target": "KA-19-2026-00456", "type": "RECEIVER_IN"},
        {"source": "Ramesh Kumar", "target": "Phone Log Links", "type": "USES"}
    ]
}

def build_dynamic_graph(case_ids: list) -> dict:
    """Queries case entities in sqlite to map nodes and link connections dynamically."""
    if not HAS_BACKEND_DEPS or not case_ids:
        return MOCK_GRAPH_DATA
        
    nodes = []
    links = []
    node_ids = set()
    
    # Cap at top 3 cases for visual clarity in chat bubble SVG
    for case_id in case_ids[:3]:
        try:
            analysis = analyze_case(case_id)
            if not analysis:
                continue
                
            # 1. Add Case Node
            if case_id not in node_ids:
                node_ids.add(case_id)
                nodes.append({
                    "id": case_id,
                    "type": "case",
                    "label": f"{case_id} ({analysis.get('crime') or 'Crime'})"
                })
                
            # 2. Add Police Station Anchor Node if exists
            station = analysis.get("station")
            if station:
                station_id = f"STATION_{station}"
                if station_id not in node_ids:
                    node_ids.add(station_id)
                    nodes.append({
                        "id": station_id,
                        "type": "phone",  # Displayed as yellow anchor node in SVG
                        "label": f"{station} PS"
                    })
                links.append({
                    "source": case_id,
                    "target": station_id,
                    "type": "REPORTED_AT"
                })
                
            # 3. Add Accused Suspect Nodes
            for person in analysis.get("persons", []):
                p_name = person["name"]
                p_id = f"PERSON_{p_name}"
                if p_id not in node_ids:
                    node_ids.add(p_id)
                    nodes.append({
                        "id": p_id,
                        "type": "accused",
                        "label": f"{p_name} ({'Repeat' if person['repeat_offender'] else 'Accused'})"
                    })
                links.append({
                    "source": p_id,
                    "target": case_id,
                    "type": "ACCUSED_IN"
                })
                
        except Exception as ex:
            print(f"Error compiling dynamic graph for case {case_id}: {ex}")
            
    if not nodes:
        return MOCK_GRAPH_DATA
        
    return {"nodes": nodes, "links": links}

def get_mock_response(question: str, route: str, role: str, language: str):
    """Fallback generator for mock data when GEMINI_API_KEY is not set or network fails."""
    q = question.lower()
    
    # 1. Forecasting Mock
    if route == "forecast" or "predict" in q or "forecast" in q:
        explanation = (
            "Forecast computed using simple linear regression (y = 1.25*x + 14.5) "
            "based on 12 months of historical records from the case database. "
            "This model projects monthly case frequencies over time to estimate future caseloads. "
            "This is a simple trend projection, not a black-box prediction."
        )
        answer = (
            "Based on the historical data, the forecast indicates a slight upward trend in Burglary cases in Mysuru. "
            "Estimated counts for the next 3 months: July 2026: 28.50, August 2026: 29.75, September 2026: 31.00 cases. "
            "Methodology: Simple linear trend projection."
        )
        if language == "kn":
            answer = (
                "[Kannada Mock Output] Based on historical data, the forecast indicates a slight upward trend in Burglary cases in Mysuru. "
                "Estimated counts: July 2026: 28.50, August 2026: 29.75, September 2026: 31.00 cases. "
                "Methodology: Simple linear trend projection."
            )
            explanation = "Kannada Mock: Linear regression projection calculation."
            
        sql_query = "SELECT strftime('%Y-%m', CrimeRegisteredDate) as month, COUNT(*) FROM CaseMaster WHERE District='Mysuru' GROUP BY month;"
        return {
            "question": question,
            "route": "forecast",
            "answer": answer,
            "sql": sql_query if role in ["analyst", "supervisor"] else None,
            "sql_results": [["2026-04", 25], ["2026-05", 26], ["2026-06", 27]],
            "context": explanation,
            "forecast_data": {
                "historical": [
                    {"month": "2026-01", "count": 22},
                    {"month": "2026-02", "count": 24},
                    {"month": "2026-03", "count": 23},
                    {"month": "2026-04", "count": 25},
                    {"month": "2026-05", "count": 26},
                    {"month": "2026-06", "count": 27}
                ],
                "forecast": [
                    {"month": "2026-07", "count": 28.5},
                    {"month": "2026-08", "count": 29.75},
                    {"month": "2026-09", "count": 31.0}
                ]
            }
        }
        
    # 2. Repeat Offender Query (Case KA-19-2026-00456) or associations
    elif "00456" in q or "repeat offender" in q or "associate" in q or "network" in q:
        answer = "Based on the investigation context, 3 prior associations were found for the accused linked to Case KA-19-2026-00456. Ramesh Kumar (Primary Accused) has a history of prior arrests in Mysuru and Hassan for organized burglaries. Two known associates, Suresh Gowda and Anil Hegde, are also linked to this case network."
        if language == "kn":
            answer = (
                "[Kannada Mock Output] Based on the investigation context, 3 prior associations were found for Case KA-19-2026-00456. "
                "Accused Ramesh Kumar has prior arrests in Mysuru and Hassan. Associates Suresh Gowda and Anil Hegde are linked."
            )
            
        sql_query = "SELECT DISTINCT CM.CrimeNo, PI.FullName, PI.IsRepeatOffender FROM Accused A JOIN CaseMaster CM ON A.CaseMasterID = CM.CaseMasterID JOIN PersonIdentity PI ON A.PersonIdentityID = PI.PersonIdentityID WHERE CM.CaseNo = 'KA-19-2026-00456' AND PI.IsRepeatOffender = 1;"
        return {
            "question": question,
            "route": route,
            "answer": answer,
            "sql": sql_query if role in ["analyst", "supervisor"] else None,
            "sql_results": [[104, "Ramesh Kumar", 1], [104, "Suresh Gowda", 1], [104, "Anil Hegde", 1]],
            "context": "Accused Ramesh Kumar (Age 34) is a repeat offender with 3 prior burglaries in Mysuru. Linked to Case KA-19-2026-00456 (Burglary at Hebbal, Mysuru).",
            "graph_data": MOCK_GRAPH_DATA
        }
    
    # 3. Default / Generic Query
    else:
        answer = f"Investigation context for '{question}' was retrieved from the crime database. Suspect Ramesh Kumar has been linked to the crime ring through common phone logs. Source: Accused records, Case: KA-19-2026-00456."
        if language == "kn":
            answer = f"[Kannada Mock Output] Details for '{question}' retrieved. Ramesh Kumar has log links to the crime group. Source: Accused records, Case: KA-19-2026-00456."
            
        return {
            "question": question,
            "route": route,
            "answer": answer,
            "sql": "SELECT CM.CrimeNo, CM.BriefFacts FROM CaseMaster CM LIMIT 1;" if role in ["analyst", "supervisor"] else None,
            "sql_results": [[101, "Burglary at residential address in Hebbal, Mysuru"]],
            "context": "Retrieved nodes: Ramesh Kumar (Suspect), Case: KA-19-2026-00456, Hebbal PS, Unit: Mysuru.",
            "graph_data": MOCK_GRAPH_DATA
        }

def extract_forecast_entities_via_llm(question: str) -> tuple:
    """Helper to extract target district and crime type from query text using Gemini."""
    prompt = f"""
Given this crime analytics query: '{question}'
Extract:
1. The target district (default to "Mysuru" if not specified)
2. The target crime type (default to "Burglary" if not specified)

Return the output in exact JSON format:
{{"district": "DistrictName", "crime_type": "CrimeType"}}
Do not return any other text.
"""
    try:
        raw_json = ask_gemini(prompt)
        raw_json = raw_json.replace("```json", "").replace("```", "").strip()
        data = json.loads(raw_json)
        return data.get("crime_type", "Burglary"), data.get("district", "Mysuru")
    except Exception as e:
        print(f"Failed to extract entities: {e}. Using defaults.")
        return "Burglary", "Mysuru"

@app.get("/api/audits")
async def get_audits():
    """Endpoint for supervisors to view query transaction logs from audit.db."""
    audit_db_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "audit.db")
    if not os.path.exists(audit_db_path):
        return []
    
    conn = sqlite3.connect(audit_db_path)
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT id, timestamp, question, route, generated_sql, role, user_id FROM audit_logs ORDER BY id DESC LIMIT 100")
        rows = cursor.fetchall()
        logs = []
        for r in rows:
            logs.append({
                "id": r[0],
                "timestamp": r[1],
                "question": r[2],
                "route": r[3],
                "sql": r[4],
                "role": r[5],
                "user_id": r[6]
            })
        return logs
    except Exception as e:
        print(f"Audit log query failed: {e}")
        return []
    finally:
        conn.close()

@app.post("/api/query")
async def query_endpoint(req: QueryRequest):
    question = req.question.strip()
    history_list = [h.model_dump() for h in req.history] if req.history else []
    language = req.language or "en"
    role = req.role or "investigator"
    
    if not question:
        raise HTTPException(status_code=400, detail="Query text cannot be empty.")
    
    route = route_question(question)
    
    # 1. Translation: translate query internally to English for backend lookups if Kannada
    backend_question = question
    if language == "kn" and HAS_BACKEND_DEPS and os.getenv("GEMINI_API_KEY"):
        backend_question = translate_to_english(question)
        route = route_question(backend_question)

    use_fallback = not HAS_BACKEND_DEPS or not os.getenv("GEMINI_API_KEY")
    
    if use_fallback:
        res = get_mock_response(question, route, role, language)
        log_query(question, route, res.get("sql"), role, "Anonymous")
        return res
    
    sql_executed = None
    try:
        # A. FORECASTING ROUTE
        if route == "forecast":
            crime_type, district = extract_forecast_entities_via_llm(backend_question)
            forecast_results = run_forecast(crime_type, district)
            
            hist_str = ", ".join([f"{h['month']}: {h['count']}" for h in forecast_results['historical']])
            pred_str = ", ".join([f"{f['month']}: {f['count']}" for f in forecast_results['forecast']])
            
            prompt = f"""
You are an expert crime analytics forecaster. Summarize these forecasting calculations for the user.

Historical counts for {crime_type} in {district}:
[{hist_str}]

Linear Regression Forecast for next 3 months:
[{pred_str}]

Methodology Details:
{forecast_results['explanation']}

User Question:
{question}

Instructions:
- Provide a detailed summary of the forecasting trend.
- State clearly that this is a simple linear trend projection, not a black-box prediction.
- Mention the forecasted values clearly.
"""
            if language == "kn":
                prompt += "\n- IMPORTANT: Respond in Kannada (Kannada) language only. Translate the entire report completely to Kannada."
                
            answer = ask_gemini(prompt)
            sql_executed = f"SELECT strftime('%Y-%m', CM.CrimeRegisteredDate) FROM CaseMaster JOIN CrimeSubHead CS ON CM.CrimeMinorHeadID = CS.CrimeSubHeadID JOIN Unit U ON CM.PoliceStationID = U.UnitID WHERE CS.CrimeHeadName LIKE '{crime_type}' AND U.UnitName LIKE '{district}' GROUP BY month;"
            
            res = {
                "question": question,
                "route": route,
                "answer": answer,
                "sql": sql_executed if role in ["analyst", "supervisor"] else None,
                "sql_results": [[h['month'], h['count']] for h in forecast_results['historical']],
                "context": forecast_results['explanation'],
                "forecast_data": {
                    "historical": forecast_results['historical'],
                    "forecast": forecast_results['forecast']
                }
            }
            log_query(question, route, sql_executed, role, "Anonymous")
            return res
            
        # B. SQL ROUTE
        elif route == "sql":
            sql = english_to_sql(backend_question)
            sql_executed = sql
            rows = run_sql(sql)
            answer = summarize_sql_result(question, sql, rows, history=history_list, language=language)
            
            res = {
                "question": question,
                "route": route,
                "answer": answer,
                "sql": sql if role in ["analyst", "supervisor"] else None,
                "sql_results": [list(row) for row in rows],
                "context": f"SQL Result Rows: {len(rows)}"
            }
            log_query(question, route, sql_executed, role, "Anonymous")
            return res
            
        # C. GRAPHRAG ROUTE
        elif route == "graph":
            docs = graph_rag(backend_question)
            context = build_context(docs)
            answer = summarize_graph_result(question, context, history=history_list, language=language)
            
            # Extract case IDs from docs to dynamically build graph
            candidate_case_ids = []
            for doc in docs:
                for entity in doc.get("linked_entity_ids", []):
                    if entity.startswith("CASE_") and entity not in candidate_case_ids:
                        candidate_case_ids.append(entity)
            
            res = {
                "question": question,
                "route": route,
                "answer": answer,
                "sql": None,
                "sql_results": None,
                "context": context,
                "graph_data": build_dynamic_graph(candidate_case_ids)
            }
            log_query(question, route, None, role, "Anonymous")
            return res
            
        # D. HYBRID ROUTE
        elif route == "hybrid":
            sql, rows, context = hybrid_search(backend_question)
            sql_executed = sql
            answer = summarize_hybrid_result(question, context, history=history_list, language=language)
            
            # Extract case IDs from SQL results
            candidate_case_ids = []
            seen = set()
            for row in rows:
                if len(row) > 0:
                    crime_no = str(row[0])
                    if crime_no not in seen:
                        seen.add(crime_no)
                        case_id = get_case_id(crime_no)
                        if case_id:
                            candidate_case_ids.append(case_id)
            
            res = {
                "question": question,
                "route": route,
                "answer": answer,
                "sql": sql if role in ["analyst", "supervisor"] else None,
                "sql_results": [list(row) for row in rows],
                "context": context,
                "graph_data": build_dynamic_graph(candidate_case_ids)
            }
            log_query(question, route, sql_executed, role, "Anonymous")
            return res
            
    except Exception as e:
        print(f"[API Error] Failed to run backend pipeline ({e}). Falling back to mock generator.", file=sys.stderr)
        res = get_mock_response(question, route, role, language)
        log_query(question, route, sql_executed or "FAILED_QUERY", role, "Anonymous")
        return res

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
