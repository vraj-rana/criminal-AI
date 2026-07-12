import React, { useState, useEffect, useRef } from "react";
import { jsPDF } from "jspdf";

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
      title: "1. Network Link Analysis",
      q: "Show repeat offenders linked to Case KA-19-2026-00456 and list their associates",
      desc: "Retrieve and map organized burglary nodes in Mysuru."
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
    doc.setFontSize(16);
    doc.text("Vigil AI - Official Case Investigation Log", 14, yOffset);
    yOffset += 10;

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`Role Level: ${role.toUpperCase()}  |  Language: ${language.toUpperCase()}  |  Theme: ${theme.toUpperCase()}`, 14, yOffset);
    yOffset += 6;
    doc.text(`Exported Date: ${new Date().toLocaleString()}`, 14, yOffset);
    yOffset += 14;

    activeChat.messages.forEach((msg) => {
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
            <div className="max-w-3xl mx-auto space-y-6"> {/* Increased thread spacing (Fix 5.5) */}

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
              ) : (
                <div className="space-y-6"> {/* Consistent spacing gaps between bubbles */}
                  {activeChat.messages.map((msg, index) => {
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
                        <div
                          className={`max-w-2xl px-5 py-4 rounded-lg text-sm leading-relaxed ${isUser
                              ? "bubble-user"
                              : theme === "dark" ? "bubble-assistant-dark" : "bubble-assistant-light"
                            }`}
                        >
                          {/* Color-Coded Route Badge (Fix 5.2) */}
                          {!isUser && msg.route && msg.route !== "system" && (
                            <RouteBadge route={msg.route} />
                          )}

                          {/* Rendered Summary/Key Findings/Details (Fix 5.1 & 5.2) */}
                          <div className="mt-2 text-stone-100">
                            {isUser ? <p>{msg.content}</p> : formatMessage(msg.content)}
                          </div>

                          {/* Tabular HTML SQL Results (Fix 5.3) */}
                          {!isUser && msg.sql_results && (
                            <SqlResultsTable results={msg.sql_results} />
                          )}

                          {/* SVG forecast chart widget */}
                          {!isUser && msg.forecastData && (
                            <div className="mt-3">
                              <ForecastChart data={msg.forecastData} theme={theme} />
                            </div>
                          )}

                          {/* SVG redesigned tiered network graph widget */}
                          {!isUser && msg.graphData && (
                            <div className="mt-3">
                              <NetworkGraph data={msg.graphData} theme={theme} />
                            </div>
                          )}

                          {/* Inset Reasoning logs sub-panel (Fix 5.3) */}
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
                </div>
              )}

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
function NetworkGraph({ data, theme }) {
  const width = 360;
  const height = 150;
  const nodes = data.nodes || [];
  const links = data.links || [];

  const [selectedNode, setSelectedNode] = useState(null);

  const cases = nodes.filter((n) => n.type === "case");
  const suspects = nodes.filter((n) => n.type === "accused");
  const others = nodes.filter((n) => n.type !== "case" && n.type !== "accused");

  const nodePositions = {};

  // 1. Cases on Top Tier (y = 25)
  cases.forEach((n, idx) => {
    const gap = width / (cases.length + 1);
    nodePositions[n.id] = { x: gap * (idx + 1), y: 25 };
  });

  // 2. Suspects on Middle Tier (y = 75)
  suspects.forEach((n, idx) => {
    const gap = width / (suspects.length + 1);
    nodePositions[n.id] = { x: gap * (idx + 1), y: 75 };
  });

  // 3. Others on Bottom Tier (y = 125)
  others.forEach((n, idx) => {
    const gap = width / (others.length + 1);
    nodePositions[n.id] = { x: gap * (idx + 1), y: 125 };
  });

  const isLinked = (nodeId) => {
    if (!selectedNode) return true;
    if (selectedNode === nodeId) return true;
    return links.some(
      (link) =>
        (link.source === selectedNode && link.target === nodeId) ||
        (link.target === selectedNode && link.source === nodeId)
    );
  };

  const isLinkActive = (link) => {
    if (!selectedNode) return true;
    return link.source === selectedNode || link.target === selectedNode;
  };

  return (
    <div className={`mt-3 p-4 rounded-lg border text-[10px] font-mono select-none shadow-sm ${theme === "dark" ? "bg-[#0b1628] border-[#1e3a5f]" : "bg-slate-50 border-slate-200"
      }`}>
      <div className="flex items-center justify-between mb-2">
        <span className="font-semibold text-[#C6963C]">Offender Relationship Network Graph</span>
        {selectedNode && (
          <button
            onClick={() => setSelectedNode(null)}
            className="text-[8px] border border-[#C6963C] text-[#C6963C] px-1 rounded hover:bg-[#C6963C] hover:text-stone-900 transition-all"
          >
            Clear Filter
          </button>
        )}
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="w-full">
        <defs>
          <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="1.5" stdDeviation="1.5" floodColor="#000" floodOpacity="0.2" />
          </filter>
        </defs>

        {/* Draw Links using Smooth Cubic Bezier Curves */}
        {links.map((link, idx) => {
          const s = nodePositions[link.source];
          const t = nodePositions[link.target];
          if (!s || !t) return null;

          const cpY1 = s.y + (t.y - s.y) / 2;
          const cpY2 = cpY1;
          const pathD = `M ${s.x} ${s.y} C ${s.x} ${cpY1}, ${t.x} ${cpY2}, ${t.x} ${t.y}`;

          const isActive = isLinkActive(link);
          const strokeColor = isActive ? (link.type === "USES" ? "#EAB308" : "#EF4444") : "#475569";
          const strokeWidth = isActive ? 1.5 : 0.5;

          return (
            <g key={`l-${idx}`} style={{ opacity: isActive ? 1 : 0.15, transition: "opacity 0.25s ease" }}>
              <path
                d={pathD}
                fill="none"
                stroke={strokeColor}
                strokeWidth={strokeWidth}
                strokeDasharray={link.type === "USES" ? "3 2" : "0"}
              />
              <text
                x={(s.x + t.x) / 2}
                y={(s.y + t.y) / 2 - 2}
                fill={isActive ? "#94A3B8" : "#475569"}
                fontSize="6px"
                textAnchor="middle"
              >
                {link.type}
              </text>
            </g>
          );
        })}

        {/* Draw Nodes (Folder & Avatar Shapes) */}
        {nodes.map((node) => {
          const pos = nodePositions[node.id];
          if (!pos) return null;

          const isNodeActive = isLinked(node.id);
          const isCurrentSelected = selectedNode === node.id;

          let color = "#EF4444"; // accused (red)
          if (node.type === "case") color = "#2563EB"; // case (blue)
          if (node.type === "phone") color = "#EAB308"; // asset/station (yellow)

          return (
            <g
              key={node.id}
              transform={`translate(${pos.x},${pos.y})`}
              onClick={() => setSelectedNode(node.id)}
              className="cursor-pointer"
              style={{
                opacity: isNodeActive ? 1 : 0.15,
                transition: "opacity 0.25s ease"
              }}
            >
              {node.type === "case" ? (
                <path
                  d="M -10 -7 L -4 -7 L -2 -4 L 10 -4 L 10 7 L -10 7 Z"
                  fill={color}
                  stroke={isCurrentSelected ? "#FFF" : "#0F172A"}
                  strokeWidth={isCurrentSelected ? 1.5 : 1}
                  filter="url(#shadow)"
                />
              ) : (
                <circle
                  r="8"
                  fill={color}
                  stroke={isCurrentSelected ? "#FFF" : "#0F172A"}
                  strokeWidth={isCurrentSelected ? 1.5 : 1}
                  filter="url(#shadow)"
                />
              )}

              {node.type === "accused" && (
                <path d="M -4 5 C -4 2, -2 1, 0 1 C 2 1, 4 2, 4 5 Z M 0 -3 A 2 2 0 1 0 0 1 A 2 2 0 1 0 0 -3 Z" fill="#FFF" />
              )}
              {node.type === "phone" && (
                <circle r="2" fill="#FFF" />
              )}

              <text
                y={node.type === "case" ? "-11" : "-12"}
                fill={theme === "dark" ? "#F1F5F9" : "#0F172A"}
                fontSize="7px"
                fontWeight="semibold"
                textAnchor="middle"
                style={{
                  textShadow: theme === "dark" ? "1px 1px 2px #000" : "none"
                }}
              >
                {node.label}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="flex justify-between items-center text-[7.5px] text-slate-400 mt-2 px-1 border-t border-slate-600 border-opacity-15 pt-2">
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 bg-[#2563EB] inline-block rounded-sm"></span> Case file (Top Tier)</span>
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 bg-[#EF4444] inline-block rounded-full"></span> Suspect (Mid Tier)</span>
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 bg-[#EAB308] inline-block rounded-full"></span> Device/PS (Bottom Tier)</span>
      </div>
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
