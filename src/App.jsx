import React, { useState, useEffect, useRef } from "react";

// ---------------------------------------------------------------------------
// DESIGN TOKENS
//   Ink Navy   #0B1F3A   primary surface (header, hero, footer)
//   Midnight   #061224   deepest surface (footer base)
//   Brass      #C6963C   accent (CTAs, highlights, seals)
//   Paper      #EEF0F1   light section background (cool grey, not cream)
//   Slate      #445168   body text on light backgrounds
//   Verified   #2F6F52   trust / audit / "confirmed" indicator green
// ---------------------------------------------------------------------------

const SAMPLE_QUERIES = [
  {
    q: "Show repeat offenders linked to Case KA-19-2026-00456",
    a: "Based on the investigation context, Ramesh Kumar (Primary Accused) has a history of prior arrests in Mysuru and Hassan for organized burglaries. Two known associates, Suresh Gowda and Anil Hegde, are also linked to this case network.",
    route: "hybrid",
    sql: "SELECT DISTINCT CM.CrimeNo, PI.FullName, PI.IsRepeatOffender FROM Accused A JOIN CaseMaster CM ON A.CaseMasterID = CM.CaseMasterID JOIN PersonIdentity PI ON A.PersonIdentityID = PI.PersonIdentityID WHERE CM.CaseNo = 'KA-19-2026-00456' AND PI.IsRepeatOffender = 1;",
    src: "Accused records: Ramesh Kumar (ID: 9871) · CaseMaster: KA-19-2026-00456 · District: Mysuru",
  },
  {
    q: "How many burglary cases were reported in Mysuru last month?",
    a: "Last month, 27 burglary cases were reported in Mysuru District. Of these, 14 cases are currently under active investigation, 8 have been charge-sheeted, and 5 are pending trial.",
    route: "sql",
    sql: "SELECT COUNT(*) FROM CaseMaster CM JOIN CrimeSubHead CS ON CM.CrimeMinorHeadID = CS.CrimeSubHeadID JOIN Unit U ON CM.PoliceStationID = U.UnitID WHERE CS.CrimeHeadName = 'Burglary' AND U.UnitName LIKE '%Mysuru%' AND CM.CrimeRegisteredDate >= '2026-06-01';",
    src: "CrimeSubHead: Burglary · CaseStatusMaster · District: Mysuru",
  },
  {
    q: "ಮೈಸೂರಿನಲ್ಲಿ ಕಳೆದ ತಿಂಗಳು ಎಷ್ಟು ಕಳ್ಳತನ ಪ್ರಕರಣಗಳು ವರದಿಯಾಗಿವೆ?",
    a: "ಕಳೆದ ತಿಂಗಳು ಮೈಸೂರಿನಲ್ಲಿ ಒಟ್ಟು 27 ಕಳ್ಳತನ ಪ್ರಕರಣಗಳು ವರದಿಯಾಗಿವೆ. ಇವುಗಳಲ್ಲಿ 14 ಪ್ರಕರಣಗಳು ಪ್ರಸ್ತುತ ತನಿಖೆಯ ಹಂತದಲ್ಲಿವೆ.",
    route: "sql",
    sql: "SELECT COUNT(*) FROM CaseMaster CM JOIN CrimeSubHead CS ON CM.CrimeMinorHeadID = CS.CrimeSubHeadID JOIN Unit U ON CM.PoliceStationID = U.UnitID WHERE CS.CrimeHeadName = 'Theft' AND U.UnitName LIKE '%Mysuru%' AND CM.CrimeRegisteredDate >= '2026-06-01';",
    src: "District: Mysuru · CrimeRegisteredDate · CrimeRegisteredMonth: June 2026",
  },
];

function ShieldMark({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      <path
        d="M24 4 L42 11 V22 C42 33 34.5 40.5 24 44 C13.5 40.5 6 33 6 22 V11 Z"
        fill="var(--navy)"
        stroke="var(--brass)"
        strokeWidth="1.5"
      />
      <path
        d="M24 12 L24 26 M17 19 L31 19"
        stroke="var(--brass)"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <circle cx="24" cy="32" r="3" fill="var(--brass)" />
    </svg>
  );
}

function FeatureCard({ code, title, desc }) {
  return (
    <div
      className="rounded-lg p-6 transition-all duration-200 hover:-translate-y-1 hover:shadow-md"
      style={{
        backgroundColor: "#FFFFFF",
        border: "1px solid #DDE1E4",
        boxShadow: "0 1px 2px rgba(11,31,58,0.06)",
      }}
    >
      <span
        className="inline-block text-xs font-semibold tracking-wider px-2 py-1 rounded"
        style={{
          fontFamily: "'IBM Plex Mono', monospace",
          backgroundColor: "#0B1F3A0D",
          color: "var(--navy)",
          letterSpacing: "0.08em",
        }}
      >
        {code}
      </span>
      <h3
        className="mt-4 text-lg font-semibold"
        style={{ color: "var(--navy)", fontFamily: "'Fraunces', serif" }}
      >
        {title}
      </h3>
      <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--slate)" }}>
        {desc}
      </p>
    </div>
  );
}

function StepItem({ n, title, desc, isLast }) {
  return (
    <div className="flex-1 relative">
      <div className="flex items-center gap-3">
        <div
          className="flex items-center justify-center rounded-full font-semibold shrink-0"
          style={{
            width: 36,
            height: 36,
            backgroundColor: "var(--navy)",
            color: "var(--brass)",
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 14,
          }}
        >
          {n}
        </div>
        {!isLast && (
          <div
            className="hidden md:block flex-1 h-px"
            style={{ backgroundColor: "#C9CFD4" }}
          />
        )}
      </div>
      <h4
        className="mt-4 font-semibold text-base"
        style={{ color: "var(--navy)" }}
      >
        {title}
      </h4>
      <p className="mt-1 text-sm leading-relaxed" style={{ color: "var(--slate)" }}>
        {desc}
      </p>
    </div>
  );
}

export default function App() {
  const [navOpen, setNavOpen] = useState(false);
  const [inputVal, setInputVal] = useState("");
  const [loading, setLoading] = useState(false);
  const [isLiveMode, setIsLiveMode] = useState(false);
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);

  // Focus and prefill helpers
  const handlePrefill = (qText) => {
    setInputVal(qText);
  };

  const handleQuerySubmit = async (e) => {
    if (e) e.preventDefault();
    if (!inputVal.trim()) return;

    setLoading(true);
    setErrorMsg(null);
    setResult(null);

    try {
      const response = await fetch("http://localhost:8000/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: inputVal }),
      });

      if (!response.ok) {
        throw new Error("Server offline or returned error.");
      }

      const data = await response.json();
      setResult({
        answer: data.answer,
        route: data.route,
        sql: data.sql,
        context: data.context,
        mode: "Live API"
      });
      setIsLiveMode(true);
    } catch (err) {
      console.warn("Backend API offline. Activating client-side mock fallback.");
      
      // Perform local mock matching
      setTimeout(() => {
        const queryLower = inputVal.toLowerCase();
        let matched = null;

        // Try matching sample list
        for (const sample of SAMPLE_QUERIES) {
          if (queryLower.includes("00456") || queryLower.includes("repeat offender")) {
            matched = SAMPLE_QUERIES[0];
            break;
          } else if (queryLower.includes("burglary") || queryLower.includes("reported in")) {
            matched = SAMPLE_QUERIES[1];
            break;
          } else if (queryLower.includes("ಮೈಸೂರು") || queryLower.includes("ಕಳ್ಳತನ")) {
            matched = SAMPLE_QUERIES[2];
            break;
          }
        }

        if (matched) {
          setResult({
            answer: matched.a,
            route: matched.route,
            sql: matched.sql,
            context: matched.src,
            mode: "Local Mock (Server Offline)"
          });
        } else {
          // Default fallbacks
          const isSqlRoute = queryLower.includes("count") || queryLower.includes("how many") || queryLower.includes("number");
          setResult({
            answer: `Crime records matching "${inputVal}" have been analyzed. रमेश कुमार (suspect linked to Hebbal PS) is flagged in relation to this query network context.`,
            route: isSqlRoute ? "sql" : "graph",
            sql: isSqlRoute ? "SELECT COUNT(*) FROM CaseMaster CM WHERE CM.BriefFacts LIKE '%" + inputVal.slice(0, 10) + "%';" : null,
            context: "Source: Accused database · Hebbal Station logs",
            mode: "Local Mock (Server Offline)"
          });
        }
        setIsLiveMode(false);
      }, 750);
    } finally {
      setLoading(false);
    }
  };

  const features = [
    {
      code: "NET",
      title: "Criminal Network Analysis",
      desc: "Map links between accused, victims, locations and financial accounts to surface organized groups and repeat-offender rings.",
    },
    {
      code: "PAT",
      title: "Crime Pattern & Trend Analytics",
      desc: "Track crime across time, geography and modus operandi to identify hotspots and emerging clusters.",
    },
    {
      code: "SOC",
      title: "Sociological Crime Insights",
      desc: "Correlate crime patterns with demographic and socio-economic indicators to inform preventive policy.",
    },
    {
      code: "PROF",
      title: "Criminology-Based Profiling",
      desc: "Behavioural analysis and transparent risk scoring of repeat offenders, prioritised for investigation.",
    },
    {
      code: "FIN",
      title: "Financial Crime Link Analysis",
      desc: "Trace suspicious transaction networks and money trails connected to ongoing cases.",
    },
    {
      code: "FCST",
      title: "Forecasting & Early Warning",
      desc: "Predictive signals for emerging crime patterns, gang activity and likely hotspots.",
    },
  ];

  return (
    <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", backgroundColor: "var(--paper)" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
        :root {
          --navy: #0B1F3A;
          --midnight: #061224;
          --brass: #C6963C;
          --paper: #EEF0F1;
          --slate: #445168;
          --verified: #2F6F52;
        }
        .brass-btn {
          background-color: var(--brass);
          color: var(--navy);
          transition: all 0.2s ease;
        }
        .brass-btn:hover { filter: brightness(1.15); }
        .outline-btn {
          border: 1px solid rgba(255,255,255,0.35);
          color: #F4F2EC;
          transition: all 0.2s ease;
        }
        .outline-btn:hover { border-color: var(--brass); color: var(--brass); }
        .terminal-glow {
          box-shadow: 0 0 25px rgba(198,150,60,0.15);
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        .animate-pulse-slow {
          animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }
      `}</style>

      {/* HEADER */}
      <header
        className="sticky top-0 z-50"
        style={{ backgroundColor: "var(--navy)", borderBottom: "1px solid rgba(198,150,60,0.25)" }}
      >
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ShieldMark />
            <div>
              <p className="text-sm font-semibold" style={{ color: "#F4F2EC" }}>
                Vigil AI
              </p>
              <p
                className="text-xs"
                style={{ color: "#C6963C", fontFamily: "'IBM Plex Mono', monospace" }}
              >
                Crime Intelligence Platform · Karnataka Police
              </p>
            </div>
          </div>

          <nav className="hidden md:flex items-center gap-8">
            {["Capabilities", "How it works", "Governance"].map((item) => (
              <a
                key={item}
                href={`#${item.toLowerCase().replace(/\s+/g, "-")}`}
                className="text-sm font-medium transition-colors hover:text-white"
                style={{ color: "#D7DBDF" }}
              >
                {item}
              </a>
            ))}
            <button className="brass-btn text-sm font-semibold px-5 py-2 rounded-md">
              Sign in
            </button>
          </nav>

          <button
            className="md:hidden text-sm px-3 py-1.5 rounded"
            style={{ color: "#F4F2EC", border: "1px solid rgba(255,255,255,0.3)" }}
            onClick={() => setNavOpen((v) => !v)}
          >
            Menu
          </button>
        </div>
        {navOpen && (
          <div className="md:hidden px-6 pb-4 flex flex-col gap-3" style={{ borderTop: "1px solid rgba(255,255,255,0.1)" }}>
            {["Capabilities", "How it works", "Governance"].map((item) => (
              <a
                key={item}
                href={`#${item.toLowerCase().replace(/\s+/g, "-")}`}
                className="text-sm py-2"
                style={{ color: "#D7DBDF" }}
                onClick={() => setNavOpen(false)}
              >
                {item}
              </a>
            ))}
          </div>
        )}
      </header>

      {/* HERO */}
      <section style={{ backgroundColor: "var(--navy)" }}>
        <div className="max-w-6xl mx-auto px-6 py-16 grid md:grid-cols-2 gap-12 items-center">
          <div>
            <span
              className="inline-block text-xs font-semibold px-3 py-1 rounded-full mb-6"
              style={{
                border: "1px solid rgba(198,150,60,0.5)",
                color: "var(--brass)",
                fontFamily: "'IBM Plex Mono', monospace",
              }}
            >
              Hybrid GraphRAG + Text-to-SQL Crime Intelligence
            </span>
            <h1
              className="text-4xl md:text-5xl font-semibold leading-tight"
              style={{ color: "#F4F2EC", fontFamily: "'Fraunces', serif" }}
            >
              Ask the crime database a question. Get an investigation-ready answer.
            </h1>
            <p className="mt-6 text-base leading-relaxed" style={{ color: "#B9C1C9" }}>
              A conversational intelligence interface querying structured case records and entities. 
              Surfacing hidden networks, repeat offenders, and modus operandi in English and Kannada.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <a href="#console-section" className="brass-btn font-semibold px-6 py-3 rounded-md text-sm text-center">
                Launch Console
              </a>
              <button className="outline-btn font-semibold px-6 py-3 rounded-md text-sm">
                View Documentation
              </button>
            </div>
          </div>

          {/* Interactive signature query console mockup */}
          <div
            id="console-section"
            className="rounded-xl p-6 terminal-glow transition-all duration-300"
            style={{
              backgroundColor: "#0F2745",
              border: "1px solid rgba(198,150,60,0.4)",
              boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
            }}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: "#EF4444" }} />
                <div style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: "var(--brass)" }} />
                <div style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: "var(--verified)" }} />
                <span
                  className="ml-2 text-xs"
                  style={{ color: "#8391A3", fontFamily: "'IBM Plex Mono', monospace" }}
                >
                  investigation-terminal
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className="inline-block text-[10px] uppercase font-mono px-2 py-0.5 rounded"
                  style={{
                    backgroundColor: isLiveMode ? "#0F2E22" : "#1B2A3A",
                    color: isLiveMode ? "#BFE3CC" : "#C7CDD3",
                    border: isLiveMode ? "1px solid #2F6F52" : "1px solid #445168",
                  }}
                >
                  {isLiveMode ? "● API Live" : "Fallback Mode"}
                </span>
              </div>
            </div>

            <form onSubmit={handleQuerySubmit} className="space-y-3">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Type a crime database query... (English or Kannada)"
                  value={inputVal}
                  onChange={(e) => setInputVal(e.target.value)}
                  disabled={loading}
                  className="w-full rounded-md p-4 text-sm font-mono focus:outline-none"
                  style={{
                    backgroundColor: "#0B1F3A",
                    border: "1px solid #1E3A5F",
                    color: "#EDEFF1",
                  }}
                />
                <button
                  type="submit"
                  disabled={loading || !inputVal.trim()}
                  className="absolute right-2 top-2 bottom-2 px-4 rounded-md font-semibold text-xs brass-btn"
                  style={{ opacity: inputVal.trim() ? 1 : 0.6 }}
                >
                  {loading ? "Analyzing..." : "Ask AI"}
                </button>
              </div>
            </form>

            {/* Clickable Sample Queries inside the console */}
            <div className="mt-4">
              <p className="text-xs font-semibold mb-2" style={{ color: "#8391A3" }}>
                Click a sample query to load:
              </p>
              <div className="flex flex-col gap-2">
                {SAMPLE_QUERIES.map((sq, i) => (
                  <button
                    key={i}
                    onClick={() => handlePrefill(sq.q)}
                    className="text-left text-xs font-mono p-2 rounded transition-all hover:bg-opacity-30"
                    style={{
                      backgroundColor: "rgba(198,150,60,0.08)",
                      border: "1px solid rgba(198,150,60,0.15)",
                      color: "#D7DBDF",
                    }}
                  >
                    {sq.q}
                  </button>
                ))}
              </div>
            </div>

            {/* RESULTS CONTAINER */}
            {(loading || result) && (
              <div className="mt-5 pt-5 border-t border-dashed border-[#1E3A5F]">
                {loading && (
                  <div className="flex flex-col items-center py-6 gap-3">
                    <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "var(--brass)", borderTopColor: "transparent" }}></div>
                    <span className="text-xs font-mono animate-pulse-slow" style={{ color: "#B9C1C9" }}>
                      Routing query & analyzing graph records...
                    </span>
                  </div>
                )}

                {result && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between text-xs font-mono">
                      <span className="text-slate-400">Pipeline Route:</span>
                      <span
                        className="px-2 py-0.5 rounded font-semibold uppercase tracking-wider"
                        style={{
                          backgroundColor:
                            result.route === "sql" ? "#1A365D" : result.route === "hybrid" ? "#5C3E00" : "#2E3B4E",
                          color:
                            result.route === "sql" ? "#93C5FD" : result.route === "hybrid" ? "#FDE047" : "#E2E8F0",
                        }}
                      >
                        {result.route}
                      </span>
                    </div>

                    {result.sql && (
                      <div className="space-y-1">
                        <span className="text-xs font-mono text-slate-400">Generated SQL Query:</span>
                        <pre
                          className="text-xs p-3 rounded overflow-x-auto font-mono max-h-32 text-left"
                          style={{ backgroundColor: "#061224", border: "1px solid #1E3A5F", color: "var(--brass)" }}
                        >
                          <code>{result.sql}</code>
                        </pre>
                      </div>
                    )}

                    <div
                      className="rounded-md p-4"
                      style={{
                        backgroundColor: "#0F2E22",
                        border: "1px solid rgba(47,111,82,0.4)",
                      }}
                    >
                      <p className="text-sm font-medium leading-relaxed" style={{ color: "#BFE3CC" }}>
                        {result.answer}
                      </p>
                      <div className="mt-3 pt-3 border-t border-[#1F5F3E] flex flex-col gap-1 text-[11px] font-mono text-[#7FA98F]">
                        <span>Citations & Context:</span>
                        <p>{result.context}</p>
                      </div>
                    </div>

                    <div className="text-[10px] font-mono text-right" style={{ color: "#8391A3" }}>
                      Source: {result.mode}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section id="capabilities" className="max-w-6xl mx-auto px-6 py-20">
        <div className="max-w-2xl">
          <p
            className="text-xs font-semibold tracking-wider"
            style={{ color: "var(--brass)", fontFamily: "'IBM Plex Mono', monospace" }}
          >
            CAPABILITIES
          </p>
          <h2
            className="mt-2 text-3xl font-semibold"
            style={{ color: "var(--navy)", fontFamily: "'Fraunces', serif" }}
          >
            Beyond record lookup
          </h2>
          <p className="mt-3 text-base" style={{ color: "var(--slate)" }}>
            Six analytical modules sit behind the conversation, grounded in
            criminology and sociological method.
          </p>
        </div>
        <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {features.map((f) => (
            <FeatureCard key={f.code} {...f} />
          ))}
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how-it-works" style={{ backgroundColor: "#E4E7E9" }}>
        <div className="max-w-6xl mx-auto px-6 py-20">
          <p
            className="text-xs font-semibold tracking-wider"
            style={{ color: "var(--brass)", fontFamily: "'IBM Plex Mono', monospace" }}
          >
            HOW IT WORKS
          </p>
          <h2
            className="mt-2 text-3xl font-semibold"
            style={{ color: "var(--navy)", fontFamily: "'Fraunces', serif" }}
          >
            From question to evidence trail
          </h2>
          <div className="mt-12 flex flex-col md:flex-row gap-10 md:gap-6">
            <StepItem n="1" title="Ask" desc="Type or speak a question in English or Kannada." />
            <StepItem n="2" title="Retrieve" desc="The system queries structured records and case documents." />
            <StepItem n="3" title="Analyze" desc="Network, trend and risk models run against the results." />
            <StepItem n="4" title="Explain" desc="Every answer cites the exact record it came from." isLast />
          </div>
        </div>
      </section>

      {/* GOVERNANCE / TRUST */}
      <section id="governance" style={{ backgroundColor: "var(--navy)" }}>
        <div className="max-w-6xl mx-auto px-6 py-16">
          <p
            className="text-xs font-semibold tracking-wider"
            style={{ color: "var(--brass)", fontFamily: "'IBM Plex Mono', monospace" }}
          >
            GOVERNANCE
          </p>
          <h2
            className="mt-2 text-2xl font-semibold"
            style={{ color: "#F4F2EC", fontFamily: "'Fraunces', serif" }}
          >
            Built for accountable use
          </h2>
          <div className="mt-8 grid sm:grid-cols-3 gap-6">
            {[
              "Role-based access for investigators, analysts and supervisors",
              "Full audit log of every query and record accessed",
              "Every AI response backed by a cited source record",
            ].map((line) => (
              <div key={line} className="flex items-start gap-3">
                <span
                  className="mt-0.5 text-sm font-mono shrink-0"
                  style={{ color: "var(--verified)" }}
                >
                  ✓
                </span>
                <p className="text-sm" style={{ color: "#C7CDD3" }}>
                  {line}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer style={{ backgroundColor: "var(--midnight)" }}>
        <div className="max-w-6xl mx-auto px-6 py-12">
          <div className="flex items-center gap-3">
            <ShieldMark size={22} />
            <p className="text-sm font-semibold" style={{ color: "#F4F2EC" }}>
              Vigil AI
            </p>
          </div>
          <p className="mt-4 text-xs leading-relaxed max-w-xl" style={{ color: "#6B7789" }}>
            Prototype built for a Karnataka Police analytics challenge. Not
            affiliated with or endorsed by the Government of Karnataka. All
            case data shown is synthetic.
          </p>
          <p className="mt-6 text-xs" style={{ color: "#48536A" }}>
            © 2026 · Built for demonstration purposes
          </p>
        </div>
      </footer>
    </div>
  );
}
