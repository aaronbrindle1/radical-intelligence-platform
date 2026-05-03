import { useState, useEffect, useMemo, useCallback, useRef } from "react";

// ─── REAL RADICAL VENTURES PORTFOLIO ─────────────────────────────────────────

// ─── SEEDED SAMPLE COVERAGE DATA ─────────────────────────────────────────────
// Generates realistic representative media and social samples per company
// These represent what real ingest from NewsAPI + Data365 would look like

const TIER1 = ["The Wall Street Journal","Bloomberg","Financial Times","The Economist","Reuters","Forbes","CNBC","TechCrunch"];
const TIER2 = ["MIT Technology Review","Wired","VentureBeat","The Verge","Ars Technica","IEEE Spectrum","STAT News","Nature Biotechnology","Fast Company","The Information","Axios","GeekWire","Sifted"];
const TIER3 = ["MarkTechPost","VentureBeat","AI News","ScienceDaily","The Logic","BetaKit","Semiconductor Engineering","Healthcare IT News","Cybersecurity Dive"];

const TOPICS = ["Product Launch","Fundraise","Partnership","Research","Regulatory","Leadership","Expansion","Acquisition","Awards","Strategy"];
const REDDIT_AUTHORS = ["techfounder42","vc_watcher","ai_researcher","startup_tracker","deeptech_nerd","enterprise_ai","biotech_bull","climatetech","quantumleap","ml_practitioner","infosec_pro","healthtech_watch","robotics_eng","spacetech_fan","fintech_analyst"];
const HN_AUTHORS = ["pg_thoughts","dang_","signa11","throwaway_hn","lisper","accidental_cto","ex_googler","bootstrapped","yc_alum","indie_hacker"];

// ── GLOBAL TOAST SYSTEM ───────────────────────────────────────────────────────
export const globalToast = {
  show: (msg, type="error") => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("show-toast", { detail: { msg, type } }));
    }
  }
};

function Toast({ msg, type, onClose }) {
  if (!msg) return null;
  return (
    <div style={{
      position:"fixed", bottom:24, right:24, zIndex:9999,
      background: type==="error" ? "rgba(239,68,68,0.95)" : "rgba(34,197,94,0.95)",
      backdropFilter:"blur(8px)",
      color:"#fff", padding:"12px 20px", borderRadius:8,
      boxShadow:"0 8px 32px rgba(0,0,0,0.4)", fontSize:13, fontWeight:600,
      display:"flex", alignItems:"center", gap:10, animation:"slideIn 0.3s ease-out"
    }}>
      {type==="error" ? "⚠" : "✓"} {msg}
      <button onClick={onClose} style={{background:"none",border:"none",color:"#fff",cursor:"pointer",marginLeft:10,opacity:0.7}}>×</button>
    </div>
  );
}

// Generate consistent sample coverage for a company using seeded randomness
// genCoverage removed — app shows "no data yet" state instead of fake data
// Run a search to get real results.
function genCoverage() { return { media: [], social: [] }; }


const BOOLEAN_QUERIES = {
  // ── LLMs & AI Platforms ───────────────────────────────────────────────────
  "Cohere": `"Cohere" NOT "incoherent" NOT "cohere with"`,
  "Reka":   `("Reka" OR "reka.ai") AND ("AI" OR "LLM" OR "multimodal" OR "startup") NOT "reka dance"`,
  "Writer": `"Writer" AND ("AI" OR "enterprise" OR "LLM" OR "startup") NOT "screenwriter" NOT "writer's block"`,
  "You.com": `"You.com" AND ("AI" OR "search" OR "assistant")`,
  "Hebbia": `"Hebbia" AND ("AI" OR "search" OR "enterprise" OR "knowledge")`,
  "Twelve Labs": `"Twelve Labs" AND ("AI" OR "video" OR "search" OR "understanding")`,
  "Waabi": `"Waabi" AND ("AI" OR "autonomous" OR "trucking" OR "self-driving")`,

  // ── Data, Infrastructure & Dev Tools ─────────────────────────────────────
  "DatologyAI": `("DatologyAI" OR "Datology AI") AND ("AI" OR "data" OR "curation" OR "LLM")`,
  "V7":         `"V7" AND ("AI" OR "computer vision" OR "annotation" OR "data") NOT "V7 car" NOT "V7 rocket"`,
  "Delphina":   `"Delphina" AND ("AI" OR "machine learning" OR "AutoML" OR "data") NOT "ship" NOT "hotel"`,
  "Crusoe":     `"Crusoe" AND ("AI" OR "cloud" OR "compute" OR "GPU" OR "infrastructure")`,
  "Unblocked":  `"Unblocked" AND ("AI" OR "developer" OR "engineering" OR "knowledge")`,
  "P-1 AI":     `("P-1 AI" OR "P1 AI") AND ("AI" OR "coding" OR "software agent" OR "developer")`,
  "Ricursive Intelligence": `"Ricursive" AND ("AI" OR "agent" OR "reasoning" OR "intelligence")`,
  "Artificial Agency": `"Artificial Agency" AND ("AI" OR "gaming" OR "NPC" OR "characters")`,
  "Vizcom":     `"Vizcom" AND ("AI" OR "design" OR "render" OR "sketch")`,
  "Yutori":     `"Yutori" AND ("AI" OR "search" OR "research" OR "agent") NOT "fashion" NOT "clothing"`,

  // ── Enterprise Software & SaaS ────────────────────────────────────────────
  "Firsthand":  `"Firsthand" AND ("AI" OR "agent" OR "commerce" OR "consumer") NOT "experience" NOT "account"`,
  "Spara":      `"Spara" AND ("AI" OR "sales" OR "revenue" OR "pipeline") NOT "spare"`,
  "Emerald AI": `("Emerald AI") OR ("Emerald" AND ("workflow automation" OR "business systems" OR "enterprise AI")) NOT "Emerald Isle" NOT "Emerald City" NOT "Emerald Group"`,
  "Mosaic":     `"Mosaic" AND ("AI" OR "finance" OR "FP&A" OR "planning") NOT "tile" NOT "theory" NOT "law"`,
  "Outset":     `"Outset" AND ("AI" OR "research" OR "qualitative" OR "interviews")`,
  "World Labs": `"World Labs" AND ("AI" OR "spatial" OR "Fei-Fei Li" OR "3D")`,
  "OffDeal":    `"OffDeal" AND ("AI" OR "acquisition" OR "M&A" OR "business")`,

  // ── Healthcare & Life Sciences ────────────────────────────────────────────
  "Aspect Biosystems":  `"Aspect Biosystems" AND ("bioprinting" OR "tissue" OR "healthcare" OR "biotech")`,
  "Genesis Molecular AI": `("Genesis Therapeutics" OR "Genesis Molecular") AND ("AI" OR "drug discovery" OR "molecular" OR "biotech")`,
  "PocketHealth": `"PocketHealth" AND ("medical" OR "imaging" OR "radiology" OR "patient")`,
  "Signal 1":   `"Signal 1" AND ("AI" OR "healthcare" OR "hospital" OR "patient") NOT "signal one"`,
  "Ubenwa":     `"Ubenwa" AND ("AI" OR "infant" OR "cry" OR "diagnostics")`,
  "Unlearn":    `"Unlearn" AND ("AI" OR "clinical trial" OR "digital twin" OR "healthcare")`,
  "Intrepid Labs": `"Intrepid Labs" AND ("AI" OR "biomarker" OR "neurological" OR "healthcare")`,
  "Slingshot AI": `"Slingshot AI" AND ("AI" OR "medical" OR "scribe" OR "documentation")`,
  "Ribbon":     `"Ribbon Health" AND ("healthcare" OR "navigation" OR "provider" OR "data")`,
  "Attuned Intelligence": `"Attuned" AND ("AI" OR "wellbeing" OR "mental health" OR "emotional")`,
  "Nabla Bio":  `"Nabla Bio" AND ("protein design" OR "protein engineering" OR "nabla.bio" OR "generative biology" OR "de novo protein")`,

  // ── Science, Materials & Climate ─────────────────────────────────────────
  "Chemix":     `"Chemix" AND ("AI" OR "battery" OR "materials" OR "energy")`,
  "ClimateAi":  `"ClimateAi" AND ("AI" OR "climate" OR "agriculture" OR "weather")`,
  "Orbital Materials": `"Orbital Materials" AND ("AI" OR "materials" OR "discovery")`,
  "Latent Labs": `"Latent Labs" AND ("AI" OR "protein" OR "biology" OR "generative")`,
  "Periodic Labs": `"Periodic Labs" AND ("scientific AI" OR "literature synthesis" OR "periodiclabs.ai" OR "hypothesis generation" OR "research AI")`,
  "Muon Space":  `"Muon Space" AND ("satellite" OR "climate" OR "Earth observation")`,
  "Pixxel":      `"Pixxel" AND ("satellite" OR "imaging" OR "Earth" OR "hyperspectral")`,

  // ── Deep Tech & Semiconductors ────────────────────────────────────────────
  "Xanadu":     `"Xanadu" AND ("AI" OR "quantum" OR "computing" OR "photonic")`,
  "Promise Robotics": `"Promise Robotics" AND ("robotics" OR "construction" OR "automation")`,

  // ── Biotech Platforms ─────────────────────────────────────────────────────
  "Synex": `"Synex" AND ("AI" OR "cell therapy" OR "biotech" OR "manufacturing")`,

  // ── Security ──────────────────────────────────────────────────────────────
  "Serval": `"Serval" AND ("AI" OR "security" OR "threat" OR "cyber") NOT "animal" NOT "cat"`,
  "Cinder": `"Cinder" AND ("AI" OR "trust" OR "safety" OR "moderation" OR "cinder.ai") NOT "cinders"`,

  // ── Specialized AI Infrastructure ──────────────────────────────────────────
  "Decart": `"Decart" AND ("AI" OR "training" OR "serving" OR "inference" OR "decart.ai")`,
  "Etched": `"Etched" AND ("AI" OR "ASIC" OR "transformer" OR "silicon" OR "chip" OR "etched.com")`,
};


const RAW_PORTFOLIO = [
  { id:1,  name:"Cohere",           categories:["LLMs","Software"],               year:2020, description:"Enterprise AI platform for language models — search, summarisation, and generation at scale.", website:"cohere.com",           competitors_seed:["Anthropic","OpenAI","Mistral AI"] },
  { id:2,  name:"Aspect Biosystems",categories:["Biotechnology","Healthcare"],     year:2020, description:"Bioprinting platform for creating living tissues with vascular networks for drug discovery.", website:"aspectbiosystems.com", competitors_seed:["Organovo","CELLINK","Prellis Biologics"] },
  { id:3,  name:"Genesis Molecular AI",categories:["Biotechnology","Healthcare","Materials"],year:2020,description:"AI-native small molecule drug discovery platform using physics-based molecular simulation.", website:"genesistherapeutics.ai",competitors_seed:["Schrödinger","Recursion Pharmaceuticals","Insilico Medicine"] },
  { id:4,  name:"PocketHealth",    categories:["Healthcare"],                     year:2020, description:"Patient-controlled medical imaging platform — patients own and share their radiology records.", website:"pockethealth.com",    competitors_seed:["Ambra Health","Nanox","Intelerad"] },
  { id:5,  name:"Promise Robotics", categories:["Construction","Robotics","Supply Chain"],year:2020,description:"AI-powered robotic platform for automating off-site construction of building structures.", website:"promiserobotics.com",  competitors_seed:["ICON Build","Mighty Buildings","Skender"] },
  { id:6,  name:"Synex",            categories:["Biotechnology","Healthcare"],     year:2020, description:"Cell therapy manufacturing platform using AI to scale and optimise complex cell production.", website:"synex.bio",            competitors_seed:["Ori Biotech","Multiply Labs","Cellares"] },
  { id:7,  name:"Chemix",           categories:["Climate","Energy","Materials"],   year:2021, description:"AI platform for designing next-generation battery electrolytes and energy storage materials.", website:"chemix.ai",            competitors_seed:["Aionics","Sila Nanotechnologies","QuantumScape"] },
  { id:8,  name:"ClimateAi",        categories:["Climate","Supply Chain"],         year:2021, description:"Climate risk intelligence platform for agriculture and supply chain using hyperlocal AI forecasting.", website:"climate.ai",       competitors_seed:["The Climate Corporation","aWhere","Gro Intelligence"] },
  { id:9,  name:"Waabi",            categories:["Data","Supply Chain","Transportation"],year:2021,description:"AI-first autonomous trucking company using a generative world model to train and deploy self-driving trucks.", website:"waabi.ai",competitors_seed:["Aurora Innovation","TuSimple","Kodiak Robotics"] },
  { id:10, name:"Hebbia",           categories:["Financial Services","LLMs","Search","Software"],year:2022,description:"AI research platform for knowledge work — structured analysis of complex documents at enterprise scale.", website:"hebbia.ai",competitors_seed:["Glean","Perplexity","Kensho"] },
  { id:11, name:"Muon Space",       categories:["Software","Space"],               year:2022, description:"Full-stack satellite company building a constellation for continuous Earth observation and climate monitoring.", website:"muonspace.com",   competitors_seed:["Planet Labs","Spire Global","HawkEye 360"] },
  { id:12, name:"Pixxel",           categories:["Climate","Software","Space"],     year:2022, description:"Hyperspectral Earth imaging satellite constellation for agriculture, environment and resource monitoring.", website:"pixxel.space",     competitors_seed:["Planet Labs","Satellogic","BlackSky"] },
  { id:13, name:"Signal 1",         categories:["Healthcare"],                     year:2022, description:"AI early warning system for hospitals — predicts patient deterioration before critical events occur.", website:"signal1.ai",         competitors_seed:["Sepsis Alliance","Dascena","BioVitals"] },
  { id:14, name:"Twelve Labs",      categories:["Search","Software"],              year:2022, description:"Video understanding API — multimodal AI that can search, understand and generate insights from video content.", website:"twelvelabs.io",  competitors_seed:["Runway","Google Video AI","Amazon Rekognition"] },
  { id:15, name:"Ubenwa",           categories:["Healthcare"],                     year:2022, description:"AI diagnostics platform that analyses infant cry patterns to detect neurological conditions at birth.", website:"ubenwa.ai",         competitors_seed:["Natus Medical","Masimo","Medtronic Newborn"] },
  { id:16, name:"Unlearn",          categories:["Data","Healthcare"],              year:2022, description:"AI platform that generates digital twin control arms to accelerate and de-risk clinical trials.", website:"unlearn.ai",         competitors_seed:["Medidata Solutions","Inato","Phesi"] },
  { id:17, name:"V7",               categories:["Data","Software"],                year:2022, description:"AI training data platform for computer vision — annotation, automation and data pipeline management.", website:"v7labs.com",        competitors_seed:["Scale AI","Labelbox","Roboflow"] },
  { id:18, name:"Xanadu",           categories:["Semiconductors"],                 year:2019, description:"Photonic quantum computing company building fault-tolerant quantum computers using light.", website:"xanadu.ai",          competitors_seed:["IonQ","PsiQuantum","IBM Quantum"] },
  { id:19, name:"You.com",          categories:["LLMs","Search"],                  year:2022, description:"AI-powered search engine and productivity assistant with real-time web grounding.", website:"you.com",            competitors_seed:["Perplexity AI","Bing AI","Google AI Overviews"] },
  { id:20, name:"Artificial Agency",categories:["Software"],                       year:2023, description:"AI agent platform for game NPCs — enabling believable, adaptive, LLM-powered non-player characters.", website:"artificialagency.ai",competitors_seed:["Inworld AI","Convai","NVIDIA ACE"] },
  { id:21, name:"DatologyAI",       categories:["Data"],                           year:2023, description:"Automated data curation platform — curates and optimises training datasets to improve LLM quality.", website:"datology.ai",       competitors_seed:["Scale AI","Gretel AI","Snorkel AI"] },
  { id:22, name:"Delphina",         categories:["Data","Software"],                year:2023, description:"Automated ML pipeline platform — finds the best models and features for tabular data without manual work.", website:"delphina.ai",      competitors_seed:["DataRobot","H2O.ai","Alteryx"] },
  { id:23, name:"Firsthand",        categories:["Software"],                       year:2023, description:"Personal AI that knows your preferences and acts on your behalf for commerce and services.", website:"firsthand.so",      competitors_seed:["Rabbit","Humane","Adept AI"] },
  { id:24, name:"Intrepid Labs",    categories:["Healthcare"],                     year:2023, description:"AI biomarker discovery platform for neurological diseases using multimodal patient data.", website:"intrepidlabs.ai",   competitors_seed:["Praxis Precision Medicine","Tempus","Recursion"] },
  { id:25, name:"Nabla Bio",        categories:["Biotechnology","Materials"],      year:2023, description:"Protein design platform using generative AI to engineer novel proteins for therapeutic and industrial uses.", website:"nabla.bio",         competitors_seed:["Absci","Arzeda","Generate Biomedicines"] },
  { id:26, name:"Orbital Materials",categories:["Climate","Materials"],            year:2023, description:"AI foundation model for materials discovery — accelerating the design of new sustainable materials.", website:"orbitalmaterials.com",competitors_seed:["Citrine Informatics","Kebotix","Enthought"] },
  { id:27, name:"Reka",             categories:["LLMs","Software"],                year:2023, description:"Multimodal frontier AI company building powerful models for enterprise and consumer applications.", website:"reka.ai",            competitors_seed:["Mistral AI","Cohere","Inflection AI"] },
  { id:28, name:"Emerald AI",       categories:["Software"],                       year:2024, description:"AI platform for enterprise workflow automation with deep integration into existing business systems.", website:"emeraldai.com",     competitors_seed:["UiPath","Automation Anywhere","ServiceNow AI"] },
  { id:29, name:"Latent Labs",      categories:["Biotechnology","Software"],       year:2024, description:"Generative AI for protein structure and function — foundation models for biological sequence design.", website:"latentlabs.ai",    competitors_seed:["EvolutionaryScale","Generate Biomedicines","Profluent"] },
  { id:30, name:"OffDeal",          categories:["Financial Services","Software"],  year:2024, description:"AI platform for SMB M&A — finding, analysing and executing acquisitions for small business buyers.", website:"offdeal.com",       competitors_seed:["Axial","Exitwise","BizBuySell"] },
  { id:31, name:"Spara",            categories:["Software"],                       year:2024, description:"AI-powered revenue intelligence platform for B2B sales teams — pipeline and deal execution.", website:"spara.ai",           competitors_seed:["Gong","Clari","Outreach"] },
  { id:32, name:"World Labs",       categories:["Software"],                       year:2024, description:"Spatial intelligence company building large world models for 3D understanding and generation.", website:"worldlabs.ai",     competitors_seed:["Waymo Research","DeepMind","NVIDIA Research"] },
  { id:33, name:"Writer",           categories:["LLMs","Software"],                year:2024, description:"Full-stack generative AI for the enterprise — models, platform and applications for business content.", website:"writer.com",         competitors_seed:["Jasper AI","Copy.ai","Anthropic Claude"] },
  { id:34, name:"Attuned Intelligence",categories:["Healthcare"],                  year:2025, description:"AI system for detecting and supporting emotional and cognitive wellbeing in clinical settings.", website:"attuned.ai",         competitors_seed:["Woebot","Limbic","Spring Health"] },
  { id:35, name:"Crusoe",           categories:["Infrastructure"],                 year:2025, description:"Sustainable cloud computing platform using stranded and renewable energy for AI workloads.", website:"crusoe.ai",          competitors_seed:["CoreWeave","Lambda Labs","Voltage Park"] },
  { id:36, name:"Mosaic",           categories:["Financial Services","Software"],  year:2026, description:"AI-native financial planning and analysis platform for modern finance teams.", website:"mosaicapp.com",     competitors_seed:["Pigment","Planful","Anaplan"] },
  { id:37, name:"Outset",           categories:["Software"],                       year:2025, description:"AI-powered qualitative research platform — conducts and analyses user interviews at scale.", website:"outset.ai",          competitors_seed:["UserInterviews","Maze","Respondent"] },
  { id:38, name:"P-1 AI",           categories:["Software"],                       year:2025, description:"AI coding agent that autonomously writes, tests and deploys production software end-to-end.", website:"p1.ai",             competitors_seed:["Devin (Cognition)","GitHub Copilot","Cursor"] },
  { id:39, name:"Periodic Labs",    categories:["Software"],                       year:2025, description:"AI platform for scientific literature synthesis and hypothesis generation in research workflows.", website:"periodiclabs.ai",   competitors_seed:["Elicit","Consensus","Semantic Scholar"] },
  { id:40, name:"Ricursive Intelligence",categories:["Infrastructure","Software"], year:2025, description:"Recursive AI infrastructure for self-improving agent systems and autonomous reasoning at scale.", website:"ricursive.ai",     competitors_seed:["LangChain","CrewAI","AutoGPT"] },
  { id:41, name:"Ribbon",           categories:["Software"],                       year:2025, description:"AI-powered healthcare navigation platform — helping patients find and access the right care.", website:"ribbon.health",     competitors_seed:["Kyruus","Solv Health","Zocdoc"] },
  { id:42, name:"Serval",           categories:["Software"],                       year:2025, description:"AI security platform for autonomous threat detection and response in enterprise environments.", website:"serval.ai",          competitors_seed:["Darktrace","SentinelOne","CrowdStrike"] },
  { id:43, name:"Slingshot AI",     categories:["Healthcare"],                     year:2025, description:"AI-powered clinical documentation platform — automated notes and coding for healthcare providers.", website:"slingshotai.com",   competitors_seed:["Nuance DAX","Abridge","Suki AI"] },
  { id:44, name:"Unblocked",        categories:["Software"],                       year:2025, description:"AI knowledge assistant for engineering teams — surfaces institutional knowledge from codebases and docs.", website:"getunblocked.com",  competitors_seed:["Glean","Notion AI","Guru"] },
  { id:45, name:"Vizcom",           categories:["Software"],                       year:2025, description:"AI design tool for industrial designers — generates photorealistic product renders from sketches.", website:"vizcom.ai",         competitors_seed:["Midjourney","Adobe Firefly","Canva AI"] },
  { id:46, name:"Yutori",           categories:["Search","Software"],              year:2025, description:"AI agent for autonomous web search and deep research — executes complex multi-step research tasks.", website:"yutori.ai",         competitors_seed:["Perplexity","You.com","OpenAI Deep Research"] },
  { id:47, name:"Decart",           categories:["Infrastructure","Software"],      year:2024, description:"AI infrastructure platform for ultra-fast model training and serving, focusing on inference efficiency.", website:"decart.ai",           competitors_seed:["NVIDIA","Groq","Together AI"] },
  { id:48, name:"Etched",           categories:["Semiconductors"],                 year:2024, description:"Semiconductor company building specialized ASICs (Etched Sohu) designed specifically for transformer-based models.", website:"etched.com",          competitors_seed:["NVIDIA","Cerebras","SambaNova"] },
  { id:49, name:"Cinder",           categories:["Software","Security"],            year:2024, description:"Trust and safety platform for the internet, using AI to manage content moderation and policy enforcement at scale.", website:"cinder.ai",          competitors_seed:["ActiveFence","Unitary","Spectrum Labs"] },
];

// Build full company objects with seeded mock data
const INITIAL_COMPANIES = RAW_PORTFOLIO.map(c => ({
  ...c,
  monitoring_enabled: true,
  boolean_query: BOOLEAN_QUERIES[c.name] || `"${c.name}" AND (${c.categories.map(x=>x.toLowerCase()).join(' OR ')})`,
  boolean_approved: BOOLEAN_QUERIES[c.name] ? true : seed(c.id) > 0.3,
  competitors: c.competitors_seed.map((name,i) => ({ name, rationale: "", editable: true })),
  social_volume: 0,
  media_volume: 0,
  sentiment: 0,
  engagement: 0,
  employee_count: 0,
  employee_delta: 0,
  web_visits: 0,
  web_delta: 0,
  linkedin_followers: 0,
  funding_total: 0,
  sparkline: [],
  mentions: { media: [], social: [] },
}));

// ─── INITIAL OUTLETS ──────────────────────────────────────────────────────────
const DEFAULT_OUTLETS = [

  // ══════════════════════════════════════════════════════════════════════════
  // TIER 1 — Authoritative global publications. High signal, wide reach.
  // ══════════════════════════════════════════════════════════════════════════

  // ── Tier 1: Global News & Business ───────────────────────────────────────
  {id:1,   name:"The New York Times",           tier:1, cat:"General", domain:"nytimes.com"},
  {id:2,   name:"The Wall Street Journal",      tier:1, cat:"General", domain:"wsj.com"},
  {id:3,   name:"Bloomberg",                    tier:1, cat:"General", domain:"bloomberg.com"},
  {id:4,   name:"Financial Times",              tier:1, cat:"General", domain:"ft.com"},
  {id:5,   name:"The Economist",                tier:1, cat:"General", domain:"economist.com"},
  {id:6,   name:"Reuters",                      tier:1, cat:"General", domain:"reuters.com"},
  {id:7,   name:"BBC News",                     tier:1, cat:"General", domain:"bbc.com"},
  {id:8,   name:"The Guardian",                 tier:1, cat:"General", domain:"theguardian.com"},
  {id:9,   name:"CNBC",                         tier:1, cat:"General", domain:"cnbc.com"},
  {id:10,  name:"Forbes",                       tier:1, cat:"General", domain:"forbes.com"},
  {id:11,  name:"Fortune",                      tier:1, cat:"General", domain:"fortune.com"},
  {id:12,  name:"The Atlantic",                 tier:1, cat:"General", domain:"theatlantic.com"},
  {id:13,  name:"Associated Press",             tier:1, cat:"General", domain:"apnews.com"},
  {id:14,  name:"The Washington Post",          tier:1, cat:"General", domain:"washingtonpost.com"},
  {id:15,  name:"Los Angeles Times",            tier:1, cat:"General", domain:"latimes.com"},
  {id:16,  name:"Yahoo Finance",                tier:1, cat:"Finance", domain:"finance.yahoo.com"},
  {id:17,  name:"Business Insider",             tier:1, cat:"General", domain:"businessinsider.com"},
  {id:18,  name:"Inc.",                         tier:1, cat:"Startups", domain:"inc.com"},
  {id:19,  name:"Bloomberg Businessweek",       tier:1, cat:"General", domain:"bloomberg.com"},
  {id:20,  name:"Bloomberg Technology",         tier:1, cat:"Tech", domain:"bloomberg.com"},
  {id:21,  name:"The Times",                    tier:1, cat:"General", domain:"thetimes.co.uk"},
  {id:22,  name:"The Telegraph",                tier:1, cat:"General", domain:"telegraph.co.uk"},
  {id:23,  name:"The Independent",              tier:1, cat:"General", domain:"independent.co.uk"},
  {id:24,  name:"Agence France-Presse",         tier:1, cat:"General", domain:"afp.com"},
  {id:25,  name:"AFP",                          tier:1, cat:"General", domain:"afp.com"},
  {id:26,  name:"Dow Jones",                    tier:1, cat:"Finance", domain:"dowjones.com"},
  {id:27,  name:"MarketWatch",                  tier:1, cat:"Finance", domain:"marketwatch.com"},
  {id:28,  name:"Barron's",                     tier:1, cat:"Finance", domain:"barrons.com"},
  {id:29,  name:"Institutional Investor",       tier:1, cat:"Finance", domain:"institutionalinvestor.com"},
  {id:30,  name:"The Australian Financial Review",tier:1,cat:"Finance", domain:"afr.com"},
  {id:31,  name:"South China Morning Post",     tier:1, cat:"General", domain:"scmp.com"},
  {id:32,  name:"Nikkei Asia",                  tier:1, cat:"General", domain:"nikkei.com"},
  {id:33,  name:"Der Spiegel",                  tier:1, cat:"General", domain:"spiegel.de"},
  {id:34,  name:"Le Monde",                     tier:1, cat:"General", domain:"lemonde.fr"},
  {id:35,  name:"Handelsblatt",                 tier:1, cat:"Finance", domain:"handelsblatt.com"},
  {id:36,  name:"Die Zeit",                     tier:1, cat:"General", domain:"zeit.de"},
  {id:37,  name:"NZZ",                          tier:1, cat:"General", domain:"nzz.ch"},
  {id:38,  name:"El País",                      tier:1, cat:"General", domain:"elpais.com"},
  {id:39,  name:"Corriere della Sera",          tier:1, cat:"General", domain:"corriere.it"},
  {id:40,  name:"The Hindu",                    tier:1, cat:"General", domain:"thehindu.com"},
  {id:41,  name:"Al Jazeera",                   tier:1, cat:"General", domain:"aljazeera.com"},

  // ── Tier 1: Science & Medicine ────────────────────────────────────────────
  {id:50,  name:"Nature",                       tier:1, cat:"Science", domain:"nature.com"},
  {id:51,  name:"Science",                      tier:1, cat:"Science", domain:"science.org"},
  {id:52,  name:"The Lancet",                   tier:1, cat:"Science", domain:"thelancet.com"},
  {id:53,  name:"NEJM",                         tier:1, cat:"Science", domain:"nejm.org"},
  {id:54,  name:"New England Journal of Medicine",tier:1,cat:"Science", domain:"nejm.org"},
  {id:55,  name:"JAMA",                         tier:1, cat:"Science", domain:"jamanetwork.com"},
  {id:56,  name:"Cell",                         tier:1, cat:"Science", domain:"cell.com"},
  {id:57,  name:"PNAS",                         tier:1, cat:"Science", domain:"pnas.org"},
  {id:58,  name:"Nature Medicine",              tier:1, cat:"Science", domain:"nature.com"},
  {id:59,  name:"Nature Biotechnology",         tier:1, cat:"Science", domain:"nature.com"},
  {id:60,  name:"Nature Machine Intelligence",  tier:1, cat:"AI", domain:"nature.com"},

  // ══════════════════════════════════════════════════════════════════════════
  // TIER 2 — Specialist publications. High relevance for portfolio coverage.
  // ══════════════════════════════════════════════════════════════════════════

  // ── Tier 2: Core Tech ─────────────────────────────────────────────────────
  {id:100, name:"TechCrunch",                   tier:2, cat:"Tech", domain:"techcrunch.com"},
  {id:101, name:"Wired",                        tier:2, cat:"Tech", domain:"wired.com"},
  {id:102, name:"MIT Technology Review",        tier:2, cat:"Tech", domain:"technologyreview.com"},
  {id:103, name:"VentureBeat",                  tier:2, cat:"Tech", domain:"venturebeat.com"},
  {id:104, name:"The Verge",                    tier:2, cat:"Tech", domain:"theverge.com"},
  {id:105, name:"Ars Technica",                 tier:2, cat:"Tech", domain:"arstechnica.com"},
  {id:106, name:"IEEE Spectrum",                tier:2, cat:"Tech", domain:"spectrum.ieee.org"},
  {id:107, name:"CNET",                         tier:2, cat:"Tech", domain:"cnet.com"},
  {id:108, name:"ZDNet",                        tier:2, cat:"Tech", domain:"zdnet.com"},
  {id:110, name:"Axios",                        tier:2, cat:"Tech", domain:"axios.com"},
  {id:112, name:"GeekWire",                     tier:2, cat:"Tech", domain:"geekwire.com"},
  {id:113, name:"Fast Company",                 tier:2, cat:"Tech", domain:"fastcompany.com"},
  {id:114, name:"Sifted",                       tier:2, cat:"Tech", domain:"sifted.eu"},
  {id:120, name:"Engadget",                     tier:2, cat:"Tech", domain:"engadget.com"},
  {id:121, name:"Gizmodo",                      tier:2, cat:"Tech", domain:"gizmodo.com"},

  // ── Tier 2: VC, Startups & Finance ───────────────────────────────────────
  {id:150, name:"PitchBook",                    tier:2, cat:"VC & Startups", domain:"pitchbook.com"},
  {id:151, name:"Crunchbase News",              tier:2, cat:"VC & Startups", domain:"news.crunchbase.com"},
  {id:152, name:"CB Insights",                  tier:2, cat:"VC & Startups", domain:"cbinsights.com"},
  {id:153, name:"Venture Capital Journal",      tier:2, cat:"VC & Startups", domain:"venturecapitaljournal.com"},
  {id:157, name:"Hacker News",                  tier:2, cat:"VC & Startups", domain:"ycombinator.com"},

  // ── Tier 2: Healthcare & Biotech ─────────────────────────────────────────
  {id:200, name:"STAT News",                    tier:2, cat:"Healthcare", domain:"statnews.com"},
  {id:201, name:"Fierce Biotech",               tier:2, cat:"Healthcare", domain:"fiercebiotech.com"},
  {id:202, name:"Fierce Healthcare",            tier:2, cat:"Healthcare", domain:"fiercehealthcare.com"},
  {id:203, name:"Endpoints News",               tier:2, cat:"Healthcare", domain:"endpts.com"},
  {id:204, name:"BioPharma Dive",               tier:2, cat:"Healthcare", domain:"biopharmadive.com"},
  {id:205, name:"MedCity News",                 tier:2, cat:"Healthcare", domain:"medcitynews.com"},
  {id:206, name:"MobiHealthNews",               tier:2, cat:"Healthcare", domain:"mobihealthnews.com"},
  {id:207, name:"Health IT Analytics",          tier:2, cat:"Healthcare", domain:"healthitanalytics.com"},
  {id:208, name:"GenomeWeb",                    tier:2, cat:"Healthcare", domain:"genomeweb.com"},
  {id:209, name:"Medical News Today",           tier:2, cat:"Healthcare", domain:"medicalnewstoday.com"},

  // ── Tier 2: Climate & Sustainability ─────────────────────────────────────
  {id:250, name:"Carbon Brief",                 tier:2, cat:"Climate", domain:"carbonbrief.org"},
  {id:251, name:"Inside Climate News",          tier:2, cat:"Climate", domain:"insideclimatenews.org"},
  {id:252, name:"Climate Home News",            tier:2, cat:"Climate", domain:"climatechangenews.com"},
  {id:253, name:"GreenBiz",                     tier:2, cat:"Climate", domain:"greenbiz.com"},
  {id:254, name:"Canary Media",                 tier:2, cat:"Climate", domain:"canarymedia.com"},
  {id:255, name:"Energy Storage News",          tier:2, cat:"Climate", domain:"energy-storage.news"},
  {id:256, name:"Renewable Energy World",       tier:2, cat:"Climate", domain:"renewableenergyworld.com"},

  // ── Tier 2: AI & Data ────────────────────────────────────────────────────
  {id:300, name:"Towards AI",                   tier:2, cat:"AI", domain:"towardsai.net"},
  {id:301, name:"The Gradient",                 tier:2, cat:"AI", domain:"thegradient.pub"},
  {id:302, name:"Import AI",                    tier:2, cat:"AI", domain:"jack-clark.net"},
  {id:303, name:"AI Weekly",                    tier:2, cat:"AI", domain:"aiweekly.co"},
  {id:304, name:"The Rundown AI",               tier:2, cat:"AI", domain:"therundown.ai"},
  {id:305, name:"Ben's Bites",                  tier:2, cat:"AI", domain:"bensbites.co"},
  {id:163, name:"Tech.eu",                      tier:2, cat:"VC & Startups"},
  {id:164, name:"Dealroom",                     tier:2, cat:"VC & Startups"},
  {id:165, name:"The Business Journals",        tier:2, cat:"VC & Startups"},
  {id:166, name:"American Banker",              tier:2, cat:"Finance"},
  {id:167, name:"Bloomberg Markets",            tier:2, cat:"Finance"},
  {id:168, name:"S&P Global",                   tier:2, cat:"Finance"},
  {id:169, name:"Seeking Alpha",                tier:2, cat:"Finance"},
  {id:170, name:"The Motley Fool",              tier:2, cat:"Finance"},
  {id:171, name:"Investopedia",                 tier:2, cat:"Finance"},

  // ── Tier 2: AI & Machine Learning ────────────────────────────────────────
  {id:200, name:"The Rundown AI",               tier:2, cat:"AI"},
  {id:201, name:"Import AI",                    tier:2, cat:"AI"},
  {id:202, name:"The Decoder",                  tier:2, cat:"AI"},
  {id:203, name:"Interconnects",                tier:2, cat:"AI"},
  {id:204, name:"The Gradient",                 tier:2, cat:"AI"},
  {id:205, name:"Ahead of AI",                  tier:2, cat:"AI"},
  {id:206, name:"AlphaSignal",                  tier:2, cat:"AI"},
  {id:207, name:"The Batch",                    tier:2, cat:"AI"},
  {id:208, name:"Hugging Face Blog",            tier:2, cat:"AI"},
  {id:209, name:"OpenAI Blog",                  tier:2, cat:"AI"},
  {id:210, name:"Google DeepMind Blog",         tier:2, cat:"AI"},
  {id:211, name:"Anthropic News",               tier:2, cat:"AI"},
  {id:212, name:"NVIDIA Blog",                  tier:2, cat:"AI"},
  {id:213, name:"Google Blog",                  tier:2, cat:"AI"},
  {id:214, name:"Microsoft Blog",               tier:2, cat:"AI"},
  {id:215, name:"Microsoft Research Blog",      tier:2, cat:"AI"},
  {id:216, name:"Meta AI Blog",                 tier:2, cat:"AI"},
  {id:217, name:"Meta Blog",                    tier:2, cat:"AI"},
  {id:218, name:"MarkTechPost",                 tier:2, cat:"AI"},
  {id:220, name:"AI News",                      tier:2, cat:"AI"},
  {id:223, name:"Weights & Biases Blog",        tier:2, cat:"AI"},
  {id:224, name:"Cohere Blog",                  tier:2, cat:"AI"},
  {id:225, name:"Mistral Blog",                 tier:2, cat:"AI"},
  {id:226, name:"AI Business",                  tier:2, cat:"AI"},
  {id:227, name:"Synced Review",                tier:2, cat:"AI"},
  {id:228, name:"Analytics India Magazine",     tier:2, cat:"AI"},
  {id:229, name:"AI Magazine",                  tier:2, cat:"AI"},
  {id:230, name:"ZDNET AI",                     tier:2, cat:"AI"},

  // ── Tier 2: Analysis & Newsletters ───────────────────────────────────────
  {id:250, name:"Stratechery",                  tier:2, cat:"Analysis"},
  {id:251, name:"Semianalysis",                 tier:2, cat:"Analysis"},
  {id:252, name:"Exponential View",             tier:2, cat:"Analysis"},
  {id:253, name:"Newcomer",                     tier:2, cat:"Analysis"},
  {id:254, name:"The Generalist",               tier:2, cat:"Analysis"},
  {id:255, name:"Not Boring",                   tier:2, cat:"Analysis"},
  {id:256, name:"Lenny's Newsletter",           tier:2, cat:"Analysis"},
  {id:257, name:"Every.to",                     tier:2, cat:"Analysis"},
  {id:258, name:"Platformer",                   tier:2, cat:"Analysis"},
  {id:259, name:"Andreessen Horowitz",          tier:2, cat:"Analysis"},
  {id:260, name:"a16z",                         tier:2, cat:"Analysis"},
  {id:261, name:"First Round Review",           tier:2, cat:"Analysis"},
  {id:262, name:"Y Combinator Blog",            tier:2, cat:"Analysis"},
  {id:263, name:"Sequoia Capital Blog",         tier:2, cat:"Analysis"},
  {id:264, name:"Bessemer Venture Partners",    tier:2, cat:"Analysis"},
  {id:265, name:"Lightspeed Venture Partners",  tier:2, cat:"Analysis"},
  {id:266, name:"NFX Blog",                     tier:2, cat:"Analysis"},
  {id:267, name:"Insight Partners Blog",        tier:2, cat:"Analysis"},
  {id:268, name:"Battery Ventures Blog",        tier:2, cat:"Analysis"},
  {id:269, name:"The Diff",                     tier:2, cat:"Analysis"},
  {id:270, name:"Axios Pro Rata",               tier:2, cat:"Analysis"},
  {id:271, name:"Margins",                      tier:2, cat:"Analysis"},
  {id:272, name:"Napkin Math",                  tier:2, cat:"Analysis"},
  {id:273, name:"Net Interest",                 tier:2, cat:"Analysis"},
  {id:274, name:"Citation Needed",              tier:2, cat:"Analysis"},
  {id:275, name:"Packy McCormick",              tier:2, cat:"Analysis"},

  // ── Tier 2: Science & Research ────────────────────────────────────────────
  {id:300, name:"Scientific American",          tier:2, cat:"Science"},
  {id:301, name:"New Scientist",                tier:2, cat:"Science"},
  {id:302, name:"Quanta Magazine",              tier:2, cat:"Science"},
  {id:303, name:"ScienceDaily",                tier:2, cat:"Science"},
  {id:304, name:"Stanford HAI",                tier:2, cat:"Science"},
  {id:305, name:"Harvard Gazette",             tier:2, cat:"Science"},
  {id:306, name:"MIT News",                    tier:2, cat:"Science"},
  {id:307, name:"Phys.org",                    tier:2, cat:"Science"},
  {id:308, name:"Space.com",                   tier:2, cat:"Science"},
  {id:309, name:"SpaceNews",                   tier:2, cat:"Science"},
  {id:310, name:"Eos",                         tier:2, cat:"Science"},
  {id:311, name:"Physics Today",               tier:2, cat:"Science"},
  {id:312, name:"Chemistry World",             tier:2, cat:"Science"},
  {id:313, name:"Materials Today",             tier:2, cat:"Science"},

  // ── Tier 2: Biotech, Pharma & Healthcare ─────────────────────────────────
  {id:330, name:"STAT News",                   tier:2, cat:"Biotech"},
  {id:331, name:"FierceBiotech",               tier:2, cat:"Biotech"},
  {id:332, name:"BioPharma Dive",              tier:2, cat:"Biotech"},
  {id:333, name:"Endpoints News",              tier:2, cat:"Biotech"},
  {id:334, name:"BioWorld",                    tier:2, cat:"Biotech"},
  {id:335, name:"Genetic Engineering & Biotechnology News",tier:2,cat:"Biotech"},
  {id:336, name:"GEN",                         tier:2, cat:"Biotech"},
  {id:337, name:"Drug Discovery Today",        tier:2, cat:"Biotech"},
  {id:338, name:"Chemical & Engineering News", tier:2, cat:"Biotech"},
  {id:339, name:"Labiotech",                   tier:2, cat:"Biotech"},
  {id:340, name:"Fierce Pharma",               tier:2, cat:"Biotech"},
  {id:341, name:"Pharma Intelligence",         tier:2, cat:"Biotech"},
  {id:342, name:"Healthcare IT News",          tier:2, cat:"Healthcare"},
  {id:343, name:"Fierce Healthcare",           tier:2, cat:"Healthcare"},
  {id:344, name:"MobiHealthNews",              tier:2, cat:"Healthcare"},
  {id:345, name:"Medscape",                    tier:2, cat:"Healthcare"},
  {id:346, name:"Health Affairs",              tier:2, cat:"Healthcare"},
  {id:347, name:"Modern Healthcare",           tier:2, cat:"Healthcare"},
  {id:348, name:"Becker's Hospital Review",    tier:2, cat:"Healthcare"},

  // ── Tier 2: Semiconductors & Hardware ────────────────────────────────────
  {id:360, name:"Semiconductor Engineering",   tier:2, cat:"Semiconductor"},
  {id:361, name:"EE Times",                    tier:2, cat:"Semiconductor"},
  {id:362, name:"Semiconductor Digest",        tier:2, cat:"Semiconductor"},
  {id:363, name:"The Chip Letter",             tier:2, cat:"Semiconductor"},
  {id:364, name:"AnandTech",                   tier:2, cat:"Semiconductor"},
  {id:365, name:"Tom's Hardware",              tier:2, cat:"Semiconductor"},
  {id:366, name:"ExtremeTech",                 tier:2, cat:"Semiconductor"},
  {id:367, name:"WikiChip",                    tier:2, cat:"Semiconductor"},
  {id:368, name:"ServeTheHome",                tier:2, cat:"Semiconductor"},

  // ── Tier 2: Security & Cybersecurity ─────────────────────────────────────
  {id:380, name:"Cybersecurity Dive",          tier:2, cat:"Security"},
  {id:381, name:"SC Media",                    tier:2, cat:"Security"},
  {id:382, name:"Dark Reading",                tier:2, cat:"Security"},
  {id:383, name:"Krebs on Security",           tier:2, cat:"Security"},
  {id:384, name:"Threatpost",                  tier:2, cat:"Security"},
  {id:385, name:"Security Week",               tier:2, cat:"Security"},
  {id:386, name:"Bleeping Computer",           tier:2, cat:"Security"},
  {id:387, name:"The Hacker News",             tier:2, cat:"Security"},
  {id:388, name:"Help Net Security",           tier:2, cat:"Security"},

  // ── Tier 2: Climate, Energy & Environment ────────────────────────────────
  {id:400, name:"CleanTechnica",               tier:2, cat:"Climate"},
  {id:401, name:"Canary Media",                tier:2, cat:"Climate"},
  {id:402, name:"GreenBiz",                    tier:2, cat:"Climate"},
  {id:403, name:"E&E News",                    tier:2, cat:"Climate"},
  {id:404, name:"Carbon Brief",               tier:2, cat:"Climate"},
  {id:405, name:"Inside Climate News",         tier:2, cat:"Climate"},
  {id:406, name:"Bloomberg Green",             tier:2, cat:"Climate"},
  {id:407, name:"Energy Monitor",              tier:2, cat:"Climate"},
  {id:408, name:"Renewable Energy World",      tier:2, cat:"Climate"},
  {id:409, name:"PV Magazine",                 tier:2, cat:"Climate"},
  {id:410, name:"Wood Mackenzie",              tier:2, cat:"Climate"},
  {id:411, name:"S&P Global Commodity Insights",tier:2,cat:"Climate"},

  // ── Tier 2: Transportation, Robotics & Space ─────────────────────────────
  {id:420, name:"The Autopian",                tier:2, cat:"Transportation"},
  {id:421, name:"Electrek",                    tier:2, cat:"Transportation"},
  {id:422, name:"Automotive News",             tier:2, cat:"Transportation"},
  {id:423, name:"Wards Auto",                  tier:2, cat:"Transportation"},
  {id:424, name:"IEEE Robotics & Automation",  tier:2, cat:"Robotics"},
  {id:425, name:"Robotics Business Review",    tier:2, cat:"Robotics"},
  {id:426, name:"Construction Dive",           tier:2, cat:"Construction"},
  {id:427, name:"Engineering News-Record",     tier:2, cat:"Construction"},
  {id:428, name:"SpaceNews",                   tier:2, cat:"Space"},
  {id:429, name:"Ars Technica Space",          tier:2, cat:"Space"},
  {id:430, name:"Aviation Week",               tier:2, cat:"Space"},

  // ── Tier 2: Canada-specific ───────────────────────────────────────────────
  {id:440, name:"The Globe and Mail",          tier:2, cat:"Canada"},
  {id:441, name:"The Logic",                   tier:2, cat:"Canada"},
  {id:442, name:"BetaKit",                     tier:2, cat:"Canada"},
  {id:443, name:"Financial Post",              tier:2, cat:"Canada"},
  {id:444, name:"CBC News",                    tier:2, cat:"Canada"},
  {id:445, name:"Toronto Star",                tier:2, cat:"Canada"},
  {id:446, name:"Vancouver Sun",               tier:2, cat:"Canada"},
  {id:447, name:"The Canadian Press",          tier:2, cat:"Canada"},
  {id:448, name:"MaRS Discovery District",     tier:2, cat:"Canada"},
  {id:449, name:"Communitech",                 tier:2, cat:"Canada"},

  // ── Tier 2: Regional US ───────────────────────────────────────────────────
  {id:460, name:"San Francisco Chronicle",     tier:2, cat:"Regional"},
  {id:461, name:"San Francisco Business Times",tier:2, cat:"Regional"},
  {id:462, name:"Silicon Valley Business Journal",tier:2,cat:"Regional"},
  {id:463, name:"The Boston Globe",            tier:2, cat:"Regional"},
  {id:464, name:"Boston Business Journal",     tier:2, cat:"Regional"},
  {id:465, name:"New York Post",               tier:2, cat:"Regional"},
  {id:466, name:"New York Business Journal",   tier:2, cat:"Regional"},
  {id:467, name:"Chicago Tribune",             tier:2, cat:"Regional"},
  {id:468, name:"Austin American-Statesman",   tier:2, cat:"Regional"},
  {id:469, name:"The Seattle Times",           tier:2, cat:"Regional"},
  {id:470, name:"Denver Post",                 tier:2, cat:"Regional"},

  // ══════════════════════════════════════════════════════════════════════════
  // TIER 3 — Podcasts, newsletters, niche. Lower signal but useful context.
  // ══════════════════════════════════════════════════════════════════════════

  {id:500, name:"Dwarkesh Podcast",            tier:3, cat:"Podcasts"},
  {id:501, name:"Invest Like the Best",        tier:3, cat:"Podcasts"},
  {id:502, name:"Acquired Podcast",            tier:3, cat:"Podcasts"},
  {id:503, name:"All-In Podcast",              tier:3, cat:"Podcasts"},
  {id:504, name:"Lex Fridman Podcast",         tier:3, cat:"Podcasts"},
  {id:505, name:"20VC",                        tier:3, cat:"Podcasts"},
  {id:506, name:"My First Million",            tier:3, cat:"Podcasts"},
  {id:507, name:"This Week in Startups",       tier:3, cat:"Podcasts"},
  {id:508, name:"Masters of Scale",            tier:3, cat:"Podcasts"},
  {id:509, name:"The Tim Ferriss Show",        tier:3, cat:"Podcasts"},
  {id:510, name:"Hard Fork",                   tier:3, cat:"Podcasts"},
  {id:511, name:"Pivot",                       tier:3, cat:"Podcasts"},
  {id:512, name:"Darknet Diaries",             tier:3, cat:"Podcasts"},
  {id:513, name:"Eye on AI",                   tier:3, cat:"Podcasts"},
  {id:514, name:"The AI Podcast",              tier:3, cat:"Podcasts"},
  {id:515, name:"a16z Podcast",               tier:3, cat:"Podcasts"},
  {id:516, name:"BioTech Nation",             tier:3, cat:"Podcasts"},
  {id:517, name:"The Long View",              tier:3, cat:"Podcasts"},

];

// ─── INITIAL API KEYS

// ─── INITIAL API KEYS ─────────────────────────────────────────────────────────
// API keys sourced from radical-media-monitor codebase (settings.ts + admin/page.tsx)
// Core: NewsAPI (media), Data365 (social), OpenAI (sentiment), SMTP (reports)
const INITIAL_API_KEYS = [
  // ── News / Media ───────────────────────────────────────────────────────────
  { id:"newsapi",      label:"NewsAPI",             category:"News",    placeholder:"Enter NewsAPI key",          url:"https://newsapi.org",              icon:"📰", note:"Primary news ingest — articles from 150k+ sources. Free tier: 100 req/day.", required:true },
  { id:"mediastack",   label:"Mediastack",          category:"News",    placeholder:"your-mediastack-key",        url:"https://mediastack.com",           icon:"📡", note:"Backup news source. Free tier available.", required:false },
  { id:"gdelt",        label:"GDELT Project",       category:"News",    placeholder:"No key required (free)",     url:"https://gdeltproject.org",         icon:"🌐", note:"Free global news index — no auth needed", required:false },
  // ── Social — Yutori (recommended) ─────────────────────────────────────────
  { id:"yutori",       label:"Yutori",              category:"Social",  placeholder:"Your Yutori API key",        url:"https://docs.yutori.com",         icon:"🔍", note:"RECOMMENDED: Research & Scouting APIs — covers Twitter/X, Reddit, LinkedIn, HN, web. $0.35/company/run.", required:false },
  // ── Social — Data365 (alternative) ────────────────────────────────────────
  { id:"data365",      label:"Data365",             category:"Social",  placeholder:"Enter Data365 API key",      url:"https://data365.co",              icon:"📊", note:"Alternative social provider — structured Reddit/Twitter data. Requires paid plan for browser CORS.", required:false },
  { id:"reddit",       label:"Reddit API (direct)", category:"Social",  placeholder:"your-reddit-client-id",      url:"https://reddit.com/dev/api",      icon:"💬", note:"Direct Reddit API — free, Reddit only", required:false },
  { id:"twitter",      label:"Twitter/X Bearer",    category:"Social",  placeholder:"AAAA...Bearer token",        url:"https://developer.twitter.com",   icon:"🐦", note:"Twitter v2 API — expensive, use Yutori instead", required:false },
  // ── LLM — Cohere North (Radical private cloud, recommended) ──────────────
  { id:"cohere_north_key",      label:"Cohere North — API Key",      category:"LLM", placeholder:"your-cohere-north-key",               url:"https://radical.cloud.cohere.com", icon:"◈", note:"Radical's private Cohere deployment. IP-allowlisted — works from Radical servers only. Falls back to Anthropic automatically on laptop.", required:false },
  { id:"cohere_north_hostname", label:"Cohere North — Hostname",     category:"LLM", placeholder:"radical.cloud.cohere.com",            url:"https://radical.cloud.cohere.com", icon:"🌐", note:"Your North hostname — default: radical.cloud.cohere.com", required:false, isText:true },
  { id:"cohere_north_model",    label:"Cohere North — Model",        category:"LLM", placeholder:"command-r-plus",                      url:"https://docs.cohere.com/docs/models", icon:"⚙", note:"Model name on your North deployment — default: command-r-plus", required:false, isText:true },
  // ── LLM — Anthropic (fallback public API) ─────────────────────────────────
  { id:"cohere",       label:"Cohere (Public API)",  category:"LLM",     placeholder:"your-cohere-api-key",        url:"https://dashboard.cohere.com",    icon:"⌘", note:"Public Cohere API. Alternative to Cohere North.", required:false },
  { id:"gemini",       label:"Google Gemini (Public API)",category:"LLM",     placeholder:"AIzaSy...",                  url:"https://aistudio.google.com",     icon:"✨", note:"Public API key from Google AI Studio.", required:false },
  { id:"google_project_id", label:"Vertex AI Project ID", category:"LLM", placeholder:"your-project-id", url:"https://console.cloud.google.com", icon:"☁", note:"Google Cloud Project ID for Vertex AI access.", required:false, isText:true },
  { id:"google_region",     label:"Vertex AI Region",     category:"LLM", placeholder:"us-central1",    url:"https://cloud.google.com/vertex-ai/docs/general/locations", icon:"📍", note:"GCP Region (e.g., us-central1).", required:false, isText:true },
  { id:"openai",       label:"OpenAI",               category:"LLM",     placeholder:"sk-proj-...",                url:"https://openai.com",              icon:"🤖", note:"GPT-4o-mini for sentiment analysis — optional fallback", required:false },
  { id:"anthropic",    label:"Anthropic (Claude)",   category:"LLM",     placeholder:"sk-ant-api03-...",           url:"https://anthropic.com",           icon:"✦", note:"Fallback if Cohere North is not configured. Powers AI briefings, boolean suggestions, competitor research.", required:false },
  // ── Email / SMTP ───────────────────────────────────────────────────────────
  { id:"smtp_host",    label:"SMTP Host",            category:"Email",   placeholder:"smtp.gmail.com",             url:"https://support.google.com/mail/answer/7126229", icon:"📧", note:"From: aaron@radical.vc — Google Workspace App Password recommended", required:false },
  { id:"smtp_port",    label:"SMTP Port",            category:"Email",   placeholder:"587",                        url:"",                                icon:"🔌", note:"Standard TLS port is 587", required:false },
  { id:"smtp_user",    label:"SMTP Username",        category:"Email",   placeholder:"aaron@radical.vc",          url:"",                                icon:"👤", note:"Full email address used to send reports", required:false },
  { id:"smtp_pass",    label:"SMTP App Password",    category:"Email",   placeholder:"xxxx xxxx xxxx xxxx",       url:"",                                icon:"🔑", note:"Google Workspace App Password (not your login password)", required:false },
  // ── Portfolio Data ─────────────────────────────────────────────────────────
  { id:"database_url", label:"Database URL",         category:"Database",placeholder:"postgres://user:pass@host/db",url:"https://neon.tech",             icon:"🗄", note:"Neon/Render Postgres in prod, SQLite in dev (from db.ts)", required:false },
  { id:"specter",      label:"Specter",              category:"Portfolio",placeholder:"your-specter-api-key",     url:"https://specter.ai",              icon:"📈", note:"Headcount, funding, web traffic data for portfolio companies", required:false },
];

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const fmt = n => { if(!n) return "—"; const a=Math.abs(n); return a>=1e9?`$${(n/1e9).toFixed(1)}B`:a>=1e6?`${(n/1e6).toFixed(1)}M`:a>=1e3?`${(n/1e3).toFixed(1)}K`:n.toLocaleString(); };
const sc = s => s > 0.5 ? "#22c55e" : s > 0.15 ? "#4ade80" : s < -0.5 ? "#ef4444" : s < -0.15 ? "#f87171" : "#f59e0b";
const sl = s => s > 0.5 ? "Very Positive" : s > 0.15 ? "Positive" : s < -0.5 ? "Very Negative" : s < -0.15 ? "Negative" : "Neutral";
const tc = t => t===1?"#fbbf24":t===2?"#818cf8":"#6b7280";
const CAT_COLOR = { LLMs:"#7c3aed", Software:"#3b82f6", Healthcare:"#10b981", Biotechnology:"#ec4899", Climate:"#06b6d4", Materials:"#f59e0b", Space:"#8b5cf6", Semiconductors:"#f97316", Data:"#14b8a6", Infrastructure:"#64748b", "Financial Services":"#22c55e", Robotics:"#e11d48", Search:"#0ea5e9", Construction:"#a3e635", Transportation:"#fb923c", "Supply Chain":"#a78bfa", Agriculture:"#84cc16", Energy:"#facc15" };

function Pip({ s, sz=7 }) { return <span style={{display:"inline-block",width:sz,height:sz,borderRadius:"50%",background:sc(s),flexShrink:0}}/>; }
function CatTag({ cat }) { const c = CAT_COLOR[cat]||"#6b7280"; return <span style={{fontSize:9,fontWeight:700,padding:"1px 6px",borderRadius:10,background:c+"22",color:c,border:`1px solid ${c}44`,whiteSpace:"nowrap"}}>{cat}</span>; }
function Tag({ children, bg="rgba(99,102,241,0.15)", color="#818cf8", style:s={} }) { return <span style={{fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:20,background:bg,color,display:"inline-block",whiteSpace:"nowrap",...s}}>{children}</span>; }
function Delta({ v }) { if(v==null) return null; return <span style={{fontSize:11,fontWeight:600,color:v>=0?"#22c55e":"#ef4444"}}>{v>=0?"▲":"▼"} {Math.abs(v).toFixed(1)}%</span>; }
function Spinner() { return <span style={{display:"inline-block",animation:"spin 0.8s linear infinite",fontSize:16}}>◌</span>; }
const Spin = Spinner; // alias used throughout run UI
function Toggle({ enabled, onChange, label, style: s = {} }) {
  return (
    <div 
      style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", ...s }} 
      onClick={(e) => { 
        e.stopPropagation();
        onChange(!enabled); 
      }}
    >
      <div style={{
        width: 36, height: 20, borderRadius: 10, 
        background: enabled ? "#22c55e" : "rgba(255,255,255,0.1)",
        position: "relative", transition: "background 0.2s"
      }}>
        <div style={{
          position: "absolute", top: 2, left: enabled ? 18 : 2, width: 16, height: 16,
          borderRadius: "50%", background: "#fff", transition: "left 0.2s",
          boxShadow: "0 1px 3px rgba(0,0,0,0.3)"
        }}/>
      </div>
      {label && <span style={{ fontSize: 12, fontWeight: 600, color: enabled ? "#f0f0f5" : "rgba(255,255,255,0.5)" }}>{label}</span>}
    </div>
  );
}

function Btn({ children, onClick, variant="primary", style: s = {} }) {
  const base = {
    padding: "8px 16px", borderRadius: 20, fontSize: 12, fontWeight: 700,
    border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 7,
    transition: "all 0.2s"
  };
  const variants = {
    primary: { background: "rgba(99,102,241,0.8)", color: "#fff" },
    secondary: { background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.35)", color: "#818cf8" },
    danger: { background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#f87171" },
    ghost: { background: "transparent", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.4)" }
  };
  return (
    <button onClick={onClick} style={{ ...base, ...variants[variant], ...s }}>
      {children}
    </button>
  );
}

function Sparkline({ data, color="#818cf8", h=28 }) {
  if(!data?.length) return null;
  const max=Math.max(...data)||1, min=Math.min(...data), range=max-min||1;
  const pts=data.map((v,i)=>`${(i/(data.length-1))*76},${h-((v-min)/range)*(h-4)-2}`).join(" ");
  return <svg width={76} height={h} style={{display:"block"}}><polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round"/></svg>;
}

function MiniBar({ data, color="#818cf8", h=40 }) {
  const max=Math.max(...(data||[]),1);
  if (!data?.length) return <div style={{height:h,display:"flex",alignItems:"center",justifyContent:"center",color:"rgba(255,255,255,0.15)",fontSize:10}}>No data — run a search to populate</div>;
  return <div style={{display:"flex",alignItems:"flex-end",gap:2,height:h}}>
    {data.map((v,i)=><div key={i} style={{flex:1,background:color,opacity:0.45+(v/max)*0.55,borderRadius:"2px 2px 0 0",height:`${Math.max(4,(v/max)*100)}%`}}/>)}
  </div>;
}

// Clickable article timeline bar chart — built from lastRun.mediaResults dates
function ArticleTimeline({ mediaResults, dateRangeId, onBarClick, selectedDate }) {
  if (!mediaResults?.length) return null;
  const range = DATE_RANGES.find(r=>r.id===dateRangeId)||DATE_RANGES[2];
  // Bucket articles by day
  const buckets = {};
  mediaResults.forEach(m => {
    const d = m.date?.slice(0,10);
    if (d) buckets[d] = (buckets[d]||[]).concat(m);
  });
  const entries = Object.entries(buckets).sort(([a],[b])=>a.localeCompare(b));
  if (!entries.length) return null;
  const max = Math.max(...entries.map(([,v])=>v.length), 1);
  return (
    <div>
      <div style={{fontSize:9,fontWeight:700,color:"rgba(255,255,255,0.25)",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>
        Articles by date · {range.label} · click a bar to filter
      </div>
      <div style={{display:"flex",alignItems:"flex-end",gap:3,height:48}}>
        {entries.map(([date, articles]) => {
          const isSelected = selectedDate === date;
          return (
            <div key={date} onClick={()=>onBarClick(isSelected?null:date)}
              title={`${date}: ${articles.length} article${articles.length!==1?"s":""}`}
              style={{flex:1,cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
              <div style={{
                width:"100%", borderRadius:"3px 3px 0 0",
                height:`${Math.max(8,(articles.length/max)*100)}%`,
                background:isSelected?"#818cf8":"rgba(99,102,241,0.5)",
                border:isSelected?"1px solid #818cf8":"1px solid transparent",
                transition:"all 0.15s",
                minHeight:6,
              }}/>
              {entries.length <= 14 && (
                <div style={{fontSize:7,color:"rgba(255,255,255,0.2)",transform:"rotate(-45deg)",transformOrigin:"center",marginTop:2,whiteSpace:"nowrap"}}>
                  {date.slice(5)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Anthropic API key management ─────────────────────────────────────────────
// Keys are saved to localStorage so they persist across sessions.
// In production, set VITE_ANTHROPIC_API_KEY in a .env file instead.
// ─── LLM PROVIDER LAYER ──────────────────────────────────────────────────────
// Priority: Cohere North (private cloud) → Anthropic (public API)
// Cohere North uses the standard Cohere v2 Chat API at your private hostname.
// Set NORTH_HOSTNAME in .env or enter the key in Admin → API Keys.

function getLLMConfig() {
  const ls = k => { try { return localStorage.getItem(k) || ""; } catch { return ""; } };
  const env = k => (typeof import.meta !== "undefined" && import.meta.env?.[k]) || "";

  // Gemini — public API
  const geminiKey = env("VITE_GEMINI_API_KEY") || ls("radical_apikey_gemini");

  // Cohere Public API
  const coherePublicKey = env("VITE_COHERE_API_KEY") || ls("radical_apikey_cohere");

  // Cohere North — private deployment at radical.cloud.cohere.com
  const northKey      = env("VITE_COHERE_NORTH_KEY")      || ls("radical_cohere_north_key");
  const northHostname = (env("VITE_COHERE_NORTH_HOSTNAME") || ls("radical_cohere_north_hostname") || "radical.cloud.cohere.com")
                        .replace(/^https?:\/\//, "").replace(/\/$/, "");
  const northModel    = env("VITE_COHERE_NORTH_MODEL")     || ls("radical_cohere_north_model")
                        || "command-r-plus";

  // Anthropic — fallback public API
  const anthropicKey  = env("VITE_ANTHROPIC_API_KEY")      || ls("radical_anthropic_key");

  // Default hierarchy if multiple are defined: Gemini > Cohere Public > Cohere North > Anthropic
  // (We use Gemini first if provided, else Cohere Public, etc.)
  if (geminiKey) return { provider: "gemini", key: geminiKey };
  if (coherePublicKey) return { provider: "cohere-public", key: coherePublicKey };
  if (northKey) return { provider: "cohere-north", key: northKey, hostname: northHostname, model: northModel };
  if (anthropicKey) return { provider: "anthropic", key: anthropicKey };
  
  return null;
}

// Keep this for backwards-compat (used in KeyBanner check and hasApiKey guard)
function getAnthropicKey() {
  const cfg = getLLMConfig();
  return cfg ? cfg.key : "";
}

async function callLLM(userPrompt, systemPrompt="You are a VC portfolio intelligence assistant. Return only valid JSON, no markdown.") {
  let cfg = getLLMConfig();
  if (!cfg) {
    console.warn("No LLM key configured — add Gemini, Cohere, or Anthropic key in Admin → API Keys.");
    globalToast.show("No AI key configured. Add your API key in Admin.", "error");
    return { _error: "no_key", _message: "No AI key configured. Add your API key in Admin → API Keys." };
  }

  try {
    let res;

    // ── Gemini ────────────────────────────────────────────────────────────
    if (cfg.provider === "gemini") {
      const payload = {
        contents: [
          { 
            role: "user", 
            parts: [{ text: `System Instructions: ${systemPrompt}\n\nUser Request: ${userPrompt}` }] 
          }
        ],
        generationConfig: { 
          temperature: 0.1
        }
      };
      // Use v1 with gemini-1.5-flash for stable, fast performance
      res = await fetch(`http://localhost:3001/gemini/v1/models/gemini-1.5-flash:generateContent?key=${cfg.key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error("[Gemini Error Detail]:", JSON.stringify(err, null, 2));
        // globalToast.show(`Gemini API error ${res.status}: ${err.error?.message || "Unknown error"}`, "error");
        return { _error: true, status: res.status, message: err.error?.message || "Unknown error" };
      }
      
      const data = await res.json();
      let text = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
      // Robust JSON extraction
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) text = jsonMatch[0];
      
      try {
        return JSON.parse(text);
      } catch(e) {
        console.warn("[Gemini] JSON Parse failed, returning raw text as object", text);
        return { text };
      }
    }

    // ── Cohere Public API ──────────────────────────────────────────────────
    if (cfg.provider === "cohere-public") {
      res = await fetch("http://localhost:3001/cohere-public/v2/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${cfg.key}`,
        },
        body: JSON.stringify({
          model: "command-r-plus",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user",   content: userPrompt   },
          ],
          response_format: { type: "json_object" },
          max_tokens: 1000,
        }),
      });
      if (!res.ok) throw new Error("Cohere API error " + res.status);
      const data = await res.json();
      const text = data.message?.content?.[0]?.text || data.text || "{}";
      return JSON.parse(text.replace(/```json|```/g, "").trim());
    }

    // ── Cohere North ───────────────────────────────────────────────────────
    if (cfg.provider === "cohere-north") {
      let cohereOk = false;
      try {
        res = await fetch("http://localhost:3001/cohere/v2/chat", {
          method: "POST",
          headers: {
            "Content-Type":  "application/json",
            "Authorization": `Bearer ${cfg.key}`,
            "X-Client-Name": "radical-intelligence",
          },
          body: JSON.stringify({
            model: cfg.model,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user",   content: userPrompt   },
            ],
            response_format: { type: "json_object" },
            max_tokens: 1000,
          }),
        });
        if (res.ok) {
          const rawText = await res.text();
          try {
            const data = JSON.parse(rawText);
            const text = data.message?.content?.[0]?.text || data.text || "{}";
            cohereOk = true;
            return JSON.parse(text.replace(/```json|```/g, "").trim());
          } catch { /* fall through to Anthropic */ }
        } else {
          console.warn("[Cohere North] Error", res.status, "— auto-switching to Anthropic.");
        }
      } catch(e) {
        console.warn("[Cohere North] Network error — auto-switching to Anthropic:", e.message);
      }

      if (!cohereOk) {
        const anthropicKey = (() => {
          try { return (typeof import.meta !== "undefined" && import.meta.env?.VITE_ANTHROPIC_API_KEY)
            || localStorage.getItem("radical_anthropic_key") || ""; } catch { return ""; }
        })();
        if (!anthropicKey) {
          return { _error: "no_fallback",
            _message: "Cohere North is IP-restricted. Add Anthropic or Gemini key in Admin." };
        }
        cfg = { provider: "anthropic", key: anthropicKey };
      }
    }

    // ── Anthropic (primary or fallback) ────────────────────────────────────
    if (cfg.provider === "anthropic") {
      res = await fetch("http://localhost:3001/anthropic/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type":   "application/json",
          "x-api-key":      cfg.key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model:      "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system:     systemPrompt,
          messages:   [{ role: "user", content: userPrompt }],
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error("Anthropic error:", res.status, err?.error?.message || err);
        return {};
      }
      const data = await res.json();
      const text = data.content?.[0]?.text || "{}";
      try { return JSON.parse(text.replace(/```json|```/g, "").trim()); }
      catch { return {}; }
    }
  } catch(e) {
    const isProxyDown = e.message?.includes("Failed to fetch") || e.message?.includes("ERR_CONNECTION_REFUSED");
    if (isProxyDown) {
      console.error("callLLM: proxy not running. Start it with: node proxy.mjs");
      return { _error: "proxy_down", _message: "API proxy not running. Close this window, double-click START-MAC.command, and try again." };
    }
    console.error("callLLM network error:", e);
    return { _error: "network", _message: e.message };
  }
}

function computeSignals(c) {
  const s=[];
  if(Math.abs(c.employee_delta)>12) s.push({label:c.employee_delta>0?`Hiring +${c.employee_delta}%`:`Headcount ↓${Math.abs(c.employee_delta)}%`,sev:c.employee_delta>0?"positive":Math.abs(c.employee_delta)>25?"critical":"high",icon:c.employee_delta>0?"👥":"⚠️"});
  if(c.sentiment<-0.2) s.push({label:`Negative sentiment (${c.sentiment.toFixed(2)})`,sev:c.sentiment<-0.55?"critical":"high",icon:"🔴"});
  if(c.web_delta>35) s.push({label:`Web +${c.web_delta.toFixed(0)}%`,sev:"positive",icon:"📈"});
  if(!c.boolean_approved) s.push({label:"Boolean query pending",sev:"medium",icon:"🔍"});
  if(c.monitoring_enabled===false) s.push({label:"Monitoring paused",sev:"medium",icon:"⏸"});
  return s;
}
const SEV={critical:{bg:"rgba(220,38,38,0.12)",c:"#f87171",b:"rgba(220,38,38,0.3)"},high:{bg:"rgba(239,68,68,0.08)",c:"#fca5a5",b:"rgba(239,68,68,0.2)"},medium:{bg:"rgba(245,158,11,0.08)",c:"#fbbf24",b:"rgba(245,158,11,0.2)"},positive:{bg:"rgba(34,197,94,0.08)",c:"#4ade80",b:"rgba(34,197,94,0.2)"}};

// ─── COMPONENTS ───────────────────────────────────────────────────────────────

function Modal({ title, onClose, children, width=500 }) {
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={onClose}>
      <div style={{background:"#0f0f1a",border:"1px solid rgba(255,255,255,0.1)",borderRadius:16,width:"100%",maxWidth:width,maxHeight:"90vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"18px 22px",borderBottom:"1px solid rgba(255,255,255,0.07)"}}>
          <div style={{fontSize:15,fontWeight:800,color:"#f0f0f5"}}>{title}</div>
          <button onClick={onClose} style={{background:"none",border:"none",color:"rgba(255,255,255,0.3)",cursor:"pointer",fontSize:20,lineHeight:1,padding:2}}>×</button>
        </div>
        <div style={{padding:"20px 22px"}}>{children}</div>
      </div>
    </div>
  );
}

// ─── ADD COMPANY MODAL ────────────────────────────────────────────────────────
function AddCompanyModal({ onAdd, onClose }) {
  const [form, setForm] = useState({ name:"", description:"", website:"", categories:[], year: new Date().getFullYear().toString(), boolean_query:"" });
  const [loading, setLoading] = useState(false);
  const ALL_CATS = Object.keys(CAT_COLOR);
  const upd = k => v => setForm(f=>({...f,[k]:v}));

  const generate = async () => {
    if(!form.name) return;
    setLoading(true);
    const result = await callLLM(`Generate monitoring config for this company:
Name: ${form.name}
Description: ${form.description||"unknown"}
Website: ${form.website||"unknown"}
Return JSON: { "boolean_query": "...", "competitors": [{"name":"...","rationale":"..."},{"name":"...","rationale":"..."},{"name":"...","rationale":"..."}] }`);
    if(result.boolean_query) upd("boolean_query")(result.boolean_query);
    setLoading(false);
  };

  const submit = () => {
    if(!form.name.trim()) return;
    const newId = Date.now();
    onAdd({
      id: newId,
      name: form.name.trim(),
      description: form.description,
      website: form.website,
      categories: form.categories.length ? form.categories : ["Software"],
      year: parseInt(form.year)||2025,
      boolean_query: form.boolean_query || `"${form.name}"`,
      boolean_approved: false,
      competitors: [],
      social_volume: 0, media_volume: 0, sentiment: 0, engagement: 0,
      employee_count: 0, employee_delta: 0, web_visits: 0, web_delta: 0,
      linkedin_followers: 0, funding_total: 0,
      sparkline: [],
      mentions: { media:[], social:[] },
    });
    onClose();
  };

  const inp = { width:"100%",padding:"9px 12px",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,fontSize:13,color:"#f0f0f5",outline:"none" };
  const lbl = { fontSize:10,fontWeight:700,color:"rgba(255,255,255,0.3)",textTransform:"uppercase",letterSpacing:"0.08em",display:"block",marginBottom:5 };

  return (
    <Modal title="Add Company" onClose={onClose} width={540}>
      <div style={{display:"flex",flexDirection:"column",gap:14}}>
        <div><label style={lbl}>Company name *</label><input style={inp} value={form.name} onChange={e=>upd("name")(e.target.value)} placeholder="e.g. Cohere"/></div>
        <div><label style={lbl}>Description</label><textarea style={{...inp,resize:"vertical"}} rows={2} value={form.description} onChange={e=>upd("description")(e.target.value)} placeholder="One-line description…"/></div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          <div><label style={lbl}>Website</label><input style={inp} value={form.website} onChange={e=>upd("website")(e.target.value)} placeholder="company.com"/></div>
          <div><label style={lbl}>Year invested</label><input style={inp} type="number" value={form.year} onChange={e=>upd("year")(e.target.value)}/></div>
        </div>
        <div>
          <label style={lbl}>Categories</label>
          <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
            {ALL_CATS.map(cat=>{
              const on=form.categories.includes(cat);
              const c=CAT_COLOR[cat]||"#6b7280";
              return <button key={cat} onClick={()=>upd("categories")(on?form.categories.filter(x=>x!==cat):[...form.categories,cat])} style={{fontSize:10,fontWeight:700,padding:"3px 9px",borderRadius:20,border:`1px solid ${on?c:c+"44"}`,background:on?c+"22":"transparent",color:on?c:"rgba(255,255,255,0.25)",cursor:"pointer"}}>{cat}</button>;
            })}
          </div>
        </div>
        <div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
            <label style={{...lbl,marginBottom:0}}>Boolean search query</label>
            <button onClick={generate} disabled={loading||!form.name} style={{fontSize:10,fontWeight:700,padding:"3px 10px",borderRadius:20,background:"rgba(99,102,241,0.2)",border:"1px solid rgba(99,102,241,0.4)",color:"#818cf8",cursor:"pointer",display:"flex",alignItems:"center",gap:4}}>
              {loading?<Spinner/>:"✦"} AI suggest
            </button>
          </div>
          <textarea style={{...inp,fontFamily:"monospace",fontSize:11,resize:"vertical"}} rows={3} value={form.boolean_query} onChange={e=>upd("boolean_query")(e.target.value)} placeholder={`"${form.name||"Company Name"}" AND (keyword OR keyword)`}/>
        </div>
        <div style={{display:"flex",gap:8,marginTop:4}}>
          <button onClick={onClose} style={{flex:1,padding:"9px",borderRadius:8,border:"1px solid rgba(255,255,255,0.1)",background:"transparent",color:"rgba(255,255,255,0.4)",cursor:"pointer",fontSize:13,fontWeight:600}}>Cancel</button>
          <button onClick={submit} disabled={!form.name.trim()} style={{flex:2,padding:"9px",borderRadius:8,border:"none",background:"rgba(99,102,241,0.8)",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:700}}>Add Company</button>
        </div>
      </div>
    </Modal>
  );
}

// ─── OUTLETS PANEL ────────────────────────────────────────────────────────────
function OutletsPanel({ outlets, onUpdate }) {
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("All");
  const [filterTier, setFilterTier] = useState("All");
  const [addName, setAddName] = useState("");
  const [addTier, setAddTier] = useState(2);
  const [addCat, setAddCat] = useState("Tech");
  const [showAdd, setShowAdd] = useState(false);

  const categories = ["All", ...Array.from(new Set(outlets.map(o=>o.cat)))];
  const filtered = outlets.filter(o => {
    if(filterCat!=="All" && o.cat!==filterCat) return false;
    if(filterTier!=="All" && o.tier!==parseInt(filterTier)) return false;
    if(search && !o.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const remove = (id) => onUpdate(outlets.filter(o=>o.id!==id));
  const add = () => {
    if(!addName.trim()) return;
    onUpdate([...outlets, { id:Date.now(), name:addName.trim(), tier:addTier, category:addCat }]);
    setAddName(""); setShowAdd(false);
  };

  const inp = { padding:"7px 11px",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:7,fontSize:12,color:"#f0f0f5",outline:"none" };

  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search outlets…" style={{...inp,flex:1,minWidth:160}}/>
        <select value={filterCat} onChange={e=>setFilterCat(e.target.value)} style={{...inp,cursor:"pointer"}}>
          {categories.map(c=><option key={c}>{c}</option>)}
        </select>
        <select value={filterTier} onChange={e=>setFilterTier(e.target.value)} style={{...inp,cursor:"pointer"}}>
          <option value="All">All tiers</option>
          <option value="1">Tier 1</option><option value="2">Tier 2</option><option value="3">Tier 3</option>
        </select>
        <button onClick={()=>setShowAdd(!showAdd)} style={{padding:"7px 14px",borderRadius:8,border:"1px solid rgba(99,102,241,0.4)",background:"rgba(99,102,241,0.12)",color:"#818cf8",fontSize:12,fontWeight:700,cursor:"pointer"}}>+ Add outlet</button>
      </div>

      {showAdd && (
        <div style={{padding:"14px",background:"rgba(99,102,241,0.06)",border:"1px solid rgba(99,102,241,0.15)",borderRadius:10,display:"flex",gap:8,flexWrap:"wrap",alignItems:"flex-end"}}>
          <div style={{flex:2,minWidth:160}}>
            <div style={{fontSize:9,fontWeight:700,color:"rgba(255,255,255,0.3)",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:4}}>Outlet name</div>
            <input value={addName} onChange={e=>setAddName(e.target.value)} placeholder="e.g. Wired" style={{...inp,width:"100%"}} onKeyDown={e=>e.key==="Enter"&&add()}/>
          </div>
          <div>
            <div style={{fontSize:9,fontWeight:700,color:"rgba(255,255,255,0.3)",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:4}}>Tier</div>
            <select value={addTier} onChange={e=>setAddTier(parseInt(e.target.value))} style={{...inp,cursor:"pointer"}}>
              <option value={1}>Tier 1</option><option value={2}>Tier 2</option><option value={3}>Tier 3</option>
            </select>
          </div>
          <div>
            <div style={{fontSize:9,fontWeight:700,color:"rgba(255,255,255,0.3)",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:4}}>Category</div>
            <input value={addCat} onChange={e=>setAddCat(e.target.value)} placeholder="Tech" style={{...inp,width:90}}/>
          </div>
          <button onClick={add} style={{padding:"7px 14px",borderRadius:8,border:"none",background:"rgba(99,102,241,0.7)",color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>Add</button>
          <button onClick={()=>setShowAdd(false)} style={{padding:"7px 10px",borderRadius:8,border:"1px solid rgba(255,255,255,0.1)",background:"transparent",color:"rgba(255,255,255,0.3)",fontSize:12,cursor:"pointer"}}>×</button>
        </div>
      )}

      <div style={{fontSize:11,color:"rgba(255,255,255,0.25)",display:"flex",gap:16}}>
        <span>Showing {filtered.length} of {outlets.length} outlets</span>
        {[1,2,3].map(t=><span key={t} style={{color:tc(t)}}>T{t}: {outlets.filter(o=>o.tier===t).length}</span>)}
      </div>

      <div style={{display:"flex",flexWrap:"wrap",gap:6,maxHeight:360,overflowY:"auto"}}>
        {filtered.map(o=>(
          <div key={o.id} style={{display:"flex",alignItems:"center",gap:5,padding:"4px 4px 4px 10px",borderRadius:20,background:`${tc(o.tier)}15`,border:`1px solid ${tc(o.tier)}30`}}>
            <span style={{fontSize:9,opacity:0.6,color:tc(o.tier)}}>T{o.tier}</span>
            <span style={{fontSize:11,fontWeight:600,color:tc(o.tier)}}>{o.name}</span>
            <button onClick={()=>remove(o.id)} style={{width:16,height:16,borderRadius:"50%",border:"none",background:"rgba(255,255,255,0.08)",color:"rgba(255,255,255,0.3)",cursor:"pointer",fontSize:10,lineHeight:1,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>×</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── API KEYS PANEL ───────────────────────────────────────────────────────────
function ApiKeysPanel({ keys, onUpdate }) {
  const [vals, setVals] = useState(() => {
    const initial = Object.fromEntries(keys.map(k=>[k.id,""]));
    try {
      const lsKeyMap = {
        "anthropic":            "radical_anthropic_key",
        "cohere_north_key":     "radical_cohere_north_key",
        "cohere_north_hostname":"radical_cohere_north_hostname",
        "cohere_north_model":   "radical_cohere_north_model",
      };
      keys.forEach(k => {
        const lsKey  = lsKeyMap[k.id] || `radical_apikey_${k.id}`;
        const stored = localStorage.getItem(lsKey);
        if (stored) initial[k.id] = stored;
      });
    } catch {}
    return initial;
  });
  const [show, setShow] = useState({});
  const [saved, setSaved] = useState({});
  const [testing, setTesting] = useState({});
  const [testResult, setTestResult] = useState({});

  const testKey = async (id) => {
    setTesting(t => ({...t, [id]:true}));
    setTestResult(r => ({...r, [id]:null}));
    try {
      const val = vals[id]?.trim();
      if (!val) throw new Error("Key is empty");

      if (id === "gemini") {
        const res = await fetch(`http://localhost:3001/gemini/v1/models/gemini-1.5-flash:generateContent?key=${val}`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: "Respond with 'ok'" }] }] })
        });
        if (!res.ok) {
          const d = await res.json().catch(()=>({}));
          throw new Error(d.error?.message || `Error ${res.status}`);
        }
        setTestResult(r => ({...r, [id]: { success:true }}));
      } else if (id === "anthropic") {
        const res = await fetch(`http://localhost:3001/anthropic/v1/messages`, {
          method: "POST", headers: { "Content-Type":"application/json", "x-api-key": val, "anthropic-version":"2023-06-01" },
          body: JSON.stringify({ model:"claude-3-haiku-20240307", max_tokens:10, messages:[{role:"user", content:"hi"}] })
        });
        if (!res.ok) throw new Error(`Error ${res.status}`);
        setTestResult(r => ({...r, [id]: { success:true }}));
      } else if (id.includes("cohere")) {
        setTestResult(r => ({...r, [id]: { success:true, msg: "Saved (test skipped for Cohere)" }}));
      } else {
        setTestResult(r => ({...r, [id]: { success:true, msg: "Key saved locally" }}));
      }
    } catch (e) {
      setTestResult(r => ({...r, [id]: { success:false, msg: e.message }}));
    } finally {
      setTesting(t => ({...t, [id]:false}));
    }
  };

  const save = (id) => {
    const val = vals[id]?.trim() || "";
    if (val) {
      try {
        // Map key IDs to their localStorage keys
        const lsKeyMap = {
          "anthropic":           "radical_anthropic_key",
          "cohere_north_key":    "radical_cohere_north_key",
          "cohere_north_hostname":"radical_cohere_north_hostname",
          "cohere_north_model":  "radical_cohere_north_model",
        };
        const lsKey = lsKeyMap[id] || `radical_apikey_${id}`;
        localStorage.setItem(lsKey, val);
      } catch(e) { console.warn("localStorage unavailable:", e); }
    }
    setSaved(s=>({...s,[id]:true}));
    setTimeout(()=>setSaved(s=>({...s,[id]:false})),2000);
  };

  const cats = [...new Set(keys.map(k => k.category).filter(Boolean))];

  return (
    <div style={{display:"flex",flexDirection:"column",gap:20}}>
      {cats.map(cat=>(
        <div key={cat}>
          <div style={{fontSize:10,fontWeight:700,color:"rgba(255,255,255,0.25)",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:10}}>{cat}</div>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {keys.filter(k=>k.category===cat).map(k=>(
              <div key={k.id} style={{padding:"12px 14px",background:"rgba(255,255,255,0.025)",border:`1px solid ${k.required?"rgba(99,102,241,0.2)":"rgba(255,255,255,0.07)"}`,borderRadius:10}}>
                <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
                  <span style={{fontSize:15,flexShrink:0}}>{k.icon}</span>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:"flex",alignItems:"center",gap:6}}>
                      <span style={{fontSize:12,fontWeight:700,color:"#f0f0f5"}}>{k.label}</span>
                      {k.required&&<span style={{fontSize:9,padding:"1px 6px",borderRadius:10,background:"rgba(99,102,241,0.15)",color:"#818cf8",fontWeight:700}}>REQUIRED</span>}
                    </div>
                    {k.note&&<div style={{fontSize:10,color:"rgba(255,255,255,0.25)",marginTop:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{k.note}</div>}
                  </div>
                  {k.url&&<a href={k.url} target="_blank" rel="noreferrer" style={{fontSize:9,color:"rgba(99,102,241,0.7)",textDecoration:"none",flexShrink:0}}>docs ↗</a>}
                </div>
                <div style={{display:"flex",gap:7,alignItems:"center"}}>
                  <div style={{flex:1,position:"relative"}}>
                    <input
                      type={k.cat==="Email"&&(k.id==="smtp_host"||k.id==="smtp_port"||k.id==="smtp_user")?"text":(show[k.id]?"text":"password")}
                      value={vals[k.id]}
                      onChange={e=>setVals(v=>({...v,[k.id]:e.target.value}))}
                      placeholder={k.placeholder}
                      style={{width:"100%",padding:"7px 36px 7px 10px",background:"rgba(0,0,0,0.3)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:7,fontSize:11,color:"#f0f0f5",outline:"none",fontFamily:"monospace"}}
                    />
                    {!(k.cat==="Email"&&(k.id==="smtp_host"||k.id==="smtp_port"||k.id==="smtp_user"))&&(
                      <button onClick={()=>setShow(s=>({...s,[k.id]:!s[k.id]}))} style={{position:"absolute",right:8,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:"rgba(255,255,255,0.25)",cursor:"pointer",fontSize:11,lineHeight:1}}>
                        {show[k.id]?"●":"○"}
                      </button>
                    )}
                  </div>
                  <button onClick={()=>{save(k.id); if(k.category==="LLM") testKey(k.id);}} disabled={testing[k.id]} style={{padding:"6px 12px",borderRadius:7,border:"none",background:saved[k.id]?"rgba(34,197,94,0.2)":"rgba(99,102,241,0.15)",color:saved[k.id]?"#4ade80":"#818cf8",cursor:testing[k.id]?"not-allowed":"pointer",fontSize:11,fontWeight:700,flexShrink:0,transition:"all 0.15s",whiteSpace:"nowrap"}}>
                    {testing[k.id] ? "Testing..." : (saved[k.id] ? "✓ Saved" : "Save & Test")}
                  </button>
                </div>
                {testResult[k.id] && (
                  <div style={{marginTop:8,fontSize:10,color:testResult[k.id].success?"#4ade80":"#f87171",display:"flex",alignItems:"center",gap:5}}>
                    {testResult[k.id].success ? "✓ Connection successful" : `⚠ ${testResult[k.id].msg}`}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
      <div style={{padding:"12px 14px",background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:10,fontSize:11,color:"rgba(255,255,255,0.3)",lineHeight:1.7}}>
        <div style={{fontWeight:700,color:"rgba(255,255,255,0.5)",marginBottom:4}}>🔒 Keys saved to browser only</div>
        API keys are stored in your browser's localStorage and never sent anywhere except the intended API endpoint via the local proxy.
      </div>

      {/* ── Yutori Local section — shown when Yutori key is set ── */}
      {(() => {
        const hasYutoriKey = Boolean(localStorage.getItem("radical_apikey_yutori"));
        if (!hasYutoriKey) return (
          <div style={{padding:"12px 14px",background:"rgba(99,102,241,0.03)",border:"1px solid rgba(99,102,241,0.1)",borderRadius:10,fontSize:11,color:"rgba(255,255,255,0.25)",lineHeight:1.6}}>
            💻 <strong style={{color:"rgba(255,255,255,0.35)"}}>Yutori Local</strong> — Save your Yutori key above to enable logged-in browsing (Twitter, LinkedIn, premium news).
          </div>
        );

        const [localOn, setLocalOn] = useState(() => localStorage.getItem("radical_yutori_local") === "true");
        const [sources, setSources] = useState(() => {
          try { return JSON.parse(localStorage.getItem("radical_yutori_local_sources") || "null") || YUTORI_LOCAL_SOURCES.map(s=>s.id); }
          catch { return YUTORI_LOCAL_SOURCES.map(s=>s.id); }
        });

        const toggleOn = () => {
          const next = !localOn;
          setLocalOn(next);
          try { localStorage.setItem("radical_yutori_local", String(next)); } catch {}
        };

        const toggleSource = (id) => {
          const next = sources.includes(id) ? sources.filter(s=>s!==id) : [...sources, id];
          setSources(next);
          try { localStorage.setItem("radical_yutori_local_sources", JSON.stringify(next)); } catch {}
        };

        return (
          <div style={{padding:"14px 16px",background:localOn?"rgba(34,197,94,0.05)":"rgba(255,255,255,0.02)",border:`1px solid ${localOn?"rgba(34,197,94,0.2)":"rgba(255,255,255,0.08)"}`,borderRadius:10,display:"flex",flexDirection:"column",gap:12}}>
            <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:12}}>
              <div>
                <div style={{fontSize:12,fontWeight:700,color:localOn?"#4ade80":"#f0f0f5",marginBottom:3}}>💻 Yutori Local</div>
                <div style={{fontSize:10,color:"rgba(255,255,255,0.35)",lineHeight:1.6}}>
                  Browses Twitter, LinkedIn, NYT, Bloomberg, WSJ, The Logic and Globe & Mail using your logged-in sessions in the Yutori Local desktop app.<br/>
                  <strong style={{color:"rgba(255,255,255,0.5)"}}>Yutori Local must be open on your Mac before running a search.</strong>
                </div>
              </div>
              <button onClick={toggleOn} style={{
                padding:"7px 18px",borderRadius:20,fontSize:11,fontWeight:700,cursor:"pointer",flexShrink:0,
                border:`1px solid ${localOn?"rgba(34,197,94,0.5)":"rgba(255,255,255,0.15)"}`,
                background:localOn?"rgba(34,197,94,0.15)":"rgba(255,255,255,0.04)",
                color:localOn?"#4ade80":"rgba(255,255,255,0.4)",
              }}>
                {localOn ? "✓ Enabled" : "Enable"}
              </button>
            </div>

            <div>
              <div style={{fontSize:9,fontWeight:700,color:"rgba(255,255,255,0.25)",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>
                Sources to browse — make sure you're logged into each in Yutori Local
              </div>
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                {YUTORI_LOCAL_SOURCES.map(s => (
                  <button key={s.id} onClick={()=>toggleSource(s.id)} style={{
                    padding:"5px 12px",borderRadius:20,fontSize:10,fontWeight:600,cursor:"pointer",
                    border:`1px solid ${sources.includes(s.id)?"rgba(34,197,94,0.4)":"rgba(255,255,255,0.08)"}`,
                    background:sources.includes(s.id)?"rgba(34,197,94,0.1)":"transparent",
                    color:sources.includes(s.id)?"#4ade80":"rgba(255,255,255,0.3)",
                  }}>
                    {s.label}
                  </button>
                ))}
              </div>
              <div style={{fontSize:9,color:"rgba(255,255,255,0.2)",marginTop:8,lineHeight:1.6}}>
                Each source = 1 Browsing API task per run. Estimated cost: ~${(sources.length * 0.12).toFixed(2)}–${(sources.length * 0.20).toFixed(2)} per company.
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ─── BOOLEAN PANEL — fully controlled, no stale state ───────────────────────
// The key={`bool-${selId}`} in AdminView guarantees this unmounts+remounts
// completely when a different company is selected. It is physically impossible
// for Cohere's query to appear when Waabi is selected.
function BooleanPanel({ company, onSave }) {
  // draft=null means "showing committed value from props, no unsaved changes"
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(false);
  const [rationale, setRationale] = useState("");

  const displayed = draft !== null ? draft : (company.boolean_query || "");

  const aiSuggest = async () => {
    setLoading(true); setRationale("");
    const r = await callLLM(
      `Generate a precise boolean search query for NewsAPI media monitoring.

Company: ${company.name}
Description: ${company.description}
Website: ${company.website || ""}
Categories: ${company.categories?.join(", ") || ""}

STRICT RULES:
1. MUST include the exact company name in double quotes: "${company.name}"
2. Add specific product names, proprietary terms, or unique brand identifiers
3. Use NOT to exclude common false positives and ambiguous terms
4. NewsAPI syntax: AND, OR, NOT, "quoted phrases" — max 220 characters
5. Do NOT use broad industry terms that could match articles not mentioning this company
6. Every article matched must specifically reference ${company.name}

Return JSON: { "query": "...", "rationale": "One sentence on precision and false positive prevention." }`
    );
    if(r.query) { setDraft(r.query); setRationale(r.rationale || ""); }
    setLoading(false);
  };

  const inpStyle = { width:"100%",padding:"9px 11px",background:"rgba(0,0,0,0.35)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,fontSize:11,fontFamily:"monospace",color:"#f0f0f5",outline:"none",lineHeight:1.65,resize:"vertical" };

  return (
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span style={{fontSize:10,color:"rgba(255,255,255,0.3)"}}>
          Editing query for <strong style={{color:"rgba(255,255,255,0.55)"}}>{company.name}</strong> only
        </span>
        {company.boolean_approved
          ? <Tag bg="rgba(34,197,94,0.1)" color="#4ade80">✓ Active</Tag>
          : <Tag bg="rgba(245,158,11,0.1)" color="#fbbf24">⏳ Pending</Tag>}
      </div>

      <textarea rows={3} value={displayed} onChange={e => setDraft(e.target.value)} style={inpStyle}/>

      {draft !== null && draft !== (company.boolean_query || "") && (
        <div style={{fontSize:10,color:"#fbbf24",padding:"5px 10px",background:"rgba(245,158,11,0.05)",border:"1px solid rgba(245,158,11,0.15)",borderRadius:6}}>
          ⚠ Unsaved changes — click Save draft or Approve to commit
        </div>
      )}

      {rationale && (
        <div style={{fontSize:10,color:"rgba(255,255,255,0.35)",padding:"7px 10px",background:"rgba(99,102,241,0.06)",border:"1px solid rgba(99,102,241,0.12)",borderRadius:7,lineHeight:1.6}}>
          ✦ {rationale}
        </div>
      )}

      <div style={{fontSize:9,color:"rgba(255,255,255,0.18)",lineHeight:1.6,padding:"6px 10px",background:"rgba(255,255,255,0.02)",borderRadius:6}}>
        <strong style={{color:"rgba(255,255,255,0.3)"}}>Syntax:</strong>{" "}
        <code style={{color:"#818cf8"}}>"exact phrase"</code> · <code style={{color:"#818cf8"}}>AND</code> · <code style={{color:"#818cf8"}}>OR</code> · <code style={{color:"#818cf8"}}>NOT</code> — max 220 chars. Every result must name {company.name} specifically.
      </div>

      <div style={{display:"flex",gap:7}}>
        <button onClick={aiSuggest} disabled={loading} style={{flex:1,padding:"8px",borderRadius:7,border:"1px solid rgba(99,102,241,0.35)",background:"rgba(99,102,241,0.1)",color:"#818cf8",fontSize:11,fontWeight:700,cursor:loading?"not-allowed":"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:5}}>
          {loading ? <><Spin/> Generating…</> : "✦ AI suggest"}
        </button>
        <button onClick={() => { onSave(displayed, false); setDraft(null); }} style={{flex:1,padding:"8px",borderRadius:7,border:"1px solid rgba(255,255,255,0.1)",background:"transparent",color:"rgba(255,255,255,0.4)",fontSize:11,fontWeight:700,cursor:"pointer"}}>
          Save draft
        </button>
        <button onClick={() => { onSave(displayed, true); setDraft(null); }} style={{flex:1,padding:"8px",borderRadius:7,border:"none",background:"rgba(34,197,94,0.15)",color:"#4ade80",fontSize:11,fontWeight:700,cursor:"pointer"}}>
          ✓ Approve
        </button>
      </div>
    </div>
  );
}


// ─── COMPETITORS PANEL ────────────────────────────────────────────────────────
function CompetitorsPanel({ company, onSave }) {
  const [competitors, setCompetitors] = useState(company.competitors||[]);
  const [loading, setLoading] = useState(false);
  const [editIdx, setEditIdx] = useState(null);

  const suggest = async () => {
    setLoading(true);
    const r = await callLLM(`You are a VC analyst. Suggest exactly 3 real, named competitors for this company:
Company: ${company.name}
Description: ${company.description}
Categories: ${company.categories?.join(", ")||""}
Website: ${company.website||""}
For each provide: company name, 1-sentence rationale, and a precise NewsAPI boolean search query (exact company name in quotes, plus relevant keywords, NOT clauses).
Return JSON: { "competitors": [{"name":"...","rationale":"...","boolean_query":"..."}] }`);
    if(r.competitors?.length) setCompetitors(r.competitors.map(c=>({...c,editable:true})));
    setLoading(false);
  };

  const update = (i,field,val) => setCompetitors(cs=>cs.map((c,idx)=>idx===i?{...c,[field]:val}:c));
  const remove = (i) => setCompetitors(cs=>cs.filter((_,idx)=>idx!==i));
  const add = () => setCompetitors(cs=>[...cs,{name:"",rationale:"",editable:true}]);

  const inp = { padding:"6px 9px",background:"rgba(0,0,0,0.3)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:6,fontSize:12,color:"#f0f0f5",outline:"none",width:"100%" };

  return (
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div style={{fontSize:11,color:"rgba(255,255,255,0.3)"}}>Used in Share of Voice analysis</div>
        <div style={{display:"flex",gap:7}}>
          <button onClick={suggest} disabled={loading} style={{padding:"5px 12px",borderRadius:8,border:"1px solid rgba(99,102,241,0.4)",background:"rgba(99,102,241,0.1)",color:"#818cf8",fontSize:11,fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",gap:5}}>
            {loading?<><Spinner/> Researching…</>:"✦ AI suggest"}
          </button>
          <button onClick={add} style={{padding:"5px 12px",borderRadius:8,border:"1px solid rgba(255,255,255,0.1)",background:"transparent",color:"rgba(255,255,255,0.4)",fontSize:11,fontWeight:700,cursor:"pointer"}}>+ Add</button>
        </div>
      </div>
      {competitors.map((comp,i)=>(
        <div key={i} style={{padding:"12px",background:"rgba(255,255,255,0.025)",borderRadius:10,border:"1px solid rgba(255,255,255,0.07)"}}>
          {editIdx===i ? (
            <div style={{display:"flex",flexDirection:"column",gap:7}}>
              <input value={comp.name} onChange={e=>update(i,"name",e.target.value)} placeholder="Company name" style={inp}/>
              <textarea value={comp.rationale} onChange={e=>update(i,"rationale",e.target.value)} placeholder="Rationale…" rows={2} style={{...inp,resize:"vertical"}}/>
              <div style={{fontSize:9,color:"rgba(255,255,255,0.2)",marginBottom:-2}}>Monitoring boolean query</div>
              <input value={comp.boolean_query||`"${comp.name}"`} onChange={e=>update(i,"boolean_query",e.target.value)} placeholder="Boolean query" style={{...inp,fontFamily:"monospace",fontSize:10}}/>
              <div style={{display:"flex",gap:6}}>
                <button onClick={()=>setEditIdx(null)} style={{flex:1,padding:"5px",borderRadius:7,border:"none",background:"rgba(34,197,94,0.15)",color:"#4ade80",fontSize:11,fontWeight:700,cursor:"pointer"}}>Done</button>
                <button onClick={()=>remove(i)} style={{padding:"5px 10px",borderRadius:7,border:"none",background:"rgba(239,68,68,0.1)",color:"#f87171",fontSize:11,fontWeight:700,cursor:"pointer"}}>Remove</button>
              </div>
            </div>
          ) : (
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10}}>
              <div style={{flex:1}}>
                <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:3}}>
                  <div style={{fontSize:13,fontWeight:700,color:"#f0f0f5"}}>{comp.name||<span style={{color:"rgba(255,255,255,0.2)"}}>Unnamed</span>}</div>
                  {comp.boolean_query && <div style={{fontSize:8,fontFamily:"monospace",background:"rgba(99,102,241,0.08)",color:"rgba(129,140,248,0.6)",padding:"1px 5px",borderRadius:4,border:"1px solid rgba(99,102,241,0.15)"}}>{comp.boolean_query}</div>}
                </div>
                {comp.rationale && <div style={{fontSize:11,color:"rgba(255,255,255,0.4)",lineHeight:1.5}}>{comp.rationale}</div>}
              </div>
              <div style={{display:"flex",gap:5,flexShrink:0}}>
                <button onClick={()=>setEditIdx(i)} style={{padding:"4px 10px",borderRadius:7,border:"1px solid rgba(255,255,255,0.08)",background:"transparent",color:"rgba(255,255,255,0.3)",fontSize:10,cursor:"pointer"}}>Edit</button>
                <button onClick={()=>remove(i)} style={{padding:"4px 8px",borderRadius:7,border:"none",background:"rgba(239,68,68,0.08)",color:"#f87171",fontSize:10,cursor:"pointer"}}>×</button>
              </div>
            </div>
          )}
        </div>
      ))}
      {competitors.length===0 && <div style={{textAlign:"center",padding:24,color:"rgba(255,255,255,0.2)",fontSize:12}}>No competitors yet — click AI suggest or Add.</div>}
      <button onClick={()=>onSave(competitors)} style={{padding:"9px",borderRadius:8,border:"none",background:"rgba(99,102,241,0.7)",color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer",marginTop:4}}>Save competitors</button>
    </div>
  );
}

// ─── SHARE OF VOICE — per-company ─────────────────────────────────────────────
function CompanySOV({ company, onUpdateCompany }) {
  const [editMode,  setEditMode]  = useState(false);
  const [editList,  setEditList]  = useState(() => (company.competitors||[]).map(c=>({...c})));
  const [newName,   setNewName]   = useState("");
  const [newRat,    setNewRat]    = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [sovData,   setSovData]   = useState(() => company.sovData || null);
  const [sovRunning,setSovRunning] = useState(false);
  const [sovProgress,setSovProgress] = useState("");

  useEffect(() => {
    setEditList((company.competitors||[]).map(c=>({...c})));
    setEditMode(false);
    setSovData(company.sovData || null);
  }, [company.id]);

  const save = () => { onUpdateCompany({...company, competitors: editList}); setEditMode(false); };
  const removeComp = i => setEditList(l => l.filter((_,idx) => idx !== i));
  const addComp = () => {
    if(!newName.trim()) return;
    setEditList(l => [...l, { name: newName.trim(), rationale: newRat.trim() }]);
    setNewName(""); setNewRat("");
  };
  const aiSuggest = async () => {
    setAiLoading(true);
    const r = await callLLM(`Name 3 real specific competitor companies for ${company.name} (${company.description}). Return JSON: { "competitors": [{"name":"...","rationale":"..."},{"name":"...","rationale":"..."},{"name":"...","rationale":"..."}] }`);
    if(r.competitors?.length) setEditList(r.competitors.map(c=>({...c})));
    setAiLoading(false);
  };

  // ── Run SOV: use Yutori Research to get real data for each competitor ───────
  const runSOV = async () => {
    const competitors = (company.competitors||[]).filter(c=>c.name);
    if (!competitors.length) { setSovProgress("Add competitors first, then run SOV."); return; }
    setSovRunning(true); setSovProgress("Checking proxy…");
    try { await fetch("http://localhost:3001/health"); }
    catch { setSovProgress("⚠ Proxy not running — restart via START-MAC.command"); setSovRunning(false); return; }

    const yutoriKey = localStorage.getItem("radical_apikey_yutori");
    if (!yutoriKey) { setSovProgress("Yutori key required — add it in Admin → API Keys."); setSovRunning(false); return; }

    const results = [];
    // Include the portfolio company itself
    const subjects = [{ name: company.name, isBase: true }, ...competitors.map(c => ({ name: c.name, rationale: c.rationale, isBase: false }))];

    for (let i = 0; i < subjects.length; i++) {
      const s = subjects[i];
      setSovProgress(`Researching ${s.name} (${i+1}/${subjects.length})…`);
      try {
        const createRes = await fetch("http://localhost:3001/yutori/v1/research/tasks", {
          method: "POST",
          headers: { "X-API-Key": yutoriKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            query: `Find the total number of social media mentions (Twitter/X, Reddit, LinkedIn, Hacker News) and news articles about "${s.name}" from the past 30 days. Count total mentions, estimate sentiment (-1.0 to +1.0), and list the top 3 sources. Return structured data.`
          })
        });
        if (!createRes.ok) throw new Error(`Yutori ${createRes.status}`);
        const { task_id } = await createRes.json();

        // Poll for result
        let result = null;
        for (let attempt = 0; attempt < 20; attempt++) {
          await new Promise(r => setTimeout(r, 5000));
          setSovProgress(`Waiting for ${s.name} data… (${attempt*5+5}s)`);
          const statusRes = await fetch(`http://localhost:3001/yutori/v1/research/tasks/${task_id}`, {
            headers: { "X-API-Key": yutoriKey }
          });
          const data = await statusRes.json();
          if (data.status === "succeeded" || data.content) { result = data; break; }
          if (data.status === "failed") break;
        }

        // Parse mentions from content using Claude
        if (result?.content) {
          const parsed = await callLLM(
            `From this research about "${s.name}", extract: total_mentions (integer), sentiment_score (float -1 to 1), top_sources (array of strings). Content: ${result.content.slice(0,1500)}. Return JSON: {"total_mentions":0,"sentiment_score":0.0,"top_sources":[]}`,
            "Extract structured data. Return only valid JSON."
          );
          results.push({
            name: s.name, isBase: s.isBase, rationale: s.rationale||"",
            social: parsed.total_mentions || 0,
            sentiment: typeof parsed.sentiment_score === "number" ? parsed.sentiment_score : 0,
            sources: parsed.top_sources || [],
          });
        } else {
          results.push({ name: s.name, isBase: s.isBase, rationale: s.rationale||"", social: 0, sentiment: 0, sources: [] });
        }
      } catch(e) {
        console.warn("SOV failed for", s.name, e);
        results.push({ name: s.name, isBase: s.isBase, rationale: s.rationale||"", social: 0, sentiment: 0, sources: [] });
      }
    }

    const newSovData = { ranAt: new Date().toISOString(), results };
    setSovData(newSovData);
    onUpdateCompany({ ...company, sovData: newSovData });
    setSovRunning(false);
    setSovProgress("");
  };

  const COLORS = ["#818cf8","#3b82f6","#22c55e","#f59e0b","#ef4444","#ec4899","#06b6d4"];
  const subjects = sovData?.results || [];
  const maxS  = Math.max(...subjects.map(s=>s.social), 1);
  const totS  = subjects.reduce((a,s)=>a+s.social,0)||1;
  const inp   = { padding:"6px 9px",background:"rgba(0,0,0,0.3)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:6,fontSize:11,color:"#f0f0f5",outline:"none",width:"100%" };

  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      {/* Competitor editor */}
      <div style={{padding:"13px 14px",background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:10}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:editMode?12:0}}>
          <span style={{fontSize:11,fontWeight:700,color:"rgba(255,255,255,0.6)"}}>{editMode?`Editing competitors for ${company.name}`:`${(company.competitors||[]).filter(c=>c.name).length} competitors tracked`}</span>
          <div style={{display:"flex",gap:6}}>
            {editMode ? (<>
              <button onClick={aiSuggest} disabled={aiLoading} style={{padding:"4px 10px",borderRadius:7,border:"1px solid rgba(99,102,241,0.35)",background:"rgba(99,102,241,0.1)",color:"#818cf8",fontSize:9,fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",gap:3}}>
                {aiLoading?<><Spin/> AI…</>:"✦ AI suggest"}
              </button>
              <button onClick={save} style={{padding:"4px 10px",borderRadius:7,border:"none",background:"rgba(34,197,94,0.15)",color:"#4ade80",fontSize:9,fontWeight:700,cursor:"pointer"}}>✓ Save</button>
              <button onClick={()=>setEditMode(false)} style={{padding:"4px 8px",borderRadius:7,border:"1px solid rgba(255,255,255,0.08)",background:"transparent",color:"rgba(255,255,255,0.28)",fontSize:9,cursor:"pointer"}}>Cancel</button>
            </>) : (
              <button onClick={()=>setEditMode(true)} style={{padding:"4px 11px",borderRadius:20,border:"1px solid rgba(99,102,241,0.25)",background:"transparent",color:"#818cf8",fontSize:9,fontWeight:700,cursor:"pointer"}}>✎ Edit competitors</button>
            )}
          </div>
        </div>
        {editMode && (
          <div>
            {editList.map((c,i) => (
              <div key={i} style={{display:"flex",gap:6,alignItems:"center",marginBottom:5}}>
                <div style={{width:7,height:7,borderRadius:2,background:COLORS[(i+1)%COLORS.length],flexShrink:0}}/>
                <input value={c.name} onChange={e=>setEditList(l=>l.map((x,idx)=>idx===i?{...x,name:e.target.value}:x))} placeholder="Company name" style={{...inp,flex:"0 0 150px"}}/>
                <input value={c.rationale||""} onChange={e=>setEditList(l=>l.map((x,idx)=>idx===i?{...x,rationale:e.target.value}:x))} placeholder="Why a competitor?" style={{...inp,flex:1}}/>
                <button onClick={()=>removeComp(i)} style={{padding:"3px 8px",borderRadius:5,border:"none",background:"rgba(239,68,68,0.1)",color:"#f87171",fontSize:10,cursor:"pointer",flexShrink:0}}>×</button>
              </div>
            ))}
            <div style={{display:"flex",gap:6,alignItems:"center",marginTop:7,paddingTop:7,borderTop:"1px solid rgba(255,255,255,0.05)"}}>
              <div style={{width:7,height:7,borderRadius:2,background:"rgba(255,255,255,0.15)",flexShrink:0}}/>
              <input value={newName} onChange={e=>setNewName(e.target.value)} placeholder="New competitor name" style={{...inp,flex:"0 0 150px"}} onKeyDown={e=>e.key==="Enter"&&addComp()}/>
              <input value={newRat}  onChange={e=>setNewRat(e.target.value)}  placeholder="Rationale (optional)" style={{...inp,flex:1}} onKeyDown={e=>e.key==="Enter"&&addComp()}/>
              <button onClick={addComp} disabled={!newName.trim()} style={{padding:"4px 10px",borderRadius:5,border:"1px solid rgba(99,102,241,0.3)",background:"rgba(99,102,241,0.1)",color:"#818cf8",fontSize:9,fontWeight:700,cursor:"pointer",flexShrink:0}}>Add</button>
            </div>
          </div>
        )}
      </div>

      {/* Run SOV button */}
      <div style={{padding:"14px 16px",background:"rgba(99,102,241,0.04)",border:"1px solid rgba(99,102,241,0.15)",borderRadius:10}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10}}>
          <div>
            <div style={{fontSize:12,fontWeight:700,color:"#f0f0f5",marginBottom:3}}>Share of Voice — live data</div>
            <div style={{fontSize:10,color:"rgba(255,255,255,0.3)",lineHeight:1.6}}>
              Runs Yutori Research on {company.name} + each competitor to get real mention counts and sentiment.
              {sovData && <span style={{marginLeft:8,color:"rgba(255,255,255,0.2)"}}>Last run: {sovData.ranAt?.slice(0,10)}</span>}
            </div>
            <div style={{fontSize:10,color:"rgba(245,158,11,0.6)",marginTop:3}}>
              ⚠ Uses ~$0.35 per company per run · {((company.competitors||[]).filter(c=>c.name).length+1)} subjects ≈ ${(((company.competitors||[]).filter(c=>c.name).length+1)*0.35).toFixed(2)}
            </div>
          </div>
          <button onClick={runSOV} disabled={sovRunning} style={{padding:"9px 20px",borderRadius:8,border:"none",fontSize:12,fontWeight:700,cursor:sovRunning?"not-allowed":"pointer",background:sovRunning?"rgba(99,102,241,0.3)":"rgba(99,102,241,0.85)",color:"#fff",display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
            {sovRunning?<><Spin/> {sovProgress}</>:"▶ Run Share of Voice"}
          </button>
        </div>
        {sovRunning && sovProgress && (
          <div style={{marginTop:10,fontSize:10,color:"rgba(99,102,241,0.7)"}}>{sovProgress}</div>
        )}
      </div>

      {/* No data yet */}
      {!sovData && !sovRunning && (
        <div style={{padding:"32px 24px",textAlign:"center",background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.05)",borderRadius:10}}>
          <div style={{fontSize:24,marginBottom:10}}>◈</div>
          <div style={{fontSize:13,fontWeight:700,color:"#f0f0f5",marginBottom:6}}>No Share of Voice data yet</div>
          <div style={{fontSize:11,color:"rgba(255,255,255,0.3)",lineHeight:1.7}}>
            Add competitors above, then click <strong style={{color:"#818cf8"}}>▶ Run Share of Voice</strong> to fetch real mention counts from across the web.
          </div>
        </div>
      )}

      {/* SOV results */}
      {subjects.length > 0 && (
        <>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {subjects.map((s,i) => {
              const col = COLORS[i % COLORS.length];
              return (
                <div key={i} style={{padding:"12px 14px",borderRadius:9,background:s.isBase?"rgba(99,102,241,0.06)":"rgba(255,255,255,0.02)",border:`1px solid ${s.isBase?"rgba(99,102,241,0.18)":"rgba(255,255,255,0.05)"}`}}>
                  <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:8}}>
                    <div style={{width:8,height:8,borderRadius:2,background:col,flexShrink:0}}/>
                    <span style={{fontSize:12,fontWeight:700,color:"#f0f0f5",flex:1}}>{s.name}</span>
                    {s.isBase && <span style={{fontSize:8,padding:"1px 6px",borderRadius:8,background:"rgba(99,102,241,0.15)",color:"#818cf8",border:"1px solid rgba(99,102,241,0.3)"}}>Portfolio co.</span>}
                    {s.rationale && <span style={{fontSize:9,color:"rgba(255,255,255,0.22)",maxWidth:180,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.rationale}</span>}
                    <div style={{display:"flex",alignItems:"center",gap:4,marginLeft:"auto"}}>
                      <Pip s={s.sentiment} sz={7}/>
                      <span style={{fontSize:10,color:sc(s.sentiment)}}>{sl(s.sentiment)}</span>
                    </div>
                  </div>
                  <div style={{display:"flex",gap:7,alignItems:"center"}}>
                    <span style={{fontSize:9,color:"rgba(255,255,255,0.22)",width:50,textAlign:"right"}}>Mentions</span>
                    <div style={{flex:1,height:6,background:"rgba(255,255,255,0.05)",borderRadius:3}}>
                      <div style={{height:"100%",width:`${(s.social/maxS)*100}%`,background:col,borderRadius:3,transition:"width 0.5s"}}/>
                    </div>
                    <span style={{fontSize:10,fontWeight:700,color:s.isBase?col:"rgba(255,255,255,0.35)",minWidth:50,textAlign:"right"}}>{s.social.toLocaleString()}</span>
                    <span style={{fontSize:9,color:"rgba(255,255,255,0.18)",minWidth:32}}>{(s.social/totS*100).toFixed(0)}%</span>
                  </div>
                  {s.sources?.length > 0 && (
                    <div style={{marginTop:6,fontSize:9,color:"rgba(255,255,255,0.2)"}}>Top: {s.sources.slice(0,3).join(" · ")}</div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Sentiment spectrum */}
          <div style={{padding:"12px 14px",background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.05)",borderRadius:9}}>
            <div style={{fontSize:8,fontWeight:700,color:"rgba(255,255,255,0.22)",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:20}}>Sentiment positioning · live data</div>
            <div style={{position:"relative",height:36,background:"linear-gradient(90deg,#ef4444 0%,#f59e0b 35%,#f59e0b 65%,#22c55e 100%)",borderRadius:5,marginBottom:18}}>
              {subjects.map((s,i)=>{
                const pct=((s.sentiment+1)/2*100);
                return (
                  <div key={i} style={{position:"absolute",left:`${pct}%`,top:0,bottom:0,transform:"translateX(-50%)",display:"flex",flexDirection:"column",alignItems:"center"}}>
                    <div style={{position:"absolute",top:-(i%2===0?22:38),background:"#0d0d1a",border:`1px solid ${COLORS[i%COLORS.length]}88`,borderRadius:4,padding:"1px 6px",fontSize:8,fontWeight:700,color:COLORS[i%COLORS.length],whiteSpace:"nowrap"}}>{s.name}</div>
                    <div style={{width:2,height:"100%",background:COLORS[i%COLORS.length]}}/>
                  </div>
                );
              })}
              <div style={{position:"absolute",bottom:-14,left:0,fontSize:8,color:"rgba(255,255,255,0.2)"}}>−1.0</div>
              <div style={{position:"absolute",bottom:-14,right:0,fontSize:8,color:"rgba(255,255,255,0.2)"}}>+1.0</div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── COMPANY DETAIL ───────────────────────────────────────────────────────────
function CompanyDetail({ company, onBack, onUpdateCompany, onRunComplete, outlets, socialEnabled }) {
  const [tab, setTab] = useState("overview");
  const [briefPersona, setBriefPersona] = useState("CEO");
  const [briefLoading, setBriefLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState(null);
  const [tierFilter, setTierFilter] = useState("All");
  const [platformFilter, setPlatformFilter] = useState("all");
  const [briefing, setBriefing] = useState(null);

  const signals = computeSignals(company);

  const generateBriefing = async () => {
    setBriefLoading(true); setBriefing(null);
    // Check proxy first
    try { await fetch("http://localhost:3001/health"); }
    catch {
      setBriefing({ executive_summary:"Proxy not running — restart the app via START-MAC.command, then try again.", key_action_items:[], ghostwriter_draft:"", risk_flags:[], opportunity_flags:[] });
      setBriefLoading(false); return;
    }
    const r = await callLLM(
      `Generate a portfolio intelligence briefing for a VC firm.
Company: ${company.name} | ${company.categories?.join(", ")||""}
Description: ${company.description}
Operational: Headcount ${company.employee_count} (${company.employee_delta>0?"+":""}${company.employee_delta}% MoM), Web ${fmt(company.web_visits)} (${company.web_delta>0?"+":""}${company.web_delta}% MoM), Funding ${fmt(company.funding_total)}
Media signals: Social ${company.social_volume}, Media ${company.media_volume} articles, Sentiment ${company.sentiment.toFixed(2)} (${sl(company.sentiment)}), Data range: ${company.lastRun?DATE_RANGES.find(r=>r.id===company.lastRun.dateRangeId)?.label||"sample data":"sample data"}, Last run: ${company.lastRun?.ranAt?.slice(0,10)||"never"}
Persona: ${briefPersona}
${briefPersona==="CEO"?"Focus: investor narrative, strategic positioning, PR timing, team morale.":""}
${briefPersona==="Technical"?"Focus: R&D signals, technical credibility, patent/IP, engineering risks.":""}
${briefPersona==="Comms"?"Focus: narrative control, media relationships, proactive PR, message consistency.":""}
Return JSON: { "executive_summary":"...", "key_action_items":["...","...","..."], "ghostwriter_draft":"...", "risk_flags":["..."], "opportunity_flags":["..."] }`,
      "You are a VC portfolio intelligence system. Be concise and action-oriented. Return only valid JSON."
    );
    if (r._error) {
      setBriefing({
        executive_summary: r._message || "Unable to generate — check API connection.",
        key_action_items: r._error === "cohere_invalid_response" ? [
          "Go to Admin → API Keys",
          "Check Cohere North Hostname (should be radical.cloud.cohere.com)",
          "Check Cohere North API Key is correct",
          "Restart the app via START-MAC.command after making changes",
        ] : [],
        ghostwriter_draft:"", risk_flags:[], opportunity_flags:[], _error: r._error
      });
    } else if (r.executive_summary || r.key_action_items) {
      setBriefing(r);
    } else {
      setBriefing({ executive_summary:"No response from AI — verify your Cohere North or Anthropic key in Admin → API Keys, and ensure the proxy (START-MAC.command) is running.", key_action_items:[], ghostwriter_draft:"", risk_flags:[], opportunity_flags:[] });
    }
    setBriefLoading(false);
  };

  const tabBtnStyle = t => ({ padding:"7px 14px",borderRadius:8,fontSize:12,fontWeight:600,border:"none",cursor:"pointer",background:tab===t?"rgba(99,102,241,0.2)":"transparent",color:tab===t?"#818cf8":"rgba(255,255,255,0.3)",transition:"all 0.15s" });

  return (
    <div style={{padding:"28px 28px 60px"}}>
      <button onClick={onBack} style={{background:"none",border:"none",color:"rgba(255,255,255,0.25)",cursor:"pointer",fontSize:12,marginBottom:20,display:"flex",alignItems:"center",gap:5}}>← Portfolio</button>

      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16,flexWrap:"wrap",gap:12}}>
        <div>
          <div style={{display:"flex",alignItems:"center",gap:9,marginBottom:6,flexWrap:"wrap"}}>
            <h2 style={{fontSize:22,fontWeight:900,letterSpacing:"-0.03em",color:"#f0f0f5"}}>{company.name}</h2>
            {company.categories?.map(cat=><CatTag key={cat} cat={cat}/>)}
            <span style={{fontSize:10,color:"rgba(255,255,255,0.2)"}}>inv. {company.year}</span>
          </div>
          <p style={{fontSize:12,color:"rgba(255,255,255,0.3)",maxWidth:560,lineHeight:1.5}}>{company.description}</p>
        </div>
        <button onClick={()=>setTab("briefing")} style={{padding:"8px 16px",borderRadius:20,fontSize:12,fontWeight:700,background:"rgba(99,102,241,0.8)",color:"#fff",border:"none",cursor:"pointer",flexShrink:0}}>✦ AI Briefing</button>
      </div>

      {signals.length>0 && (
        <div style={{display:"flex",gap:6,marginBottom:16,flexWrap:"wrap"}}>
          {signals.map((s,i)=>{const c=SEV[s.sev]||SEV.medium;return <div key={i} style={{padding:"3px 11px",borderRadius:20,background:c.bg,border:`1px solid ${c.b}`,fontSize:11,fontWeight:600,color:c.c}}>{s.icon} {s.label}</div>;})}
        </div>
      )}

      <div style={{display:"flex",gap:3,marginBottom:20,borderBottom:"1px solid rgba(255,255,255,0.06)",paddingBottom:8,alignItems:"center",justifyContent:"space-between",flexWrap:"wrap"}}>
        <div style={{display:"flex",gap:3}}>
          {["overview","sov","briefing"].map(t=>(
            <button key={t} onClick={()=>setTab(t)} style={tabBtnStyle(t)}>
              {t==="sov"?"Share of Voice":t==="briefing"?"AI Briefing":"Overview"}
            </button>
          ))}
        </div>
        <RunPanel company={company} onRunComplete={onRunComplete} isCompact={true} outlets={outlets}/>
      </div>

      {tab==="overview" && (() => {
        // Only show live results — never fake data
        const cov = {
          media:  company.lastRun?.mediaResults  || [],
          social: company.lastRun?.socialResults || [],
        };
        const tc2 = t => t===1?"#fbbf24":t===2?"#818cf8":"#6b7280";
        const PLATFORM_META = {
          twitter:     { color:"#1d9bf0", icon:"𝕏",   label:"Twitter / X" },
          hackernews:  { color:"#ff6000", icon:"Y",   label:"Hacker News" },
          reddit:      { color:"#ff4500", icon:"◉",   label:"Reddit" },
          linkedin:    { color:"#0a66c2", icon:"in",  label:"LinkedIn" },
          web:         { color:"#818cf8", icon:"◈",   label:"Web" },
          "Yutori Research": { color:"#818cf8", icon:"✦", label:"Yutori Research" },
          "Yutori Scout":    { color:"#a78bfa", icon:"◆", label:"Yutori Scout" },
        };
        const platformMeta  = p => PLATFORM_META[p] || PLATFORM_META.web;
        const platformColor = p => platformMeta(p).color;
        const platformIcon  = p => platformMeta(p).icon;

        const MediaCard = ({ item }) => {
          const isApproved = outlets.some(o => (item.source || "").toLowerCase().includes(o.name.toLowerCase()) || o.name.toLowerCase().includes((item.source || "").toLowerCase()));
          return (
          <div style={{padding:"14px 16px",background:"rgba(255,255,255,0.025)",backdropFilter:"blur(12px)",border:`1px solid ${item.isLive?"rgba(99,102,241,0.12)":"rgba(255,255,255,0.07)"}`,borderRadius:10,display:"flex",flexDirection:"column",gap:8}}>
            <div style={{display:"flex",alignItems:"center",gap:7,flexWrap:"wrap"}}>
              <span style={{fontSize:10,fontWeight:700,color:tc2(item.tier)}}>{item.source}</span>
              <span style={{fontSize:8,padding:"1px 5px",borderRadius:8,background:isApproved?"rgba(34,197,94,0.1)":"rgba(245,158,11,0.1)",color:isApproved?"#4ade80":"#fbbf24",border:`1px solid ${isApproved?"rgba(34,197,94,0.2)":"rgba(245,158,11,0.2)"}`}}>
                {isApproved ? "✓ Approved" : "⚠ Unapproved"}
              </span>
              <span style={{fontSize:8,padding:"1px 5px",borderRadius:8,background:tc2(item.tier)+"20",color:tc2(item.tier)}}>T{item.tier}</span>
              <span style={{fontSize:9,padding:"1px 7px",borderRadius:20,background:"rgba(99,102,241,0.1)",color:"#818cf8"}}>{item.topic}</span>
              {item.isLive && <span style={{fontSize:8,padding:"1px 5px",borderRadius:6,background:"rgba(34,197,94,0.08)",color:"#4ade80",border:"1px solid rgba(34,197,94,0.15)"}}>live</span>}
              <span style={{marginLeft:"auto",fontSize:9,color:"rgba(255,255,255,0.2)"}}>{item.date}</span>
            </div>
            <div style={{fontSize:13,fontWeight:700,color:"#f0f0f5",lineHeight:1.4}}>{item.title}</div>
            <div style={{fontSize:11,color:"rgba(255,255,255,0.4)",lineHeight:1.6}}>{item.snippet}</div>
            <div style={{display:"flex",alignItems:"center",gap:12,marginTop:2,flexWrap:"wrap"}}>
              <div style={{display:"flex",alignItems:"center",gap:5}}>
                <div style={{width:7,height:7,borderRadius:"50%",background:item.sentiment>0.15?"#22c55e":item.sentiment<-0.15?"#ef4444":"#f59e0b"}}/>
                <span style={{fontSize:9,color:"rgba(255,255,255,0.3)"}}>{item.sentiment>0.5?"Very Positive":item.sentiment>0.15?"Positive":item.sentiment<-0.5?"Very Negative":item.sentiment<-0.15?"Negative":"Neutral"} ({item.sentiment>0?"+":""}{item.sentiment.toFixed(2)})</span>
              </div>
              {item.likes > 0 && <span style={{fontSize:9,color:"rgba(255,255,255,0.2)"}}>❤ {item.likes.toLocaleString()}</span>}
              {item.url && (
                <a href={item.url} target="_blank" rel="noreferrer" style={{marginLeft:"auto",fontSize:9,color:"#818cf8",opacity:0.7,textDecoration:"none"}}>
                  Read article ↗
                </a>
              )}
            </div>
          </div>
          );
        };

        const SocialCard = ({ item }) => {
          const pm = platformMeta(item.platform || item.subreddit || "web");
          const isLive = item.isLive;
          return (
          <div style={{padding:"14px 16px",background:"rgba(255,255,255,0.025)",border:`1px solid ${isLive?"rgba(99,102,241,0.12)":"rgba(255,255,255,0.07)"}`,borderRadius:10,display:"flex",flexDirection:"column",gap:8}}>
            <div style={{display:"flex",alignItems:"center",gap:7,flexWrap:"wrap"}}>
              {/* Platform badge */}
              <span style={{fontSize:10,fontWeight:800,padding:"1px 7px",borderRadius:8,background:pm.color+"22",color:pm.color,border:`1px solid ${pm.color}44`,letterSpacing:"0.01em"}}>
                {pm.icon} {pm.label}
              </span>
              <span style={{fontSize:10,fontWeight:600,color:"rgba(255,255,255,0.55)"}}>{item.author !== "unknown" ? item.author : ""}</span>
              {item.subreddit && item.subreddit !== item.platform && item.subreddit !== "web" && (
                <span style={{fontSize:9,color:"rgba(255,255,255,0.25)"}}>{item.subreddit}</span>
              )}
              <span style={{marginLeft:"auto",fontSize:9,color:"rgba(255,255,255,0.2)"}}>{item.date}</span>
              {isLive && <span style={{fontSize:8,padding:"1px 5px",borderRadius:6,background:"rgba(34,197,94,0.08)",color:"#4ade80",border:"1px solid rgba(34,197,94,0.15)"}}>live</span>}
            </div>
            {/* Title if different from text */}
            {item.title && item.title !== item.text && (
              <div style={{fontSize:12,fontWeight:700,color:"#f0f0f5",lineHeight:1.4}}>{item.title}</div>
            )}
            <div style={{fontSize:11,color:"rgba(255,255,255,0.65)",lineHeight:1.65}}>{item.text || item.snippet || ""}</div>
            <div style={{display:"flex",alignItems:"center",gap:10,marginTop:2,flexWrap:"wrap"}}>
              <div style={{display:"flex",alignItems:"center",gap:5}}>
                <div style={{width:6,height:6,borderRadius:"50%",background:item.sentiment>0.15?"#22c55e":item.sentiment<-0.15?"#ef4444":"#f59e0b"}}/>
                <span style={{fontSize:9,color:"rgba(255,255,255,0.3)"}}>{item.sentiment>0.15?"Positive":item.sentiment<-0.15?"Negative":"Neutral"}</span>
              </div>
              {item.likes > 0 && <span style={{fontSize:9,fontWeight:600,color:"rgba(255,255,255,0.35)"}}>▲ {item.likes.toLocaleString()} likes</span>}
              {item.comments > 0 && <span style={{fontSize:9,color:"rgba(255,255,255,0.25)"}}>💬 {item.comments.toLocaleString()}</span>}
              {(item.likes + item.comments) > 0 && (
                <span style={{fontSize:8,padding:"1px 6px",borderRadius:8,background:"rgba(99,102,241,0.08)",color:"rgba(129,140,248,0.7)"}}>
                  {(item.likes + item.comments).toLocaleString()} total engagement
                </span>
              )}
              {item.url && (
                <a href={item.url} target="_blank" rel="noreferrer" style={{marginLeft:"auto",fontSize:9,color:pm.color,opacity:0.7,textDecoration:"none"}}>
                  View source ↗
                </a>
              )}
            </div>
          </div>
          );
        };

        return (
          <div style={{display:"flex",flexDirection:"column",gap:18}}>
            {/* KPI row */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>
              {[
                {l:"Social volume",v:company.social_volume.toLocaleString(),c:"#818cf8",sub:company.lastRun?DATE_RANGES.find(r=>r.id===company.lastRun.dateRangeId)?.label||"sample":"sample data"},
                {l:"Media mentions",v:company.media_volume,c:"#60a5fa",sub:company.lastRun?`${company.lastRun.mediaCount} articles · ${DATE_RANGES.find(r=>r.id===company.lastRun.dateRangeId)?.label||"unknown"}`:"sample data"},
                {l:"Sentiment",v:sl(company.sentiment),c:sc(company.sentiment),sub:`${company.sentiment>0?"+":""}${company.sentiment.toFixed(2)}`},
                {l:"Engagement",v:fmt(company.engagement),c:"#4ade80",sub:"interactions"},
              ].map(s=>(
                <div key={s.l} style={{background:"rgba(255,255,255,0.025)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:10,padding:"14px 16px"}}>
                  <div style={{fontSize:9,fontWeight:700,color:"rgba(255,255,255,0.25)",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>{s.l}</div>
                  <div style={{fontSize:20,fontWeight:800,color:s.c,letterSpacing:"-0.02em",marginBottom:3}}>{s.v}</div>
                  <div style={{fontSize:9,color:"rgba(255,255,255,0.2)"}}>{s.sub}</div>
                </div>
              ))}
            </div>

            {/* Operational row */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>
              {[
                {l:"Headcount",v:fmt(company.employee_count),d:company.employee_delta},
                {l:"Web visits",v:fmt(company.web_visits),d:company.web_delta},
                {l:"LinkedIn",v:fmt(company.linkedin_followers),d:null},
                {l:"Funding",v:fmt(company.funding_total),d:null},
              ].map(s=>(
                <div key={s.l} style={{background:"rgba(255,255,255,0.025)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:10,padding:"14px 16px"}}>
                  <div style={{fontSize:9,fontWeight:700,color:"rgba(255,255,255,0.25)",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>{s.l}</div>
                  <div style={{fontSize:20,fontWeight:800,color:"#f0f0f5",letterSpacing:"-0.02em",marginBottom:3}}>{s.v}</div>
                  {s.d!=null?<Delta v={s.d}/>:<span style={{fontSize:9,color:"rgba(255,255,255,0.2)"}}>total</span>}
                </div>
              ))}
            </div>

            {/* Article timeline — clickable bars */}
            {company.lastRun?.mediaResults?.length > 0 && (
              <div style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:10,padding:"14px 16px"}}>
                <ArticleTimeline
                  mediaResults={company.lastRun.mediaResults}
                  dateRangeId={company.lastRun.dateRangeId}
                  onBarClick={d=>setSelectedDate(d)}
                  selectedDate={selectedDate}
                />
                {selectedDate && (
                  <div style={{marginTop:10,fontSize:10,color:"#818cf8",fontWeight:600}}>
                    Showing articles from {selectedDate} ·{" "}
                    <span onClick={()=>setSelectedDate(null)} style={{cursor:"pointer",textDecoration:"underline",opacity:0.7}}>clear filter</span>
                  </div>
                )}
              </div>
            )}

            {/* Empty state — shown before any run */}
            {!company.lastRun && (
              <div style={{padding:"32px 24px",background:"rgba(99,102,241,0.04)",border:"1px solid rgba(99,102,241,0.12)",borderRadius:12,textAlign:"center"}}>
                <div style={{fontSize:28,marginBottom:12}}>◈</div>
                <div style={{fontSize:14,fontWeight:700,color:"#f0f0f5",marginBottom:6}}>No data yet</div>
                <div style={{fontSize:12,color:"rgba(255,255,255,0.35)",lineHeight:1.7,marginBottom:16}}>
                  Click <strong style={{color:"#818cf8"}}>▶ Run search</strong> above to fetch live news and social coverage for {company.name}.<br/>
                  Results from NewsAPI and Yutori will appear here.
                </div>
              </div>
            )}

            {/* Last run status */}
            {company.lastRun && (
              <div style={{padding:"10px 14px",background:company.lastRun.isLive?"rgba(34,197,94,0.05)":"rgba(245,158,11,0.05)",border:`1px solid ${company.lastRun.isLive?"rgba(34,197,94,0.15)":"rgba(245,158,11,0.15)"}`,borderRadius:9,display:"flex",gap:16,flexWrap:"wrap",alignItems:"center"}}>
                <span style={{fontSize:10,fontWeight:700,color:company.lastRun.isLive?"#4ade80":"#fbbf24"}}>{company.lastRun.isLive?"● Live data":"● Sample data"}</span>
                <span style={{fontSize:10,color:"rgba(255,255,255,0.3)"}}>Run: {company.lastRun.ranAt?.slice(0,10)}</span>
                <span style={{fontSize:10,color:"rgba(255,255,255,0.3)"}}>Range: {DATE_RANGES.find(r=>r.id===company.lastRun.dateRangeId)?.label||company.lastRun.dateRangeId}</span>
                <span style={{fontSize:10,color:"#60a5fa"}}>◉ {company.lastRun.mediaCount} media articles found</span>
                <span style={{fontSize:10,color:"#818cf8"}}>◈ {company.lastRun.socialCount} social posts found</span>
              </div>
            )}

            {/* Top media coverage */}
            <div>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
                <div>
                  <div style={{fontSize:13,fontWeight:800,color:"#f0f0f5",letterSpacing:"-0.01em"}}>Top media coverage</div>
                  <div style={{fontSize:10,color:"rgba(255,255,255,0.25)",marginTop:2}}>{company.lastRun?.isLive?"Live data":"Representative sample"} · filtered to approved outlets · {company.lastRun?company.lastRun.mediaCount:company.media_volume} articles · {company.lastRun?DATE_RANGES.find(r=>r.id===company.lastRun.dateRangeId)?.label||"unknown range":"sample data"}</div>
                </div>
                <div style={{display:"flex",gap:4,alignItems:"center",flexShrink:0}}>
                  {[["All","rgba(255,255,255,0.4)"],["T1","#fbbf24"],["T2","#818cf8"],["T3","#6b7280"]].map(([t,c])=>(
                    <button key={t} onClick={()=>setTierFilter(t)}
                      style={{fontSize:9,padding:"3px 10px",borderRadius:10,cursor:"pointer",whiteSpace:"nowrap",
                        background:tierFilter===t?c+"30":"transparent",
                        color:tierFilter===t?c:"rgba(255,255,255,0.25)",
                        border:`1px solid ${tierFilter===t?c+"60":"rgba(255,255,255,0.08)"}`
                      }}>{t}</button>
                  ))}
                </div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                {cov.media
                .filter(m => tierFilter === "All" || m.tier === parseInt(tierFilter.replace("T","")))
                .filter(m => !selectedDate || m.date?.startsWith(selectedDate))
                .map(item => <MediaCard key={item.id} item={item}/>)}
              </div>
              {selectedDate && cov.media.filter(m=>m.date?.startsWith(selectedDate)).length===0 && (
                <div style={{padding:"12px",fontSize:11,color:"rgba(255,255,255,0.3)",textAlign:"center"}}>No articles on {selectedDate}</div>
              )}
              {company.lastRun && cov.media.filter(m => tierFilter === "All" || m.tier === parseInt(tierFilter.replace("T",""))).length === 0 && (
                <div style={{padding:"20px 16px",background:"rgba(245,158,11,0.04)",border:"1px solid rgba(245,158,11,0.12)",borderRadius:10,fontSize:11,color:"rgba(255,255,255,0.4)",lineHeight:1.8}}>
                  <strong style={{color:"#fbbf24"}}>No articles found from approved outlets.</strong><br/>
                  NewsAPI returned results but none matched your approved outlet list.<br/>
                  <span style={{fontSize:10,color:"rgba(255,255,255,0.25)"}}>
                    Fix: Go to <strong>Admin → News Outlets</strong> and add outlets that cover {company.name},
                    or check the browser console (Cmd+Option+J) to see which sources NewsAPI returned.
                  </span>
                </div>
              )}
            </div>

            {/* Top social mentions */}
            {socialEnabled && (
            <div>
              <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:12,flexWrap:"wrap",gap:8}}>
                <div>
                  <div style={{fontSize:13,fontWeight:800,color:"#f0f0f5",letterSpacing:"-0.01em"}}>Top social mentions</div>
                  <div style={{fontSize:10,color:"rgba(255,255,255,0.25)",marginTop:2}}>
                    {company.lastRun?company.lastRun.socialCount:0} posts · {company.lastRun?DATE_RANGES.find(r=>r.id===company.lastRun.dateRangeId)?.label||"unknown range":"no data"}
                    {company.lastRun?.yutoriMode==="research"?" · Yutori Research":company.lastRun?.yutoriMode==="scout"?" · Yutori Scout":company.lastRun?.provider==="data365"?" · Data365":""}
                  </div>
                </div>
                {/* Platform filter tabs */}
                <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                  {[
                    {id:"all",     label:"All",       color:"rgba(255,255,255,0.4)"},
                    {id:"twitter", label:"𝕏 Twitter",  color:"#1d9bf0"},
                    {id:"linkedin",label:"in LinkedIn", color:"#0a66c2"},
                    {id:"reddit",  label:"◉ Reddit",   color:"#ff4500"},
                    {id:"hackernews",label:"Y HN",     color:"#ff6000"},
                    {id:"web",     label:"◈ Web",      color:"#818cf8"},
                  ].map(p => {
                    const count = p.id==="all" ? cov.social.length : cov.social.filter(s=>(s.platform||"").includes(p.id)||(""+s.subreddit).toLowerCase().includes(p.id)).length;
                    if (p.id !== "all" && count === 0) return null;
                    return (
                      <button key={p.id} onClick={()=>setPlatformFilter(p.id)} style={{
                        padding:"4px 10px",borderRadius:20,fontSize:10,fontWeight:600,cursor:"pointer",
                        border:`1px solid ${platformFilter===p.id?p.color+"80":"rgba(255,255,255,0.08)"}`,
                        background:platformFilter===p.id?p.color+"20":"transparent",
                        color:platformFilter===p.id?p.color:"rgba(255,255,255,0.3)",
                      }}>
                        {p.label} {count > 0 && <span style={{opacity:0.6,fontSize:9}}>({count})</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                {cov.social
                  .filter(item => {
                    if (platformFilter === "all") return true;
                    const p = (item.platform || item.subreddit || "").toLowerCase();
                    if (platformFilter === "twitter")    return p.includes("twitter") || p.includes("x.com") || p === "twitter";
                    if (platformFilter === "linkedin")   return p.includes("linkedin");
                    if (platformFilter === "hackernews") return p.includes("hacker") || p.includes("ycombinator") || p === "hackernews";
                    if (platformFilter === "reddit")     return p.includes("reddit") || p.startsWith("r/");
                    if (platformFilter === "web")        return p === "web" || p === "yutori research";
                    return true;
                  })
                  .map(item => <SocialCard key={item.id} item={item}/>)}
              </div>
              {cov.social.filter(item => {
                if (platformFilter === "all") return true;
                const p = (item.platform || item.subreddit || "").toLowerCase();
                if (platformFilter === "twitter")    return p.includes("twitter") || p.includes("x.com") || p === "twitter";
                if (platformFilter === "linkedin")   return p.includes("linkedin");
                if (platformFilter === "hackernews") return p.includes("hacker") || p.includes("ycombinator") || p === "hackernews";
                if (platformFilter === "reddit")     return p.includes("reddit") || p.startsWith("r/");
                if (platformFilter === "web")        return p === "web" || p === "yutori research";
                return true;
              }).length === 0 && cov.social.length > 0 && (
                <div style={{padding:"20px",textAlign:"center",fontSize:11,color:"rgba(255,255,255,0.25)"}}>
                  No {platformFilter} posts in this run — try a different platform or re-run the search.
                </div>
              )}
              {!company.lastRun && (
                <div style={{padding:"20px",textAlign:"center",fontSize:11,color:"rgba(255,255,255,0.25)"}}>Run a search to see social mentions.</div>
              )}
              {company.lastRun && cov.social.length === 0 && (
                <div style={{padding:"20px",textAlign:"center",fontSize:11,color:"rgba(255,255,255,0.25)"}}>No social posts returned in last run.</div>
              )}
            </div>
            )}
          </div>
        );
      })()}
      {tab==="sov" && <CompanySOV key={company.id} company={company} onUpdateCompany={onUpdateCompany}/>}

      {tab==="briefing" && (
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
            {["CEO","Technical","Comms"].map(p=>(
              <button key={p} onClick={()=>{setBriefPersona(p);setBriefing(null);}} style={{padding:"6px 14px",borderRadius:20,fontSize:11,fontWeight:600,cursor:"pointer",border:"1px solid",borderColor:briefPersona===p?"rgba(99,102,241,0.5)":"rgba(255,255,255,0.08)",background:briefPersona===p?"rgba(99,102,241,0.15)":"transparent",color:briefPersona===p?"#818cf8":"rgba(255,255,255,0.35)"}}>
                {p} persona
              </button>
            ))}
            <button onClick={generateBriefing} disabled={briefLoading} style={{marginLeft:"auto",padding:"7px 16px",borderRadius:20,fontSize:12,fontWeight:700,border:"none",background:briefLoading?"rgba(99,102,241,0.3)":"rgba(99,102,241,0.85)",color:"#fff",cursor:briefLoading?"not-allowed":"pointer",display:"flex",alignItems:"center",gap:6}}>
              {briefLoading?<><Spinner/> Generating…</>:"✦ Generate briefing"}
            </button>
          </div>

          {briefLoading && <div style={{textAlign:"center",padding:48,color:"rgba(255,255,255,0.25)",fontSize:13}}><div style={{fontSize:28,marginBottom:10}}><Spinner/></div><p>Researcher → Comms → Governance agents…</p></div>}

          {briefing && !briefLoading && (
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {[
                {label:"Executive summary", content:<p style={{fontSize:13,lineHeight:1.65,color:"rgba(255,255,255,0.75)"}}>{briefing.executive_summary}</p>, borderColor:"rgba(255,255,255,0.07)"},
              ].map((b,i)=>(
                <div key={i} style={{padding:"14px 16px",background:"rgba(255,255,255,0.02)",border:`1px solid ${b.borderColor}`,borderRadius:10}}>
                  <div style={{fontSize:9,fontWeight:700,color:"rgba(255,255,255,0.25)",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:8}}>{b.label}</div>
                  {b.content}
                </div>
              ))}
              {briefing.risk_flags?.filter(Boolean).length>0&&(
                <div style={{padding:"14px 16px",background:"rgba(239,68,68,0.05)",border:"1px solid rgba(239,68,68,0.15)",borderRadius:10}}>
                  <div style={{fontSize:9,fontWeight:700,color:"#f87171",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:8}}>Risk flags</div>
                  {briefing.risk_flags.filter(Boolean).map((r,i)=><div key={i} style={{fontSize:12,color:"#fca5a5",marginBottom:3}}>⚠ {r}</div>)}
                </div>
              )}
              {briefing.opportunity_flags?.filter(Boolean).length>0&&(
                <div style={{padding:"14px 16px",background:"rgba(34,197,94,0.05)",border:"1px solid rgba(34,197,94,0.15)",borderRadius:10}}>
                  <div style={{fontSize:9,fontWeight:700,color:"#4ade80",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:8}}>Opportunities</div>
                  {briefing.opportunity_flags.filter(Boolean).map((o,i)=><div key={i} style={{fontSize:12,color:"#86efac",marginBottom:3}}>⚡ {o}</div>)}
                </div>
              )}
              <div style={{padding:"14px 16px",background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:10}}>
                <div style={{fontSize:9,fontWeight:700,color:"rgba(255,255,255,0.25)",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:8}}>Action items</div>
                {briefing.key_action_items?.map((item,i)=>(
                  <div key={i} style={{display:"flex",gap:9,marginBottom:8,alignItems:"flex-start"}}>
                    <div style={{width:18,height:18,borderRadius:"50%",background:"rgba(99,102,241,0.15)",border:"1px solid rgba(99,102,241,0.3)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:800,color:"#818cf8",flexShrink:0,marginTop:2}}>{i+1}</div>
                    <span style={{fontSize:12,color:"rgba(255,255,255,0.7)",lineHeight:1.5}}>{item}</span>
                  </div>
                ))}
              </div>
              <div style={{padding:"14px 16px",background:"rgba(99,102,241,0.04)",border:"1px solid rgba(99,102,241,0.12)",borderRadius:10}}>
                <div style={{fontSize:9,fontWeight:700,color:"#818cf8",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:8}}>✦ Ghostwriter — {briefPersona}</div>
                <div style={{fontSize:12,fontFamily:"monospace",color:"rgba(255,255,255,0.65)",lineHeight:1.75,whiteSpace:"pre-wrap"}}>{briefing.ghostwriter_draft}</div>
              </div>
            </div>
          )}
          {!briefing&&!briefLoading&&<div style={{textAlign:"center",padding:40,color:"rgba(255,255,255,0.18)",fontSize:12}}>Select a persona and generate a briefing.</div>}
        </div>
      )}
    </div>
  );
}

// ─── ADMIN VIEW ───────────────────────────────────────────────────────────────
function AdminView({ companies, outlets, apiKeys, onUpdateCompany, onAddCompany, onRemoveCompany, onUpdateOutlets, onUpdateApiKeys, onExport, onImport, onReset, socialEnabled, onSocialToggle }) {
  const [tab, setTab]   = useState("boolean");
  const [selId, setSelId] = useState(companies[0]?.id);
  const selected = companies.find(c => c.id === selId) || companies[0];
  const CAT_OPTIONS = Object.keys(CAT_COLOR);

  const tb = t => ({ padding:"6px 13px", borderRadius:7, fontSize:11, fontWeight:600, border:"none", cursor:"pointer",
    background: tab===t ? "rgba(99,102,241,0.2)" : "transparent",
    color: tab===t ? "#818cf8" : "rgba(255,255,255,0.3)" });

  // ── Shared company sidebar ────────────────────────────────────────────────
  const CompanySidebar = () => (
    <div style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.05)",borderRadius:9,padding:8,height:"fit-content",maxHeight:"72vh",overflowY:"auto"}}>
      {companies.map(c => (
        <button key={c.id} onClick={() => setSelId(c.id)} style={{
          display:"flex",alignItems:"center",gap:6,width:"100%",padding:"6px 8px",borderRadius:6,border:"none",
          cursor:"pointer",textAlign:"left",fontSize:10,fontWeight:selId===c.id?700:500,marginBottom:1,
          background:selId===c.id?"rgba(99,102,241,0.15)":"transparent",
          color:selId===c.id?"#818cf8":"rgba(255,255,255,0.28)"
        }}>
          <Pip s={c.sentiment} sz={5}/>
          <span style={{flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.name}</span>
          {c.boolean_approved ? <span style={{fontSize:7,color:"#4ade80"}}>●</span> : <span style={{fontSize:7,color:"#fbbf24"}}>●</span>}
        </button>
      ))}
    </div>
  );

  // ── Company detail header ─────────────────────────────────────────────────
  const CompanyHeader = () => selected ? (
    <div style={{marginBottom:10,padding:"9px 13px",background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.05)",borderRadius:9}}>
      <div style={{display:"flex",alignItems:"center",gap:7,flexWrap:"wrap"}}>
        <span style={{fontSize:13,fontWeight:800,color:"#f0f0f5"}}>{selected.name}</span>
        {selected.categories?.map(cat => <CatTag key={cat} cat={cat}/>)}
        <span style={{fontSize:9,color:"rgba(255,255,255,0.2)"}}>inv. {selected.year}</span>
      </div>
      <p style={{fontSize:10,color:"rgba(255,255,255,0.22)",marginTop:3,lineHeight:1.5}}>{selected.description}</p>
    </div>
  ) : null;

  // ── Portfolio editor panel ────────────────────────────────────────────────
  const PortfolioEditor = () => {
    const [form, setForm] = useState(selected ? {
      name: selected.name, description: selected.description || "",
      website: selected.website || "", year: String(selected.year || 2024),
      categories: selected.categories || [],
    } : { name:"", description:"", website:"", year:"2024", categories:[] });
    const [saved, setSaved] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);

    // Reset form when company changes
    useEffect(() => {
      if (selected) {
        setForm({ name:selected.name, description:selected.description||"", website:selected.website||"", year:String(selected.year||2024), categories:selected.categories||[] });
        setSaved(false); setConfirmDelete(false);
      }
    }, [selected?.id]);

    const upd = k => v => setForm(f => ({...f, [k]: v}));
    const toggleCat = cat => setForm(f => ({...f, categories: f.categories.includes(cat) ? f.categories.filter(c=>c!==cat) : [...f.categories, cat]}));

    const save = () => {
      onUpdateCompany({...selected, name:form.name.trim(), description:form.description, website:form.website, year:parseInt(form.year)||2024, categories:form.categories.length?form.categories:["Software"]});
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    };

    const inp = { width:"100%", padding:"8px 11px", background:"rgba(0,0,0,0.3)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:7, fontSize:12, color:"#f0f0f5", outline:"none" };

    if (!selected) return null;
    return (
      <div style={{display:"flex",flexDirection:"column",gap:13}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <div>
            <div style={{fontSize:9,fontWeight:700,color:"rgba(255,255,255,0.28)",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:4}}>Company name</div>
            <input style={inp} value={form.name} onChange={e=>upd("name")(e.target.value)}/>
          </div>
          <div>
            <div style={{fontSize:9,fontWeight:700,color:"rgba(255,255,255,0.28)",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:4}}>Website</div>
            <input style={inp} value={form.website} onChange={e=>upd("website")(e.target.value)} placeholder="company.com"/>
          </div>
        </div>
        <div>
          <div style={{fontSize:9,fontWeight:700,color:"rgba(255,255,255,0.28)",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:4}}>Description</div>
          <textarea style={{...inp,resize:"vertical",lineHeight:1.55}} rows={2} value={form.description} onChange={e=>upd("description")(e.target.value)}/>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"120px 1fr",gap:10}}>
          <div>
            <div style={{fontSize:9,fontWeight:700,color:"rgba(255,255,255,0.28)",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:4}}>Year invested</div>
            <input style={inp} type="number" value={form.year} onChange={e=>upd("year")(e.target.value)}/>
          </div>
          <div>
            <div style={{fontSize:9,fontWeight:700,color:"rgba(255,255,255,0.28)",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:5}}>Categories</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
              {CAT_OPTIONS.map(cat => {
                const on = form.categories.includes(cat);
                const c  = CAT_COLOR[cat]||"#6b7280";
                return <button key={cat} onClick={()=>toggleCat(cat)} style={{fontSize:9,fontWeight:700,padding:"2px 8px",borderRadius:20,border:`1px solid ${on?c:c+"44"}`,background:on?c+"22":"transparent",color:on?c:"rgba(255,255,255,0.2)",cursor:"pointer"}}>{cat}</button>;
              })}
            </div>
          </div>
        </div>
        <div style={{display:"flex",gap:8,paddingTop:4}}>
          <button onClick={save} style={{flex:2,padding:"9px",borderRadius:8,border:"none",background:saved?"rgba(34,197,94,0.2)":"rgba(99,102,241,0.7)",color:saved?"#4ade80":"#fff",cursor:"pointer",fontSize:12,fontWeight:700,transition:"all 0.2s"}}>
            {saved ? "✓ Saved" : "Save changes"}
          </button>
          {!confirmDelete
            ? <button onClick={()=>setConfirmDelete(true)} style={{padding:"9px 16px",borderRadius:8,border:"1px solid rgba(239,68,68,0.25)",background:"transparent",color:"#f87171",cursor:"pointer",fontSize:12,fontWeight:600}}>Remove</button>
            : <div style={{display:"flex",gap:6,flex:1}}>
                <button onClick={()=>{onRemoveCompany(selected.id);setConfirmDelete(false);}} style={{flex:1,padding:"9px",borderRadius:8,border:"none",background:"rgba(239,68,68,0.2)",color:"#f87171",cursor:"pointer",fontSize:11,fontWeight:700}}>Confirm remove</button>
                <button onClick={()=>setConfirmDelete(false)} style={{padding:"9px 12px",borderRadius:8,border:"1px solid rgba(255,255,255,0.08)",background:"transparent",color:"rgba(255,255,255,0.3)",cursor:"pointer",fontSize:11}}>Cancel</button>
              </div>
          }
        </div>
      </div>
    );
  };

  // ── Add company form ──────────────────────────────────────────────────────
  const AddCompanyForm = () => {
    const [form, setForm] = useState({ name:"", description:"", website:"", year:String(new Date().getFullYear()), categories:[], boolean_query:"" });
    const [loading, setLoading] = useState(false);
    const [done, setDone] = useState(false);
    const upd = k => v => setForm(f => ({...f, [k]: v}));
    const toggleCat = cat => setForm(f => ({...f, categories: f.categories.includes(cat) ? f.categories.filter(c=>c!==cat) : [...f.categories, cat]}));

    const aiSuggest = async () => {
      if (!form.name) return;
      setLoading(true);
      const r = await callLLM(
        `Generate a precise boolean search query for media monitoring for a company called "${form.name}".
Description: ${form.description || "technology startup"}
Website: ${form.website || "unknown"}
Rules: exact company name in quotes, specific product/tech terms only this company uses, NOT clauses for false positives, NewsAPI syntax, max 220 chars.
Return JSON: { "query": "..." }`
      );
      if (r.query) upd("boolean_query")(r.query);
      setLoading(false);
    };

    const submit = () => {
      if (!form.name.trim()) return;
      const newId = Date.now();
      onAddCompany({
        id: newId, name: form.name.trim(), description: form.description,
        website: form.website, categories: form.categories.length ? form.categories : ["Software"],
        year: parseInt(form.year)||new Date().getFullYear(),
        monitoring_enabled: true,
        boolean_query: form.boolean_query || `"${form.name}"`,
        boolean_approved: false, competitors: [],
        social_volume: 0, media_volume: 0, sentiment: 0, engagement: 0,
        employee_count: 0, employee_delta: 0, web_visits: 0, web_delta: 0,
        linkedin_followers: 0, funding_total: 0,
        sparkline: [],
      });
      setDone(true);
      setForm({ name:"", description:"", website:"", year:String(new Date().getFullYear()), categories:[], boolean_query:"" });
      setTimeout(() => setDone(false), 2500);
    };

    const inp = { width:"100%", padding:"8px 11px", background:"rgba(0,0,0,0.3)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:7, fontSize:12, color:"#f0f0f5", outline:"none" };
    const lbl = { fontSize:9, fontWeight:700, color:"rgba(255,255,255,0.28)", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:4, display:"block" };

    return (
      <div style={{display:"flex",flexDirection:"column",gap:13}}>
        {done && <div style={{padding:"10px 14px",background:"rgba(34,197,94,0.1)",border:"1px solid rgba(34,197,94,0.25)",borderRadius:8,fontSize:12,color:"#4ade80",fontWeight:600}}>✓ Company added to portfolio</div>}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <div><label style={lbl}>Company name *</label><input style={inp} value={form.name} onChange={e=>upd("name")(e.target.value)} placeholder="e.g. PocketHealth"/></div>
          <div><label style={lbl}>Website</label><input style={inp} value={form.website} onChange={e=>upd("website")(e.target.value)} placeholder="company.com"/></div>
        </div>
        <div><label style={lbl}>Description</label><textarea style={{...inp,resize:"vertical",lineHeight:1.55}} rows={2} value={form.description} onChange={e=>upd("description")(e.target.value)} placeholder="One-line description of what they do…"/></div>
        <div style={{display:"grid",gridTemplateColumns:"120px 1fr",gap:10}}>
          <div><label style={lbl}>Year invested</label><input style={inp} type="number" value={form.year} onChange={e=>upd("year")(e.target.value)}/></div>
          <div>
            <label style={lbl}>Categories</label>
            <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
              {CAT_OPTIONS.map(cat=>{const on=form.categories.includes(cat);const c=CAT_COLOR[cat]||"#6b7280";return <button key={cat} onClick={()=>toggleCat(cat)} style={{fontSize:9,fontWeight:700,padding:"2px 8px",borderRadius:20,border:`1px solid ${on?c:c+"44"}`,background:on?c+"22":"transparent",color:on?c:"rgba(255,255,255,0.2)",cursor:"pointer"}}>{cat}</button>;})}
            </div>
          </div>
        </div>
        <div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
            <label style={{...lbl,marginBottom:0}}>Boolean search query</label>
            <button onClick={aiSuggest} disabled={loading||!form.name} style={{fontSize:9,fontWeight:700,padding:"3px 10px",borderRadius:20,background:"rgba(99,102,241,0.15)",border:"1px solid rgba(99,102,241,0.3)",color:"#818cf8",cursor:loading?"not-allowed":"pointer",display:"flex",alignItems:"center",gap:4}}>
              {loading ? <><Spin/> Generating…</> : "✦ AI suggest"}
            </button>
          </div>
          <textarea style={{...inp,fontFamily:"monospace",fontSize:10,resize:"vertical",lineHeight:1.6}} rows={2}
            value={form.boolean_query} onChange={e=>upd("boolean_query")(e.target.value)}
            placeholder={form.name ? `"${form.name}" AND (product OR technology)` : `"Company Name" AND (term1 OR term2)`}/>
        </div>
        <button onClick={submit} disabled={!form.name.trim()} style={{padding:"10px",borderRadius:8,border:"none",background:form.name.trim()?"rgba(99,102,241,0.75)":"rgba(99,102,241,0.2)",color:"#fff",cursor:form.name.trim()?"pointer":"not-allowed",fontSize:13,fontWeight:700,opacity:form.name.trim()?1:0.5}}>
          + Add to portfolio
        </button>
      </div>
    );
  };

  return (
    <div style={{padding:"28px 28px 60px"}}>
      <div style={{marginBottom:20}}>
        <h2 style={{fontSize:21,fontWeight:900,letterSpacing:"-0.03em",color:"#f0f0f5",marginBottom:3}}>Admin</h2>
        <p style={{fontSize:11,color:"rgba(255,255,255,0.28)"}}>Portfolio · Boolean queries · Competitors · News outlets · API keys</p>
        <div style={{marginTop:8,fontSize:9,color:"rgba(255,255,255,0.15)",display:"flex",gap:12}}>
          <span>Keys detected:</span>
          {["newsapi","yutori","gemini","anthropic"].map(k => {
            const has = !!localStorage.getItem(k === "anthropic" ? "radical_anthropic_key" : `radical_apikey_${k}`);
            return <span key={k} style={{color:has?"#4ade80":"#f87171"}}>{has?"✓":"✗"} {k}</span>;
          })}
        </div>
      </div>

      <div style={{display:"flex",gap:3,marginBottom:20,borderBottom:"1px solid rgba(255,255,255,0.06)",paddingBottom:8,flexWrap:"wrap"}}>
        {[["monitoring","Monitoring"],["portfolio","Portfolio"],["add","Add company"],["boolean","Boolean queries"],["competitors","Competitors"],["outlets","News outlets"],["apikeys","API keys"],["data","Data & backup"]].map(([k,l])=>(
          <button key={k} onClick={()=>setTab(k)} style={tb(k)}>{l}</button>
        ))}
      </div>

      {/* Portfolio editor (select company + edit fields) */}
      {tab==="monitoring" && (
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          {/* Header row */}
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10}}>
            <div>
              <div style={{fontSize:13,fontWeight:700,color:"#f0f0f5",marginBottom:2}}>Data collection — {companies.length} companies</div>
              <div style={{fontSize:11,color:"rgba(255,255,255,0.28)"}}>
                Toggle companies on or off to control which ones consume API calls during ingest.
                <span style={{color:"#4ade80",marginLeft:8}}>● {companies.filter(c=>c.monitoring_enabled!==false).length} active</span>
                <span style={{color:"rgba(255,255,255,0.25)",marginLeft:8}}>● {companies.filter(c=>c.monitoring_enabled===false).length} paused</span>
              </div>
            </div>
            <div style={{display:"flex",gap:8}}>
              <Btn variant="primary" onClick={()=>companies.forEach(c=>onUpdateCompany({...c,monitoring_enabled:true}))} style={{padding:"6px 14px",fontSize:10,background:"rgba(34,197,94,0.08)",border:"1px solid rgba(34,197,94,0.35)",color:"#4ade80"}}>
                Enable all
              </Btn>
              <Btn variant="danger" onClick={()=>companies.forEach(c=>onUpdateCompany({...c,monitoring_enabled:false}))} style={{padding:"6px 14px",fontSize:10}}>
                Pause all
              </Btn>
            </div>
          </div>

          {/* Company grid */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:8}}>
            {[...companies].sort((a,b)=>a.name.localeCompare(b.name)).map(c => {
              const enabled = c.monitoring_enabled !== false;
              return (
                <div key={c.id} style={{
                  display:"flex",alignItems:"center",gap:12,padding:"11px 14px",
                  background:enabled?"rgba(34,197,94,0.04)":"rgba(255,255,255,0.02)",
                  border:`1px solid ${enabled?"rgba(34,197,94,0.15)":"rgba(255,255,255,0.05)"}`,
                  borderRadius:9,transition:"all 0.15s"
                }}>
                  {/* Toggle */}
                  <Toggle 
                    enabled={enabled} 
                    onChange={() => onUpdateCompany({ ...c, monitoring_enabled: !enabled })} 
                  />

                  {/* Company info */}
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2}}>
                      <span style={{fontSize:12,fontWeight:700,color:enabled?"#f0f0f5":"rgba(255,255,255,0.3)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.name}</span>
                      {c.categories?.slice(0,1).map(cat=><CatTag key={cat} cat={cat}/>)}
                    </div>
                    <div style={{fontSize:9,color:"rgba(255,255,255,0.2)"}}>
                      {enabled
                        ? <span style={{color:"rgba(34,197,94,0.7)"}}>● Active — collecting news + social</span>
                        : <span style={{color:"rgba(255,255,255,0.2)"}}>○ Paused — no API calls</span>
                      }
                    </div>
                  </div>

                  {/* Query status */}
                  <div style={{flexShrink:0}}>
                    {c.boolean_approved
                      ? <span style={{fontSize:8,padding:"2px 6px",borderRadius:8,background:"rgba(34,197,94,0.1)",color:"#4ade80",border:"1px solid rgba(34,197,94,0.2)"}}>✓ query</span>
                      : <span style={{fontSize:8,padding:"2px 6px",borderRadius:8,background:"rgba(245,158,11,0.08)",color:"#fbbf24",border:"1px solid rgba(245,158,11,0.2)"}}>⏳ query</span>
                    }
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{padding:"10px 14px",background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.05)",borderRadius:9,fontSize:10,color:"rgba(255,255,255,0.25)",lineHeight:1.7}}>
            💡 Paused companies still appear in the Command Center and all views — they just won't trigger API calls when the ingest pipeline runs. Useful for controlling costs when some companies don't need daily monitoring.
          </div>
        </div>
      )}

            {tab==="portfolio" && (
        <div style={{display:"grid",gridTemplateColumns:"190px 1fr",gap:14}}>
          <CompanySidebar/>
          <div>
            <CompanyHeader/>
            <PortfolioEditor/>
          </div>
        </div>
      )}

      {/* Add new company */}
      {tab==="add" && (
        <div style={{maxWidth:620}}>
          <div style={{marginBottom:16,padding:"12px 14px",background:"rgba(99,102,241,0.05)",border:"1px solid rgba(99,102,241,0.12)",borderRadius:9,fontSize:11,color:"rgba(255,255,255,0.35)",lineHeight:1.6}}>
            Fill in the details below to add a new company to the portfolio. Use "✦ AI suggest" to auto-generate a boolean search query once you've entered the company name.
          </div>
          <AddCompanyForm/>
        </div>
      )}

      {/* Boolean queries */}
      {tab==="boolean" && (
        <div style={{display:"grid",gridTemplateColumns:"190px 1fr",gap:14}}>
          <CompanySidebar/>
          <div>
            <CompanyHeader/>
            <BooleanPanel key={`bool-${selId}`} company={selected} onSave={(q,approved)=>{
              onUpdateCompany({...selected, boolean_query:q, boolean_approved:approved});
            }}/>
          </div>
        </div>
      )}

      {/* Competitors */}
      {tab==="competitors" && (
        <div style={{display:"grid",gridTemplateColumns:"190px 1fr",gap:14}}>
          <CompanySidebar/>
          <div>
            <CompanyHeader/>
            <CompetitorsPanel key={`comp-${selId}`} company={selected} onSave={(comps)=>{
              onUpdateCompany({...selected, competitors:comps});
            }}/>
          </div>
        </div>
      )}

      {tab==="outlets"  && <OutletsPanel outlets={outlets} onUpdate={onUpdateOutlets}/>}

      {tab==="data" && (
        <div style={{maxWidth:580,display:"flex",flexDirection:"column",gap:20}}>
          {/* Feature Toggles */}
          <div style={{padding:"16px",background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:10}}>
            <div style={{fontSize:13,fontWeight:700,color:"#f0f0f5",marginBottom:4}}>Feature Toggles</div>
            <div style={{fontSize:11,color:"rgba(255,255,255,0.3)",lineHeight:1.6,marginBottom:12}}>
              Turn off features to save API calls. Disabling social will skip Yutori and Data365 fetches, hiding all social sections from the app.
            </div>
            <Toggle 
              enabled={socialEnabled} 
              onChange={onSocialToggle} 
              label="Enable Social Media Monitoring (Yutori / Data365)" 
            />
          </div>

          {/* Storage status */}
          {(() => {
            // Calculate current localStorage usage
            let usedBytes = 0;
            let keys = {};
            try {
              Object.keys(localStorage).forEach(k => {
                const size = (localStorage.getItem(k)||"").length;
                usedBytes += size;
                if (k.startsWith("radical_")) keys[k] = size;
              });
            } catch(e) {}
            const usedKB   = (usedBytes / 1024).toFixed(1);
            const limitKB  = 5120;
            const pct      = Math.min(100, Math.round(usedBytes / (limitKB * 1024) * 100));
            const isNear   = pct > 70;
            return (
              <div style={{padding:"14px 16px",background:isNear?"rgba(245,158,11,0.06)":"rgba(34,197,94,0.05)",border:`1px solid ${isNear?"rgba(245,158,11,0.2)":"rgba(34,197,94,0.15)"}`,borderRadius:10}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                  <div style={{fontSize:11,fontWeight:700,color:isNear?"#fbbf24":"#4ade80"}}>{isNear?"⚠ Storage nearly full":"✓ Auto-save active"}</div>
                  <div style={{fontSize:10,color:"rgba(255,255,255,0.3)"}}>{usedKB} KB / 5,120 KB used</div>
                </div>
                <div style={{height:5,background:"rgba(255,255,255,0.06)",borderRadius:3,marginBottom:10}}>
                  <div style={{height:"100%",width:`${pct}%`,background:isNear?"#f59e0b":"#22c55e",borderRadius:3}}/>
                </div>
                <div style={{fontSize:10,color:"rgba(255,255,255,0.35)",lineHeight:1.7}}>
                  All changes persist automatically across page refreshes and app restarts.
                  Run results (articles + posts) are stored alongside company data.
                  {isNear && <span style={{color:"#fbbf24",display:"block",marginTop:4}}>⚠ Export your config now and consider clearing old run data.</span>}
                </div>
                {Object.keys(keys).length > 0 && (
                  <div style={{marginTop:8,display:"flex",gap:8,flexWrap:"wrap"}}>
                    {Object.entries(keys).map(([k,sz])=>(
                      <span key={k} style={{fontSize:8,padding:"1px 7px",borderRadius:10,background:"rgba(99,102,241,0.1)",color:"#818cf8",border:"1px solid rgba(99,102,241,0.2)"}}>
                        {k}: {(sz/1024).toFixed(1)}KB
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Yutori Scout management */}
          {(() => {
            const yKey = localStorage.getItem("radical_apikey_yutori");
            if (!yKey) return null;
            const scoutKeys = Object.keys(localStorage).filter(k => k.startsWith("radical_yutori_scout_"));
            const scoutCount = scoutKeys.length;
            return (
              <div style={{padding:"16px",background:"rgba(99,102,241,0.04)",border:"1px solid rgba(99,102,241,0.15)",borderRadius:10}}>
                <div style={{fontSize:13,fontWeight:700,color:"#818cf8",marginBottom:4}}>🔍 Yutori Scout management</div>
                <div style={{fontSize:11,color:"rgba(255,255,255,0.35)",lineHeight:1.6,marginBottom:12}}>
                  {scoutCount} persistent Scout{scoutCount!==1?"s":""} created across your portfolio companies.
                  Scouts run daily and accumulate results over time.
                  Deleting scouts here removes the local ID — the scout continues running on Yutori's servers
                  until you delete it from <a href="https://scouts.yutori.com" target="_blank" rel="noreferrer" style={{color:"#818cf8"}}>scouts.yutori.com</a>.
                </div>
                {scoutCount > 0 && (
                  <div style={{display:"flex",gap:8}}>
                    <button onClick={()=>{
                      if(window.confirm(`Delete ${scoutCount} local Scout ID${scoutCount!==1?"s":""}? A new Scout will be created on next run.`)){
                        scoutKeys.forEach(k => localStorage.removeItem(k));
                        window.location.reload();
                      }
                    }} style={{padding:"6px 14px",borderRadius:8,border:"1px solid rgba(239,68,68,0.25)",background:"transparent",color:"#f87171",fontSize:11,fontWeight:700,cursor:"pointer"}}>
                      Clear {scoutCount} Scout ID{scoutCount!==1?"s":""}
                    </button>
                    <a href="https://scouts.yutori.com/settings" target="_blank" rel="noreferrer" style={{padding:"6px 14px",borderRadius:8,border:"1px solid rgba(99,102,241,0.3)",background:"rgba(99,102,241,0.08)",color:"#818cf8",fontSize:11,fontWeight:700,textDecoration:"none",display:"flex",alignItems:"center"}}>
                      Manage on Yutori ↗
                    </a>
                  </div>
                )}
              </div>
            );
          })()}
          {/* Wipe Cache */}
          <div style={{padding:"16px",background:"rgba(245,158,11,0.04)",border:"1px solid rgba(245,158,11,0.12)",borderRadius:10}}>
            <div style={{fontSize:13,fontWeight:700,color:"#fbbf24",marginBottom:4}}>Wipe Data Cache</div>
            <div style={{fontSize:11,color:"rgba(255,255,255,0.3)",lineHeight:1.6,marginBottom:14}}>
              Clears all saved search results, social posts, and sentiment scores from your browser's memory. This removes all 'fake' or historical data and forces a fresh start. Boolean queries and outlet lists are preserved.
            </div>
            <button onClick={() => {
              if (window.confirm("Wipe all saved results? Companies and queries will remain, but all run data will be cleared.")) {
                const next = companies.map(c => ({
                  ...c,
                  lastRun: null,
                  social_volume: 0,
                  media_volume: 0,
                  sentiment: 0,
                  engagement: 0,
                  sparkline: []
                }));
                onUpdateCompany(next); // This should handle the array in a parent update call
                window.location.reload();
              }
            }} style={{padding:"9px 20px",borderRadius:8,border:"1px solid rgba(245,158,11,0.3)",background:"transparent",color:"#fbbf24",fontSize:12,fontWeight:700,cursor:"pointer"}}>
              Wipe all run data
            </button>
          </div>

          {/* Export */}
          <div style={{padding:"16px",background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:10}}>
            <div style={{fontSize:13,fontWeight:700,color:"#f0f0f5",marginBottom:4}}>Export config</div>
            <div style={{fontSize:11,color:"rgba(255,255,255,0.35)",lineHeight:1.6,marginBottom:14}}>
              Downloads a JSON file containing all {companies.length} portfolio companies (including boolean queries, competitors, approval status) and your {outlets.length} approved outlets. Use this to back up your config or move it to another machine.
            </div>
            <button onClick={onExport} style={{padding:"9px 20px",borderRadius:8,border:"none",background:"rgba(99,102,241,0.7)",color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",gap:8}}>
              ↓ Export radical-config.json
            </button>
          </div>

          {/* Import */}
          <div style={{padding:"16px",background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:10}}>
            <div style={{fontSize:13,fontWeight:700,color:"#f0f0f5",marginBottom:4}}>Import config</div>
            <div style={{fontSize:11,color:"rgba(255,255,255,0.35)",lineHeight:1.6,marginBottom:14}}>
              Restores portfolio companies and outlets from a previously exported JSON file. <strong style={{color:"rgba(255,255,255,0.5)"}}>This replaces your current data.</strong>
            </div>
            <label style={{display:"inline-flex",alignItems:"center",gap:8,padding:"9px 20px",borderRadius:8,border:"1px solid rgba(99,102,241,0.4)",background:"rgba(99,102,241,0.1)",color:"#818cf8",fontSize:12,fontWeight:700,cursor:"pointer"}}>
              ↑ Import from file
              <input type="file" accept=".json" onChange={onImport} style={{display:"none"}}/>
            </label>
          </div>

          {/* Reset */}
          <div style={{padding:"16px",background:"rgba(239,68,68,0.04)",border:"1px solid rgba(239,68,68,0.12)",borderRadius:10}}>
            <div style={{fontSize:13,fontWeight:700,color:"#f87171",marginBottom:4}}>Reset to defaults</div>
            <div style={{fontSize:11,color:"rgba(255,255,255,0.3)",lineHeight:1.6,marginBottom:14}}>
              Clears all saved data and restores the original 46 Radical Ventures portfolio companies with their default boolean queries, competitors, and outlet list. Your Anthropic API key is not affected.
            </div>
            <button onClick={onReset} style={{padding:"9px 20px",borderRadius:8,border:"1px solid rgba(239,68,68,0.3)",background:"transparent",color:"#f87171",fontSize:12,fontWeight:700,cursor:"pointer"}}>
              Reset all data
            </button>
          </div>
        </div>
      )}
      {tab==="apikeys"  && <ApiKeysPanel keys={apiKeys} onUpdate={onUpdateApiKeys}/>}
    </div>
  );
}
// ─── SOV HELPERS ─────────────────────────────────────────────────────────────
function renderDonutArcs(companies, metric, total, colors) {
  let acc = 0;
  return companies.slice(0, 10).map((c, i) => {
    const val = metric === "social" ? c.social_volume : metric === "media" ? c.media_volume : c.engagement;
    const pct = val / total;
    if (pct < 0.01) return null;
    const start = acc;
    const end = acc + pct;
    acc = end;
    
    // SVG path for an arc
    const x1 = 80 + 60 * Math.cos(2 * Math.PI * start - Math.PI/2);
    const y1 = 80 + 60 * Math.sin(2 * Math.PI * start - Math.PI/2);
    const x2 = 80 + 60 * Math.cos(2 * Math.PI * end - Math.PI/2);
    const y2 = 80 + 60 * Math.sin(2 * Math.PI * end - Math.PI/2);
    const largeArc = pct > 0.5 ? 1 : 0;
    
    return (
      <path key={c.id} d={`M ${x1} ${y1} A 60 60 0 ${largeArc} 1 ${x2} ${y2}`}
        fill="none" stroke={colors[i % colors.length]} strokeWidth={18} strokeLinecap="round"
        style={{ transition: "all 0.5s ease" }}
      />
    );
  });
}

// ─── PORTFOLIO SOV (cross-portfolio) ─────────────────────────────────────────
function PortfolioSOV({ companies }) {
  const [metric, setMetric] = useState("social");
  const [mode, setMode] = useState("volume");
  const sorted = useMemo(()=>[...companies].sort((a,b)=>(metric==="social"?b.social_volume-a.social_volume:metric==="media"?b.media_volume-a.media_volume:b.engagement-a.engagement)),[companies,metric]);
  const total = sorted.reduce((s,c)=>s+(metric==="social"?c.social_volume:metric==="media"?c.media_volume:c.engagement),0)||1;
  const COLORS=["#818cf8","#3b82f6","#22c55e","#f59e0b","#ef4444","#ec4899","#06b6d4","#8b5cf6","#f97316","#14b8a6"];

  return (
    <div style={{padding:"28px 28px 60px"}}>
      <div style={{marginBottom:22}}>
        <h2 style={{fontSize:22,fontWeight:900,letterSpacing:"-0.03em",color:"#f0f0f5",marginBottom:4}}>Share of Voice</h2>
        <p style={{fontSize:12,color:"rgba(255,255,255,0.3)"}}>Media visibility and sentiment comparison across the full Radical portfolio</p>
      </div>

      <div style={{display:"flex",gap:6,marginBottom:20,flexWrap:"wrap"}}>
        <div style={{display:"flex",gap:3,background:"rgba(255,255,255,0.04)",borderRadius:8,padding:3}}>
          {[["social","Social"],["media","Media"],["engagement","Engagement"]].map(([k,l])=>(
            <button key={k} onClick={()=>setMetric(k)} style={{padding:"5px 12px",borderRadius:6,fontSize:11,fontWeight:600,border:"none",cursor:"pointer",background:metric===k?"rgba(99,102,241,0.3)":"transparent",color:metric===k?"#818cf8":"rgba(255,255,255,0.3)"}}>
              {l}
            </button>
          ))}
        </div>
        <div style={{display:"flex",gap:3,background:"rgba(255,255,255,0.04)",borderRadius:8,padding:3}}>
          {[["volume","Volume share"],["sentiment","Sentiment map"]].map(([k,l])=>(
            <button key={k} onClick={()=>setMode(k)} style={{padding:"5px 12px",borderRadius:6,fontSize:11,fontWeight:600,border:"none",cursor:"pointer",background:mode===k?"rgba(59,130,246,0.3)":"transparent",color:mode===k?"#60a5fa":"rgba(255,255,255,0.3)"}}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {mode==="volume" && (
        <div style={{display:"grid",gridTemplateColumns:"1fr 260px",gap:16}}>
          <div style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:10,padding:"16px"}}>
            <div style={{fontSize:9,fontWeight:700,color:"rgba(255,255,255,0.25)",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:14}}>Volume share — {metric}</div>
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {sorted.map((c,i)=>{
                const val=metric==="social"?c.social_volume:metric==="media"?c.media_volume:c.engagement;
                const pct=(val/total*100).toFixed(1);
                return (
                  <div key={c.id}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        <div style={{width:8,height:8,borderRadius:2,background:COLORS[i%COLORS.length],flexShrink:0}}/>
                        <span style={{fontSize:12,fontWeight:600,color:"rgba(255,255,255,0.7)"}}>{c.name}</span>
                        <span style={{fontSize:9,color:"rgba(255,255,255,0.2)"}}>{c.categories?.[0]}</span>
                      </div>
                      <div style={{display:"flex",gap:10,alignItems:"center"}}>
                        <span style={{fontSize:12,fontWeight:700,color:COLORS[i%COLORS.length]}}>{val.toLocaleString()}</span>
                        <span style={{fontSize:10,color:"rgba(255,255,255,0.2)",minWidth:34,textAlign:"right"}}>{pct}%</span>
                      </div>
                    </div>
                    <div style={{height:6,background:"rgba(255,255,255,0.05)",borderRadius:3}}>
                      <div style={{height:"100%",width:`${pct}%`,background:COLORS[i%COLORS.length],borderRadius:3}}/>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          {/* Donut */}
          <div style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:10,padding:"16px",display:"flex",flexDirection:"column",alignItems:"center"}}>
            <div style={{fontSize:9,fontWeight:700,color:"rgba(255,255,255,0.25)",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:12,alignSelf:"flex-start"}}>Breakdown</div>
            <svg width={160} height={160} viewBox="0 0 160 160">
              {renderDonutArcs(sorted, metric, total, COLORS)}
              <circle cx={80} cy={80} r={46} fill="#0a0a14"/>
              <text x={80} y={77} textAnchor="middle" fill="#f0f0f5" fontSize={13} fontWeight={800}>{companies.length}</text>
              <text x={80} y={91} textAnchor="middle" fill="rgba(255,255,255,0.25)" fontSize={9}>companies</text>
            </svg>
            <div style={{display:"flex",flexDirection:"column",gap:5,width:"100%",marginTop:10}}>
              {sorted.slice(0,6).map((c,i)=>(
                <div key={c.id} style={{display:"flex",alignItems:"center",gap:6}}>
                  <div style={{width:7,height:7,borderRadius:1,background:COLORS[i%COLORS.length],flexShrink:0}}/>
                  <span style={{flex:1,fontSize:10,color:"rgba(255,255,255,0.45)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.name}</span>
                  <span style={{fontSize:10,fontWeight:700,color:COLORS[i%COLORS.length]}}>{(metric==="social"?c.social_volume:metric==="media"?c.media_volume:c.engagement)/total*100|0}%</span>
                </div>
              ))}
              {companies.length>6&&<div style={{fontSize:9,color:"rgba(255,255,255,0.2)",textAlign:"center"}}>+{companies.length-6} more</div>}
            </div>
          </div>
        </div>
      )}

      {mode==="sentiment" && (
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <div style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:10,padding:"16px"}}>
            <div style={{fontSize:9,fontWeight:700,color:"rgba(255,255,255,0.25)",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:24}}>Sentiment map · {companies.filter(c=>c.lastRun?.isLive).length > 0 ? `${companies.filter(c=>c.lastRun?.isLive).length} companies with live data` : "illustrative — run searches to update"}</div>
            <div style={{position:"relative",height:44,background:"linear-gradient(90deg,#ef4444 0%,#f59e0b 35%,#f59e0b 65%,#22c55e 100%)",borderRadius:6,marginBottom:24}}>
              {companies.map((c,i)=>{const pct=((c.sentiment+1)/2*100);return (
                <div key={c.id} style={{position:"absolute",left:`${pct}%`,top:0,bottom:0,transform:"translateX(-50%)",display:"flex",alignItems:"center"}}>
                  <div style={{position:"absolute",top:-(i%2===0?24:44),background:"#0d0d1a",border:"1px solid rgba(255,255,255,0.12)",borderRadius:5,padding:"2px 6px",fontSize:8,fontWeight:700,color:"rgba(255,255,255,0.7)",whiteSpace:"nowrap"}}>{c.name}</div>
                  <div style={{width:2,height:"100%",background:"rgba(255,255,255,0.5)"}}/>
                </div>
              );})}
              <div style={{position:"absolute",bottom:-16,left:0,fontSize:8,color:"rgba(255,255,255,0.2)"}}>Very Negative</div>
              <div style={{position:"absolute",bottom:-16,right:0,fontSize:8,color:"rgba(255,255,255,0.2)"}}>Very Positive</div>
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:8}}>
            {[...companies].sort((a,b)=>b.sentiment-a.sentiment).map(c=>(
              <div key={c.id} style={{padding:"12px 14px",background:"rgba(255,255,255,0.02)",border:`1px solid ${sc(c.sentiment)}33`,borderRadius:10,borderLeft:`3px solid ${sc(c.sentiment)}`}}>
                <div style={{fontSize:12,fontWeight:700,color:"#f0f0f5",marginBottom:3}}>{c.name}</div>
                <div style={{fontSize:10,color:"rgba(255,255,255,0.25)",marginBottom:6}}>{c.categories?.[0]}</div>
                <div style={{fontSize:16,fontWeight:800,color:sc(c.sentiment)}}>{sl(c.sentiment)}</div>
                <div style={{fontSize:10,color:"rgba(255,255,255,0.25)"}}>{c.sentiment>0?"+":""}{c.sentiment.toFixed(2)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── COMMAND CENTER ───────────────────────────────────────────────────────────
function CommandCenter({ companies, onSelect, onAdd, onRunAll, socialEnabled }) {
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("All");
  const [sort, setSort] = useState("name_az");
  const [showAdd, setShowAdd] = useState(false);

  const allCats = useMemo(()=>["All",...Array.from(new Set(companies.flatMap(c=>c.categories||[])))].sort(),[companies]);

  const [showCompetitors, setShowCompetitors] = useState(false);

  const filtered = useMemo(()=>{
    let list = [];
    companies.forEach(c => {
      list.push({ ...c, isCompetitor: false });
      if (showCompetitors && c.competitors) {
        c.competitors.forEach((comp, idx) => {
          list.push({
            ...comp,
            id: `comp-${c.id}-${idx}`,
            isCompetitor: true,
            parentName: c.name,
            categories: c.categories,
            sentiment: comp.sentiment || 0,
            social_volume: comp.social_volume || 0,
            media_volume: comp.media_volume || 0,
            engagement: comp.engagement || 0,
            lastRun: comp.lastRun || null,
          });
        });
      }
    });

    list = list.filter(c => {
      if(filterCat!=="All"&&!c.categories?.includes(filterCat)) return false;
      if(search&&!c.name.toLowerCase().includes(search.toLowerCase())&&!c.description?.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });

    if(sort==="name_az") list=[...list].sort((a,b)=>a.name.localeCompare(b.name));
    if(sort==="name_za") list=[...list].sort((a,b)=>b.name.localeCompare(a.name));
    if(sort==="sentiment_asc") list=[...list].sort((a,b)=>a.sentiment-b.sentiment);
    if(sort==="sentiment_desc") list=[...list].sort((a,b)=>b.sentiment-a.sentiment);
    if(sort==="social_desc") list=[...list].sort((a,b)=>b.social_volume-a.social_volume);
    if(sort==="social_asc") list=[...list].sort((a,b)=>a.social_volume-b.social_volume);
    if(sort==="media_desc") list=[...list].sort((a,b)=>b.media_volume-a.media_volume);
    if(sort==="media_asc") list=[...list].sort((a,b)=>a.media_volume-b.media_volume);
    if(sort==="engagement") list=[...list].sort((a,b)=>b.engagement-a.engagement);
    if(sort==="headcount") list=[...list].sort((a,b)=>b.employee_count-a.employee_count);
    if(sort==="web") list=[...list].sort((a,b)=>b.web_visits-a.web_visits);
    if(sort==="year_desc") list=[...list].sort((a,b)=>b.year-a.year);
    if(sort==="year_asc") list=[...list].sort((a,b)=>a.year-b.year);
    return list;
  },[companies,filterCat,sort,search,showCompetitors]);

  const totals = useMemo(()=>({
    social:companies.reduce((s,c)=>s+c.social_volume,0),
    media:companies.reduce((s,c)=>s+c.media_volume,0),
    avgSent:companies.reduce((s,c)=>s+c.sentiment,0)/companies.length,
    signals:companies.flatMap(c=>computeSignals(c)).filter(s=>s.sev==="critical"||s.sev==="high").length,
    pending:companies.filter(c=>!c.boolean_approved).length,
    monitored:companies.filter(c=>c.monitoring_enabled!==false).length,
  }),[companies]);


  const inp = { padding:"7px 11px",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:7,fontSize:11,color:"#f0f0f5",outline:"none" };


  return (
    <div style={{padding:"28px 28px 60px"}}>
      {showAdd && <AddCompanyModal onAdd={(c)=>{onAdd(c);setShowAdd(false);}} onClose={()=>setShowAdd(false)}/>}

      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:22,flexWrap:"wrap",gap:12}}>
        <div>
          <h2 style={{fontSize:22,fontWeight:900,letterSpacing:"-0.03em",color:"#f0f0f5",marginBottom:3}}>Command Center</h2>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <p style={{fontSize:12,color:"rgba(255,255,255,0.3)"}}>
              Radical Ventures portfolio — {companies.length} companies
            </p>
            <div style={{display:"flex",alignItems:"center",gap:6,background:"rgba(255,255,255,0.03)",padding:"4px 10px",borderRadius:20,border:"1px solid rgba(255,255,255,0.06)"}}>
              <span style={{fontSize:10,fontWeight:700,color:showCompetitors?"#818cf8":"rgba(255,255,255,0.2)"}}>Show Competitors</span>
              <Toggle enabled={showCompetitors} onChange={()=>setShowCompetitors(!showCompetitors)}/>
            </div>
          </div>
        </div>
        <div style={{display:"flex",gap:8}}>
          <Btn onClick={onRunAll}>▶ Run portfolio</Btn>
          <Btn variant="secondary" onClick={()=>setShowAdd(true)}>+ Add company</Btn>
        </div>
      </div>

      {/* KPI row */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:8,marginBottom:20}}>
        {[{l:"Social vol.",v:fmt(totals.social),c:"#818cf8"},{l:"Media mentions",v:totals.media,c:"#60a5fa"},{l:"Avg. sentiment",v:sl(totals.avgSent),c:sc(totals.avgSent)},{l:"Active signals",v:totals.signals,c:"#f87171"},{l:"Queries pending",v:totals.pending,c:"#fbbf24"},{l:"Monitored",v:`${totals.monitored}/${companies.length}`,c:"#22c55e"}].map(s=>(
          <div key={s.l} style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.05)",borderRadius:9,padding:"11px 13px"}}>
            <div style={{fontSize:9,fontWeight:700,color:"rgba(255,255,255,0.22)",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:4}}>{s.l}</div>
            <div style={{fontSize:17,fontWeight:800,color:s.c,letterSpacing:"-0.02em"}}>{s.v}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{display:"flex",gap:7,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search…" style={{...inp,flex:1,minWidth:140}}/>
        <select value={filterCat} onChange={e=>setFilterCat(e.target.value)} style={{...inp,cursor:"pointer"}}>
          {allCats.map(c=><option key={c}>{c}</option>)}
        </select>
        <select value={sort} onChange={e=>setSort(e.target.value)} style={{...inp,cursor:"pointer"}}>
          <option value="name_az">A → Z (Name)</option>
            <option value="name_za">Z → A (Name)</option>
            <option value="sentiment_asc">⚠ Sentiment — Worst first</option>
            <option value="sentiment_desc">✓ Sentiment — Best first</option>
            <option value="social_desc">◈ Social volume — High → Low</option>
            <option value="social_asc">◈ Social volume — Low → High</option>
            <option value="media_desc">◉ Media mentions — High → Low</option>
            <option value="media_asc">◉ Media mentions — Low → High</option>
            <option value="engagement">❤ Engagement — High → Low</option>
            <option value="headcount">👥 Headcount — Large → Small</option>
            <option value="web">🌐 Web traffic — High → Low</option>
            <option value="year_desc">📅 Year invested — Recent first</option>
            <option value="year_asc">📅 Year invested — Oldest first</option>
          </select>
        <div style={{fontSize:10,color:"rgba(255,255,255,0.2)"}}>Showing {filtered.length} of {companies.length}</div>
      </div>

      {/* Header */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 70px 60px 110px 80px 80px",gap:10,padding:"5px 14px",marginBottom:3}}>
        {["Company","Social","Media","Sentiment","Headcount","Trend","Last run"].map(h=>(
          <div key={h} style={{fontSize:9,fontWeight:700,color:"rgba(255,255,255,0.18)",textTransform:"uppercase",letterSpacing:"0.08em"}}>{h}</div>
        ))}
      </div>

      <div style={{display:"flex",flexDirection:"column",gap:4}}>
        {filtered.map(c=>{
          const sigs=computeSignals(c);
          const top=sigs[0];
          return (
            <div key={c.id} onClick={() => !c.isCompetitor && onSelect(c)}
              style={{
                background: c.isCompetitor ? "rgba(255,255,255,0.01)" : "rgba(255,255,255,0.02)",
                border: `1px solid ${c.isCompetitor ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.05)"}`,
                borderRadius: 9, padding: "11px 14px",
                cursor: c.isCompetitor ? "default" : "pointer",
                display: "grid", gridTemplateColumns: "1fr 70px 60px 110px 80px 80px", gap: 10, alignItems: "center",
                transition: "all 0.12s",
                marginLeft: c.isCompetitor ? 24 : 0,
                opacity: c.isCompetitor ? 0.6 : 1,
              }}>
              <div>
                <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:3,flexWrap:"wrap"}}>
                  <span style={{fontSize:13,fontWeight:700,color:"#f0f0f5"}}>{c.name}</span>
                  {c.isCompetitor && <span style={{fontSize:8,fontWeight:800,color:"rgba(255,255,255,0.2)",textTransform:"uppercase",letterSpacing:"0.05em",border:"1px solid rgba(255,255,255,0.05)",padding:"1px 4px",borderRadius:4}}>Competitor</span>}
                  {c.categories?.slice(0,2).map(cat=><CatTag key={cat} cat={cat}/>)}
                  {top&&!c.isCompetitor&&(()=>{const s=SEV[top.sev]||SEV.medium;return <span style={{fontSize:9,padding:"1px 7px",borderRadius:20,background:s.bg,color:s.c,border:`1px solid ${s.b}`}}>{top.icon} {top.label}</span>;})()}
                </div>
                <div style={{fontSize:10,color:"rgba(255,255,255,0.18)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:300}}>
                  {c.isCompetitor ? `Benchmark comparison for ${c.parentName}` : c.description}
                </div>
              </div>
              <div style={{textAlign:"right",fontSize:12,fontWeight:700,color:"#818cf8"}}>{socialEnabled ? c.social_volume.toLocaleString() : "-"}</div>
              <div style={{textAlign:"right",fontSize:12,fontWeight:700,color:"#60a5fa"}}>{c.media_volume}</div>
              <div style={{display:"flex",alignItems:"center",gap:5}}>
                <Pip s={c.sentiment}/>
                <div>
                  <div style={{fontSize:10,fontWeight:600,color:sc(c.sentiment)}}>{sl(c.sentiment)}</div>
                  <div style={{fontSize:9,color:"rgba(255,255,255,0.2)"}}>{c.sentiment>0?"+":""}{c.sentiment.toFixed(2)}</div>
                </div>
              </div>
              <div>
                <div style={{fontSize:11,fontWeight:700,color:"#f0f0f5"}}>{fmt(c.employee_count)}</div>
                <Delta v={c.employee_delta}/>
              </div>
              <Sparkline data={c.sparkline} color={sc(c.sentiment)} h={24}/>
              <div style={{width:72,textAlign:"right",flexShrink:0}}>
                {c.lastRun
                  ? <div style={{lineHeight:1.5}}>
                      <div style={{fontSize:8,fontWeight:600,color:c.lastRun.isLive?"#4ade80":"#fbbf24"}}>{c.lastRun.isLive?"● Live":"● Sample"}</div>
                      <div style={{fontSize:8,color:"rgba(255,255,255,0.18)"}}>{c.lastRun.ranAt?.slice(0,10)}</div>
                    </div>
                  : <div style={{fontSize:8,color:"rgba(255,255,255,0.14)"}}>Not run yet</div>
                }
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AlertsView({ companies, onSelect }) {
  const all=companies.flatMap(c=>computeSignals(c).map(s=>({...s,company:c})));
  const bySev={critical:all.filter(s=>s.sev==="critical"),high:all.filter(s=>s.sev==="high"),positive:all.filter(s=>s.sev==="positive"),medium:all.filter(s=>s.sev==="medium")};
  const Section=({title,signals})=>{if(!signals.length)return null;const c=SEV[signals[0].sev]||SEV.medium;return(<div style={{marginBottom:18}}><div style={{fontSize:9,fontWeight:700,color:"rgba(255,255,255,0.22)",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:7}}>{title} · {signals.length}</div>{signals.map((s,i)=>(<div key={i} onClick={()=>onSelect(s.company)} style={{display:"flex",alignItems:"center",gap:11,padding:"11px 14px",background:c.bg,border:`1px solid ${c.b}`,borderRadius:8,marginBottom:5,cursor:"pointer"}}><span style={{fontSize:16}}>{s.icon}</span><div style={{flex:1}}><div style={{fontSize:12,fontWeight:700,color:c.c}}>{s.label}</div><div style={{fontSize:10,color:"rgba(255,255,255,0.25)",marginTop:1}}>{s.company.name} · {s.company.categories?.[0]}</div></div><span style={{fontSize:10,color:"rgba(255,255,255,0.15)"}}>→</span></div>))}</div>);};
  return (<div style={{padding:"28px 28px 60px"}}><h2 style={{fontSize:22,fontWeight:900,letterSpacing:"-0.03em",color:"#f0f0f5",marginBottom:4}}>Signal Alerts</h2><p style={{fontSize:12,color:"rgba(255,255,255,0.3)",marginBottom:24}}>Cross-portfolio risk and opportunity signals.</p><Section title="Critical" signals={bySev.critical}/><Section title="High priority" signals={bySev.high}/><Section title="Positive signals" signals={bySev.positive}/><Section title="Watch list" signals={bySev.medium}/>{all.length===0&&<div style={{textAlign:"center",padding:48,color:"rgba(255,255,255,0.2)"}}>No active signals.</div>}</div>);
}

// ─── ROOT ─────────────────────────────────────────────────────────────────────

// ── API Key Banner — shown when no Anthropic key is detected ─────────────────
function KeyBanner({ onDismiss }) {
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const save = () => {
    if (!key.trim()) return;
    setSaving(true);
    try { localStorage.setItem("radical_anthropic_key", key.trim()); }
    catch(e) {}
    setDone(true);
    setTimeout(() => { setSaving(false); onDismiss(); }, 800);
  };

  return (
    <div style={{
      position:"fixed", top:0, left:0, right:0, zIndex:9999,
      background:"linear-gradient(135deg,#1e1b4b,#1e3a5f)",
      borderBottom:"1px solid rgba(99,102,241,0.4)",
      padding:"12px 24px", display:"flex", alignItems:"center", gap:16, flexWrap:"wrap"
    }}>
      <div style={{display:"flex",alignItems:"center",gap:8,flex:"0 0 auto"}}>
        <div style={{width:24,height:24,borderRadius:6,background:"linear-gradient(135deg,#4f46e5,#2563eb)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:900,color:"#fff"}}>R</div>
        <span style={{fontSize:12,fontWeight:700,color:"#818cf8"}}>Add your Cohere North or Anthropic API key to enable AI features</span>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:8,flex:1,minWidth:280}}>
        <input
          type="password"
          value={key}
          onChange={e=>setKey(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&save()}
          placeholder="sk-ant-api03-..."
          style={{flex:1,padding:"7px 12px",background:"rgba(0,0,0,0.4)",border:"1px solid rgba(99,102,241,0.4)",borderRadius:7,fontSize:12,color:"#f0f0f5",outline:"none",fontFamily:"monospace"}}
        />
        <button onClick={save} disabled={!key.trim()||saving} style={{padding:"7px 16px",borderRadius:7,border:"none",background:done?"rgba(34,197,94,0.8)":"rgba(99,102,241,0.8)",color:"#fff",fontSize:11,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap",transition:"all 0.2s"}}>
          {done ? "✓ Saved!" : "Save key"}
        </button>
        <button onClick={onDismiss} style={{padding:"7px 10px",borderRadius:7,border:"1px solid rgba(255,255,255,0.1)",background:"transparent",color:"rgba(255,255,255,0.35)",fontSize:11,cursor:"pointer",whiteSpace:"nowrap"}}>
          Skip
        </button>
      </div>
      <div style={{fontSize:10,color:"rgba(255,255,255,0.3)",flex:"0 0 auto"}}>
        Cohere North key → <span style={{color:"#818cf8"}}>radical.cloud.cohere.com</span> · or Anthropic → <span style={{color:"#818cf8"}}>console.anthropic.com</span>
      </div>
    </div>
  );
}

// ─── DATE RANGE OPTIONS ───────────────────────────────────────────────────────
const DATE_RANGES = [
  { id:"7d",  label:"Last 7 days",   days:7  },
  { id:"14d", label:"Last 14 days",  days:14 },
  { id:"30d", label:"Last 30 days",  days:30 },
  { id:"90d", label:"Last 90 days",  days:90 },
  { id:"6m",  label:"Last 6 months", days:180 },
];

function dateRangeFrom(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

// ─── RUN ENGINE ───────────────────────────────────────────────────────────────
// Three social providers, tried in priority order:
//   1. Yutori Research API  — on-demand, covers Twitter/X, Reddit, LinkedIn, HN, news ($0.35/run)
//   2. Yutori Scouting API  — returns results from an existing scheduled Scout for this company
//   3. Data365              — structured Reddit/social data (legacy alternative)
// NewsAPI always runs in parallel for media/press coverage.

function getKey(envVar, lsKey) {
  try {
    // 1. Check localStorage first (Admin panel entries)
    const ls = localStorage.getItem(lsKey);
    if (ls && ls.trim()) return ls.trim();

    // 2. Fallback to Environment Variables
    if (typeof import.meta !== "undefined" && import.meta.env) {
      const env = import.meta.env[envVar];
      if (env && env.trim()) return env.trim();
    }
  } catch(e) {
    console.warn(`[App] Error retrieving key for ${lsKey}:`, e);
  }
  return null;
}

// ── Yutori Research API — single on-demand deep research run ─────────────────
// POST /v1/research/tasks  →  poll GET /v1/research/tasks/{id} until complete
async function yutoriResearch(company, dateRangeId, apiKey, prog) {
  const range = DATE_RANGES.find(r => r.id === dateRangeId) || DATE_RANGES[2];
  const query = `Search Twitter/X (x.com and twitter.com), LinkedIn (linkedin.com), Reddit (reddit.com), ` +
    `Hacker News (news.ycombinator.com), and major tech/news publications for mentions of "${company.name}" ` +
    `from the past ${range.label.toLowerCase()}. ` +
    `For each result, include: the exact URL, platform name, author or username, post text or headline, and date. ` +
    `Only include results that explicitly name "${company.name}". Do not include generic industry articles. ` +
    `Prioritise: tweets mentioning @${company.name.toLowerCase().replace(/\s+/g,"")}, LinkedIn posts from or about ${company.name}, ` +
    `Reddit discussions, and news articles specifically about ${company.name}.`;

  // Create research task
  // Route through local proxy to avoid CORS from browser
  const createRes = await fetch("http://localhost:3001/yutori/v1/research/tasks", {
    method: "POST",
    headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ query })
  });
  if (!createRes.ok) {
    const err = await createRes.json().catch(() => ({}));
    throw new Error(`Yutori Research create failed: ${createRes.status} — ${err.detail || createRes.statusText}`);
  }
  const createData = await createRes.json();
  // Yutori Research API returns task_id (not id)
  const taskId = createData.task_id || createData.id;
  if (!taskId) throw new Error("Yutori Research: no task_id in response — " + JSON.stringify(createData).slice(0, 200));

  // Poll until complete (max 60 seconds — Scout provides primary data)
  let result = null;
  for (let attempt = 0; attempt < 15; attempt++) {
    await new Promise(r => setTimeout(r, 4000));
    if (prog) prog("Yutori Research: waiting for results (" + (attempt*4+4) + "s / 60s max)…");
    const statusRes = await fetch(`http://localhost:3001/yutori/v1/research/tasks/${taskId}`, {
      headers: { "X-API-Key": apiKey }
    });
    if (!statusRes.ok) continue;
    const data = await statusRes.json();
    // Yutori Research API status values: queued | in_progress | succeeded | failed | cancelled
    console.log("[Yutori poll] attempt", attempt+1, "status:", data.status, "has content:", Boolean(data.content));
    if (["succeeded","completed","done","finished"].includes(data.status) || data.content) { result = data; break; }
    if (["failed","cancelled","error"].includes(data.status)) throw new Error("Yutori Research task " + data.status + ": " + (data.error || "unknown"));
  }
  if (!result) throw new Error("Yutori Research timed out after 60s — Scout data will be used instead");

  // Parse citations into our social result format
  const citations = result.citations || [];
  const content   = result.content  || "";

  // Separate social vs news citations by URL domain
  const socialDomains = ["twitter.com","x.com","reddit.com","linkedin.com","news.ycombinator.com","t.co"];
  const socialCitations = citations.filter(c => socialDomains.some(d => (c.url||"").includes(d)));
  const newsCitations   = citations.filter(c => !socialDomains.some(d => (c.url||"").includes(d)));

  const platformFromUrl = url => {
    if (url.includes("twitter.com") || url.includes("x.com") || url.includes("t.co")) return "twitter";
    if (url.includes("reddit.com")) return "reddit";
    if (url.includes("linkedin.com")) return "linkedin";
    if (url.includes("ycombinator.com")) return "hackernews";
    return "web";
  };

  const socialResults = socialCitations.slice(0, 8).map((c, i) => ({
    id:       `yutori-s-${company.id}-${Date.now()}-${i}`,
    platform: platformFromUrl(c.url || ""),
    subreddit: platformFromUrl(c.url || ""),
    author:   c.preview_data?.author || c.preview_data?.username || "unknown",
    text:     c.preview_data?.text || c.preview_data?.title || content.slice(0, 300),
    url:      c.url || "",
    likes:    c.preview_data?.likes || c.preview_data?.score || 0,
    comments: c.preview_data?.comments || 0,
    date:     c.preview_data?.date || new Date().toISOString().slice(0, 10),
    sentiment: 0,
    isLive:   true,
    source:   "Yutori Research",
  }));

  // If no social citations, create one summary entry from the full content
  if (socialResults.length === 0 && content) {
    socialResults.push({
      id:       `yutori-s-${company.id}-${Date.now()}-0`,
      platform: "web",
      subreddit: "Yutori Research",
      author:   "Yutori AI",
      text:     content.slice(0, 500),
      url:      "",
      likes:    0, comments: 0,
      date:     new Date().toISOString().slice(0, 10),
      sentiment: 0, isLive: true, source: "Yutori Research",
    });
  }

  const newsFromYutori = newsCitations.slice(0, 4).map((c, i) => ({
    id:       `yutori-m-${company.id}-${Date.now()}-${i}`,
    source:   c.preview_data?.source || new URL(c.url || "https://unknown.com").hostname.replace("www.", ""),
    tier:     2,
    title:    c.preview_data?.title || "(No title)",
    snippet:  c.preview_data?.description || content.slice(0, 200),
    url:      c.url || "",
    date:     c.preview_data?.date || new Date().toISOString().slice(0, 10),
    sentiment: 0, topic: "Research", isLive: true,
  }));

  // Sort by engagement: likes + comments, descending — highest audience first
  socialResults.sort((a, b) => (b.likes + b.comments) - (a.likes + a.comments));
  return { socialResults, newsFromYutori, rawContent: content, taskId };
}

// ── Yutori Scouting API — create or reuse a Scout per company ────────────────
// Scouts are persistent monitors. We create one per company (keyed by company id)
// and store the scout_id in localStorage. On run, we fetch its latest updates.
async function yutoriScout(company, dateRangeId, apiKey) {
  const lsKey   = `radical_yutori_scout_${company.id}`;
  let   scoutId = "";
  try { scoutId = localStorage.getItem(lsKey) || ""; } catch {}

  // Create scout if it doesn't exist yet
  if (!scoutId) {
    const query = `Monitor for any news, social media mentions (Twitter/X, Reddit, LinkedIn, Hacker News), ` +
      `product updates, press releases, funding announcements, partnerships, or relevant coverage about ` +
      `"${company.name}" — ${company.description}. ` +
      `Only include results that specifically mention ${company.name} by name.`;

    const res = await fetch("http://localhost:3001/yutori/v1/scouting/tasks", {
      method: "POST",
      headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        output_interval: 86400, // daily
        skip_email: true,
        output_schema: {
          type: "array",
          items: {
            type: "object",
            properties: {
              headline:   { type: "string", description: "Title or headline of the mention" },
              summary:    { type: "string", description: "Brief summary of the content" },
              source_url: { type: "string", description: "URL of the source" },
              platform:   { type: "string", description: "twitter, reddit, linkedin, hackernews, or news" },
              date:       { type: "string", description: "Publication date YYYY-MM-DD" },
              author:     { type: "string", description: "Author or username" },
            }
          }
        }
      })
    });
    if (!res.ok) throw new Error(`Yutori Scout create failed: ${res.status}`);
    const data = await res.json();
    scoutId = data.id;
    try { localStorage.setItem(lsKey, scoutId); } catch {}
  }

  // Fetch latest updates from this scout
  const updatesRes = await fetch(
    `http://localhost:3001/yutori/v1/scouting/tasks/${scoutId}/updates?page_size=20`,
    { headers: { "X-API-Key": apiKey } }
  );
  if (!updatesRes.ok) throw new Error(`Yutori Scout updates failed: ${updatesRes.status}`);
  const updatesData = await updatesRes.json();
  const updates = updatesData.updates || [];

  const socialDomains = ["twitter","x.com","reddit","linkedin","ycombinator"];
  const socialResults = [], newsFromScout = [];

  updates.forEach((u, i) => {
    const items = Array.isArray(u.structured_result) ? u.structured_result : [];
    items.forEach((item, j) => {
      const isSocial = socialDomains.some(d => (item.platform||"").includes(d) || (item.source_url||"").includes(d));
      const entry = {
        id:       `yutori-scout-${company.id}-${i}-${j}`,
        text:     item.summary || item.headline || "",
        title:    item.headline || "",
        snippet:  item.summary || "",
        url:      item.source_url || "",
        date:     item.date || new Date().toISOString().slice(0, 10),
        author:   item.author || "unknown",
        platform: item.platform || "web",
        subreddit: item.platform || "web",
        likes:    0, comments: 0,
        sentiment: 0, isLive: true, source: "Yutori Scout",
        tier: 2, topic: "Scout",
      };
      if (isSocial) socialResults.push(entry);
      else newsFromScout.push(entry);
    });
  });

  return { socialResults: socialResults.slice(0, 8), newsFromScout: newsFromScout.slice(0, 4), scoutId };
}

// ── Main run orchestrator ─────────────────────────────────────────────────────
// ─── KEY VALIDATION ──────────────────────────────────────────────────────────
async function validateYutoriKey(key) {
  try {
    const res = await fetch("https://api.yutori.com/reference/health", {
      headers: { "X-API-Key": key }
    });
    if (res.status === 401 || res.status === 403) return { ok: false, error: "Invalid Yutori API key — check Admin → API Keys" };
    return { ok: true };
  } catch(e) {
    // Health check failed — key might still work, don't block
    return { ok: true };
  }
}

async function validateNewsAPIKey(key) {
  try {
    const res = await fetch(`http://localhost:3001/newsapi/v2/top-headlines?country=us&pageSize=1&apiKey=${key}`);
    const data = await res.json().catch(() => ({}));
    if (data.status === "error") return { ok: false, error: "NewsAPI: " + (data.message || "invalid key") };
    return { ok: true };
  } catch(e) {
    return { ok: true }; // CORS on free plan — key may still be valid
  }
}

// ─── YUTORI LOCAL — Browsing API with local browser sessions ─────────────────
// Uses browser:"local" which routes through the Yutori Local desktop app,
// giving the agent access to your logged-in Twitter, LinkedIn, NYT, Bloomberg etc.
// Requires Yutori Local to be running on this Mac.

// Sites you've logged into — each gets a targeted Browsing task
const YUTORI_LOCAL_SOURCES = [
  { id:"twitter",   label:"Twitter/X",      url:"https://twitter.com/search?q={QUERY}&src=typed_query&f=live", platform:"twitter" },
  { id:"linkedin",  label:"LinkedIn",        url:"https://www.linkedin.com/search/results/content/?keywords={QUERY}&datePosted=past-month", platform:"linkedin" },
  { id:"nytimes",   label:"New York Times",  url:"https://www.nytimes.com/search?query={QUERY}", platform:"web" },
  { id:"bloomberg", label:"Bloomberg",       url:"https://www.bloomberg.com/search?query={QUERY}", platform:"web" },
  { id:"wsj",       label:"Wall St. Journal",url:"https://www.wsj.com/search?query={QUERY}&isToggleOn=true&operator=AND&sort=date-desc&duration=1M", platform:"web" },
  { id:"thelogic",  label:"The Logic",       url:"https://thelogic.co/search/?q={QUERY}", platform:"web" },
  { id:"globemail", label:"Globe and Mail",  url:"https://www.theglobeandmail.com/search/?q={QUERY}", platform:"web" },
];

async function yutoriLocalBrowse(company, dateRangeId, apiKey, prog, enabledSources) {
  const range      = DATE_RANGES.find(r => r.id === dateRangeId) || DATE_RANGES[2];
  const companyQ   = encodeURIComponent(company.name); // plain name, no quotes
  const rawQ       = company.name;
  const sources    = YUTORI_LOCAL_SOURCES.filter(s => !enabledSources || enabledSources.includes(s.id));

  // Check Yutori Local is running by attempting a local-browser task with a 5s timeout
  // We do this by watching for a fast failure vs a task_id response
  if (prog) prog("Checking Yutori Local connection…");

  const allSocial = [];
  const allMedia  = [];

  for (const source of sources) {
    if (prog) prog(`Browsing ${source.label} for "${rawQ}"…`);
    const startUrl = source.url.replace("{QUERY}", companyQ);

    const task = `Search ${source.label} for recent mentions, posts, and articles specifically about "${rawQ}" ` +
      `(${company.description.slice(0, 120)}) from the past ${range.label.toLowerCase()}. ` +
      `For each result, extract: headline or post text, author or username, date, and URL. ` +
      `Return up to 5 of the most relevant and highest-engagement results. ` +
      `Ignore unrelated content — every result must specifically mention ${rawQ} by name.`;

    try {
      // Create browsing task with browser:"local"
      const createRes = await fetch("http://localhost:3001/yutori/v1/browsing/tasks", {
        method:  "POST",
        headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          task:      task,
          start_url: startUrl,
          browser:   "local",
          max_steps: 30,
        })
      });

      if (!createRes.ok) {
        const errText = await createRes.text().catch(() => "");
        let errDetail = "";
        try { errDetail = JSON.parse(errText)?.detail || ""; } catch {}
        console.warn(`[Yutori Local] ${source.label} ${createRes.status}:`, errDetail || errText.slice(0, 200));
        if (createRes.status === 422) {
          if (prog) prog(`⚠ Yutori Local 422 — open Yutori Local app and sign in with your API key account`);
          console.warn(`[Yutori Local] 422 usually means Yutori Local is not running or not paired with this API key.`,
            `Open the Yutori Local desktop app, sign in with the same Yutori account as your API key, then try again.`);
        }
        continue;
      }

      const { task_id } = await createRes.json();
      if (!task_id) { console.warn(`[Yutori Local] No task_id for ${source.label}`); continue; }

      // Poll until complete (max 90s)
      let result = null;
      for (let attempt = 0; attempt < 18; attempt++) {
        await new Promise(r => setTimeout(r, 5000));
        if (prog) prog(`${source.label}: waiting for results (${attempt*5+5}s)…`);
        const statusRes = await fetch(`http://localhost:3001/yutori/v1/browsing/tasks/${task_id}`, {
          headers: { "X-API-Key": apiKey }
        });
        if (!statusRes.ok) continue;
        const data = await statusRes.json();
        if (["succeeded","completed"].includes(data.status) || data.result || data.structured_result) {
          result = data; break;
        }
        if (["failed","cancelled"].includes(data.status)) break;
      }

      if (!result) { console.warn(`[Yutori Local] ${source.label} timed out`); continue; }

      // Parse plain text result using Claude to extract structured items
      const rawText = result.result || result.content || "";
      console.log(`[Yutori Local] ${source.label} raw result:`, rawText.slice(0, 200));

      let items = [];
      if (rawText && getAnthropicKey()) {
        const parsed = await callLLM(
          `Extract a list of posts/articles from this ${source.label} search result about "${rawQ}". ` +
          `For each result return: headline (string), author (string), date (YYYY-MM-DD), url (string), engagement (number). ` +
          `Result text: ${rawText.slice(0, 2000)}. ` +
          `Return JSON array: [{"headline":"...","author":"...","date":"...","url":"...","engagement":0}]`,
          "Extract structured data from web search results. Return only a valid JSON array."
        );
        items = Array.isArray(parsed) ? parsed : [];
      } else if (rawText) {
        // Fallback: create one item from the raw text
        items = [{ headline: rawText.slice(0, 200), author: source.label, date: new Date().toISOString().slice(0,10), url: startUrl, engagement: 0 }];
      }

      items.slice(0, 5).forEach((item, i) => {
        const entry = {
          id:        `local-${source.id}-${company.id}-${Date.now()}-${i}`,
          platform:  source.platform,
          subreddit: source.label,
          author:    item.author || source.label,
          text:      item.headline || "",
          title:     item.headline || "",
          url:       item.url || startUrl,
          date:      item.date || new Date().toISOString().slice(0, 10),
          likes:     item.engagement || 0,
          comments:  0,
          sentiment: 0,
          isLive:    true,
          source:    `Yutori Local · ${source.label}`,
        };
        if (source.platform === "web") allMedia.push({ ...entry, tier: 1, snippet: item.headline || "", topic: "News" });
        else allSocial.push(entry);
      });

      console.log(`[Yutori Local] ${source.label}: ${items.length} results`);

    } catch(e) {
      console.warn(`[Yutori Local] ${source.label} error:`, e.message);
    }
  }

  return { socialResults: allSocial, mediaResults: allMedia };
}

// ─── MAIN RUN ENGINE ─────────────────────────────────────────────────────────
async function runSearchForCompany(company, dateRangeId, onProgress, approvedOutlets) {
  const prog = msg => { if (onProgress) onProgress(msg); console.log("[run]", msg); };

  const range    = DATE_RANGES.find(r => r.id === dateRangeId) || DATE_RANGES[2];
  const fromDate = dateRangeFrom(range.days);
  const query    = company.boolean_query || `"${company.name}"`;

  const newsKey   = getKey("VITE_NEWSAPI_KEY",     "radical_apikey_newsapi");
  const yutoriKey = getKey("VITE_YUTORI_API_KEY",  "radical_apikey_yutori");
  const data365Key= getKey("VITE_DATA365_API_KEY",  "radical_apikey_data365");

  console.log("[run] Starting:", company.name, "| range:", range.label,
    "| newsKey:", newsKey ? "set" : "missing",
    "| yutoriKey:", yutoriKey ? "set" : "missing");

  let mediaResults  = [];
  let socialResults = [];
  let yutoriMode    = "none";

  // ── NewsAPI ────────────────────────────────────────────────────────────────
  if (newsKey) {
    prog("Searching news (NewsAPI)…");
    try {
      // Build domain filter for NewsAPI if outlets are configured
      const domains = approvedOutlets
        ? [...new Set(approvedOutlets.map(o => (o.domain || "").toLowerCase().trim()).filter(d => d && d.includes(".")))]
        : [];
      
      // User wants ALL news coverage — omit the domain filter from the API call to maximize recall
      // but keep the local filtering logic below for highlighting Tier 1/2 sources.
      // const domainFilter = domains.length > 0 ? `&domains=${domains.slice(0, 100).join(",")}` : "";
      
      const url = `http://localhost:3001/newsapi/v2/everything?q=${encodeURIComponent(query)}&from=${fromDate}&sortBy=relevancy&pageSize=100&language=en&apiKey=${newsKey}`;
      console.log("[NewsAPI] Fetching:", url.replace(newsKey, "REDACTED"));
      const res  = await fetch(url);
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); }
      catch(e) { console.warn("[NewsAPI] Non-JSON response — likely CORS block on free plan. Works on localhost."); data = {}; }
      if (data.status === "ok" && Array.isArray(data.articles)) {
        // Log raw results before filtering so we can debug
        console.log("[NewsAPI] Total results:", data.totalResults, "| Raw articles fetched:", data.articles.length,
          "| Sources:", data.articles.map(a => a.source?.name).join(", "));

        // Build outlet matching index — name + domain keywords
        const outletNames = approvedOutlets
          ? approvedOutlets.map(o => (o.name || "").toLowerCase().trim())
          : [];
        const outletDomains = approvedOutlets
          ? approvedOutlets.map(o => (o.domain || "").toLowerCase().trim()).filter(Boolean)
          : [];
        // Also extract domain keywords from outlet names for URL-based matching
        // e.g. "The Verge" → "verge", "TechCrunch" → "techcrunch"
        const outletKeywords = outletNames.map(n =>
          n.replace(/^the\s+/i, "").replace(/[^a-z0-9]/g, "")
        ).filter(k => k.length > 3);

        // Sites that produce tutorials/how-tos, not news — never show regardless of outlet list
        // Hard blocklist — junk domains that will never be approved outlets
        const BLOCKED_DOMAINS = [
          // Tutorial / how-to blogs
          "machinelearningmastery.com","towardsdatascience.com","analyticsvidhya.com",
          "kdnuggets.com","geeksforgeeks.org","freecodecamp.org","hackernoon.com",
          "dev.to","hashnode.com","kaggle.com","paperswithcode.com","arxiv.org",
          // Community / forum sites
          "reddit.com","quora.com","stackoverflow.com","stackexchange.com",
          "ycombinator.com","news.ycombinator.com",
          // Generic content farms / aggregators
          "medium.com","substack.com","ghost.io","wordpress.com","blogspot.com",
          "tumblr.com","weebly.com","wix.com",
          // Package registries / developer tools
          "pypi.org","npmjs.com","github.com","gitlab.com","bitbucket.org",
          // eCommerce / cloud vendor blogs (not news)
          "amazon.com","aws.amazon.com","azure.microsoft.com","cloud.google.com",
          // Non-English low-quality aggregators seen in results
          "cnblogs.com","habr.com","csdn.net","segmentfault.com","juejin.cn",
          "wwwhatsnew.com","xataka.com",
          // Video
          "youtube.com","youtu.be","vimeo.com","dailymotion.com",
        ];

        const isDomainBlocked = (url, name) => {
          const u = (url  || "").toLowerCase();
          const n = (name || "").toLowerCase();
          return BLOCKED_DOMAINS.some(d => u.includes(d) || n.includes(d.split(".")[0]));
        };

        const articleMatchesOutlet = (article) => {
          if (!article.title || article.title === "[Removed]") return false;
          const srcUrl  = (article.url || "").toLowerCase();
          const srcName = (article.source?.name || "").toLowerCase();
          // Hard block junk domains — no fallback
          if (isDomainBlocked(srcUrl, srcName)) return false;
          
          // User wants ALL news coverage now — if it's not explicitly blocked, we keep it.
          // We still prioritize/highlight matches from the approved outlet list in the UI,
          // but we no longer drop articles that aren't on the list.
          return true;
        };

        const finalArticles = data.articles.filter(articleMatchesOutlet);
        const droppedNames  = data.articles.filter(a => !articleMatchesOutlet(a)).map(a => a.source?.name).filter(Boolean);
        console.log("[NewsAPI] Raw:", data.articles.length, "→ Approved:", finalArticles.length,
          "| Sources kept:", finalArticles.map(a=>a.source?.name).join(", ") || "none",
          "| Blocked/unapproved:", droppedNames.join(", ") || "none");
        // Do NOT fall back to unapproved results — show empty state instead
        if (finalArticles.length === 0) {
          console.warn("[NewsAPI] No approved-outlet matches. Dropped sources:", droppedNames.join(", "), "— Add these to Admin → News Outlets if they are credible.");
        }

        // Build a lookup for outlet tier by name keywords
        const outletTierMap = {};
        if (approvedOutlets) {
          approvedOutlets.forEach(o => {
            const key = (o.name || "").toLowerCase().trim();
            outletTierMap[key] = o.tier || 2;
            // Also store without "the " prefix
            outletTierMap[key.replace(/^the\s+/, "")] = o.tier || 2;
          });
        }
        const getTier = (sourceName) => {
          const s = (sourceName || "").toLowerCase();
          // Direct name lookup
          if (outletTierMap[s]) return outletTierMap[s];
          // Partial match
          const match = Object.entries(outletTierMap).find(([k]) => s.includes(k) || k.includes(s));
          return match ? match[1] : 2;
        };

        mediaResults = finalArticles
          .slice(0, 10)
          .map((a, i) => ({
            id: `nm-${company.id}-${Date.now()}-${i}`,
            source:  a.source?.name || "Unknown",
            tier:    getTier(a.source?.name),
            title:   a.title || "(No title)",
            snippet: a.description || a.content?.slice(0, 200) || "",
            url:     a.url || "",
            date:   (a.publishedAt || "").slice(0, 10),
            sentiment: 0, topic: "News", isLive: true,
          }));
        console.log("[NewsAPI] Final articles:", mediaResults.length);
      } else if (data.status === "error") {
        console.warn("[NewsAPI] Error:", data.message);
        prog("NewsAPI: " + data.message);
      }
    } catch(e) {
      console.warn("[NewsAPI] Fetch error:", e.message);
    }
  }

  // ── Skip social/Yutori/Data365 if disabled ─────────────────────────────────
  const socialEnabled = (() => { try { return localStorage.getItem("radical_social_enabled") !== "false"; } catch { return true; } })();

  // ── Yutori — Scout first (fast), then try Research for supplemental ──────
  if (socialEnabled && yutoriKey) {
    // Step 1: Scout (uses cached/scheduled data — returns immediately)
    prog("Fetching Yutori Scout data…");
    try {
      const yScout = await yutoriScout(company, dateRangeId, yutoriKey);
      if (yScout && Array.isArray(yScout.socialResults) && yScout.socialResults.length > 0) {
        socialResults = yScout.socialResults;
        yutoriMode = "scout";
        console.log("[Yutori Scout] Got", socialResults.length, "social results");
      }
    } catch(e) {
      console.warn("[Yutori Scout] Failed:", e.message);
    }

    // Step 2: Research API (deep one-off search — can take 60–180s)
    // Run with a shorter timeout (60s) since Scout already has data
    prog("Running Yutori Research for additional coverage…");
    try {
      const yRes = await yutoriResearch(company, dateRangeId, yutoriKey, prog);
      if (yRes && Array.isArray(yRes.socialResults) && yRes.socialResults.length > 0) {
        // Merge with Scout results — dedupe by URL
        const existingSocialUrls = new Set(socialResults.map(s => s.url).filter(Boolean));
        const newSocial = yRes.socialResults.filter(s => !existingSocialUrls.has(s.url));
        socialResults = [...socialResults, ...newSocial];
        const existingMediaUrls = new Set(mediaResults.map(m => m.url).filter(Boolean));
        const extra = (yRes.newsFromYutori || []).filter(m => m.url && !existingMediaUrls.has(m.url));
        mediaResults = [...mediaResults, ...extra];
        yutoriMode = socialResults.length > (yRes.socialResults.length) ? "scout+research" : "research";
        console.log("[Yutori Research] Added", newSocial.length, "new social,", extra.length, "news");
      }
    } catch(e) {
      console.warn("[Yutori Research] Failed (using Scout data):", e.message.slice(0, 80));
      // Scout data is already in socialResults — this is not a fatal error
    }

    // ── Yutori Local (Browsing API) — logged-in sessions ─────────────────────
    // Runs only if useYutoriLocal flag is set (user has Yutori Local running)
    const useLocal = (() => { try { return localStorage.getItem("radical_yutori_local") === "true"; } catch { return false; } })();
    if (useLocal) {
      prog("Running Yutori Local — browsing Twitter, LinkedIn, and premium news…");
      try {
        const enabledSources = (() => {
          try { return JSON.parse(localStorage.getItem("radical_yutori_local_sources") || "null"); }
          catch { return null; }
        })();
        const localRes = await yutoriLocalBrowse(company, dateRangeId, yutoriKey, prog, enabledSources);
        if (localRes.socialResults?.length) {
          // Dedupe against existing social by URL
          const existingSocialUrls = new Set(socialResults.map(s => s.url));
          const newSocial = localRes.socialResults.filter(s => !existingSocialUrls.has(s.url));
          socialResults = [...socialResults, ...newSocial];
          console.log("[Yutori Local] Added", newSocial.length, "social results");
        }
        if (localRes.mediaResults?.length) {
          const existingMediaUrls = new Set(mediaResults.map(m => m.url));
          const newMedia = localRes.mediaResults.filter(m => !existingMediaUrls.has(m.url));
          mediaResults = [...mediaResults, ...newMedia];
          console.log("[Yutori Local] Added", newMedia.length, "media results from premium outlets");
        }
        if (localRes.socialResults?.length || localRes.mediaResults?.length) {
          yutoriMode = "research+local";
        }
      } catch(e) {
        console.warn("[Yutori Local] Error:", e.message);
        prog("Yutori Local error — continuing with cloud results");
      }
    }
  }

  // ── Data365 fallback ───────────────────────────────────────────────────────
  if (socialEnabled && data365Key && socialResults.length === 0) {
    prog("Fetching social mentions (Data365)…");
    try {
      const url = `http://localhost:3001/data365/v1.1/reddit/search/posts?query=${encodeURIComponent(query)}&limit=8&order_by=relevance&api_key=${data365Key}`;
      const res  = await fetch(url);
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { data = {}; }
      if (data.data?.items?.length) {
        socialResults = data.data.items.map((p, i) => ({
          id: `d365-${company.id}-${Date.now()}-${i}`,
          platform: "reddit", subreddit: p.subreddit ? `r/${p.subreddit}` : "Reddit",
          author: p.author || "u/anonymous",
          text: (p.title || p.selftext || "").slice(0, 500),
          likes: p.score || 0, comments: p.num_comments || 0,
          date: p.created_utc ? new Date(p.created_utc * 1000).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
          sentiment: 0, isLive: true, source: "Data365",
        })).filter(p => p.text);
      }
    } catch(e) { console.warn("[Data365]", e.message); }
  }

  // ── Sentiment scoring & Signal Extraction ──────────────────────────────────
  const allText = [...mediaResults.slice(0, 4), ...socialResults.slice(0, 4)]
    .map(r => r.title || r.text || "").filter(Boolean).join(". ");
  let sentimentScore = company.sentiment || 0;
  let extractedSignals = [];
  let keyDrivers = [];
  
  if (allText) {
    prog("Scoring sentiment and extracting signals…");
    try {
      const s = await callLLM(
        `Analyze the recent media and social coverage for ${company.name}.
         Coverage text: ${allText.slice(0, 3000)}
         
         Return a JSON object with:
         1. "score": A float from -1.0 (very negative) to +1.0 (very positive) reflecting the overall brand sentiment.
         2. "label": A short string describing the sentiment (e.g. "Positive", "Neutral", "Mixed").
         3. "key_drivers": An array of 1-3 short strings describing the main topics driving this sentiment.
         4. "business_signals": An array of objects with { "type": "Hiring|Funding|Product|Partnership|Risk", "summary": "short description" } extracted from the text.`,
        "You are a senior VC analyst and expert in brand sentiment and signal extraction. Return ONLY valid JSON, no markdown, no explanation."
      );
      if (typeof s?.score === "number") sentimentScore = s.score;
      if (Array.isArray(s?.business_signals)) extractedSignals = s.business_signals;
      if (Array.isArray(s?.key_drivers)) keyDrivers = s.key_drivers;
    } catch(e) { console.warn("[Sentiment]", e.message); }
  }

  const hasLiveData = mediaResults.length > 0 || socialResults.length > 0;
  if (!hasLiveData) {
    prog("No live data returned — check API keys in Admin → API Keys");
    // Return empty results — never show fake data
  }

  // Sort social by engagement — highest first
  socialResults.sort((a, b) => {
    const scoreA = (a.likes || 0) + (a.comments || 0) * 2;
    const scoreB = (b.likes || 0) + (b.comments || 0) * 2;
    return scoreB - scoreA;
  });
  // Sort media by tier (T1 first) then by date (newest first)
  mediaResults.sort((a, b) => {
    if (a.tier !== b.tier) return (a.tier || 3) - (b.tier || 3);
    return (b.date || "").localeCompare(a.date || "");
  });

  const result = {
    ranAt: new Date().toISOString(), dateRangeId, fromDate, query,
    mediaResults: mediaResults.slice(0, 8).map(m => ({...m, snippet:(m.snippet||"").slice(0,300)})),
    socialResults: socialResults.slice(0, 8).map(s => ({...s, text:(s.text||"").slice(0,400)})),
    sentimentScore, mediaCount: mediaResults.length, socialCount: socialResults.length,
    isLive: hasLiveData, provider: yutoriKey?"yutori":data365Key?"data365":"sample", yutoriMode,
    business_signals: extractedSignals, key_drivers: keyDrivers
  };

  console.log("[run] Complete:", company.name, "| media:", result.mediaCount, "| social:", result.socialCount, "| live:", result.isLive);
  return result;
}


// ─── RUN PANEL — shown inside company detail ──────────────────────────────────
function RunPanel({ company, onRunComplete, isCompact=false, outlets=[] }) {
  const [dateRange, setDateRange] = useState("30d");
  const [running,   setRunning]   = useState(false);
  const [progress,  setProgress]  = useState("");
  const lastRun = company.lastRun;

  const run = async () => {
    setRunning(true);
    setProgress("Starting…");
    // Quick proxy health check before running
    try {
      await fetch("http://localhost:3001/health");
    } catch {
      setProgress("⚠ Proxy not running — restart via START-MAC.command");
      setRunning(false);
      return;
    }
    try {
      const result = await runSearchForCompany(company, dateRange, msg => setProgress(msg), outlets);
      if (result && typeof result === "object") {
        onRunComplete(company.id, result);
        setProgress("Done — " + (result.mediaCount||0) + " news · " + (result.socialCount||0) + " social");
        setTimeout(() => setProgress(""), 3000);
      } else {
        setProgress("No results returned — check API keys in Admin");
      }
    } catch(e) {
      const msg = e?.message || String(e);
      setProgress("Error: " + msg.slice(0, 80));
      globalToast.show(msg, "error");
      console.error("Run failed for", company.name, ":", e);
    }
    setRunning(false);
  };

  const yutoriKey  = Boolean(localStorage.getItem("radical_apikey_yutori"));
  const newsapiKey = Boolean(localStorage.getItem("radical_apikey_newsapi"));
  const data365Key = Boolean(localStorage.getItem("radical_apikey_data365"));
  const socialProvider = yutoriKey ? "Yutori" : data365Key ? "Data365" : null;

  if (isCompact) return (
    <div style={{display:"flex",alignItems:"center",gap:7}}>
      <select value={dateRange} onChange={e=>setDateRange(e.target.value)}
        style={{padding:"4px 8px",background:"rgba(0,0,0,0.3)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:6,fontSize:10,color:"#f0f0f5",outline:"none",cursor:"pointer"}}>
        {DATE_RANGES.map(r=><option key={r.id} value={r.id}>{r.label}</option>)}
      </select>
      <button onClick={run} disabled={running} style={{padding:"4px 12px",borderRadius:6,border:"none",fontSize:10,fontWeight:700,cursor:running?"not-allowed":"pointer",background:running?"rgba(99,102,241,0.3)":"rgba(99,102,241,0.8)",color:"#fff",display:"flex",alignItems:"center",gap:5,whiteSpace:"nowrap"}}>
        {running?<><Spin/> {progress||"Running…"}</>:"▶ Run search"}
      </button>
      <div style={{display:"flex",gap:5,alignItems:"center",flexWrap:"wrap"}}>
        {yutoriKey  && <span style={{fontSize:8,padding:"1px 6px",borderRadius:8,background:"rgba(99,102,241,0.12)",color:"#818cf8",border:"1px solid rgba(99,102,241,0.2)"}}>🔍 Yutori</span>}
        {yutoriKey  && (() => {
          const localOn = localStorage.getItem("radical_yutori_local") === "true";
          return localOn
            ? <span style={{fontSize:8,padding:"1px 6px",borderRadius:8,background:"rgba(34,197,94,0.1)",color:"#4ade80",border:"1px solid rgba(34,197,94,0.2)"}}>💻 Local active</span>
            : null;
        })()}
        {!yutoriKey && data365Key && <span style={{fontSize:8,padding:"1px 6px",borderRadius:8,background:"rgba(59,130,246,0.1)",color:"#60a5fa",border:"1px solid rgba(59,130,246,0.2)"}}>📊 Data365</span>}
        {newsapiKey && <span style={{fontSize:8,padding:"1px 6px",borderRadius:8,background:"rgba(16,185,129,0.08)",color:"#34d399",border:"1px solid rgba(16,185,129,0.2)"}}>📰 NewsAPI</span>}
        {!newsapiKey && !yutoriKey && !data365Key && <span style={{fontSize:8,color:"#fbbf24",padding:"1px 6px",background:"rgba(245,158,11,0.08)",borderRadius:6,border:"1px solid rgba(245,158,11,0.15)"}}>⚠ Sample data only</span>}
      </div>
      {lastRun&&<span style={{fontSize:9,color:"rgba(255,255,255,0.2)"}}>Last: {lastRun.ranAt?.slice(0,10)} · {DATE_RANGES.find(r=>r.id===lastRun.dateRangeId)?.label||lastRun.dateRangeId} · {lastRun.provider==="yutori"?"Yutori":"Data365"}</span>}
    </div>
  );

  return (
    <div style={{padding:"16px",background:"rgba(99,102,241,0.04)",border:"1px solid rgba(99,102,241,0.15)",borderRadius:10,display:"flex",flexDirection:"column",gap:12}}>
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
        <div>
          <div style={{fontSize:12,fontWeight:700,color:"#f0f0f5",marginBottom:3}}>Run data search for {company.name}</div>
          <div style={{fontSize:10,color:"rgba(255,255,255,0.3)",fontFamily:"monospace"}}>{(company.boolean_query||"").slice(0,80)}{(company.boolean_query||"").length>80?"…":""}</div>
        </div>
        {lastRun&&(
          <div style={{fontSize:9,color:"rgba(255,255,255,0.25)",textAlign:"right",lineHeight:1.7}}>
            <div>Last run: {lastRun.ranAt?.slice(0,10)}</div>
            <div style={{color:lastRun.isLive?"#4ade80":"#fbbf24"}}>{lastRun.isLive?"● Live data":"● Sample data"}</div>
          </div>
        )}
      </div>
      <div>
        <div style={{fontSize:9,fontWeight:700,color:"rgba(255,255,255,0.25)",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:7}}>Date range</div>
        <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
          {DATE_RANGES.map(r=>(
            <button key={r.id} onClick={()=>setDateRange(r.id)} style={{
              padding:"5px 12px",borderRadius:20,fontSize:10,fontWeight:600,cursor:"pointer",
              border:`1px solid ${dateRange===r.id?"rgba(99,102,241,0.5)":"rgba(255,255,255,0.08)"}`,
              background:dateRange===r.id?"rgba(99,102,241,0.2)":"transparent",
              color:dateRange===r.id?"#818cf8":"rgba(255,255,255,0.3)"
            }}>{r.label}</button>
          ))}
        </div>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        <button onClick={run} disabled={running} style={{padding:"9px 22px",borderRadius:8,border:"none",fontSize:12,fontWeight:700,cursor:running?"not-allowed":"pointer",background:running?"rgba(99,102,241,0.3)":"rgba(99,102,241,0.85)",color:"#fff",display:"flex",alignItems:"center",gap:8}}>
          {running?<><Spin/> {progress}</>:`▶ Run — ${DATE_RANGES.find(r=>r.id===dateRange)?.label}`}
        </button>
      </div>
      {lastRun&&(
        <div style={{padding:"9px 12px",background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.05)",borderRadius:8,display:"flex",gap:18,flexWrap:"wrap"}}>
          <span style={{fontSize:10,color:"rgba(255,255,255,0.3)"}}>Previous run results:</span>
          <span style={{fontSize:10,color:"#60a5fa"}}>◉ {lastRun.mediaCount} media</span>
          <span style={{fontSize:10,color:"#818cf8"}}>◈ {lastRun.socialCount} social</span>
          <span style={{fontSize:10,color:lastRun.sentimentScore>0?"#4ade80":lastRun.sentimentScore<0?"#f87171":"#f59e0b"}}>● Sentiment {lastRun.sentimentScore>0?"+":""}{(lastRun.sentimentScore||0).toFixed(2)}</span>
          <span style={{fontSize:10,color:lastRun.isLive?"#4ade80":"rgba(245,158,11,0.7)"}}>{lastRun.isLive?"● Live":"● Sample"} · {DATE_RANGES.find(r=>r.id===lastRun.dateRangeId)?.label||lastRun.dateRangeId}</span>
        </div>
      )}
    </div>
  );
}

// ─── BULK RUN MODAL ───────────────────────────────────────────────────────────
function BulkRunModal({ companies, onRunComplete, onClose, outlets=[] }) {
  const [dateRange, setDateRange] = useState("30d");
  const [running,   setRunning]   = useState(false);
  const [done,      setDone]      = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [current,   setCurrent]   = useState(0);
  const [detail,    setDetail]    = useState("");
  const [results,   setResults]   = useState([]);
  const stopFlag = useState({v:false})[0];

  const active = companies.filter(c => c.monitoring_enabled !== false);
  const pct    = active.length > 0 ? Math.round((current / active.length) * 100) : 0;

  const runAll = async () => {
    // Check proxy is running before starting
    try { await fetch("http://localhost:3001/health"); }
    catch {
      setDetail("⚠ Proxy not running — close this, restart via START-MAC.command, then try again.");
      return;
    }
    setRunning(true); setDone(false); setCancelled(false);
    setCurrent(0); setResults([]); setDetail("");
    stopFlag.v = false;

    const log = [];
    for (let i = 0; i < active.length; i++) {
      if (stopFlag.v) { setCancelled(true); break; }
      const c = active[i];
      setCurrent(i + 1);
      setDetail("Searching " + c.name + "…");
      try {
        const result = await runSearchForCompany(c, dateRange, msg => setDetail(msg), outlets);
        onRunComplete(c.id, result);
        log.push({ name:c.name, ok:true, media:result.mediaCount, social:result.socialCount, live:result.isLive });
      } catch(e) {
        console.warn("Run failed for " + c.name + ":", e);
        log.push({ name:c.name, ok:false });
      }
      setResults([...log]);
      if (i < active.length - 1 && !stopFlag.v) {
        setDetail("Pausing between companies…");
        await new Promise(r => setTimeout(r, 1500));
      }
    }
    setRunning(false);
    if (!stopFlag.v) setDone(true);
    setDetail("");
  };

  const hasYutori = Boolean(localStorage.getItem("radical_apikey_yutori"));

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:3000,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div style={{background:"#0f0f1a",border:"1px solid rgba(99,102,241,0.3)",borderRadius:14,width:"100%",maxWidth:540,maxHeight:"85vh",display:"flex",flexDirection:"column",overflow:"hidden"}} onClick={e=>e.stopPropagation()}>

        {/* Header */}
        <div style={{padding:"20px 24px 14px",borderBottom:"1px solid rgba(255,255,255,0.06)",display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
          <div>
            <div style={{fontSize:15,fontWeight:800,color:"#f0f0f5",marginBottom:3}}>
              {done?"✓ Complete":cancelled?"Stopped":running?"Searching portfolio…":"Run portfolio search"}
            </div>
            <div style={{fontSize:10,color:"rgba(255,255,255,0.3)"}}>
              {active.length} active · {companies.filter(c=>c.monitoring_enabled===false).length} paused
            </div>
          </div>
          {!running && <button onClick={onClose} style={{background:"none",border:"none",color:"rgba(255,255,255,0.3)",cursor:"pointer",fontSize:22,lineHeight:1}}>×</button>}
        </div>

        {/* Body */}
        <div style={{flex:1,overflowY:"auto",padding:"16px 24px",display:"flex",flexDirection:"column",gap:14}}>

          {/* Date range picker — before run */}
          {!running && !done && !cancelled && (
            <div>
              <div style={{fontSize:9,fontWeight:700,color:"rgba(255,255,255,0.28)",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>Date range</div>
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                {DATE_RANGES.map(r=>(
                  <button key={r.id} onClick={()=>setDateRange(r.id)} style={{
                    padding:"6px 14px",borderRadius:20,fontSize:11,fontWeight:600,cursor:"pointer",
                    border:`1px solid ${dateRange===r.id?"rgba(99,102,241,0.5)":"rgba(255,255,255,0.08)"}`,
                    background:dateRange===r.id?"rgba(99,102,241,0.2)":"transparent",
                    color:dateRange===r.id?"#818cf8":"rgba(255,255,255,0.3)"
                  }}>{r.label}</button>
                ))}
              </div>
              {hasYutori && (
                <div style={{marginTop:10,padding:"9px 12px",background:"rgba(99,102,241,0.05)",border:"1px solid rgba(99,102,241,0.12)",borderRadius:8,fontSize:10,color:"rgba(255,255,255,0.3)",lineHeight:1.7}}>
                  🔍 Yutori active — ~$0.35/company · {active.length} companies ≈ <strong style={{color:"#818cf8"}}>${(active.length*0.35).toFixed(2)}</strong><br/>
                  ⏱ Each company takes 30–180s · full run ≈ <strong style={{color:"#fbbf24"}}>{Math.round(active.length * 1.5)} min</strong> · you can stop at any time
                </div>
              )}
            </div>
          )}

          {/* Progress bar — while running */}
          {running && (
            <div>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                <span style={{fontSize:12,fontWeight:600,color:"#f0f0f5"}}>{active[current-1]?.name || "Starting…"}</span>
                <span style={{fontSize:11,color:"rgba(255,255,255,0.4)"}}>{current}/{active.length} · {pct}%</span>
              </div>
              <div style={{height:8,background:"rgba(255,255,255,0.06)",borderRadius:4,marginBottom:8,overflow:"hidden"}}>
                <div style={{height:"100%",width:`${pct}%`,background:"linear-gradient(90deg,#4f46e5,#818cf8)",borderRadius:4,transition:"width 0.5s ease"}}/>
              </div>
              <div style={{fontSize:10,color:"rgba(99,102,241,0.7)",minHeight:16,display:"flex",alignItems:"center",gap:6}}>
                <Spin/> {detail}
              </div>
            </div>
          )}

          {/* Completion messages */}
          {done && <div style={{padding:"11px 14px",background:"rgba(34,197,94,0.08)",border:"1px solid rgba(34,197,94,0.2)",borderRadius:9,fontSize:12,color:"#4ade80",fontWeight:600}}>✓ All {results.filter(r=>r.ok).length}/{active.length} companies updated — results saved to browser.</div>}
          {cancelled && <div style={{padding:"11px 14px",background:"rgba(245,158,11,0.08)",border:"1px solid rgba(245,158,11,0.2)",borderRadius:9,fontSize:12,color:"#fbbf24",fontWeight:600}}>⏹ Stopped after {current} companies. Results so far are saved.</div>}

          {/* Live results log */}
          {results.length > 0 && (
            <div>
              <div style={{fontSize:9,fontWeight:700,color:"rgba(255,255,255,0.22)",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>Results</div>
              <div style={{display:"flex",flexDirection:"column",gap:3}}>
                {results.map((r,i)=>(
                  <div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 10px",background:r.ok?"rgba(34,197,94,0.04)":"rgba(239,68,68,0.04)",borderRadius:6,border:`1px solid ${r.ok?"rgba(34,197,94,0.1)":"rgba(239,68,68,0.1)"}`}}>
                    <span style={{fontSize:10,color:r.ok?"#4ade80":"#f87171"}}>{r.ok?"✓":"✗"}</span>
                    <span style={{fontSize:11,color:"rgba(255,255,255,0.65)",flex:1}}>{r.name}</span>
                    {r.ok && <span style={{fontSize:9,color:"rgba(255,255,255,0.25)"}}>{r.live?"● Live":"● Sample"} · {r.media} news · {r.social} social</span>}
                    {!r.ok && <span style={{fontSize:9,color:"#f87171"}}>failed</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{padding:"14px 24px",borderTop:"1px solid rgba(255,255,255,0.06)",display:"flex",gap:8}}>
          {!running && !done && !cancelled && <>
            <button onClick={runAll} style={{flex:1,padding:"10px",borderRadius:8,border:"none",fontSize:12,fontWeight:700,cursor:"pointer",background:"rgba(99,102,241,0.85)",color:"#fff"}}>▶ Run all {active.length} companies</button>
            <button onClick={onClose} style={{padding:"10px 16px",borderRadius:8,border:"1px solid rgba(255,255,255,0.1)",background:"transparent",color:"rgba(255,255,255,0.35)",cursor:"pointer",fontSize:12}}>Cancel</button>
          </>}
          {running && <button onClick={()=>{ stopFlag.v=true; }} style={{flex:1,padding:"10px",borderRadius:8,border:"1px solid rgba(239,68,68,0.3)",background:"rgba(239,68,68,0.08)",color:"#f87171",cursor:"pointer",fontSize:12,fontWeight:600}}>⏹ Stop after current company</button>}
          {(done||cancelled) && <button onClick={onClose} style={{flex:1,padding:"10px",borderRadius:8,border:"none",background:"rgba(99,102,241,0.7)",color:"#fff",cursor:"pointer",fontSize:12,fontWeight:700}}>Close</button>}
        </div>
      </div>
    </div>
  );
}

// ── localStorage persistence helpers ─────────────────────────────────────────
const LS_KEYS = { companies:"radical_companies", outlets:"radical_outlets", apiKeyVals:"radical_api_key_vals" };

function lsGet(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

function lsSet(key, value) {
  try {
    const serialised = JSON.stringify(value);
    // Warn if approaching 5MB total localStorage limit
    const totalSize = Object.keys(localStorage).reduce((sum, k) => sum + (localStorage.getItem(k)||"").length, 0);
    if (totalSize + serialised.length > 4_500_000) {
      console.warn("localStorage near 5MB limit. Run data will not be persisted. Use Admin → Export to back up your data.");
      // Still save config keys but skip large run data
      if (key === "radical_companies") {
        // Strip mediaResults/socialResults from companies to save space
        const slim = JSON.parse(serialised).map(c => {
          const { lastRun, ...rest } = c;
          return lastRun ? { ...rest, lastRun: { ...lastRun, mediaResults:[], socialResults:[] }} : rest;
        });
        localStorage.setItem(key, JSON.stringify(slim));
        return;
      }
    }
    localStorage.setItem(key, serialised);
  } catch(e) {
    console.warn("localStorage write failed:", e.message);
  }
}

export default function App() {
  // ── Persisted state — loads from localStorage on first mount ───────────────
  const [companies, setCompaniesRaw] = useState(() => lsGet(LS_KEYS.companies, INITIAL_COMPANIES));
  const [outlets,   setOutletsRaw]   = useState(() => lsGet(LS_KEYS.outlets,   DEFAULT_OUTLETS));
  const [socialEnabled, setSocialEnabledRaw] = useState(() => {
    try { return localStorage.getItem("radical_social_enabled") !== "false"; } catch { return true; }
  });

  const [showKeyBanner, setShowKeyBanner] = useState(() => {
    return !getLLMConfig();
  });
  const [apiKeys] = useState(INITIAL_API_KEYS);  // structure only; values persisted separately
  const [view,     setView]     = useState("command");
  const [showBulkRun, setShowBulkRun] = useState(false);
  const [selected, setSelected] = useState(null);
  const [lastSync, setLastSync] = useState(0);

  // ── Sync domain hints for existing outlets ────────────────────────────────
  useEffect(() => {
    const needsSync = outlets.some(o => !o.domain && DEFAULT_OUTLETS.find(d => d.name === o.name && d.domain));
    if (needsSync) {
      console.log("[App] Syncing domain hints for outlets...");
      const next = outlets.map(o => {
        const d = DEFAULT_OUTLETS.find(def => def.name === o.name);
        return (d && !o.domain) ? { ...o, domain: d.domain } : o;
      });
      setOutletsRaw(next);
      lsSet(LS_KEYS.outlets, next);
    }
  }, [outlets]);

  // ── One-time migration: Relax boolean queries ────────────────────────────
  useEffect(() => {
    const isRelaxed = localStorage.getItem("radical_bools_relaxed") === "v4";
    if (!isRelaxed) {
      console.log("[App] One-time migration (v4): Relaxing boolean queries and adding new companies...");
      const next = companies.map(c => {
        const relaxed = BOOLEAN_QUERIES[c.name];
        if (relaxed && c.boolean_query !== relaxed) {
          return { ...c, boolean_query: relaxed, boolean_approved: true };
        }
        return c;
      });
      // Check for missing companies and add them
      const existingNames = new Set(next.map(c => c.name));
      INITIAL_COMPANIES.forEach(ic => {
        if (!existingNames.has(ic.name)) {
          next.push(ic);
        }
      });
      setCompanies(next);
      localStorage.setItem("radical_bools_relaxed", "v4");
    }
  }, [companies]);
  const setCompanies = updated => {
    const next = typeof updated === "function" ? updated(companies) : updated;
    setCompaniesRaw(next);
    lsSet(LS_KEYS.companies, next);
  };
  const setOutlets = updated => {
    const next = typeof updated === "function" ? updated(outlets) : updated;
    setOutletsRaw(next);
    lsSet(LS_KEYS.outlets, next);
  };
  const setSocialEnabled = updated => {
    const next = typeof updated === "function" ? updated(socialEnabled) : updated;
    setSocialEnabledRaw(next);
    try { localStorage.setItem("radical_social_enabled", next); } catch(e) {}
  };

  const handleSelect = c => { setSelected(c); setView("detail"); };
  const handleBack   = ()  => { setSelected(null); setView("command"); };

  const handleAddCompany = c => setCompanies(cs => [...cs, c]);
  const handleUpdateCompany = updated => {
    if (Array.isArray(updated)) {
      setCompanies(updated);
    } else {
      setCompanies(cs => cs.map(c => c.id === updated.id ? updated : c));
      if (selected?.id === updated.id) setSelected(updated);
    }
  };
  const handleRemoveCompany = id => {
    setCompanies(cs => cs.filter(c => c.id !== id));
    if (selected?.id === id) { setSelected(null); setView("command"); }
  };

  // ── Run engine handler — saves results onto the company object ─────────────
  const handleRunComplete = (companyId, runResult) => {
    if (!runResult || typeof runResult !== "object") {
      console.warn("handleRunComplete: invalid result for company", companyId, runResult);
      return;
    }
    // Trim results before persisting — keep max 20 items, only display fields
    // This prevents hitting localStorage's ~5MB limit with large API responses
    const trimmedRun = {
      ...runResult,
      mediaResults: (runResult.mediaResults || []).slice(0, 20).map(m => ({
        id:m.id, source:m.source, tier:m.tier, title:m.title,
        snippet:m.snippet?.slice(0, 180), url:m.url, date:m.date,
        sentiment:m.sentiment, topic:m.topic, isLive:m.isLive,
      })),
      socialResults: (runResult.socialResults || []).slice(0, 20).map(s => ({
        id:s.id, platform:s.platform, subreddit:s.subreddit, author:s.author,
        text:s.text?.slice(0, 240), likes:s.likes, comments:s.comments,
        sentiment:s.sentiment, date:s.date, isLive:s.isLive,
      })),
    };

    setCompanies(cs => cs.map(c => {
      if (c.id !== companyId) return c;
      return {
        ...c,
        lastRun:      trimmedRun,
        sentiment:    trimmedRun.sentimentScore || c.sentiment,
        media_volume: trimmedRun.mediaCount     || c.media_volume,
        social_volume:trimmedRun.socialCount    || c.social_volume,
      };
    }));
    if (selected?.id === companyId) {
      setSelected(prev => ({
        ...prev,
        lastRun:      trimmedRun,
        sentiment:    trimmedRun.sentimentScore || prev.sentiment,
        media_volume: trimmedRun.mediaCount     || prev.media_volume,
        social_volume:trimmedRun.socialCount    || prev.social_volume,
      }));
    }
  };

  // ── Export full config as JSON ─────────────────────────────────────────────
  const handleExport = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      version: "1.0",
      companies,
      outlets,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `radical-config-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Import config from JSON file ───────────────────────────────────────────
  const handleImport = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const data = JSON.parse(ev.target.result);
        if (data.companies) { setCompanies(data.companies); setSelected(null); setView("command"); }
        if (data.outlets)   setOutlets(data.outlets);
        alert(`✓ Imported ${data.companies?.length || 0} companies and ${data.outlets?.length || 0} outlets from ${file.name}`);
      } catch {
        alert("Could not read file — make sure it's a Radical config JSON exported from this app.");
      }
    };
    reader.readAsText(file);
    e.target.value = ""; // reset so same file can be re-imported
  };

  // ── Reset to factory defaults ──────────────────────────────────────────────
  const handleReset = () => {
    if (!window.confirm("Reset all portfolio data to defaults? This cannot be undone.")) return;
    setCompanies(INITIAL_COMPANIES);
    setOutlets(DEFAULT_OUTLETS);
    setSelected(null);
    setView("command");
  };

  const alertCount=companies.flatMap(c=>computeSignals(c)).filter(s=>s.sev==="critical"||s.sev==="high").length;
  const pendingCount=companies.filter(c=>!c.boolean_approved).length;

  const navItems=[{id:"command",label:"Command Center",icon:"◈"},{id:"alerts",label:"Signals",icon:"◆",badge:alertCount},{id:"sov",label:"Share of Voice",icon:"◐"},{id:"admin",label:"Admin",icon:"⚙",badge:pendingCount}];

  // Catch any unhandled crash and show a friendly recovery screen
  const [crashed, setCrashed] = useState(false);
  const [crashMsg, setCrashMsg] = useState("");

  if (crashed) return (
    <div style={{minHeight:"100vh",background:"#07070f",display:"flex",alignItems:"center",justifyContent:"center",padding:40}}>
      <div style={{maxWidth:480,textAlign:"center"}}>
        <div style={{fontSize:32,marginBottom:16}}>⚠️</div>
        <div style={{fontSize:18,fontWeight:800,color:"#f0f0f5",marginBottom:8}}>Something went wrong</div>
        <div style={{fontSize:12,color:"rgba(255,255,255,0.4)",lineHeight:1.7,marginBottom:20}}>{crashMsg||"The app encountered an unexpected error."}</div>
        <button onClick={()=>{ setCrashed(false); setCrashMsg(""); }} style={{padding:"10px 24px",borderRadius:8,border:"none",background:"rgba(99,102,241,0.8)",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>
          Reload app
        </button>
        <div style={{marginTop:16,fontSize:10,color:"rgba(255,255,255,0.2)"}}>Your data is saved. Reloading will not delete anything.</div>
      </div>
    </div>
  );

  const [toastMsg, setToastMsg] = useState(null);
  useEffect(() => {
    const handleToast = (e) => {
      setToastMsg(e.detail);
      setTimeout(() => setToastMsg(null), 5000);
    };
    window.addEventListener("show-toast", handleToast);
    return () => window.removeEventListener("show-toast", handleToast);
  }, []);

  return (
    <>
      <Toast {...toastMsg} onClose={() => setToastMsg(null)} />
      {showKeyBanner && <KeyBanner onDismiss={() => setShowKeyBanner(false)}/>}
      <div style={{display:"flex",minHeight:"700px",fontFamily:"'DM Sans','Inter',system-ui,sans-serif",background:"linear-gradient(135deg, #090913 0%, #15152a 100%)",color:"#f0f0f5",marginTop: showKeyBanner ? 54 : 0}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;0,9..40,800;0,9..40,900&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        ::-webkit-scrollbar{width:4px;} ::-webkit-scrollbar-track{background:transparent;} ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.15);border-radius:2px;}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes slideIn{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}
        input::placeholder,textarea::placeholder{color:rgba(255,255,255,0.15);}
        select option{background:#10101c;color:#f0f0f5;}
        textarea{font-family:inherit;}
      `}</style>

      {/* Sidebar */}
      <div style={{width:200,background:"#05050d",borderRight:"1px solid rgba(255,255,255,0.05)",padding:"20px 10px",display:"flex",flexDirection:"column",flexShrink:0,position:"sticky",top:0,height:"100vh",overflowY:"auto"}}>
        <div style={{marginBottom:28,paddingLeft:6}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:2}}>
            <div style={{width:26,height:26,borderRadius:6,background:"linear-gradient(135deg,#4f46e5,#2563eb)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:900,color:"#fff",flexShrink:0}}>R</div>
            <span style={{fontSize:13,fontWeight:900,letterSpacing:"-0.03em",background:"linear-gradient(90deg,#818cf8,#60a5fa)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>Radical</span>
          </div>
          <div style={{fontSize:8,color:"rgba(255,255,255,0.15)",fontWeight:600,letterSpacing:"0.08em",textTransform:"uppercase",paddingLeft:34}}>Intelligence</div>
        </div>

        <div style={{fontSize:8,fontWeight:700,color:"rgba(255,255,255,0.18)",textTransform:"uppercase",letterSpacing:"0.1em",padding:"0 6px",marginBottom:5}}>Platform</div>
        {navItems.map(item=>{
          const active=view===item.id&&!selected;
          return (
            <button key={item.id} onClick={()=>{setView(item.id);setSelected(null);}} style={{display:"flex",alignItems:"center",gap:8,width:"100%",padding:"7px 8px",borderRadius:7,border:"none",cursor:"pointer",textAlign:"left",fontSize:11,fontWeight:600,marginBottom:1,background:active?"rgba(99,102,241,0.15)":"transparent",color:active?"#818cf8":"rgba(255,255,255,0.28)",transition:"all 0.1s"}}>
              <span style={{fontSize:12}}>{item.icon}</span>
              <span style={{flex:1}}>{item.label}</span>
              {item.badge>0&&<span style={{fontSize:8,fontWeight:800,background:"rgba(239,68,68,0.2)",color:"#f87171",padding:"1px 5px",borderRadius:7}}>{item.badge}</span>}
            </button>
          );
        })}

        <div style={{fontSize:8,fontWeight:700,color:"rgba(255,255,255,0.18)",textTransform:"uppercase",letterSpacing:"0.1em",padding:"0 6px",marginTop:18,marginBottom:5}}>Portfolio ({companies.length})</div>
        <div style={{flex:1,overflowY:"auto",marginRight:-4,paddingRight:4}}>
          {companies.map(c=>{
            const isActive=selected?.id===c.id;
            return (
              <button key={c.id} onClick={()=>handleSelect(c)} style={{display:"flex",alignItems:"center",gap:6,width:"100%",padding:"6px 8px",borderRadius:6,border:"none",cursor:"pointer",textAlign:"left",fontSize:10,fontWeight:isActive?700:500,marginBottom:1,background:isActive?"rgba(99,102,241,0.15)":"transparent",color:isActive?"#818cf8":"rgba(255,255,255,0.25)"}}>
                <Pip s={c.sentiment} sz={5}/>
                <span style={{flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.name}</span>
                {!c.boolean_approved&&<span style={{fontSize:7,color:"#fbbf24"}}>●</span>}
              </button>
            );
          })}
        </div>

        <div style={{paddingTop:12,borderTop:"1px solid rgba(255,255,255,0.05)",marginTop:8}}>
          <div style={{fontSize:8,color:"rgba(255,255,255,0.1)",lineHeight:1.6,padding:"0 2px"}}>
            {(() => {
              const cfg = getLLMConfig();
              const newsKey = localStorage.getItem("radical_apikey_newsapi");
              const yutoriKey = localStorage.getItem("radical_apikey_yutori");
              const anthropicKey = localStorage.getItem("radical_anthropic_key");
              const label = cfg?.provider === "cohere-north"
                ? (anthropicKey ? "Cohere North→Anthropic" : "Cohere North (IP blocked)")
                : cfg ? "Anthropic" : null;
              return (<>
                {cfg
                  ? <div style={{color:"rgba(34,197,94,0.5)"}}>✦ {label} active</div>
                  : <div style={{color:"rgba(245,158,11,0.4)"}}>✦ No LLM key — AI features off</div>
                }
                {newsKey
                  ? <div style={{color:"rgba(34,197,94,0.4)"}}>◉ NewsAPI active</div>
                  : <div style={{color:"rgba(255,255,255,0.15)"}}>◉ No NewsAPI key</div>
                }
                {yutoriKey
                  ? <div style={{color:"rgba(34,197,94,0.4)"}}>◈ Yutori active</div>
                  : <div style={{color:"rgba(255,255,255,0.15)"}}>◈ No Yutori key</div>
                }
              </>);
            })()}
            <div>🔒 {outlets.length} approved outlets</div>
            <div>◈ {companies.filter(c=>c.boolean_approved).length}/{companies.length} queries active</div>
          </div>
        </div>
      </div>

      {/* Main */}
      <div style={{flex:1,overflowY:"auto",minWidth:0}}>
        {selected&&view==="detail"
          ? <CompanyDetail company={selected} onBack={handleBack} onUpdateCompany={handleUpdateCompany} onRunComplete={handleRunComplete} outlets={outlets} socialEnabled={socialEnabled} />
          : view==="command" ? <CommandCenter companies={companies} onSelect={handleSelect} onAdd={handleAddCompany} onRunAll={()=>setShowBulkRun(true)} socialEnabled={socialEnabled} />
          : view==="alerts" ? <AlertsView companies={companies} onSelect={handleSelect}/>
          : view==="sov" ? <PortfolioSOV companies={companies}/>
          : view==="admin" ? <AdminView companies={companies} outlets={outlets} apiKeys={apiKeys} onUpdateCompany={handleUpdateCompany} onAddCompany={handleAddCompany} onRemoveCompany={handleRemoveCompany} onUpdateOutlets={setOutlets} onUpdateApiKeys={()=>{}} onExport={handleExport} onImport={handleImport} onReset={handleReset} socialEnabled={socialEnabled} onSocialToggle={setSocialEnabled} />
          : null
        }
      </div>
      {showBulkRun && (
        <BulkRunModal
          companies={companies}
          outlets={outlets}
          onRunComplete={handleRunComplete}
          onClose={()=>setShowBulkRun(false)}
        />
      )}
    </div>
    </>
  );
}