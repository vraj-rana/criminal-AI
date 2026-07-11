import React, { useState, useEffect, useRef } from "react";
import { jsPDF } from "jspdf";

// ---------------------------------------------------------------------------
// DESIGN TOKENS (referencing CSS variables inside styled roots)
// ---------------------------------------------------------------------------

export default function App() {
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content: "Welcome to Vigil AI Crime Intelligence Platform. You can query case files, offender records, or trend forecasts in English and Kannada.",
      route: "system",
      sql: null,
      context: "Initial greeting context.",
      timestamp: new Date().toLocaleTimeString()
    }
  ]);
  const [inputVal, setInputVal] = useState("");
  const [loading, setLoading] = useState(false);
  const [language, setLanguage] = useState("en"); // "en" or "kn"
  const [role, setRole] = useState("investigator"); // "investigator" | "analyst" | "supervisor" | "policymaker"
  const [theme, setTheme] = useState("dark"); // "dark" | "light"
  
  // Custom states for visual analytics
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(true);
  const [showAuditDrawer, setShowAuditDrawer] = useState(false);
  const [auditLogs, setAuditLogs] = useState([]);
  const [showPromptsSidebar, setShowPromptsSidebar] = useState(true);
  
  const threadEndRef = useRef(null);
  const recognitionRef = useRef(null);

  const DETAILED_PROMPT_SUGGESTIONS = [
    {
      title: "1. Network Link Analysis",
      q: "Show repeat offenders linked to Case KA-19-2026-00456 and list their associates",
      desc: "Map the nodes and criminal links for organized break-ins."
    },
    {
      title: "2. Caseload Trend Forecast",
      q: "Predict burglary cases in Mysuru next month using database metrics",
      desc: "Compute a 3-month linear regression projection on local burglary trends."
    },
    {
      title: "3. Spatio-Temporal SQL search",
      q: "How many burglary cases were reported in Mysuru last month?",
      desc: "Run structured aggregations over the district crime master records."
    },
    {
      title: "4. Kannada Local Query",
      q: "ಮೈಸೂರಿನಲ್ಲಿ ಕಳೆದ ತಿಂಗಳು ಎಷ್ಟು ಕಳ್ಳತನ ಪ್ರಕರಣಗಳು ವರದಿಯಾಗಿವೆ?",
      desc: "Queries database using Kannada natural language translation."
    }
  ];

  // Initialize Speech Recognition
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setSpeechSupported(false);
    } else {
      const rec = new SpeechRecognition();
      rec.continuous = false;
      rec.interimResults = false;
      
      rec.onstart = () => setIsListening(true);
      rec.onend = () => setIsListening(false);
      rec.onerror = (e) => {
        console.error("Speech recognition error:", e);
        setIsListening(false);
      };
      rec.onresult = (event) => {
        const resultText = event.results[0][0].transcript;
        setInputVal((prev) => prev + (prev ? " " : "") + resultText);
      };
      
      recognitionRef.current = rec;
    }
  }, []);

  // Sync language selection to Speech Recognition lang parameter
  useEffect(() => {
    if (recognitionRef.current) {
      recognitionRef.current.lang = language === "kn" ? "kn-IN" : "en-IN";
    }
  }, [language]);

  // Auto-scroll to bottom of thread
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Fetch Supervisor Audit logs from database API
  const fetchAuditLogs = async () => {
    try {
      const response = await fetch("http://localhost:8000/api/audits");
      if (!response.ok) throw new Error();
      const data = await response.json();
      setAuditLogs(data);
    } catch {
      // Fallback mock audit log rows if backend is down
      setAuditLogs([
        { id: 4, timestamp: "2026-07-11 21:16:49", question: "predict burglary cases in Mysuru next month", route: "forecast", sql: "SELECT CM.CrimeNo...", role: "Investigator", user_id: "Anonymous" },
        { id: 3, timestamp: "2026-07-11 20:55:12", question: "Show repeat offenders linked to Case KA-19-2026-00456", route: "hybrid", sql: "SELECT DISTINCT...", role: "Supervisor", user_id: "Anonymous" },
        { id: 2, timestamp: "2026-07-11 20:53:06", question: "How many burglary cases in Mysuru last month?", route: "sql", sql: "SELECT COUNT(*)...", role: "Analyst", user_id: "Anonymous" },
        { id: 1, timestamp: "2026-07-11 20:45:10", question: "ಮೈಸೂರಿನಲ್ಲಿ ಕಳ್ಳತನ ಪ್ರಕರಣಗಳು", route: "sql", sql: "SELECT COUNT(*)...", role: "Investigator", user_id: "Anonymous" }
      ]);
    }
  };

  useEffect(() => {
    if (showAuditDrawer) {
      fetchAuditLogs();
    }
  }, [showAuditDrawer]);

  const toggleMic = () => {
    if (!speechSupported || !recognitionRef.current) return;
    
    if (isListening) {
      recognitionRef.current.stop();
    } else {
      recognitionRef.current.start();
    }
  };

  const handleNewConversation = () => {
    setMessages([
      {
        role: "assistant",
        content: language === "kn" 
          ? "ವಿಜಿಲ್ ಎಐ ಅಪರಾಧ ಗುಪ್ತಚರ ವೇದಿಕೆಗೆ ಸುಸ್ವಾಗತ. ನೀವು ಪ್ರಕರಣದ ಕಡತಗಳು, ಅಪರಾಧಿಗಳ ವಿವರಗಳು ಅಥವಾ ಅಪರಾಧ ಪ್ರವೃತ್ತಿಗಳ ಬಗ್ಗೆ ಕನ್ನಡ ಮತ್ತು ಇಂಗ್ಲಿಷ್‌ನಲ್ಲಿ ವಿವರವಾಗಿ ಪ್ರಶ್ನಿಸಬಹುದು."
          : "Welcome to Vigil AI Crime Intelligence Platform. You can query case files, offender records, or trend forecasts in English and Kannada.",
        route: "system",
        sql: null,
        context: "New conversation initiated.",
        timestamp: new Date().toLocaleTimeString()
      }
    ]);
    setInputVal("");
  };

  const handleExportPDF = () => {
    const doc = new jsPDF();
    let yOffset = 20;
    
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("Vigil AI - Official Case Investigation Log", 14, yOffset);
    yOffset += 10;
    
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`Role Level: ${role.toUpperCase()}  |  Language: ${language.toUpperCase()}  |  Theme: ${theme.toUpperCase()}`, 14, yOffset);
    yOffset += 6;
    doc.text(`Exported Date: ${new Date().toLocaleString()}`, 14, yOffset);
    yOffset += 14;

    messages.forEach((msg) => {
      if (yOffset > 270) {
        doc.addPage();
        yOffset = 20;
      }
      
      doc.setFont("helvetica", "bold");
      const sender = msg.role === "user" ? "USER" : "ASSISTANT";
      doc.text(`[${msg.timestamp}] ${sender}:`, 14, yOffset);
      yOffset += 6;

      doc.setFont("helvetica", "normal");
      const lines = doc.splitTextToSize(msg.content, 180);
      lines.forEach((line) => {
        if (yOffset > 270) {
          doc.addPage();
          yOffset = 20;
        }
        doc.text(line, 14, yOffset);
        yOffset += 6;
      });

      if (msg.route && msg.route !== "system") {
        if (yOffset > 260) {
          doc.addPage();
          yOffset = 20;
        }
        doc.setFont("helvetica", "oblique");
        doc.text(`- Route: ${msg.route}`, 18, yOffset);
        yOffset += 5;
        if (msg.sql) {
          doc.text(`- Generated SQL: ${msg.sql}`, 18, yOffset);
          yOffset += 5;
        }
        if (msg.context) {
          doc.text(`- Citations: ${msg.context}`, 18, yOffset);
          yOffset += 5;
        }
      }
      
      yOffset += 8;
    });

    doc.save("Vigil_AI_Investigation_Report.pdf");
  };

  const handleSend = async (customQText) => {
    const userMessageText = (customQText || inputVal).trim();
    if (!userMessageText || loading) return;

    setInputVal("");
    
    const userMsg = {
      role: "user",
      content: userMessageText,
      timestamp: new Date().toLocaleTimeString()
    };
    
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    // Prepare history: send last 6 turns (excluding initial system notices)
    const historyPayload = messages
      .filter((m) => m.route !== "system" && m.route !== "error")
      .slice(-6)
      .map((m) => ({
        role: m.role,
        content: m.content
      }));

    try {
      const response = await fetch("http://localhost:8000/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: userMessageText,
          history: historyPayload,
          language: language,
          role: role
        })
      });

      if (!response.ok) {
        throw new Error("API error.");
      }

      const data = await response.json();
      
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.answer,
          route: data.route,
          sql: data.sql,
          context: data.context,
          forecastData: data.forecast_data,
          graphData: data.graph_data,
          timestamp: new Date().toLocaleTimeString()
        }
      ]);
    } catch (err) {
      console.warn("Backend server unreachable. Generating response via local mock fallback.");
      
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Backend unreachable, showing a cached example response.",
          route: "error",
          sql: null,
          context: null,
          timestamp: new Date().toLocaleTimeString(),
          isSystemNotice: true
        }
      ]);

      setTimeout(() => {
        const queryLower = userMessageText.toLowerCase();
        let mockAnswer = "Detailed Analysis: Our investigation database search returned matches for suspect Ramesh Kumar, active in burglaries inside Mysuru District. Criminological profiling suggests similar modus operandi links across 3 neighboring police stations.";
        let mockSql = null;
        let mockContext = "Accused records: Ramesh Kumar (ID: 9871) · Case: KA-19-2026-00456";
        let mockRoute = "graph";
        let mockForecastData = null;
        let mockGraphData = null;

        if (queryLower.includes("predict") || queryLower.includes("forecast") || queryLower.includes("next month")) {
          mockRoute = "forecast";
          mockAnswer = language === "kn" 
            ? "ಮುನ್ಸೂಚನೆ ವರದಿ: ಮೈಸೂರಿನಲ್ಲಿ ಕಳ್ಳತನದ ಪ್ರವೃತ್ತಿ ಏರಿಕೆಯಾಗುತ್ತಿದೆ. ಜುಲೈ 2026 ಕ್ಕೆ ಅಂದಾಜು 28.5 ಪ್ರಕರಣಗಳು, ಆಗಸ್ಟ್ಗೆ 29.75 ಪ್ರಕರಣಗಳು ಮತ್ತು ಸೆಪ್ಟೆಂಬರ್ಗೆ 31.00 ಪ್ರಕರಣಗಳನ್ನು ಸರಳ ರೇಖೀಯ ಪ್ರವೃತ್ತಿ ಅಂದಾಜಿನ ಮೂಲಕ ಲೆಕ್ಕಹಾಕಲಾಗಿದೆ."
            : "Detailed Forecast: Linear regression trend calculations predict a slight upward trend in Burglary cases inside Mysuru. July 2026: 28.50 cases, August 2026: 29.75 cases, and September 2026: 31.00 cases. Causal explanation: simple linear line fitting over historical counts.";
          mockSql = "SELECT strftime('%Y-%m', CM.CrimeRegisteredDate) as month, COUNT(*) FROM CaseMaster CM JOIN CrimeSubHead CS ON CM.CrimeMinorHeadID = CS.CrimeSubHeadID JOIN Unit U ON CM.PoliceStationID = U.UnitID WHERE CS.CrimeHeadName = 'Burglary' AND U.UnitName LIKE '%Mysuru%' GROUP BY month;";
          mockContext = "Forecast methodology: Simple linear regression equation (y = 1.25*x + 14.5). Capped at 500 rows.";
          mockForecastData = {
            historical: [
              { month: "2026-01", count: 22 },
              { month: "2026-02", count: 24 },
              { month: "2026-03", count: 23 },
              { month: "2026-04", count: 25 },
              { month: "2026-05", count: 26 },
              { month: "2026-06", count: 27 }
            ],
            forecast: [
              { month: "2026-07", count: 28.5 },
              { month: "2026-08", count: 29.75 },
              { month: "2026-09", count: 31.0 }
            ]
          };
        } else if (queryLower.includes("00456") || queryLower.includes("repeat offender") || queryLower.includes("associate") || queryLower.includes("network")) {
          mockRoute = "hybrid";
          mockAnswer = language === "kn"
            ? "ನೆಟ್‌ವರ್ಕ್ ವಿಶ್ಲೇಷಣೆ: ಪ್ರಕರಣ KA-19-2026-00456 ಕ್ಕೆ ಸಂಬಂಧಿಸಿದಂತೆ 3 ಪರಿಚಿತ ಸಕ್ರಿಯ ಕಳ್ಳತನ ಆರೋಪಿಗಳು ಪತ್ತೆಯಾಗಿದ್ದಾರೆ. ರಮೇಶ್ ಕುಮಾರ್ (ಮುಖ್ಯ ಆರೋಪಿ) ಜೊತೆಗೆ ಸಹಚರರಾದ ಸುರೇಶ್ ಗೌಡ ಮತ್ತು ಅನಿಲ್ ಹೆಗಡೆ ನಡುವೆ ನೇರ ಸಂಪರ್ಕಗಳಿವೆ."
            : "Network Analytics Report: Visual relationship graphs map 3 accused linked to organized house break-ins inside Mysuru. Suspect Ramesh Kumar has direct log links to lookout Suresh Gowda and receiver Anil Hegde.";
          mockSql = "SELECT DISTINCT CM.CrimeNo, PI.FullName, PI.IsRepeatOffender FROM Accused A JOIN CaseMaster CM ON A.CaseMasterID = CM.CaseMasterID JOIN PersonIdentity PI ON A.PersonIdentityID = PI.PersonIdentityID WHERE CM.CaseNo = 'KA-19-2026-00456';";
          mockContext = "Accused records: Ramesh Kumar (ID: 9871) · Lookout: Suresh Gowda · Receiver: Anil Hegde · Cases: KA-19-2026-00456";
          mockGraphData = {
            nodes: [
              { id: "Ramesh Kumar", type: "accused", label: "Ramesh Kumar (Suspect)" },
              { id: "Suresh Gowda", type: "accused", label: "Suresh Gowda (Lookout)" },
              { id: "Anil Hegde", type: "accused", label: "Anil Hegde (Asset Handler)" },
              { id: "KA-19-2026-00456", type: "case", label: "Case KA-19-2026-00456" },
              { id: "Phone: 9876543210", type: "phone", label: "Phone: 9876543210" }
            ],
            links: [
              { source: "Ramesh Kumar", target: "KA-19-2026-00456", type: "ACCUSED_IN" },
              { source: "Suresh Gowda", target: "KA-19-2026-00456", type: "LOOKOUT_IN" },
              { source: "Anil Hegde", target: "KA-19-2026-00456", type: "RECEIVER_IN" },
              { source: "Ramesh Kumar", target: "Phone: 9876543210", type: "USES" }
            ]
          };
        } else if (queryLower.includes("burglary") || queryLower.includes("reported in")) {
          mockRoute = "sql";
          mockAnswer = language === "kn"
            ? "ಕಳೆದ ತಿಂಗಳು ಮೈಸೂರು ಜಿಲ್ಲೆಯಲ್ಲಿ ಒಟ್ಟು 27 ಕಳ್ಳತನ ಪ್ರಕರಣಗಳು ವರದಿಯಾಗಿವೆ. ಇವುಗಳಲ್ಲಿ 14 ಸಕ್ರಿಯ ತನಿಖೆಯಲ್ಲಿದ್ದು, 8 ಪ್ರಕರಣಗಳಲ್ಲಿ ಆರೋಪಪಟ್ಟಿ ಸಲ್ಲಿಕೆಯಾಗಿದೆ."
            : "Structured Query Analysis: The database reports 27 burglary cases in Mysuru during June 2026. The breakdown shows 14 cases under active investigation, 8 chargesheeted, and 5 pending in local court.";
          mockSql = "SELECT COUNT(*) FROM CaseMaster CM JOIN CrimeSubHead CS ON CM.CrimeMinorHeadID = CS.CrimeSubHeadID JOIN Unit U ON CM.PoliceStationID = U.UnitID WHERE CS.CrimeHeadName = 'Burglary' AND U.UnitName LIKE '%Mysuru%' AND CM.CrimeRegisteredDate >= '2026-06-01';";
          mockContext = "CaseMaster Table · District: Mysuru · CrimeSubHead: Burglary";
        }

        const sqlValue = (role === "analyst" || role === "supervisor") ? mockSql : null;

        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: mockAnswer,
            route: mockRoute,
            sql: sqlValue,
            context: mockContext,
            forecastData: mockForecastData,
            graphData: mockGraphData,
            timestamp: new Date().toLocaleTimeString()
          }
        ]);
        setLoading(false);
      }, 800);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div 
      className={`flex flex-col h-screen overflow-hidden transition-colors duration-300 ${
        theme === "dark" ? "bg-[#061224] text-stone-200" : "bg-[#EEF0F1] text-slate-800"
      }`}
      style={{
        "--navy": "#0B1F3A",
        "--midnight": "#061224",
        "--brass": "#C6963C",
        "--paper": "#EEF0F1",
        "--slate": "#445168",
        "--verified": "#2F6F52"
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
        .brass-btn {
          background-color: var(--brass);
          color: var(--navy);
          transition: all 0.2s ease;
        }
        .brass-btn:hover:not(:disabled) { filter: brightness(1.15); }
        .bubble-user {
          background-color: #0B1F3A;
          color: #F4F2EC;
          border-bottom-right-radius: 2px;
          border: 1px solid rgba(198,150,60,0.2);
        }
        .bubble-assistant-dark {
          background-color: #0F2745;
          color: #EDEFF1;
          border-bottom-left-radius: 2px;
          border: 1px solid #1E3A5F;
        }
        .bubble-assistant-light {
          background-color: #FFFFFF;
          color: #0B1F3A;
          border-bottom-left-radius: 2px;
          border: 1px solid #DDE1E4;
          box-shadow: 0 1px 3px rgba(11,31,58,0.05);
        }
        .bubble-notice {
          background-color: #FEF3C7;
          border: 1px solid #F59E0B;
          color: #92400E;
          font-family: 'IBM Plex Mono', monospace;
        }
        .reasoning-container-dark {
          background-color: #081628;
          border-left: 3px solid var(--brass);
        }
        .reasoning-container-light {
          background-color: #F4F5F7;
          border-left: 3px solid var(--brass);
        }
        .dot {
          width: 6px;
          height: 6px;
          background-color: var(--brass);
          border-radius: 50%;
          display: inline-block;
          animation: bounce 1.4s infinite ease-in-out both;
        }
        .dot1 { animation-delay: -0.32s; }
        .dot2 { animation-delay: -0.16s; }
        @keyframes bounce {
          0%, 80%, 100% { transform: scale(0); }
          40% { transform: scale(1.0); }
        }
        ::-webkit-scrollbar {
          width: 6px;
        }
        ::-webkit-scrollbar-track {
          background: transparent;
        }
        ::-webkit-scrollbar-thumb {
          background: #44516860;
          border-radius: 3px;
        }
      `}</style>

      {/* TOP HEADER BAR */}
      <header
        className="shrink-0 flex items-center justify-between px-6 py-3 border-b"
        style={{
          backgroundColor: "#0B1F3A",
          borderColor: "rgba(198,150,60,0.3)"
        }}
      >
        <div className="flex items-center gap-3">
          <svg width="24" height="24" viewBox="0 0 48 48" fill="none">
            <path
              d="M24 4 L42 11 V22 C42 33 34.5 40.5 24 44 C13.5 40.5 6 33 6 22 V11 Z"
              fill="#0B1F3A"
              stroke="var(--brass)"
              strokeWidth="2"
            />
            <path d="M24 12 L24 26 M17 19 L31 19" stroke="var(--brass)" strokeWidth="3" strokeLinecap="round" />
            <circle cx="24" cy="32" r="3" fill="var(--brass)" />
          </svg>
          <div>
            <h1 className="text-sm font-semibold tracking-wide text-stone-100">Vigil AI</h1>
            <p className="text-[10px] font-mono text-[#C6963C] uppercase tracking-wider">Crime Intelligence Engine</p>
          </div>
        </div>

        {/* SETTINGS AND ACTIONS */}
        <div className="flex items-center gap-3">
          {/* Theme Toggle Button */}
          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="p-1.5 rounded transition-all hover:bg-opacity-20 hover:bg-white text-stone-300"
            title="Toggle theme mode"
          >
            {theme === "dark" ? (
              <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="5" />
                <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
              </svg>
            ) : (
              <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>

          {/* User Role Selection */}
          <div className="flex items-center gap-1.5">
            <label className="text-[9px] text-[#8391A3] uppercase font-mono">Role:</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="text-xs rounded bg-[#0F2745] text-stone-200 px-2 py-1 focus:outline-none border border-[#1E3A5F]"
            >
              <option value="investigator">Investigator</option>
              <option value="analyst">Analyst</option>
              <option value="supervisor">Supervisor</option>
              <option value="policymaker">Policymaker</option>
            </select>
          </div>

          {/* Language Selection */}
          <div className="flex items-center gap-1.5">
            <label className="text-[9px] text-[#8391A3] uppercase font-mono">Lang:</label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="text-xs rounded bg-[#0F2745] text-stone-200 px-2 py-1 focus:outline-none border border-[#1E3A5F]"
            >
              <option value="en">English</option>
              <option value="kn">ಕನ್ನಡ</option>
            </select>
          </div>

          {/* Supervisor Database audit logs button */}
          {role === "supervisor" && (
            <button
              onClick={() => setShowAuditDrawer(true)}
              className="text-xs px-2.5 py-1 rounded border border-[#C6963C] text-[#C6963C] hover:bg-[#C6963C] hover:text-[#0B1F3A] transition-all"
            >
              Audit DB Logs
            </button>
          )}

          {/* New Conversation Button */}
          <button
            onClick={handleNewConversation}
            className="text-xs px-2.5 py-1.5 rounded transition-all hover:bg-stone-800 text-stone-200 border border-stone-600"
          >
            New
          </button>

          {/* Export PDF Button */}
          <button
            onClick={handleExportPDF}
            className="text-xs font-semibold px-3 py-1.5 rounded brass-btn"
          >
            Export PDF
          </button>
        </div>
      </header>

      {/* BODY WORKSPACE AREA */}
      <div className="flex flex-1 overflow-hidden">
        {/* SIDEBAR: DETAILED PROMPT SUGGESTIONS */}
        {showPromptsSidebar && (
          <aside 
            className={`w-80 shrink-0 border-r overflow-y-auto p-4 flex flex-col gap-4 ${
              theme === "dark" ? "bg-[#0b1b2f] border-[#1e3a5f]" : "bg-white border-[#dde1e4]"
            }`}
          >
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[#C6963C] font-mono">Investigation Prompts</h2>
              <p className="text-[11px] text-slate-400 mt-1">Select structured queries to inspect the databases.</p>
            </div>
            
            <div className="flex-1 flex flex-col gap-3">
              {DETAILED_PROMPT_SUGGESTIONS.map((s, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSend(s.q)}
                  className={`text-left p-3 rounded border transition-all text-xs flex flex-col gap-1.5 hover:translate-x-0.5 ${
                    theme === "dark" 
                      ? "bg-[#0f2745] border-[#1e3a5f] hover:border-[#C6963C] text-stone-200" 
                      : "bg-[#f8fafc] border-[#dde1e4] hover:border-[#C6963C] text-slate-800"
                  }`}
                >
                  <span className="font-semibold text-[11px] font-mono text-[#C6963C]">{s.title}</span>
                  <span className="font-mono text-[10px] leading-relaxed line-clamp-2">{s.q}</span>
                  <span className="text-[9px] text-slate-400 font-sans italic">{s.desc}</span>
                </button>
              ))}
            </div>
          </aside>
        )}

        {/* CHAT VIEW ENGINE */}
        <div className="flex-1 flex flex-col overflow-hidden relative">
          {/* Chat bubbles list */}
          <main className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
            <div className="max-w-3xl mx-auto space-y-4">
              {messages.map((msg, index) => {
                if (msg.isSystemNotice) {
                  return (
                    <div key={index} className="max-w-md mx-auto rounded p-2.5 text-[10px] text-center bubble-notice">
                      {msg.content}
                    </div>
                  );
                }

                const isUser = msg.role === "user";
                return (
                  <div 
                    key={index} 
                    className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}
                  >
                    {/* Message Bubble Container */}
                    <div 
                      className={`max-w-2xl px-4 py-3 rounded-lg text-sm leading-relaxed ${
                        isUser 
                          ? "bubble-user" 
                          : theme === "dark" ? "bubble-assistant-dark" : "bubble-assistant-light"
                      }`}
                    >
                      <p className="whitespace-pre-line">{msg.content}</p>

                      {/* FORECAST SVG CHART WIDGET */}
                      {!isUser && msg.forecastData && (
                        <div className="mt-3">
                          <ForecastChart data={msg.forecastData} theme={theme} />
                        </div>
                      )}

                      {/* NETWORK GRAPH SVG WIDGET */}
                      {!isUser && msg.graphData && (
                        <div className="mt-3">
                          <NetworkGraph data={msg.graphData} theme={theme} />
                        </div>
                      )}

                      {/* Reasoning metadata logs */}
                      {!isUser && msg.route && msg.route !== "system" && (
                        <ReasoningBlock 
                          msg={msg} 
                          theme={theme}
                          isRawSqlPermitted={role === "analyst" || role === "supervisor"} 
                        />
                      )}
                    </div>
                    
                    <span className="text-[10px] text-slate-400 mt-1 mx-2">
                      {msg.timestamp}
                    </span>
                  </div>
                );
              })}
              
              {loading && (
                <div className="flex flex-col items-start">
                  <div className={`px-4 py-3 rounded-lg flex items-center gap-1.5 ${
                    theme === "dark" ? "bubble-assistant-dark" : "bubble-assistant-light"
                  }`}>
                    <span className="dot dot1"></span>
                    <span className="dot dot2"></span>
                    <span className="dot"></span>
                  </div>
                </div>
              )}
              
              <div ref={threadEndRef} />
            </div>
          </main>

          {/* COMPOSER INPUT CONTAINER */}
          <footer 
            className="shrink-0 p-4 border-t" 
            style={{ 
              backgroundColor: theme === "dark" ? "#0b1b2f" : "#FFFFFF", 
              borderColor: theme === "dark" ? "#1e3a5f" : "#dde1e4" 
            }}
          >
            <div className="max-w-3xl mx-auto flex items-center gap-3">
              {/* Mic Voice recognition button */}
              <button
                type="button"
                onClick={toggleMic}
                disabled={!speechSupported}
                className={`p-3 rounded-full border transition-all ${
                  isListening 
                    ? "bg-red-100 border-red-500 text-red-600 animate-pulse" 
                    : "bg-slate-50 border-slate-300 text-slate-600 hover:bg-slate-100"
                }`}
                title={speechSupported ? (isListening ? "Listening... click to stop" : "Voice input") : "Mic not supported"}
                style={{ opacity: speechSupported ? 1 : 0.5 }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 1v11M19 10v2a7 7 0 0 1-14 0v-2M12 23v-4" strokeLinecap="round"/>
                  <rect x="9" y="5" width="6" height="10" rx="3" fill={isListening ? "currentColor" : "none"}/>
                </svg>
              </button>

              {/* Input text field */}
              <input
                type="text"
                placeholder={
                  language === "kn" 
                    ? "ಇಲ್ಲಿ ಅಪರಾಧ ಪ್ರಶ್ನೆಯನ್ನು ಟೈಪ್ ಮಾಡಿ... (ಕಳುಹಿಸಲು Enter ಒತ್ತಿ)" 
                    : "Type your query here... (Press Enter to send)"
                }
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={loading}
                className={`flex-1 rounded-md px-4 py-3 text-sm focus:outline-none border ${
                  theme === "dark" 
                    ? "bg-[#0f2745] border-[#1e3a5f] focus:border-[#C6963C] text-stone-200 focus:bg-[#0b1f3a]" 
                    : "bg-slate-50 border-slate-300 focus:border-stone-500 text-slate-800 focus:bg-white"
                }`}
              />

              {/* Submit send button */}
              <button
                onClick={() => handleSend()}
                disabled={loading || !inputVal.trim()}
                className="brass-btn font-semibold px-5 py-3 rounded-md text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {language === "kn" ? "ಕಳುಹಿಸಿ" : "Send"}
              </button>
            </div>
          </footer>
        </div>
      </div>

      {/* SUPERVISOR AUDIT LOGS MODAL DRAWER */}
      {showAuditDrawer && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black bg-opacity-60 transition-opacity duration-300">
          <div 
            className={`w-[600px] h-full flex flex-col shadow-2xl overflow-hidden p-6 ${
              theme === "dark" ? "bg-[#0b1b2f] text-stone-200 border-l border-[#1e3a5f]" : "bg-white text-slate-800 border-l border-[#dde1e4]"
            }`}
          >
            <div className="flex items-center justify-between border-b pb-4 border-slate-700">
              <div>
                <h2 className="text-sm font-semibold tracking-wide text-[#C6963C] font-mono uppercase">Query Transaction Audits</h2>
                <p className="text-[10px] text-slate-400 mt-1">compliance, logging, and security database tables (audit.db)</p>
              </div>
              <button 
                onClick={() => setShowAuditDrawer(false)}
                className="p-1 rounded hover:bg-slate-800 text-slate-400 font-mono text-sm"
              >
                [Close]
              </button>
            </div>

            {/* Audit Logs Table */}
            <div className="flex-1 overflow-y-auto mt-4">
              <table className="w-full text-left text-[11px] font-mono border-collapse">
                <thead>
                  <tr className="border-b border-slate-700 text-slate-400">
                    <th className="py-2 pr-2">ID</th>
                    <th className="py-2 pr-2">Time</th>
                    <th className="py-2 pr-2">Query</th>
                    <th className="py-2 pr-2">Route</th>
                    <th className="py-2 pr-2">Role</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLogs.map((row) => (
                    <tr key={row.id} className="border-b border-slate-800 hover:bg-white hover:bg-opacity-5">
                      <td className="py-2 pr-2 text-stone-400">{row.id}</td>
                      <td className="py-2 pr-2 text-stone-400 whitespace-nowrap">{row.timestamp.split(" ")[1] || row.timestamp}</td>
                      <td className="py-2 pr-2 max-w-[200px] truncate" title={row.question}>{row.question}</td>
                      <td className="py-2 pr-2 text-[#C6963C]">{row.route}</td>
                      <td className="py-2 pr-2 text-green-500 uppercase">{row.role}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SVG LINE CHART COMPONENT
// ---------------------------------------------------------------------------
function ForecastChart({ data, theme }) {
  const points = [...data.historical, ...data.forecast];
  const counts = points.map((p) => p.count);
  const maxCount = Math.max(...counts, 1);
  const minCount = Math.min(...counts, 0);
  const range = maxCount - minCount;
  
  const chartHeight = 100;
  const chartWidth = 360;
  const paddingX = 40;
  const paddingY = 15;
  
  const getCoords = (index, value) => {
    const x = paddingX + (index * (chartWidth - 2 * paddingX)) / (points.length - 1);
    const y = chartHeight - paddingY - ((value - minCount) * (chartHeight - 2 * paddingY)) / range;
    return { x, y };
  };

  const histCoords = data.historical.map((p, i) => getCoords(i, p.count));
  const forecastCoords = data.forecast.map((p, i) => getCoords(data.historical.length + i, p.count));
  
  // Build lines SVG attributes
  const histLinePath = histCoords.reduce((path, p, i) => path + (i === 0 ? `M ${p.x} ${p.y}` : ` L ${p.x} ${p.y}`), "");
  
  // Forecast starts from last historical coordinate
  const lastHist = histCoords[histCoords.length - 1];
  const forecastLinePath = lastHist 
    ? forecastCoords.reduce((path, p) => path + ` L ${p.x} ${p.y}`, `M ${lastHist.x} ${lastHist.y}`) 
    : forecastCoords.reduce((path, p, i) => path + (i === 0 ? `M ${p.x} ${p.y}` : ` L ${p.x} ${p.y}`), "");

  return (
    <div className={`mt-2 p-3 rounded border text-[10px] font-mono ${
      theme === "dark" ? "bg-[#0b1628] border-[#1e3a5f]" : "bg-slate-50 border-slate-200"
    }`}>
      <span className="font-semibold block mb-2 text-[#C6963C]">Time-Series Projection Dashboard</span>
      <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full">
        {/* Y Axis Grid lines */}
        <line x1={paddingX} y1={paddingY} x2={chartWidth - paddingX} y2={paddingY} stroke="#44516840" strokeWidth="0.5" />
        <line x1={paddingX} y1={chartHeight / 2} x2={chartWidth - paddingX} y2={chartHeight / 2} stroke="#44516840" strokeWidth="0.5" />
        <line x1={paddingX} y1={chartHeight - paddingY} x2={chartWidth - paddingX} y2={chartHeight - paddingY} stroke="#44516840" strokeWidth="0.5" />
        
        {/* Y Axis Labels */}
        <text x={10} y={paddingY + 4} fill="#8391A3">{Math.round(maxCount)}</text>
        <text x={10} y={chartHeight - paddingY + 4} fill="#8391A3">{Math.round(minCount)}</text>
        
        {/* Line Plots */}
        {histLinePath && (
          <path d={histLinePath} fill="none" stroke="#2563EB" strokeWidth="2.5" />
        )}
        {forecastLinePath && (
          <path d={forecastLinePath} fill="none" stroke="#C6963C" strokeWidth="2.5" strokeDasharray="4 3" />
        )}

        {/* Historical Coordinate circles */}
        {histCoords.map((c, idx) => (
          <circle key={`h-${idx}`} cx={c.x} cy={c.y} r="3.5" fill="#2563EB" />
        ))}
        {/* Forecast Coordinate circles */}
        {forecastCoords.map((c, idx) => (
          <circle key={`f-${idx}`} cx={c.x} cy={c.y} r="3.5" fill="#C6963C" />
        ))}
      </svg>
      <div className="flex justify-between items-center text-[9px] text-slate-400 mt-2 px-6">
        <span className="flex items-center gap-1"><span className="w-2 h-2 bg-[#2563EB] inline-block rounded-full"></span> Historical Case counts</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 border-b-2 border-dashed border-[#C6963C] inline-block"></span> Regression Forecast (next 3M)</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SVG NETWORK RELATIONSHIP GRAPH COMPONENT
// ---------------------------------------------------------------------------
function NetworkGraph({ data, theme }) {
  const width = 360;
  const height = 150;
  const nodes = data.nodes || [];
  const links = data.links || [];

  // Static positioning around a circle
  const nodePositions = {};
  nodes.forEach((n, idx) => {
    if (n.type === "case") {
      // Put case center-left
      nodePositions[n.id] = { x: 100, y: height / 2 };
    } else if (n.type === "phone") {
      // Put phone log link center-right
      nodePositions[n.id] = { x: 260, y: height / 2 };
    } else {
      // Arrange accused suspect nodes vertically in between
      const suspects = nodes.filter(nd => nd.type === "accused");
      const susIdx = suspects.findIndex(s => s.id === n.id);
      const gap = height / (sus_count_helper(suspects) + 1);
      nodePositions[n.id] = { x: 180, y: gap * (susIdx + 1) };
    }
  });

  function sus_count_helper(arr) {
    return arr.length || 1;
  }

  return (
    <div className={`mt-2 p-3 rounded border text-[10px] font-mono ${
      theme === "dark" ? "bg-[#0b1628] border-[#1e3a5f]" : "bg-slate-50 border-slate-200"
    }`}>
      <span className="font-semibold block mb-2 text-[#C6963C]">Offender Relationship Network Graph</span>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full">
        {/* Draw Link Edges */}
        {links.map((link, idx) => {
          const sourcePos = nodePositions[link.source];
          const targetPos = nodePositions[link.target];
          if (!sourcePos || !targetPos) return null;
          return (
            <g key={`l-${idx}`}>
              <line
                x1={sourcePos.x}
                y1={sourcePos.y}
                x2={targetPos.x}
                y2={targetPos.y}
                stroke="#64748b"
                strokeWidth="1.5"
                strokeDasharray={link.type === "USES" ? "3 3" : "0"}
              />
              {/* Midpoint arrow label */}
              <text
                x={(sourcePos.x + targetPos.x) / 2}
                y={(sourcePos.y + targetPos.y) / 2 - 2}
                fill="#8391A3"
                fontSize="7px"
                textAnchor="middle"
              >
                {link.type}
              </text>
            </g>
          );
        })}

        {/* Draw Nodes */}
        {nodes.map((node) => {
          const pos = nodePositions[node.id];
          if (!pos) return null;
          
          let fill = "#EF4444"; // accused
          if (node.type === "case") fill = "#2563EB";
          if (node.type === "phone") fill = "#EAB308";

          return (
            <g key={node.id} transform={`translate(${pos.x},${pos.y})`}>
              <circle r="8" fill={fill} stroke="#ffffff" strokeWidth="1" />
              <text
                y="-11"
                fill={theme === "dark" ? "#F1F5F9" : "#0F172A"}
                fontSize="7px"
                fontWeight="semibold"
                textAnchor="middle"
              >
                {node.label}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="flex justify-between items-center text-[8px] text-slate-400 mt-2">
        <span className="flex items-center gap-1"><span className="w-2 h-2 bg-[#2563EB] inline-block rounded-full"></span> Case ID</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 bg-[#EF4444] inline-block rounded-full"></span> Suspect Accused</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 bg-[#EAB308] inline-block rounded-full"></span> Phone Device Log</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// COLLAPSIBLE REASONING AND CLASSIFICATION COMPONENT
// ---------------------------------------------------------------------------
function ReasoningBlock({ msg, theme, isRawSqlPermitted }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-3 border-t pt-2 border-slate-600 border-opacity-35">
      <button 
        type="button" 
        onClick={() => setOpen(!open)}
        className="text-[11px] font-semibold text-slate-400 hover:text-slate-200 flex items-center gap-1.5 focus:outline-none"
      >
        <span>{open ? "▼ Hide logic details" : "▶ Show explainability logic"}</span>
        <span 
          className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded font-mono"
          style={{
            backgroundColor:
              msg.route === "sql" ? "#E0F2FE" : msg.route === "hybrid" ? "#FEF3C7" : msg.route === "forecast" ? "#F3E8FF" : "#E2E8F0",
            color:
              msg.route === "sql" ? "#0369A1" : msg.route === "hybrid" ? "#B45309" : msg.route === "forecast" ? "#6B21A8" : "#475569"
          }}
        >
          Route: {msg.route}
        </span>
      </button>

      {open && (
        <div className={`mt-2 p-3 text-[10px] font-mono rounded space-y-2.5 ${
          theme === "dark" ? "reasoning-container-dark" : "reasoning-container-light"
        }`}>
          <div className="flex justify-between items-center text-[9px] text-slate-400">
            <span>Query Pipeline:</span>
            <span className="font-bold">{msg.route.toUpperCase()} ROUTER</span>
          </div>

          {/* Gate raw SQL based on roles: Analysts & Supervisors see SQL, others do not */}
          {msg.sql && (
            <div className="space-y-1">
              <div className="text-slate-400 flex items-center justify-between text-[9px]">
                <span>Generated SQLite Query:</span>
                {!isRawSqlPermitted && <span className="text-[9px] text-red-500 italic">Hidden (RBAC Restricted)</span>}
              </div>
              {isRawSqlPermitted ? (
                <pre className="p-2 rounded bg-stone-900 text-amber-200 overflow-x-auto text-[9px]">
                  {msg.sql}
                </pre>
              ) : (
                <div className="p-2 rounded bg-amber-50 text-amber-800 italic border border-amber-200 text-[9px]">
                  Requires Analyst or Supervisor credentials to view raw SQL script.
                </div>
              )}
            </div>
          )}

          {msg.context && (
            <div className="space-y-1">
              <span className="text-slate-400 text-[9px]">Evidence Trail / Citations:</span>
              <p className="text-slate-400 leading-relaxed max-h-40 overflow-y-auto text-[9px] bg-black bg-opacity-20 p-2 border border-slate-700 rounded">
                {msg.context}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
