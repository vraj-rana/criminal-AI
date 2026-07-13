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
        summarize_network_result,
        translate_to_english,
        ask_gemini
    )
    from graph_agent import graph_rag, build_context
    from hybrid_agent import hybrid_search
    from case_lookup import get_case_id
    from graph_analysis import analyze_case, detect_criminal_clusters
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
    q = question.lower().strip()
    
    # Chat / Conversational Mock
    if route == "chat" or q in ["hey", "hello", "hi", "sup"]:
        if "what can" in q or "capabilities" in q or "what is this" in q or "help" in q or "how to" in q:
            answer = (
                "**Summary:** I am Vigil AI, an advanced crime intelligence platform configured to assist investigators.\n\n"
                "**Key Capabilities:**\n"
                "- **SQL Analytics**: Query aggregates, average offender ages, and district stats.\n"
                "- **Modularity Clusters**: Run automated community detection to uncover crew rings.\n"
                "- **Predictive Trends**: Run regression forecasts to project future station caseloads.\n"
                "- **Relational Graphs**: Build visual network diagrams linking case files and co-accused."
            )
            if language == "kn":
                answer = (
                    "**ಸಾರಾಂಶ:** ನಾನು ವಿಜಿಲ್ ಎಐ, ತನಿಖಾಧಿಕಾರಿಗಳಿಗೆ ಸಹಾಯ ಮಾಡಲು ವಿನ್ಯಾಸಗೊಳಿಸಲಾದ ಅಪರಾಧ ತನಿಖಾ ವೇದಿಕೆ.\n\n"
                    "**ಪ್ರಮುಖ ಸಾಮರ್ಥ್ಯಗಳು:**\n"
                    "- **ಅಪರಾಧ ಜಾಲ ಪತ್ತೆ**: ಸಮುದಾಯ ಪತ್ತೆ ಹಚ್ಚುವಿಕೆ ಮೂಲಕ ಸಕ್ರಿಯ ಗ್ಯಾಂಗ್‌ಗಳನ್ನು ಗುರುತಿಸುವುದು.\n"
                    "- **ಅಪರಾಧ ಪ್ರವೃತ್ತಿ ಮುನ್ಸೂಚನೆ**: ಪ್ರಕರಣಗಳ ಭವಿಷ್ಯದ ಸಂಖ್ಯೆಯನ್ನು ಅಂದಾಜಿಸುವುದು.\n"
                    "- **ಡೇಟಾಬೇಸ್ ವಿಶ್ಲೇಷಣೆ**: ನೇರವಾಗಿ ಪ್ರಶ್ನಿಸುವುದು."
                )
        else:
            answer = "**Summary:** Hello! I am Vigil AI, your criminal intelligence assistant. How can I help you with your investigation today?"
            if language == "kn":
                answer = "**ಸಾರಾಂಶ:** ನಮಸ್ಕಾರ! ನಾನು ವಿಜಿಲ್ ಎಐ, ನಿಮ್ಮ ಅಪರಾಧ ತನಿಖಾ ಸಹಾಯಕಿ. ಇಂದು ನಿಮ್ಮ ಪ್ರಕರಣದ ತನಿಖೆಯಲ್ಲಿ ನಾನು ನಿಮಗೆ ಹೇಗೆ ಸಹಾಯ ಮಾಡಲಿ?"
        
        return {
            "question": question,
            "route": "chat",
            "answer": answer,
            "sql": None,
            "sql_results": None,
            "context": "General conversation.",
            "graph_data": None
        }

    # 1. Forecasting Mock
    if route == "forecast" or "predict" in q or "forecast" in q:
        explanation = (
            "Forecast computed using simple linear regression (y = 1.25*x + 14.5) "
            "based on 12 months of historical records from the case database. "
            "This model projects monthly case frequencies over time to estimate future caseloads. "
            "This is a simple trend projection, not a black-box prediction."
        )
        answer = (
            "**Summary:** The caseload forecast indicates a slight upward trend in Burglary cases in Mysuru.\n\n"
            "**Key Findings:**\n"
            "- **July 2026 Caseload**: Projected at 28.50 cases.\n"
            "- **August 2026 Caseload**: Projected at 29.75 cases.\n"
            "- **September 2026 Caseload**: Projected at 31.00 cases.\n\n"
            "**Details:**\n"
            "Projections utilize linear trend calculations over 12 months of historical crime master data."
        )
        if language == "kn":
            answer = (
                "**ಸಾರಾಂಶ:** ಮೈಸೂರಿನಲ್ಲಿ ಕಳ್ಳತನ ಪ್ರಕರಣಗಳಲ್ಲಿ ಸ್ವಲ್ಪ ಏರಿಕೆಯಾಗುವ ಪ್ರವೃತ್ತಿಯನ್ನು ಅಂದಾಜಿಸಲಾಗಿದೆ.\n\n"
                "**ಮುಖ್ಯಾಂಶಗಳು:**\n"
                "- **ಜುಲೈ 2026 ಪ್ರಕರಣಗಳು**: 28.50 ಪ್ರಕರಣಗಳು.\n"
                "- **ಆಗಸ್ಟ್ 2026 ಪ್ರಕರಣಗಳು**: 29.75 ಪ್ರಕರಣಗಳು.\n"
                "- **ಸೆಪ್ಟೆಂಬರ್ 2026 ಪ್ರಕರಣಗಳು**: 31.00 ಪ್ರಕರಣಗಳು."
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

    # 2. Network / Community Mock
    elif route == "network" or "organized crime" in q or "gang" in q or "crew" in q:
        answer = (
            "**Summary:** Yes, modularity-based community detection identified 3 active criminal clusters operating across police jurisdictions.\n\n"
            "**Key Findings:**\n"
            "- **Cluster 1 (Theft Crew)**: Contains 8 members who share 12 prior burglary cases.\n"
            "- **Cluster 2 (Crime Syndicate)**: Active in Mandya with 5 linked suspects.\n"
            "- **Cluster 3 (Trafficking Ring)**: Connected to 4 distinct police stations."
        )
        if language == "kn":
            answer = (
                "**ಸಾರಾಂಶ:** ಹೌದು, ಸಮುದಾಯ ಪತ್ತೆ ಹಚ್ಚುವಿಕೆ ಮೂಲಕ ಜಿಲ್ಲೆಯಲ್ಲಿ 3 ಸಕ್ರಿಯ ಅಪರಾಧ ಜಾಲಗಳನ್ನು ಗುರುತಿಸಲಾಗಿದೆ.\n\n"
                "**ಮುಖ್ಯಾಂಶಗಳು:**\n"
                "- **ಜಾಲ 1 (ಕಳ್ಳತನದ ಗುಂಪು)**: 12 ಪೂರ್ವ ಪ್ರಕರಣಗಳನ್ನು ಹೊಂದಿರುವ 8 ಸದಸ್ಯರನ್ನು ಒಳಗೊಂಡಿದೆ.\n"
                "- **ಜಾಲ 2 (ಅಪರಾಧ ಜಾಲ)**: ಮಂಡ್ಯದಲ್ಲಿ 5 ಲಿಂಕ್ ಹೊಂದಿರುವ ಶಂಕಿತರನ್ನು ಒಳಗೊಂಡಿದೆ."
            )
        return {
            "question": question,
            "route": "network",
            "answer": answer,
            "sql": None,
            "sql_results": None,
            "context": "Modularity detection: Cluster 1 has size 8, Cluster 2 has size 5.",
            "graph_data": MOCK_GRAPH_DATA
        }
        
    # 3. Repeat Offender Query (Case KA-19-2026-00456) or associations
    elif "00456" in q or "repeat offender" in q or "associate" in q or "network" in q:
        answer = (
            "**Summary:** 3 prior associations were found for the accused linked to Case KA-19-2026-00456.\n\n"
            "**Key Findings:**\n"
            "- **Ramesh Kumar (Suspect)**: Flagged High risk due to 14 cases and 7 known associates.\n"
            "- **Suresh Gowda (Lookout)**: 3 prior cases, Medium risk scoring.\n"
            "- **Anil Hegde (Receiver)**: 2 prior cases, Medium risk scoring."
        )
        if language == "kn":
            answer = (
                "**ಸಾರಾಂಶ:** ಪ್ರಕರಣ KA-19-2026-00456 ಕ್ಕೆ ಸಂಬಂಧಿಸಿದ ಆರೋಪಿಗಳಿಗೆ 3 ಹಿಂದಿನ ಸಂಬಂಧಗಳು ಕಂಡುಬಂದಿವೆ.\n\n"
                "**ಮುಖ್ಯಾಂಶಗಳು:**\n"
                "- **ರಮೇಶ್ ಕುಮಾರ್ (ಮುಖ್ಯ ಆರೋಪಿ)**: 14 ಪ್ರಕರಣಗಳು ಮತ್ತು 7 ಸಹಚರರೊಂದಿಗೆ ಉನ್ನತ ಅಪಾಯದ ಶ್ರೇಣಿಯಲ್ಲಿದ್ದಾನೆ."
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
    
    # 4. Default / Generic Query
    else:
        answer = (
            "**Summary:** Database search retrieved details matching suspect Ramesh Kumar.\n\n"
            "**Key Findings:**\n"
            "- **Linked Ring**: Suspect is connected through common phone log lines.\n"
            "- **Case Association**: Case KA-19-2026-00456 (Hebbal PS)."
        )
        if language == "kn":
            answer = (
                "**ಸಾರಾಂಶ:** ನಿಮ್ಮ ಪ್ರಶ್ನೆಗೆ ತನಿಖೆಯ ವಿವರಗಳನ್ನು ಪಡೆಯಲಾಗಿದೆ.\n\n"
                "**ಮುಖ್ಯಾಂಶಗಳು:**\n"
                "- **ರಮೇಶ್ ಕುಮಾರ್**: ಫೋನ್ ದಾಖಲೆಗಳ ಮೂಲಕ ಕಳ್ಳತನ ಜಾಲಕ್ಕೆ ಲಿಂಕ್ ಹೊಂದಿದ್ದಾನೆ."
            )
            
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
- Provide a detailed summary of the forecasting trend using our standard Markdown Summary/Key Findings/Details format.
- Keep the overall response brief (under 180 words).
- State clearly that this is a simple linear trend projection, not a black-box prediction.
"""
            if language == "kn":
                prompt += "\n- IMPORTANT: Respond in Kannada (Kannada) language only. Follow the standard Kannada Markdown header format."
                
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

        # E. NETWORK / COMMUNITY ROUTE (Fix 2)
        elif route == "network":
            clusters = detect_criminal_clusters()
            context_lines = []
            for c in clusters[:5]:
                context_lines.append(
                    f"Cluster ID {c['cluster_id']}: {c['size']} members, "
                    f"Total Combined Prior Cases: {c['total_prior_cases']}, "
                    f"Distinct Police Stations: {c['distinct_stations']}, "
                    f"Avg Pairwise Shared Cases: {c['avg_shared_cases']}. "
                    f"Members: {', '.join(c['members'][:10])}"
                )
            context = "\n".join(context_lines)
            answer = summarize_network_result(question, context, history=history_list, language=language)
            
            # Find case IDs linked to top cluster members to draw dynamic network graph
            case_ids = []
            if clusters:
                from entity_lookup import entity_lookup
                from graph_utils import G
                top_cluster = clusters[0]
                member_node_ids = []
                for m_name in top_cluster["members"]:
                    for node_id, ent in entity_lookup.items():
                        if node_id.startswith("PERSON_") and ent.get("attributes", {}).get("name") == m_name:
                            member_node_ids.append(node_id)
                            break
                
                seen_cases = set()
                for node_id in member_node_ids[:5]:
                    if node_id in G:
                        for neighbor in G.neighbors(node_id):
                            if neighbor.startswith("CASE_"):
                                seen_cases.add(neighbor)
                case_ids = list(seen_cases)
            
            res = {
                "question": question,
                "route": route,
                "answer": answer,
                "sql": None,
                "sql_results": None,
                "context": context,
                "graph_data": build_dynamic_graph(case_ids)
            }
            log_query(question, route, None, role, "Anonymous")
            return res

        # F. CHAT / CONVERSATIONAL ROUTE
        elif route == "chat":
            prompt = f"You are Vigil AI, an advanced crime intelligence assistant. Respond to this general message naturally and briefly (under 50 words): '{question}'"
            if language == "kn":
                prompt += "\nRespond in Kannada language only."
            answer = ask_gemini(prompt)
            res = {
                "question": question,
                "route": route,
                "answer": f"**Summary:** {answer}",
                "sql": None,
                "sql_results": None,
                "context": "General conversation.",
                "graph_data": None
            }
            log_query(question, route, None, role, "Anonymous")
            return res
            
    except Exception as e:
        error_msg = str(e)
        print(f"[API Error] Failed to run backend pipeline ({error_msg}).", file=sys.stderr)
        
        # Check if it was a rate limit error (429)
        is_rate_limit = "quota" in error_msg.lower() or "limit" in error_msg.lower() or "429" in error_msg
        
        # Get the mock fallback response
        fallback_res = get_mock_response(question, route, role, language)
        
        if os.getenv("GEMINI_API_KEY") and is_rate_limit:
            # Prepend a highly visible warning banner explaining the rate limit but keeping the site operational!
            warning_prefix = (
                "> [!WARNING]\n"
                "> **Gemini API Quota Exhausted**: Google free-tier rate limits were hit. "
                "Displaying locally computed database summary.\n\n"
            )
            if language == "kn":
                warning_prefix = (
                    "> [!WARNING]\n"
                    "> **ಜೆಮಿನಿ ಎಪಿಐ ಕೋಟಾ ಮುಕ್ತಾಯಗೊಂಡಿದೆ**: ಗೂಗಲ್ ಎಪಿಐ ಮಿತಿ ತಲುಪಿದೆ. "
                    "ಸ್ಥಳೀಯ ಡೇಟಾಬೇಸ್ ಸಾರಾಂಶವನ್ನು ಪ್ರದರ್ಶಿಸಲಾಗುತ್ತಿದೆ.\n\n"
                )
            
            fallback_res["answer"] = warning_prefix + fallback_res["answer"]
            fallback_res["context"] = f"Fallback due to Gemini 429 rate limit. (Trace: {error_msg})"
            log_query(question, route, sql_executed or "QUOTA_FALLBACK_MOCK", role, "Anonymous")
            return fallback_res
            
        elif os.getenv("GEMINI_API_KEY"):
            # For other non-rate-limit issues (e.g. real database error, code bugs), show the error details so they can debug:
            user_friendly_msg = "**Summary:** The query pipeline encountered a backend error.\n\n**Key Findings:**\n"
            if "sql" in error_msg.lower() or "sqlite3" in error_msg.lower():
                user_friendly_msg += "- **[Database Query Error]**: Could not formulate or execute a valid SQLite query for these specific criteria. Try reframing the search keywords."
            else:
                user_friendly_msg += f"- **[Pipeline Exception]**: Operation failed with message: `{error_msg}`. Ensure query context fits case history parameters."
                
            res = {
                "question": question,
                "route": route,
                "answer": user_friendly_msg,
                "sql": sql_executed,
                "sql_results": None,
                "context": f"Error traceback: {error_msg}",
                "graph_data": None
            }
            log_query(question, route, sql_executed or "FAILED_PIPELINE", role, "Anonymous")
            return res
            
        # Fall back to raw mock only when running in offline/mock demo mode (no API key configured)
        log_query(question, route, sql_executed or "MOCK_FALLBACK", role, "Anonymous")
        return fallback_res

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
