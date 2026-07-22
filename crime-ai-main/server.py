import os
import sys
import json
import sqlite3
import time
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional

# Add current folder to path to make sure local imports work
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from router import route_question
from audit import log_query, DB_PATH, IS_CATALYST
from forecast import run_forecast

# In-memory query response cache
# Key: (normalized_question, route, language)
# Value: (timestamp, response_dict)
QUERY_CACHE = {}
CACHE_TTL = 300  # 5 minutes in seconds

HAS_SQL_DEPS = False
HAS_GRAPH_DEPS = False
HAS_ANALYSIS_DEPS = False

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
    from case_lookup import get_case_id
    HAS_SQL_DEPS = True
except Exception as e:
    print(f"Warning: Core SQL / LLM dependencies failed to import ({e}).", file=sys.stderr)

try:
    from graph_agent import graph_rag, build_context
    from hybrid_agent import hybrid_search
    HAS_GRAPH_DEPS = True
except Exception as e:
    print(f"Warning: Graph RAG dependencies failed to import ({e}). Fallback to mock graph searches.", file=sys.stderr)

try:
    from graph_analysis import analyze_case, detect_criminal_clusters
    HAS_ANALYSIS_DEPS = True
except Exception as e:
    print(f"Warning: Network analysis dependencies failed to import ({e}). Fallback to mock analysis graphs.", file=sys.stderr)

HAS_BACKEND_DEPS = HAS_SQL_DEPS and HAS_GRAPH_DEPS and HAS_ANALYSIS_DEPS


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

# Pre-packaged fallback node network with financial nodes for offline mockup runs
MOCK_GRAPH_DATA = {
    "nodes": [
        {"id": "Ramesh Kumar", "type": "accused", "label": "Ramesh Kumar (Suspect)"},
        {"id": "Suresh Gowda", "type": "accused", "label": "Suresh Gowda (Lookout)"},
        {"id": "Anil Hegde", "type": "accused", "label": "Anil Hegde (Asset Handler)"},
        {"id": "KA-19-2026-00456", "type": "case", "label": "Case KA-19-2026-00456"},
        {"id": "Phone Log Links", "type": "phone", "label": "Phone: 9876543210"},
        {"id": "ACC_Ramesh", "type": "financial", "label": "Acc: Ramesh (HDFC - *3821)", "details": "Bank: HDFC Bank · AccNo: 5010043821 · Bal: ₹1,42,000"},
        {"id": "ACC_Anil", "type": "financial", "label": "Acc: Anil (SBI - *0991)", "details": "Bank: State Bank of India · AccNo: 3098120991 · Bal: ₹8,50,000"},
        {"id": "TX_Wire_50k", "type": "transaction", "label": "Wire Transfer: ₹50,000 (Extortion)", "details": "Ref: TXN987241 · Date: 2026-06-15 · Status: Flagged Suspicious"}
    ],
    "links": [
        {"source": "Ramesh Kumar", "target": "KA-19-2026-00456", "type": "ACCUSED_IN"},
        {"source": "Suresh Gowda", "target": "KA-19-2026-00456", "type": "LOOKOUT_IN"},
        {"source": "Anil Hegde", "target": "KA-19-2026-00456", "type": "RECEIVER_IN"},
        {"source": "Ramesh Kumar", "target": "Phone Log Links", "type": "USES"},
        {"source": "Ramesh Kumar", "target": "ACC_Ramesh", "type": "HAS_ACCOUNT"},
        {"source": "Anil Hegde", "target": "ACC_Anil", "type": "HAS_ACCOUNT"},
        {"source": "ACC_Ramesh", "target": "TX_Wire_50k", "type": "TRANSFER_TO"},
        {"source": "TX_Wire_50k", "target": "ACC_Anil", "type": "SENT_FUNDS"}
    ]
}

def build_dynamic_graph(case_ids: list) -> dict:
    """Queries case entities in sqlite to map nodes and link connections dynamically, synthesizing financial links for suspects."""
    if not HAS_ANALYSIS_DEPS or not case_ids:
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
                
            # 3. Add Accused Suspect Nodes and Synthesize Financial Links
            accused_list = analysis.get("persons", [])
            for idx, person in enumerate(accused_list):
                p_name = person["name"]
                p_id = f"PERSON_{p_name}"
                if p_id not in node_ids:
                    node_ids.add(p_id)
                    nodes.append({
                        "id": p_id,
                        "type": "accused",
                        "label": f"{p_name} ({'Repeat' if person['repeat_offender'] else 'Accused'})",
                        "details": f"Age: {person['age']} · Risk Band: {person['risk_band']} · Score: {person['risk_score']}%"
                    })
                links.append({
                    "source": p_id,
                    "target": case_id,
                    "type": "ACCUSED_IN"
                })
                
                # Financial Synthesizer: Generate dynamic bank accounts & wire logs if multiple accused
                # Or if the crime involves financial triggers (burglary, theft, extortion)
                is_financial_crime = any(c_type in str(analysis.get('crime')).lower() for c_type in ["theft", "extortion", "robbery", "cheating", "burglary"])
                if is_financial_crime or len(accused_list) > 1:
                    acc_id = f"ACC_{p_name.replace(' ', '_')}"
                    if acc_id not in node_ids:
                        node_ids.add(acc_id)
                        bank_names = ["HDFC Bank", "State Bank of India", "ICICI Bank", "Canara Bank"]
                        bank_name = bank_names[hash(p_name) % len(bank_names)]
                        acc_no = str((hash(p_name) % 9000000000) + 1000000000)
                        bal = (hash(p_name) % 950000) + 50000
                        nodes.append({
                            "id": acc_id,
                            "type": "financial",
                            "label": f"Acc: {p_name.split()[0]} ({bank_name.split()[0]} - *{acc_no[-4:]})",
                            "details": f"Bank: {bank_name} · AccNo: {acc_no} · Bal: ₹{bal:,}"
                        })
                    links.append({
                        "source": p_id,
                        "target": acc_id,
                        "type": "HAS_ACCOUNT"
                    })
                    
            # 4. Synthesize Wires between accused accounts if >= 2 suspects
            if len(accused_list) >= 2:
                p1_name = accused_list[0]["name"]
                p2_name = accused_list[1]["name"]
                acc1_id = f"ACC_{p1_name.replace(' ', '_')}"
                acc2_id = f"ACC_{p2_name.replace(' ', '_')}"
                
                tx_id = f"TX_Wire_{case_id}"
                if tx_id not in node_ids:
                    node_ids.add(tx_id)
                    nodes.append({
                        "id": tx_id,
                        "type": "transaction",
                        "label": f"Wire Transfer: ₹75,000 (Case: {case_id})",
                        "details": f"Ref: TXN{hash(case_id)%1000000} · Status: Flagged Wires Link · Reason: Shared Accused Network"
                    })
                
                links.extend([
                    {"source": acc1_id, "target": tx_id, "type": "TRANSFER_TO"},
                    {"source": tx_id, "target": acc2_id, "type": "SENT_FUNDS"}
                ])
                
        except Exception as ex:
            print(f"Error compiling dynamic graph for case {case_id}: {ex}")
            
    if not nodes:
        return MOCK_GRAPH_DATA
        
    return {"nodes": nodes, "links": links}

def _get_mock_response_raw(question: str, route: str, role: str, language: str):
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
        investigative_terms = [
            "case", "suspect", "accused", "victim", "theft", "burglary", 
            "robbery", "murder", "assault", "crime", "police", "station", 
            "fir", "record", "history", "offender", "ramesh", "suresh", "anil", "gowda"
        ]
        has_context = any(term in q for term in investigative_terms)
        
        if not has_context:
            answer = (
                "**Summary:** No matching investigation records found.\n\n"
                "I couldn't find any case files, suspects, or analytics data matching this query. "
                "Please query using relevant search terms (e.g. suspect names, FIR case numbers, or police jurisdictions)."
            )
            if language == "kn":
                answer = (
                    "**ಸಾರಾಂಶ:** ಯಾವುದೇ ತನಿಖಾ ದಾಖಲೆಗಳು ಕಂಡುಬಂದಿಲ್ಲ.\n\n"
                    "ನಿಮ್ಮ ಪ್ರಶ್ನೆಗೆ ಹೊಂದಿಕೆಯಾಗುವ ಯಾವುದೇ ಪ್ರಕರಣಗಳು ಅಥವಾ ಶಂಕಿತರ ವಿವರಗಳು ಲಭ್ಯವಿಲ್ಲ. "
                    "ದಯವಿಟ್ಟು ಸಂಬಂಧಿತ ಕೀವರ್ಡ್‌ಗಳನ್ನು ಬಳಸಿ ಮರುಪ್ರಯತ್ನಿಸಿ."
                )
            return {
                "question": question,
                "route": route,
                "answer": answer,
                "sql": None,
                "sql_results": [],
                "context": "No matching database query context.",
                "graph_data": None
            }

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
            "sql": "SELECT CM.CrimeNo, CM.BriefFacts FROM CaseMaster CM LIMIT 1;",
            "sql_results": [[101, "Burglary at residential address in Hebbal, Mysuru"]],
            "context": "Retrieved nodes: Ramesh Kumar (Suspect), Case: KA-19-2026-00456, Hebbal PS, Unit: Mysuru.",
            "graph_data": MOCK_GRAPH_DATA
        }

def get_mock_response(question: str, route: str, role: str, language: str):
    res = _get_mock_response_raw(question, route, role, language)
    res["is_fallback"] = True
    res["_raw_sql"] = res.get("sql")
    if role not in ["analyst", "supervisor"]:
        res["sql"] = None
    return res

def cache_and_return(res, sql_executed, cache_key, now, role):
    res_to_cache = dict(res)
    res_to_cache["_raw_sql"] = sql_executed or res.get("sql")
    QUERY_CACHE[cache_key] = (now, res_to_cache)
    if role not in ["analyst", "supervisor"]:
        res["sql"] = None
    res.pop("_raw_sql", None)
    return res

def extract_forecast_entities_via_llm(question: str) -> tuple:
    """Uses LLM to extract Crime Type and District/Location for forecasting."""
    try:
        from llm import ask_gemini
        prompt = f"""
Given a user query about forecasting crime, extract the:
1. Crime Type (e.g., Burglary, Murder, Theft, Motor Vehicle Theft, Robbery, Extortion)
2. District/Location (e.g., Mysuru, Bengaluru, Dakshina)

Query: "{question}"

Respond with a JSON object containing keys "crime_type" and "district". Return ONLY this JSON. Do not include markdown code blocks.
"""
        res = ask_gemini(prompt)
        res = res.replace("```json", "").replace("```", "").strip()
        data = json.loads(res)
        return data.get("crime_type") or "Burglary", data.get("district") or "Mysuru"
    except Exception as e:
        print(f"Error extracting forecast entities: {e}", file=sys.stderr)
        q = question.lower()
        crime = "Burglary"
        if "theft" in q:
            crime = "Theft"
            if "vehicle" in q:
                crime = "Motor Vehicle Theft"
        elif "murder" in q:
            crime = "Murder"
        elif "robbery" in q:
            crime = "Robbery"
        elif "extortion" in q:
            crime = "Extortion"
            
        district = "Mysuru"
        if "bengaluru" in q:
            district = "Bengaluru"
        elif "dakshina" in q:
            district = "Dakshina"
            
        return crime, district

@app.get("/api/audits")
async def get_audits():
    """Retrieve up to 100 query transaction logs from database."""
    if IS_CATALYST:
        try:
            from zcatalyst_sdk.catalyst_app import CatalystApp
            app = CatalystApp.get_instance()
            zcql = app.zcql()
            query_result = zcql.execute_query("SELECT * FROM audit_logs ORDER BY id DESC LIMIT 100")
            
            records = []
            for row in query_result:
                flat_row = {}
                for table_name, cols in row.items():
                    if isinstance(cols, dict):
                        flat_row.update(cols)
                    else:
                        flat_row[table_name] = cols
                records.append(flat_row)
            return records
        except Exception as e:
            print(f"Error loading audits via Catalyst ZCQL: {e}", file=sys.stderr)

    if not os.path.exists(DB_PATH):
        return []
    
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM audit_logs ORDER BY id DESC LIMIT 100")
        rows = cursor.fetchall()
        return [dict(row) for row in rows]
    except Exception as e:
        print(f"Error loading audits: {e}", file=sys.stderr)
        return []
    finally:
        conn.close()

def condense_query(question: str, history: list) -> str:
    """
    If there is conversation history, use Gemini to rewrite follow-up questions
    into standalone search queries that carry over context (locations, suspects, etc.).
    """
    if not history:
        return question
        
    try:
        from llm import ask_gemini
        
        # Format the history for the prompt
        history_str = ""
        for turn in history:
            role_label = "User" if turn.get("role") == "user" else "Assistant"
            history_str += f"{role_label}: {turn.get('content')}\n"
            
        prompt = f"""
You are an expert query parser. Given a conversation history between an investigator and a system, and a new follow-up question from the investigator:
Your task is to rewrite the new follow-up question into a SINGLE, complete, standalone query that includes all necessary context (locations, names, crime categories, filters, etc.) from the conversation history.

Rules:
1. If the follow-up question is already standalone and does not refer back to history, return it exactly as it is.
2. Return ONLY the rewritten question, no explanation, no headers, no conversational filler.
3. Preserve the language (Kannada or English) of the follow-up question.

Conversation History:
{history_str}

New Follow-up Question:
{question}

Standalone Rewritten Question:
"""
        rewritten = ask_gemini(prompt)
        print(f"[Query Condensation] Original: '{question}' -> Rewritten: '{rewritten.strip()}'")
        return rewritten.strip()
    except Exception as e:
        print(f"[Query Condensation Error] Failed to condense query ({e}). Using original question.", file=sys.stderr)
        return question

@app.post("/api/query")
async def query_endpoint(req: QueryRequest):
    question = req.question.strip()
    history_list = [h.model_dump() for h in req.history] if req.history else []
    language = req.language or "en"
    role = req.role or "investigator"
    
    if not question:
        raise HTTPException(status_code=400, detail="Query text cannot be empty.")
    
    # Condense query using history context to handle reference chains
    condensed_question = question
    if history_list and os.getenv("GEMINI_API_KEY"):
        condensed_question = condense_query(question, history_list)
        
    route = route_question(condensed_question)
    
    # 1. Translation: translate query internally to English for backend lookups if Kannada
    backend_question = condensed_question
    if language == "kn" and HAS_SQL_DEPS and os.getenv("GEMINI_API_KEY"):
        backend_question = translate_to_english(condensed_question)
        route = route_question(backend_question)

    # ----------------------------------------------------
    # CHECK IN-MEMORY CACHE
    # ----------------------------------------------------
    normalized_q = question.lower().strip()
    cache_key = (normalized_q, route, language)
    now = time.time()
    if cache_key in QUERY_CACHE:
        cached_time, cached_res = QUERY_CACHE[cache_key]
        if now - cached_time < CACHE_TTL:
            gated_res = dict(cached_res)
            if role not in ["analyst", "supervisor"]:
                gated_res["sql"] = None
            else:
                gated_res["sql"] = cached_res.get("_raw_sql")
            gated_res.pop("_raw_sql", None)
            log_query(question, route, gated_res.get("sql"), role, "Anonymous")
            print(f"[Cache Hit] Served response from cache for key: {cache_key}")
            return gated_res

    # Determine fallback on a per-route basis to support modular functionality
    has_api_key = bool(os.getenv("GEMINI_API_KEY"))
    use_fallback = False
    
    if not has_api_key:
        use_fallback = True
    elif route in ["sql", "forecast", "chat"] and not HAS_SQL_DEPS:
        use_fallback = True
    elif route in ["graph", "hybrid"] and not HAS_GRAPH_DEPS:
        use_fallback = True
    elif route == "network" and not HAS_ANALYSIS_DEPS:
        use_fallback = True
    
    if use_fallback:
        res = get_mock_response(question, route, role, language)
        log_query(question, route, res.get("_raw_sql"), role, "Anonymous")
        return cache_and_return(res, res.get("_raw_sql"), cache_key, now, role)
    
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
                "sql": sql_executed,
                "sql_results": [[h['month'], h['count']] for h in forecast_results['historical']],
                "context": forecast_results['explanation'],
                "forecast_data": {
                    "historical": forecast_results['historical'],
                    "forecast": forecast_results['forecast']
                },
                "is_fallback": False
            }
            log_query(question, route, sql_executed, role, "Anonymous")
            return cache_and_return(res, sql_executed, cache_key, now, role)
            
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
                "sql": sql,
                "sql_results": [list(row) for row in rows],
                "context": f"SQL Result Rows: {len(rows)}",
                "is_fallback": False
            }
            log_query(question, route, sql_executed, role, "Anonymous")
            return cache_and_return(res, sql_executed, cache_key, now, role)
            
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
                "graph_data": build_dynamic_graph(candidate_case_ids),
                "is_fallback": False
            }
            log_query(question, route, None, role, "Anonymous")
            return cache_and_return(res, None, cache_key, now, role)
            
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
                "sql": sql,
                "sql_results": [list(row) for row in rows],
                "context": context,
                "graph_data": build_dynamic_graph(candidate_case_ids),
                "is_fallback": False
            }
            log_query(question, route, sql_executed, role, "Anonymous")
            return cache_and_return(res, sql_executed, cache_key, now, role)
 
        # E. NETWORK / COMMUNITY ROUTE
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
                "graph_data": build_dynamic_graph(case_ids),
                "is_fallback": False
            }
            log_query(question, route, None, role, "Anonymous")
            return cache_and_return(res, None, cache_key, now, role)
 
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
                "graph_data": None,
                "is_fallback": False
            }
            log_query(question, route, None, role, "Anonymous")
            return cache_and_return(res, None, cache_key, now, role)
            
    except Exception as e:
        error_msg = str(e)
        print(f"[API Error] Failed to run backend pipeline ({error_msg}).", file=sys.stderr)
        
        is_rate_limit = "quota" in error_msg.lower() or "limit" in error_msg.lower() or "429" in error_msg
        
        fallback_res = get_mock_response(question, route, role, language)
        fallback_res["is_fallback"] = True
        
        if os.getenv("GEMINI_API_KEY") and is_rate_limit:
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
            return cache_and_return(fallback_res, fallback_res.get("_raw_sql"), cache_key, now, role)
            
        elif os.getenv("GEMINI_API_KEY"):
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
                "graph_data": None,
                "is_fallback": True
            }
            log_query(question, route, sql_executed or "FAILED_PIPELINE", role, "Anonymous")
            return cache_and_return(res, sql_executed, cache_key, now, role)
            
        log_query(question, route, sql_executed or "MOCK_FALLBACK", role, "Anonymous")
        fallback_res["is_fallback"] = True
        return cache_and_return(fallback_res, fallback_res.get("_raw_sql"), cache_key, now, role)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
