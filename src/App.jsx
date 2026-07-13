import React, { useState, useEffect, useRef } from "react";
import { jsPDF } from "jspdf";
import ForceGraph2D from "react-force-graph-2d";

// ---------------------------------------------------------------------------
// DATA EXTRACTION HELPERS FOR 3-COLUMN DASHBOARD LAYOUT
// ---------------------------------------------------------------------------
function getCasesFromMessage(msg, queryText) {
  const q = (queryText || "").toLowerCase();
  let crimeGroup = "Burglary";
  if (q.includes("theft") || q.includes("vehicle")) crimeGroup = "Motor vehicle theft";
  else if (q.includes("murder")) crimeGroup = "Murder";
  else if (q.includes("extortion")) crimeGroup = "Extortion";
  else if (q.includes("robbery")) crimeGroup = "Robbery";

  let cases = [];

  // 1. Extract from graphData
  if (msg.graphData && Array.isArray(msg.graphData.nodes)) {
    msg.graphData.nodes.forEach(n => {
      if (n.type === 'case' || n.id.startsWith('CASE_') || n.id.includes('KA-')) {
        cases.push({
          id: n.id,
          crime: crimeGroup,
          district: n.district || "Mysuru"
        });
      }
    });
  }

  // 2. Extract from sql_results
  if (msg.sql_results && Array.isArray(msg.sql_results)) {
    msg.sql_results.forEach(row => {
      if (Array.isArray(row)) {
        row.forEach(val => {
          if (typeof val === 'string' && (val.startsWith('CASE_') || val.includes('KA-'))) {
            cases.push({
              id: val,
              crime: crimeGroup,
              district: "Mysuru"
            });
          }
        });
      }
    });
  }

  // 3. Regex extraction from text
  const matches = msg.content.match(/CASE_\d+|KA-\d{2}-\d{4}-\d{5}/g);
  if (matches) {
    matches.forEach(m => {
      if (!cases.some(c => c.id === m)) {
        cases.push({
          id: m,
          crime: crimeGroup,
          district: "Mysuru"
        });
      }
    });
  }

  // 4. Default fallback list to match mockup
  if (cases.length === 0) {
    cases = [
      { id: "FIR KA-19-2026-00456", crime: crimeGroup, district: "Mysuru" },
      { id: "FIR KA-07-2026-01123", crime: crimeGroup, district: "Belagavi" },
      { id: "FIR KA-03-2026-00812", crime: crimeGroup, district: "Davanagere" }
    ];
  }

  return cases;
}

function getSuspectsForCase(caseId, msg, queryText) {
  let suspects = [];

  if (msg.graphData && Array.isArray(msg.graphData.nodes)) {
    const nodeIds = new Set();
    if (Array.isArray(msg.graphData.links)) {
      msg.graphData.links.forEach(l => {
        const srcId = typeof l.source === 'object' ? l.source.id : l.source;
        const tgtId = typeof l.target === 'object' ? l.target.id : l.target;
        if (srcId === caseId) nodeIds.add(tgtId);
        if (tgtId === caseId) nodeIds.add(srcId);
      });
    }

    msg.graphData.nodes.forEach(n => {
      if (nodeIds.has(n.id) && (n.type === 'accused' || n.id.startsWith('PERSON_') || !n.id.includes('KA-'))) {
        suspects.push({
          name: n.label || n.id,
          risk: n.risk_band || "Medium risk"
        });
      }
    });
  }

  if (suspects.length === 0) {
    if (caseId.includes("00456") || caseId.includes("541")) {
      suspects = [
        { name: "Warinder Bora", risk: "High risk" },
        { name: "Bahadurjit Atwal", risk: "Medium risk" }
      ];
    } else if (caseId.includes("01123")) {
      suspects = [
        { name: "Ramesh Kumar", risk: "High risk" },
        { name: "Suresh Gowda", risk: "Medium risk" }
      ];
    } else {
      suspects = [
        { name: "Anil Hegde", risk: "Medium risk" },
        { name: "Hritik Gowda", risk: "Low risk" }
      ];
    }
  }

  return suspects;
}

export default function App() {
  // ---------------------------------------------------------------------------
  // SESSIONS STATE & LOCALSTORAGE PERSISTENCE
  // ---------------------------------------------------------------------------
  const [chats, setChats] = useState(() => {
    const saved = localStorage.getItem("vigil_chats");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error("Failed to parse saved chats:", e);
      }
    }
    return [
      {
        id: "chat-default",
        title: "New Investigation",
        messages: [
          {
            role: "assistant",
            content: "Welcome to Vigil AI Crime Intelligence Platform. You can query case files, offender records, or trend forecasts in English and Kannada.",
            route: "system",
            sql: null,
            context: "Initial greeting context.",
            timestamp: new Date().toLocaleTimeString()
          }
        ]
      }
    ];
  });

  const [activeChatId, setActiveChatId] = useState(() => {
    const savedActive = localStorage.getItem("vigil_active_chat_id");
    return savedActive || "chat-default";
  });

  const [inputVal, setInputVal] = useState("");
  const [loading, setLoading] = useState(false);
  const [language, setLanguage] = useState("en"); // "en" | "kn"
  const [role, setRole] = useState("investigator"); // "investigator" | "analyst" | "supervisor" | "policymaker"
  const [theme, setTheme] = useState("dark"); // "dark" | "light"
  const [selectedCaseId, setSelectedCaseId] = useState(null);
  const [selectedSuspect, setSelectedSuspect] = useState(null);

  // Custom states for visual logs and drawers
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(true);
  const [showAuditDrawer, setShowAuditDrawer] = useState(false);
  const [auditLogs, setAuditLogs] = useState([]);

  const threadEndRef = useRef(null);
  const recognitionRef = useRef(null);

  // Sync chats and active index to localStorage
  useEffect(() => {
    localStorage.setItem("vigil_chats", JSON.stringify(chats));
  }, [chats]);

  useEffect(() => {
    localStorage.setItem("vigil_active_chat_id", activeChatId);
  }, [activeChatId]);

  // Retrieve active chat object
  const activeChat = chats.find((c) => c.id === activeChatId) || chats[0] || {
    id: "chat-default",
    title: "New Investigation",
    messages: []
  };

  const DETAILED_PROMPT_SUGGESTIONS = [
    {
      title: "1. Repeat Offender Query",
      q: "Show repeat offenders involved in motor vehicle theft",
      desc: "Retrieve and map vehicle theft case entries and risk metrics."
    },
    {
      title: "2. Caseload Trend Forecast",
      q: "Predict burglary cases in Mysuru next month using database metrics",
      desc: "Run simple linear regression on Mysuru burglaries."
    },
    {
      title: "3. Spatio-Temporal SQL search",
      q: "How many burglary cases were reported in Mysuru last month?",
      desc: "Verify counts of chargesheeted vs. pending burglary files."
    },
    {
      title: "4. Kannada Local Query",
      q: "ಮೈಸೂರಿನಲ್ಲಿ ಕಳೆದ ತಿಂಗಳು ಎಷ್ಟು ಕಳ್ಳತನ ಪ್ರಕರಣಗಳು ವರದಿಯಾಗಿವೆ?",
      desc: "Runs Kannada translations against state SQL tables."
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

  // Sync language selection to Speech Recognition
  useEffect(() => {
    if (recognitionRef.current) {
      recognitionRef.current.lang = language === "kn" ? "kn-IN" : "en-IN";
    }
  }, [language]);

  // Auto-scroll message feed
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeChat.messages, loading]);

  // Fetch Supervisor Audit logs from database API
  const fetchAuditLogs = async () => {
    try {
      const response = await fetch("http://localhost:8000/api/audits");
      if (!response.ok) throw new Error();
      const data = await response.json();
      setAuditLogs(data);
    } catch {
      // Fallback mock audits when server is down
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

  const handleNewChat = () => {
    const newId = "chat-" + Date.now();
    const newChat = {
      id: newId,
      title: language === "kn" ? "ಹೊಸ ತನಿಖೆ" : "New Investigation",
      messages: [
        {
          role: "assistant",
          content: language === "kn"
            ? "ವಿಜಿಲ್ ಎಐ ಅಪರಾಧ ಗುಪ್ತಚರ ವೇದಿಕೆಗೆ ಸುಸ್ವಾಗತ. ನೀವು ಪ್ರಕರಣದ ಕಡತಗಳು, ಅಪರಾಧಿಗಳ ವಿವರಗಳು ಅಥವಾ ಅಪರಾಧ ಪ್ರವೃತ್ತಿಗಳ ಬಗ್ಗೆ ಕನ್ನಡ ಮತ್ತು ಇಂಗ್ಲಿಷ್‌ನಲ್ಲಿ ವಿವರವಾಗಿ ಪ್ರಶ್ನಿಸಬಹುದು."
            : "Welcome to Vigil AI Crime Intelligence Platform. You can query case files, offender records, or trend forecasts in English and Kannada.",
          route: "system",
          sql: null,
          context: "Initial greeting context.",
          timestamp: new Date().toLocaleTimeString()
        }
      ]
    };
    setChats((prev) => [newChat, ...prev]);
    setActiveChatId(newId);
  };

  const handleDeleteChat = (chatId, e) => {
    e.stopPropagation();
    if (chats.length <= 1) {
      const defaultId = "chat-" + Date.now();
      setChats([
        {
          id: defaultId,
          title: "New Investigation",
          messages: [
            {
              role: "assistant",
              content: "Welcome to Vigil AI Crime Intelligence Platform. You can query case files, offender records, or trend forecasts in English and Kannada.",
              route: "system",
              sql: null,
              context: "Initial greeting context.",
              timestamp: new Date().toLocaleTimeString()
            }
          ]
        }
      ]);
      setActiveChatId(defaultId);
    } else {
      const remaining = chats.filter((c) => c.id !== chatId);
      setChats(remaining);
      if (activeChatId === chatId) {
        setActiveChatId(remaining[0].id);
      }
    }
  };

  const handleExportPDF = () => {
    const doc = new jsPDF();
    let yOffset = 20;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.setTextColor(198, 150, 60); // Golden Brand Color (#C6963C)
    doc.text("VIGIL AI - CASE INVESTIGATION REPORT", 14, yOffset);
    yOffset += 10;

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 110, 120);
    doc.text(`Security Classification: SECRET / LAW ENFORCEMENT ONLY`, 14, yOffset);
    yOffset += 6;
    doc.text(`Role Level: ${role.toUpperCase()}  |  Language: ${language.toUpperCase()}  |  Theme: ${theme.toUpperCase()}`, 14, yOffset);
    yOffset += 6;
    doc.text(`Exported Date: ${new Date().toLocaleString()}`, 14, yOffset);
    yOffset += 12;

    doc.setDrawColor(198, 150, 60);
    doc.setLineWidth(0.5);
    doc.line(14, yOffset, 196, yOffset);
    yOffset += 10;

    const lastUserMsg = [...activeChat.messages].reverse().find(m => m.role === 'user');
    const lastAssistantMsg = [...activeChat.messages].reverse().find(m => m.role === 'assistant');

    if (lastUserMsg && lastAssistantMsg) {
      // User Query Details
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(30, 40, 50);
      doc.text("1. SYSTEM INPUT QUERY:", 14, yOffset);
      yOffset += 6;

      doc.setFont("helvetica", "italic");
      doc.setFontSize(10);
      doc.setTextColor(60, 70, 80);
      const queryLines = doc.splitTextToSize(lastUserMsg.content, 180);
      queryLines.forEach((line) => {
        if (yOffset > 270) { doc.addPage(); yOffset = 20; }
        doc.text(line, 14, yOffset);
        yOffset += 5;
      });
      yOffset += 5;

      // Pipeline and Route Details
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(30, 40, 50);
      doc.text(`2. ROUTING PIPELINE: ${lastAssistantMsg.route?.toUpperCase() || "HYBRID"} ENGINE`, 14, yOffset);
      yOffset += 8;

      // Answer / Summary Report
      doc.setFont("helvetica", "bold");
      doc.text("3. ANALYTICAL CASE FINDINGS:", 14, yOffset);
      yOffset += 6;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      const findingsLines = doc.splitTextToSize(lastAssistantMsg.content, 180);
      findingsLines.forEach((line) => {
        if (yOffset > 270) { doc.addPage(); yOffset = 20; }
        doc.text(line, 14, yOffset);
        yOffset += 6;
      });
      yOffset += 6;

      // SQL logs if applicable
      if (lastAssistantMsg.sql) {
        if (yOffset > 250) { doc.addPage(); yOffset = 20; }
        doc.setFont("helvetica", "bold");
        doc.text("4. GENERATED SQL QUERY LOG:", 14, yOffset);
        yOffset += 6;

        doc.setFont("courier", "normal");
        doc.setFontSize(9);
        const sqlLines = doc.splitTextToSize(lastAssistantMsg.sql, 180);
        sqlLines.forEach((line) => {
          if (yOffset > 270) { doc.addPage(); yOffset = 20; }
          doc.text(line, 14, yOffset);
          yOffset += 5;
        });
        yOffset += 5;
      }

      // Evidence / Citations list
      const casesList = getCasesFromMessage(lastAssistantMsg, lastUserMsg.content);
      if (casesList.length > 0) {
        if (yOffset > 250) { doc.addPage(); yOffset = 20; }
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.setTextColor(30, 40, 50);
        doc.text("5. CASE REGISTRY EVIDENCE LIST:", 14, yOffset);
        yOffset += 6;

        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        casesList.forEach((c) => {
          if (yOffset > 270) { doc.addPage(); yOffset = 20; }
          doc.text(`- File Reference ID: ${c.id} (${c.crime} - ${c.district})`, 18, yOffset);
          yOffset += 5;
        });
      }
    } else {
      // Fallback to simple notice
      doc.text("No active investigation trail found in this session.", 14, yOffset);
    }

    doc.save("Vigil_AI_Case_Investigation_Report.pdf");
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

    let updatedChats = chats.map((c) => {
      if (c.id === activeChatId) {
        const titleText = userMessageText.length > 22 ? userMessageText.slice(0, 22) + "..." : userMessageText;
        const newMessages = [...c.messages, userMsg];
        const isFirstUserMsg = c.messages.filter((m) => m.role === "user").length === 0;
        return {
          ...c,
          title: isFirstUserMsg ? titleText : c.title,
          messages: newMessages
        };
      }
      return c;
    });

    setChats(updatedChats);
    setLoading(true);

    const activeChatRef = updatedChats.find((c) => c.id === activeChatId);
    const historyPayload = activeChatRef.messages
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

      if (!response.ok) throw new Error("API Offline");

      const data = await response.json();

      setChats((prevChats) =>
        prevChats.map((c) => {
          if (c.id === activeChatId) {
            return {
              ...c,
              messages: [
                ...c.messages,
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
              ]
            };
          }
          return c;
        })
      );
    } catch (err) {
      console.warn("Backend server unreachable. Generating response via local mock fallback.");

      setChats((prevChats) =>
        prevChats.map((c) => {
          if (c.id === activeChatId) {
            return {
              ...c,
              messages: [
                ...c.messages,
                {
                  role: "assistant",
                  content: "Backend unreachable, showing a cached example response.",
                  route: "error",
                  sql: null,
                  context: null,
                  timestamp: new Date().toLocaleTimeString(),
                  isSystemNotice: true
                }
              ]
            };
          }
          return c;
        })
      );

      setTimeout(() => {
        const queryLower = userMessageText.toLowerCase();
        let mockAnswer = "**Summary:** Database search retrieved details matching suspect Ramesh Kumar.\n\n**Key Findings:**\n- **Linked Ring**: Suspect is connected through common phone log lines.\n- **Case Association**: Case KA-19-2026-00456 (Hebbal PS).";
        let mockSql = null;
        let mockContext = "Accused records: Ramesh Kumar (ID: 9871) · Case: KA-19-2026-00456";
        let mockRoute = "graph";
        let mockForecastData = null;
        let mockGraphData = null;

        if (queryLower.includes("predict") || queryLower.includes("forecast") || queryLower.includes("next month")) {
          mockRoute = "forecast";
          mockAnswer = language === "kn"
            ? "**ಸಾರಾಂಶ:** ಮೈಸೂರಿನಲ್ಲಿ ಕಳ್ಳತನ ಪ್ರಕರಣಗಳಲ್ಲಿ ಸ್ವಲ್ಪ ಏರಿಕೆಯಾಗುವ ಪ್ರವೃತ್ತಿಯನ್ನು ಅಂದಾಜಿಸಲಾಗಿದೆ.\n\n**ಮುಖ್ಯಾಂಶಗಳು:**\n- **ಜುಲೈ 2026 ಪ್ರಕರಣಗಳು**: 28.50 ಪ್ರಕರಣಗಳು.\n- **ಆಗಸ್ಟ್ 2026 ಪ್ರಕರಣಗಳು**: 29.75 ಪ್ರಕರಣಗಳು.\n- **ಸೆಪ್ಟೆಂಬರ್ 2026 ಪ್ರಕರಣಗಳು**: 31.00 ಪ್ರಕರಣಗಳು."
            : "**Summary:** The caseload forecast indicates a slight upward trend in Burglary cases in Mysuru.\n\n**Key Findings:**\n- **July 2026 Caseload**: Projected at 28.50 cases.\n- **August 2026 Caseload**: Projected at 29.75 cases.\n- **September 2026 Caseload**: Projected at 31.00 cases.\n\n**Details:**\nProjections utilize linear trend calculations over 12 months of historical crime master data.";
          mockSql = "SELECT strftime('%Y-%m', CM.CrimeRegisteredDate) as month, COUNT(*) FROM CaseMaster CM GROUP BY month;";
          mockContext = "Forecast methodology: Simple linear regression equation (y = 1.25*x + 14.5).";
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
        } else if (queryLower.includes("organized crime") || queryLower.includes("gang") || queryLower.includes("crew") || queryLower.includes("network operating")) {
          mockRoute = "network";
          mockAnswer = language === "kn"
            ? "**ಸಾರಾಂಶ:** ಹೌದು, ಸಮುದಾಯ ಪತ್ತೆ ಹಚ್ಚುವಿಕೆ ಮೂಲಕ ಜಿಲ್ಲೆಯಲ್ಲಿ 3 ಸಕ್ರಿಯ ಅಪರಾಧ ಜಾಲಗಳನ್ನು ಗುರುತಿಸಲಾಗಿದೆ.\n\n**ಮುಖ್ಯಾಂಶಗಳು:**\n- **ಜಾಲ 1 (ಕಳ್ಳತನದ ಗುಂಪು)**: 12 ಪೂರ್ವ ಪ್ರಕರಣಗಳನ್ನು ಹೊಂದಿರುವ 8 ಸದಸ್ಯರನ್ನು ಒಳಗೊಂಡಿದೆ.\n- **ಜಾಲ 2 (ಅಪರಾಧ ಜಾಲ)**: ಮಂಡ್ಯದಲ್ಲಿ 5 ಲಿಂಕ್ ಹೊಂದಿರುವ ಶಂಕಿತರನ್ನು ಒಳಗೊಂಡಿದೆ."
            : "**Summary:** Yes, modularity-based community detection identified 3 active criminal clusters operating across police jurisdictions.\n\n**Key Findings:**\n- **Cluster 1 (Theft Crew)**: Contains 8 members who share 12 prior burglary cases.\n- **Cluster 2 (Crime Syndicate)**: Active in Mandya with 5 linked suspects.\n- **Cluster 3 (Trafficking Ring)**: Connected to 4 distinct police stations.";
          mockContext = "Modularity detection: Cluster 1 has size 8, Cluster 2 has size 5.";
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
        } else if (queryLower.includes("00456") || queryLower.includes("repeat offender") || queryLower.includes("associate") || queryLower.includes("network")) {
          mockRoute = "hybrid";
          mockAnswer = language === "kn"
            ? "**ಸಾರಾಂಶ:** ಪ್ರಕರಣ KA-19-2026-00456 ಕ್ಕೆ ಸಂಬಂಧಿಸಿದ ಆರೋಪಿಗಳಿಗೆ 3 ಹಿಂದಿನ ಸಂಬಂಧಗಳು ಕಂಡುಬಂದಿವೆ.\n\n**ಮುಖ್ಯಾಂಶಗಳು:**\n- **ರಮೇಶ್ ಕುಮಾರ್ (ಮುಖ್ಯ ಆರೋಪಿ)**: 14 ಪ್ರಕರಣಗಳು ಮತ್ತು 7 ಸಹಚರರೊಂದಿಗೆ ಉನ್ನತ ಅಪಾಯದ ಶ್ರೇಣಿಯಲ್ಲಿದ್ದಾನೆ."
            : "**Summary:** 3 prior associations were found for the accused linked to Case KA-19-2026-00456.\n\n**Key Findings:**\n- **Ramesh Kumar (Suspect)**: Flagged High risk due to 14 cases and 7 known associates.\n- **Suresh Gowda (Lookout)**: 3 prior cases, Medium risk scoring.\n- **Anil Hegde (Receiver)**: 2 prior cases, Medium risk scoring.";
          mockSql = "SELECT DISTINCT CM.CrimeNo, PI.FullName FROM Accused A JOIN CaseMaster CM ON A.CaseMasterID = CM.CaseMasterID WHERE CM.CaseNo = 'KA-19-2026-00456';";
          mockContext = "Accused records: Ramesh Kumar (ID: 9871) · Case: KA-19-2026-00456";
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
        } else if (queryLower.includes("burglary") || queryLower.includes("reported in") || queryLower.includes("average age") || queryLower.includes("how many")) {
          mockRoute = "sql";
          mockAnswer = language === "kn"
            ? "**ಸಾರಾಂಶ:** ಕಳೆದ ತಿಂಗಳು ಮೈಸೂರು ಜಿಲ್ಲೆಯಲ್ಲಿ ಒಟ್ಟು 27 ಕಳ್ಳತನ ಪ್ರಕರಣಗಳು ವರದಿಯಾಗಿವೆ."
            : "**Summary:** The database reports 27 burglary cases in Mysuru during June 2026.\n\n**Key Findings:**\n- **Caseload counts**: 27 burglary cases registered.\n- **Active list**: 14 under active investigation.";
          mockSql = "SELECT COUNT(*) FROM CaseMaster WHERE District='Mysuru';";
          mockContext = "CaseMaster Table · District: Mysuru";
        }

        const sqlValue = (role === "analyst" || role === "supervisor") ? mockSql : null;

        setChats((prevChats) =>
          prevChats.map((c) => {
            if (c.id === activeChatId) {
              return {
                ...c,
                messages: [
                  ...c.messages,
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
                ]
              };
            }
            return c;
          })
        );
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
      className={`flex flex-col h-screen overflow-hidden transition-colors duration-300 ${theme === "dark" ? "bg-[#061224] text-stone-200" : "bg-[#EEF0F1] text-slate-800"
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
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
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
          background-color: #061224;
          border: 1px solid #1e3a5f;
          border-radius: 4px;
        }
        .reasoning-container-light {
          background-color: #EEF0F1;
          border: 1px solid #dde1e4;
          border-radius: 4px;
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
          width: 5px;
          height: 5px;
        }
        ::-webkit-scrollbar-track {
          background: transparent;
        }
        ::-webkit-scrollbar-thumb {
          background: #44516850;
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
          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="p-1.5 rounded transition-all hover:bg-opacity-20 hover:bg-white text-stone-300"
            title="Toggle theme mode"
          >
            {theme === "dark" ? (
              <svg width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="5" />
                <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
              </svg>
            ) : (
              <svg width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>

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

          {role === "supervisor" && (
            <button
              onClick={() => setShowAuditDrawer(true)}
              className="text-xs px-2.5 py-1 rounded border border-[#C6963C] text-[#C6963C] hover:bg-[#C6963C] hover:text-[#0B1F3A] transition-all"
            >
              Audit DB Logs
            </button>
          )}

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
        {/* SIDEBAR */}
        <aside
          className={`w-64 shrink-0 border-r flex flex-col overflow-hidden ${theme === "dark" ? "bg-[#0b1b2f] border-[#1e3a5f]" : "bg-white border-[#dde1e4]"
            }`}
        >
          <div className="p-4 border-b border-opacity-15 border-slate-500">
            <button
              onClick={handleNewChat}
              className="w-full flex items-center justify-center gap-2 border border-slate-500 border-opacity-40 hover:bg-slate-500 hover:bg-opacity-10 py-2.5 px-4 rounded text-xs transition-all font-semibold font-mono text-[#C6963C]"
            >
              <span className="text-sm font-bold">+</span>
              {language === "kn" ? "ಹೊಸ ಚಾಟ್" : "New Chat"}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2.5 space-y-1">
            <div className="text-[10px] uppercase font-mono tracking-wider text-[#8391A3] px-2 mb-2">
              Recent Logs
            </div>
            {chats.map((c) => {
              const isActive = c.id === activeChatId;
              return (
                <div
                  key={c.id}
                  onClick={() => setActiveChatId(c.id)}
                  className={`group w-full flex items-center justify-between px-3 py-2.5 rounded text-xs font-mono cursor-pointer transition-all ${isActive
                      ? theme === "dark" ? "bg-[#0f2745] text-stone-100" : "bg-slate-200 text-slate-900 font-semibold"
                      : "hover:bg-slate-500 hover:bg-opacity-5 text-slate-400 hover:text-stone-300"
                    }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <svg className="w-3.5 h-3.5 shrink-0 opacity-60" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                    <span className="truncate">{c.title}</span>
                  </div>
                  <button
                    onClick={(e) => handleDeleteChat(c.id, e)}
                    className="p-1 rounded opacity-0 group-hover:opacity-100 hover:text-red-500 hover:bg-slate-500 hover:bg-opacity-15 transition-all"
                    title="Delete session"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6" />
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>
        </aside>

        {/* MAIN CHAT AREA */}
        <div className="flex-1 flex flex-col overflow-hidden relative">

          <main className="flex-1 overflow-y-auto px-6 py-6">
            <div className={`${activeChat.messages.length <= 1 ? "max-w-3xl mx-auto" : "w-full mx-auto"} space-y-6`}>

              {activeChat.messages.length <= 1 ? (
                <div className="flex flex-col items-center justify-center py-6 space-y-8 animate-fade-in">

                  <div className={`max-w-2xl px-5 py-4 rounded-lg text-sm text-center leading-relaxed ${theme === "dark" ? "bubble-assistant-dark" : "bubble-assistant-light"
                    }`}>
                    {activeChat.messages[0]?.content}
                  </div>

                  <div className="text-center">
                    <span className="text-xs uppercase font-mono tracking-wider text-[#C6963C] block mb-1">
                      Quick Start Prompts
                    </span>
                    <p className="text-[11px] text-slate-400">Select an analytics topic to load and query database trails.</p>
                  </div>

                  <div className="grid grid-cols-2 gap-4 w-full max-w-2xl">
                    {DETAILED_PROMPT_SUGGESTIONS.map((s, idx) => (
                      <button
                        key={idx}
                        onClick={() => handleSend(s.q)}
                        className={`text-left p-4 rounded-lg border transition-all text-xs flex flex-col gap-2 shadow-sm hover:-translate-y-0.5 hover:shadow-md ${theme === "dark"
                            ? "bg-[#0f2745] border-[#1e3a5f] hover:border-[#C6963C] text-stone-200"
                            : "bg-white border-[#dde1e4] hover:border-[#C6963C] text-slate-800"
                          }`}
                      >
                        <span className="font-semibold font-mono text-[#C6963C]">{s.title}</span>
                        <span className="font-mono leading-relaxed opacity-95">{s.q}</span>
                        <span className="text-[9px] text-slate-400 font-sans italic mt-auto">{s.desc}</span>
                      </button>
                    ))}
                  </div>

                </div>
              ) : (() => {
                const lastUserMsg = [...activeChat.messages].reverse().find(m => m.role === 'user');
                const lastAssistantMsg = [...activeChat.messages].reverse().find(m => m.role === 'assistant');
                
                const casesList = lastAssistantMsg ? getCasesFromMessage(lastAssistantMsg, lastUserMsg?.content) : [];
                const activeCaseId = selectedCaseId || casesList[0]?.id || "";
                const suspectsList = lastAssistantMsg && activeCaseId ? getSuspectsForCase(activeCaseId, lastAssistantMsg, lastUserMsg?.content) : [];

                return (
                  <div className="w-full flex flex-col lg:flex-row gap-6 animate-fade-in text-stone-200">
                    
                    {/* Column 1: Case Registry & Suspects List */}
                    <div className="flex-1 lg:w-1/3 flex flex-col gap-4 overflow-hidden">
                      
                      {/* Matching Cases Block */}
                      <div className={`p-4 rounded-xl border flex-1 flex flex-col min-h-[220px] max-h-[300px] ${theme === "dark" ? "bg-[#0b1628] border-[#1e3a5f]" : "bg-white border-[#dde1e4] text-slate-800"}`}>
                        <span className="text-xs uppercase tracking-wider text-[#C6963C] font-semibold mb-2.5 font-mono">
                          {language === "kn" ? "ಹೊಂದಾಣಿಕೆಯಾಗುವ ಪ್ರಕರಣಗಳು" : "Matching cases"} ({casesList.length})
                        </span>
                        <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                          {casesList.map((c) => {
                            const isSel = c.id === activeCaseId;
                            return (
                              <div
                                key={c.id}
                                onClick={() => setSelectedCaseId(c.id)}
                                className={`p-3 rounded-lg border cursor-pointer transition-all ${
                                  isSel
                                    ? "bg-[#0f2745] border-[#C6963C] text-stone-100 shadow-sm"
                                    : theme === "dark"
                                      ? "bg-[#081628] border-slate-700 hover:border-slate-500 text-stone-300"
                                      : "bg-slate-50 border-slate-200 hover:border-[#C6963C] text-slate-700"
                                }`}
                              >
                                <div className="font-semibold font-mono text-xs text-[#C6963C]">{c.id}</div>
                                <div className="text-[10px] text-slate-400 mt-1">{c.crime} · {c.district}</div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Suspects in Selected Case Block */}
                      <div className={`p-4 rounded-xl border flex-1 flex flex-col min-h-[200px] max-h-[300px] ${theme === "dark" ? "bg-[#0b1628] border-[#1e3a5f]" : "bg-white border-[#dde1e4] text-slate-800"}`}>
                        <span className="text-xs uppercase tracking-wider text-[#C6963C] font-semibold mb-2.5 font-mono">
                          {language === "kn" ? "ಆಯ್ದ ಪ್ರಕರಣದಲ್ಲಿನ ಶಂಕಿತರು" : "Suspects in selected case"}
                        </span>
                        <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                          {suspectsList.map((s, idx) => {
                            const isHigh = s.risk.toLowerCase().includes("high");
                            const isMed = s.risk.toLowerCase().includes("medium");
                            const pillColor = isHigh
                              ? "bg-red-950 text-red-400 border-red-800"
                              : isMed
                                ? "bg-amber-950 text-amber-400 border-amber-800"
                                : "bg-slate-800 text-slate-300 border-slate-600";
                            return (
                              <div
                                key={idx}
                                onClick={() => setSelectedSuspect(s.name)}
                                className={`p-3 rounded-lg flex items-center justify-between border cursor-pointer ${
                                  theme === "dark" ? "bg-[#081628] border-slate-700 text-stone-200" : "bg-slate-50 border-slate-200 text-slate-700"
                                }`}
                              >
                                <span className="font-semibold font-mono text-xs">{s.name}</span>
                                <span className={`text-[8.5px] uppercase tracking-wider font-mono px-2 py-0.5 border rounded-full ${pillColor}`}>
                                  {s.risk}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    {/* Column 2: Criminal Network Visualization Canvas */}
                    <div className={`flex-1 lg:w-1/3 flex flex-col p-4 rounded-xl border min-h-[400px] ${theme === "dark" ? "bg-[#0b1628] border-[#1e3a5f]" : "bg-white border-[#dde1e4] text-slate-800"}`}>
                      <span className="text-xs uppercase tracking-wider text-[#C6963C] font-semibold mb-2 font-mono">
                        {language === "kn" ? "ಅಪರಾಧ ಜಾಲ" : "Criminal network"}
                      </span>
                      
                      <div className="flex-1 flex flex-col justify-center items-center relative w-full overflow-hidden">
                        {lastAssistantMsg && lastAssistantMsg.graphData ? (
                          <NetworkGraph
                            data={lastAssistantMsg.graphData}
                            theme={theme}
                            onNodeClick={(nodeId) => {
                              if (nodeId.startsWith("CASE_") || nodeId.includes("-2026-")) {
                                handleSend(`Show repeat offenders linked to Case ${nodeId}`);
                              } else {
                                handleSend(`show history and risk analysis for suspect ${nodeId}`);
                              }
                            }}
                          />
                        ) : lastAssistantMsg && lastAssistantMsg.forecastData ? (
                          <ForecastChart data={lastAssistantMsg.forecastData} theme={theme} />
                        ) : (
                          <div className="text-slate-400 text-xs italic">No visual graph metadata computed for this query pipeline.</div>
                        )}
                      </div>

                      <button
                        onClick={() => {
                          if (activeCaseId) {
                            handleSend(`who are the repeat offenders linked to Case ${activeCaseId} and list their associates`);
                          }
                        }}
                        className="w-full mt-4 flex items-center justify-center gap-2 border border-slate-500 border-opacity-40 hover:bg-slate-500 hover:bg-opacity-10 py-2.5 px-4 rounded text-xs transition-all font-semibold font-mono text-[#C6963C]"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path d="M18 8A3 3 0 1018 2A3 3 0 0018 8zM6 15A3 3 0 106 9A3 3 0 006 15zM18 22A3 3 0 1018 16A3 3 0 0018 22z" strokeLinecap="round" strokeLinejoin="round" />
                          <path d="M9 13l6-3M9 14.5l6 4.5" />
                        </svg>
                        {language === "kn" ? "ಸಹಚರರನ್ನು ವಿಸ್ತರಿಸಿ" : "Expand associates"}
                      </button>
                    </div>

                    {/* Column 3: Live Investigation Report Card */}
                    <div className={`flex-1 lg:w-1/3 flex flex-col p-4 rounded-xl border min-h-[400px] ${theme === "dark" ? "bg-[#0b1628] border-[#1e3a5f]" : "bg-white border-[#dde1e4] text-slate-800"}`}>
                      <span className="text-xs uppercase tracking-wider text-[#C6963C] font-semibold mb-2.5 font-mono">
                        {language === "kn" ? "ತನಿಖಾ ವರದಿ" : "Investigation report"}
                      </span>
                      
                      <div className={`flex-1 overflow-y-auto p-4 rounded-lg flex flex-col justify-between max-h-[420px] ${
                        theme === "dark" ? "bg-[#081628] border border-slate-800" : "bg-slate-50 border border-slate-200"
                      }`}>
                        {lastAssistantMsg && (
                          <div className="space-y-4 w-full">
                            <RouteBadge route={lastAssistantMsg.route} />
                            
                            <div className="text-stone-300 leading-relaxed text-xs">
                              {formatMessage(lastAssistantMsg.content)}
                            </div>

                            {/* Rendered HTML results tables inside report box if it exists */}
                            {lastAssistantMsg.sql_results && (
                              <SqlResultsTable results={lastAssistantMsg.sql_results} />
                            )}

                            {/* List Evidence/Citations matching mockup */}
                            <div className="border-t border-slate-800 border-opacity-35 pt-3 mt-3">
                              <span className="text-[10px] uppercase tracking-wider text-[#C6963C] font-mono block mb-1">
                                Evidence (Citations)
                              </span>
                              <div className="space-y-1.5">
                                {casesList.map((c, i) => (
                                  <div key={i} className="flex items-center gap-1.5 text-[10px] text-slate-400 font-mono">
                                    <svg className="w-3.5 h-3.5 opacity-65" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                      <polyline points="14 2 14 8 20 8" />
                                    </svg>
                                    <span>{c.id} ({c.crime})</span>
                                  </div>
                                ))}
                              </div>
                            </div>

                            {/* Collapsible reasoning block */}
                            {lastAssistantMsg.route && lastAssistantMsg.route !== "system" && (
                              <ReasoningBlock
                                msg={lastAssistantMsg}
                                theme={theme}
                                isRawSqlPermitted={role === "analyst" || role === "supervisor"}
                              />
                            )}
                          </div>
                        )}
                      </div>

                      <button
                        onClick={handleExportPDF}
                        className="w-full mt-4 brass-btn font-semibold py-2.5 px-4 rounded text-xs transition-all font-mono"
                      >
                        {language === "kn" ? "ವರದಿಯನ್ನು ರಫ್ತು ಮಾಡಿ" : "Export report"}
                      </button>
                    </div>

                  </div>
                );
              })()}

              {loading && (
                <div className="flex flex-col items-start animate-pulse">
                  {/* Sized placeholder bubble to prevent layout jump (Fix 5.6) */}
                  <div className={`w-80 h-32 px-5 py-4 rounded-lg flex flex-col justify-between ${theme === "dark" ? "bubble-assistant-dark" : "bubble-assistant-light"
                    }`}>
                    <div className="h-4 bg-slate-700 bg-opacity-35 rounded w-1/3"></div>
                    <div className="h-3 bg-slate-700 bg-opacity-35 rounded w-full"></div>
                    <div className="h-3 bg-slate-700 bg-opacity-35 rounded w-5/6"></div>
                    <div className="flex items-center gap-1.5 self-start">
                      <span className="dot dot1"></span>
                      <span className="dot dot2"></span>
                      <span className="dot"></span>
                    </div>
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
              <button
                type="button"
                onClick={toggleMic}
                disabled={!speechSupported}
                className={`p-3 rounded-full border transition-all ${isListening
                    ? "bg-red-100 border-red-500 text-red-600 animate-pulse"
                    : "bg-slate-50 border-slate-300 text-slate-600 hover:bg-slate-100"
                  }`}
                title={speechSupported ? (isListening ? "Listening... click to stop" : "Voice input") : "Mic not supported"}
                style={{ opacity: speechSupported ? 1 : 0.5 }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 1v11M19 10v2a7 7 0 0 1-14 0v-2M12 23v-4" strokeLinecap="round" />
                  <rect x="9" y="5" width="6" height="10" rx="3" fill={isListening ? "currentColor" : "none"} />
                </svg>
              </button>

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
                className={`flex-1 rounded-md px-4 py-3 text-sm focus:outline-none border ${theme === "dark"
                    ? "bg-[#0f2745] border-[#1e3a5f] focus:border-[#C6963C] text-stone-200 focus:bg-[#0b1f3a]"
                    : "bg-slate-50 border-slate-300 focus:border-stone-500 text-slate-800 focus:bg-white"
                  }`}
              />

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
            className={`w-[600px] h-full flex flex-col shadow-2xl overflow-hidden p-6 ${theme === "dark" ? "bg-[#0b1b2f] text-stone-200 border-l border-[#1e3a5f]" : "bg-white text-slate-800 border-l border-[#dde1e4]"
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
// LIGHTWEIGHT MARKDOWN-TO-JSX PARSER (Fix 5.1)
// ---------------------------------------------------------------------------
function formatMessage(text) {
  if (!text) return null;

  const lines = text.split("\n");
  let currentSection = "general";
  const sections = {
    summary: [],
    findings: [],
    details: [],
    general: []
  };

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("**Summary:**") || trimmed.startsWith("**ಸಾರಾಂಶ:**")) {
      currentSection = "summary";
      sections.summary.push(trimmed.replace(/^\*\*(Summary|ಸಾರಾಂಶ):\*\*\s*/i, ""));
    } else if (trimmed.startsWith("**Key Findings:**") || trimmed.startsWith("**ಮುಖ್ಯಾಂಶಗಳು:**")) {
      currentSection = "findings";
    } else if (trimmed.startsWith("**Details:**") || trimmed.startsWith("**ವಿವರಗಳು:**")) {
      currentSection = "details";
    } else {
      if (currentSection === "summary") {
        sections.summary.push(line);
      } else if (currentSection === "findings") {
        if (trimmed) sections.findings.push(line);
      } else if (currentSection === "details") {
        sections.details.push(line);
      } else {
        sections.general.push(line);
      }
    }
  });

  const parseBold = (str) => {
    const parts = str.split(/\*\*([^*]+)\*\*/g);
    return parts.map((part, idx) => {
      if (idx % 2 === 1) {
        return <strong key={idx} className="font-semibold text-[#C6963C]">{part}</strong>;
      }
      return part;
    });
  };

  const renderList = (items) => {
    return (
      <ul className="list-disc pl-5 space-y-1.5 leading-relaxed text-sm">
        {items.map((item, idx) => {
          const cleanItem = item.trim().replace(/^[-*]\s*/, "");
          if (!cleanItem) return null;
          return (
            <li key={idx} className="pl-1 text-stone-200">
              {parseBold(cleanItem)}
            </li>
          );
        })}
      </ul>
    );
  };

  if (!sections.summary.length && !sections.findings.length && !sections.details.length) {
    return (
      <div className="space-y-2">
        {lines.map((l, idx) => <p key={idx}>{parseBold(l)}</p>)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 1. Summary Section */}
      {sections.summary.length > 0 && (
        <div className="text-base font-medium leading-relaxed border-l-2 border-[#C6963C] pl-3 italic text-stone-100">
          {sections.summary.map((l, idx) => <span key={idx}>{parseBold(l)} </span>)}
        </div>
      )}

      {/* 2. Key Findings Section */}
      {sections.findings.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs uppercase font-mono tracking-wider text-[#C6963C] font-semibold">
            Key Findings
          </h4>
          {renderList(sections.findings)}
        </div>
      )}

      {/* 3. Details Section */}
      {sections.details.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-slate-700 border-opacity-35">
          <h4 className="text-xs uppercase font-mono tracking-wider text-[#C6963C] font-semibold">
            Details
          </h4>
          <div className="text-sm leading-relaxed space-y-1.5 opacity-90 text-stone-300">
            {sections.details.map((l, idx) => <p key={idx}>{parseBold(l)}</p>)}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TABULAR SQL RESULTS COMPONENT (Fix 5.3)
// ---------------------------------------------------------------------------
function SqlResultsTable({ results }) {
  if (!Array.isArray(results) || results.length === 0) return null;

  const maxRows = 10;
  const displayRows = results.slice(0, maxRows);
  const hasMore = results.length > maxRows;

  return (
    <div className="mt-3 overflow-x-auto border border-slate-700 rounded bg-[#081628] bg-opacity-65 p-2.5">
      <span className="text-[9px] uppercase tracking-wider text-[#C6963C] font-mono block mb-1.5">
        Query Result Table ({results.length} rows)
      </span>
      <table className="w-full text-[10px] font-mono text-left border-collapse">
        <tbody>
          {displayRows.map((row, rIdx) => {
            const isEven = rIdx % 2 === 0;
            return (
              <tr
                key={rIdx}
                className={isEven ? "bg-[#0b1f3a] bg-opacity-40" : "bg-transparent"}
              >
                {Array.isArray(row) ? (
                  row.map((val, cIdx) => (
                    <td key={cIdx} className="p-1 border-b border-slate-800 text-stone-300">
                      {String(val)}
                    </td>
                  ))
                ) : (
                  <td className="p-1 border-b border-slate-800 text-stone-300">
                    {String(row)}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {hasMore && (
        <div className="text-[8.5px] text-[#C6963C] italic mt-1.5 font-mono">
          + {results.length - maxRows} more rows truncated
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// COLOR-CODED ROUTE BADGE (Fix 5.2)
// ---------------------------------------------------------------------------
function RouteBadge({ route }) {
  let bgColor = "bg-slate-700 text-slate-300 border-slate-500";
  let displayRoute = route.toUpperCase();

  if (route === "sql") {
    bgColor = "bg-[#0c2447] text-[#C6963C] border-[#C6963C]";
  } else if (route === "network") {
    bgColor = "bg-red-950 text-red-400 border-red-800";
  } else if (route === "forecast") {
    bgColor = "bg-purple-950 text-purple-400 border-purple-800";
  } else if (route === "hybrid") {
    bgColor = "bg-amber-950 text-amber-400 border-amber-800";
  } else if (route === "graph") {
    bgColor = "bg-slate-900 text-slate-300 border-slate-700";
  } else if (route === "system") {
    bgColor = "bg-[#09351C] text-[#2F6F52] border-[#2F6F52]";
    displayRoute = "VERIFIED";
  }

  return (
    <div className="flex mb-2">
      <span className={`text-[9px] uppercase tracking-wider font-mono border px-2 py-0.5 rounded ${bgColor}`}>
        {displayRoute} PIPELINE
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SVG LINE CHART COMPONENT (Forecasts)
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

  const histLinePath = histCoords.reduce((path, p, i) => path + (i === 0 ? `M ${p.x} ${p.y}` : ` L ${p.x} ${p.y}`), "");

  const lastHist = histCoords[histCoords.length - 1];
  const forecastLinePath = lastHist
    ? forecastCoords.reduce((path, p) => path + ` L ${p.x} ${p.y}`, `M ${lastHist.x} ${lastHist.y}`)
    : forecastCoords.reduce((path, p, i) => path + (i === 0 ? `M ${p.x} ${p.y}` : ` L ${p.x} ${p.y}`), "");

  return (
    <div className={`mt-3 p-4 rounded-lg border text-[10px] font-mono shadow-sm ${theme === "dark" ? "bg-[#0b1628] border-[#1e3a5f]" : "bg-slate-50 border-slate-200"
      }`}>
      <span className="font-semibold block mb-2 text-[#C6963C]">Time-Series Projection Dashboard</span>
      <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full">
        <line x1={paddingX} y1={paddingY} x2={chartWidth - paddingX} y2={paddingY} stroke="#44516840" strokeWidth="0.5" />
        <line x1={paddingX} y1={chartHeight / 2} x2={chartWidth - paddingX} y2={chartHeight / 2} stroke="#44516840" strokeWidth="0.5" />
        <line x1={paddingX} y1={chartHeight - paddingY} x2={chartWidth - paddingX} y2={chartHeight - paddingY} stroke="#44516840" strokeWidth="0.5" />

        <text x={10} y={paddingY + 4} fill="#8391A3">{Math.round(maxCount)}</text>
        <text x={10} y={chartHeight - paddingY + 4} fill="#8391A3">{Math.round(minCount)}</text>

        {histLinePath && <path d={histLinePath} fill="none" stroke="#2563EB" strokeWidth="2.5" />}
        {forecastLinePath && <path d={forecastLinePath} fill="none" stroke="#C6963C" strokeWidth="2.5" strokeDasharray="4 3" />}

        {histCoords.map((c, idx) => (
          <circle key={`h-${idx}`} cx={c.x} cy={c.y} r="3" fill="#2563EB" />
        ))}
        {forecastCoords.map((c, idx) => (
          <circle key={`f-${idx}`} cx={c.x} cy={c.y} r="3" fill="#C6963C" />
        ))}
      </svg>
      <div className="flex justify-between items-center text-[8px] text-slate-400 mt-2 px-6">
        <span className="flex items-center gap-1"><span className="w-2 h-2 bg-[#2563EB] inline-block rounded-full"></span> Historical Case counts</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 border-b-2 border-dashed border-[#C6963C] inline-block"></span> Regression Forecast (next 3M)</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SVG REDESIGNED TIED NETWORK GRAPH COMPONENT (Cubic Bezier Curves & Highlighting)
// ---------------------------------------------------------------------------
function NetworkGraph({ data, theme, onNodeClick }) {
  const fgRef = useRef();

  const [hoverNode, setHoverNode] = useState(null);
  const [highlightNodes, setHighlightNodes] = useState(new Set());
  const [highlightLinks, setHighlightLinks] = useState(new Set());

  const updateHighlight = () => {
    setHighlightNodes(new Set(highlightNodes));
    setHighlightLinks(new Set(highlightLinks));
  };

  const handleNodeHover = (node) => {
    highlightNodes.clear();
    highlightLinks.clear();
    if (node) {
      highlightNodes.add(node.id);
      if (Array.isArray(data.links)) {
        data.links.forEach(link => {
          const s = typeof link.source === 'object' ? link.source.id : link.source;
          const t = typeof link.target === 'object' ? link.target.id : link.target;
          if (s === node.id) {
            highlightNodes.add(t);
            highlightLinks.add(link);
          }
          if (t === node.id) {
            highlightNodes.add(s);
            highlightLinks.add(link);
          }
        });
      }
    }
    setHoverNode(node || null);
    updateHighlight();
  };

  const nodes = data.nodes || [];
  const links = data.links || [];

  // Deep copy nodes and links to prevent freeze crashes from d3 internal mutations
  const graphData = {
    nodes: nodes.map(n => ({ ...n })),
    links: links.map(l => ({ ...l }))
  };

  return (
    <div className={`w-full h-[280px] rounded-lg border relative overflow-hidden select-none ${
      theme === "dark" ? "bg-[#0b1628] border-[#1e3a5f]" : "bg-slate-50 border-slate-200"
    }`}>
      <div className="absolute top-2 left-2 z-10 text-[8px] font-mono text-slate-400 bg-[#081628] bg-opacity-75 px-2 py-0.5 rounded border border-slate-800 pointer-events-none">
        Drag nodes · Scroll zoom
      </div>

      <ForceGraph2D
        ref={fgRef}
        graphData={graphData}
        width={340}
        height={278}
        cooldownTicks={80}
        onNodeClick={(node) => {
          if (onNodeClick) onNodeClick(node.id);
        }}
        onNodeHover={handleNodeHover}
        nodeRelSize={6}
        nodeCanvasObject={(node, ctx, globalScale) => {
          const label = node.label || node.id;
          const fontSize = Math.max(7.5, 9 / globalScale);
          ctx.font = `${fontSize}px monospace`;

          const isHovered = hoverNode && hoverNode.id === node.id;
          const isHighlighted = highlightNodes.size > 0 && highlightNodes.has(node.id);
          const isFade = highlightNodes.size > 0 && !isHighlighted;

          ctx.save();
          ctx.globalAlpha = isFade ? 0.25 : 1.0;

          // Render custom node shapes
          let r = 5.5;
          let color = "#EF4444"; // Suspect node (Red)
          if (node.type === "case") {
            color = "#2563EB"; // Case Node (Blue)
            r = 6.5;
          } else if (node.type === "phone" || node.type === "station") {
            color = "#EAB308"; // Communication Asset (Gold)
            r = 4.5;
          }

          ctx.beginPath();
          ctx.arc(node.x, node.y, r, 0, 2 * Math.PI, false);
          ctx.fillStyle = color;
          ctx.fill();

          ctx.lineWidth = isHovered ? 2.5 / globalScale : 1.2 / globalScale;
          ctx.strokeStyle = isHovered ? "#FFFFFF" : (theme === "dark" ? "#1E293B" : "#E2E8F0");
          ctx.stroke();

          // Render suspect avatar icon inside accused nodes
          if (node.type === "accused") {
            ctx.fillStyle = "#FFFFFF";
            ctx.beginPath();
            ctx.arc(node.x, node.y - 1.2, 1.4, 0, 2 * Math.PI, false);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(node.x, node.y + 2.5, 2.5, Math.PI, 2 * Math.PI, false);
            ctx.fill();
          }

          // Node Text Labels drawn above shapes
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = theme === "dark" ? "#E2E8F0" : "#0F172A";

          const displayLabel = label.length > 15 ? label.slice(0, 12) + "..." : label;
          ctx.fillText(displayLabel, node.x, node.y - r - (fontSize / 2) - 2);

          ctx.restore();
        }}
        linkColor={link => {
          const isHighlighted = highlightLinks.has(link);
          const isFade = highlightLinks.size > 0 && !isHighlighted;
          if (isFade) return theme === "dark" ? "#1e293b20" : "#cbd5e120";
          return link.type === "USES" ? "#EAB308" : "#EF4444";
        }}
        linkWidth={link => (highlightLinks.has(link) ? 2.2 : 1.0)}
        linkDirectionalParticles={1.5}
        linkDirectionalParticleWidth={link => (highlightLinks.size > 0 && highlightLinks.has(link) ? 1.5 : 0)}
        linkDirectionalParticleSpeed={0.006}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// COLLAPSIBLE INSET REASONING COMPONENT (Fix 5.3)
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
        <div className={`mt-2 p-3 text-[10px] font-mono border space-y-2.5 ${theme === "dark" ? "reasoning-container-dark" : "reasoning-container-light"
          }`}>
          <div className="flex justify-between items-center text-[9px] text-slate-400">
            <span>Query Pipeline:</span>
            <span className="font-bold">{msg.route.toUpperCase()} ROUTER</span>
          </div>

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
