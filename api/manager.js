// Service manager — vue d'ensemble de la flotte, protégée par un code d'accès.
// Réutilise le même stockage partagé (Upstash Redis) que l'app chauffeur : aucune
// nouvelle donnée à synchroniser, on lit simplement les clés fleet:*/progress:*
// déjà écrites par l'app pendant la journée.

const MANAGER_PIN = "2026"; // à changer ici si besoin — visible seulement côté serveur

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

async function redisCommand(cmd) {
  const r = await fetch(KV_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd)
  });
  const data = await r.json();
  if (data.error) throw new Error(data.error);
  return data.result;
}

const DRIVERS = [
  { display: "Patrick F",   fullname: "PATRICK FEROU",      color: "#FF6B00" },
  { display: "Christophe G",fullname: "CHRISTOPHE GARESTE", color: "#16A34A" },
  { display: "Christophe R",fullname: "CHRISTOPHE RICAU",   color: "#2563EB" },
  { display: "Pierre G",    fullname: "PIERRE GRUEL",       color: "#DC2626" },
  { display: "Isabelle D",  fullname: "ISABELLE DEGERT",    color: "#7C3AED" },
  { display: "Sonia M",     fullname: "SONIA MONCAUT",      color: "#D97706" },
  { display: "Philippe L",  fullname: "PHILIPPE LAGUILHON", color: "#0891B2" },
  { display: "José C",      fullname: "JOSE CLAISSE",       color: "#DB2777" },
  { display: "Thierry D",   fullname: "THIERRY DUFOURG",    color: "#059669" },
  { display: "Sébastien G", fullname: "SEBASTIEN GAYAN",    color: "#84CC16" },
  { display: "Michel M",    fullname: "MICHEL MAUVY",       color: "#EA580C" },
  { display: "Cyril O",     fullname: "CYRIL OGNJANOVIC",   color: "#6366F1" },
  { display: "Julien R",    fullname: "JULIEN RAMAT",       color: "#10B981" },
  { display: "Reynald D",   fullname: "REYNALD DAUGREILH",  color: "#0284C7" },
];

// Référence conso (L/100km) — pour comparer la conso du jour à la référence du
// chauffeur. Indicatif uniquement, pas un calcul de rentabilité comptable réel :
// l'app n'a accès ni au prix de vente des tournées, ni au coût salarial/véhicule.
const DRIVER_CONSO_REF = {
  "PATRICK FEROU":33.95,"CHRISTOPHE GARESTE":41.02,"CHRISTOPHE RICAU":42.31,
  "PIERRE GRUEL":35.68,"ISABELLE DEGERT":37.07,"SONIA MONCAUT":37.50,
  "PHILIPPE LAGUILHON":38.05,"JOSE CLAISSE":37.08,"THIERRY DUFOURG":36.96,
  "SEBASTIEN GAYAN":34.13,"MICHEL MAUVY":43.44,"CYRIL OGNJANOVIC":38.73,"JULIEN RAMAT":41.94
};
const DIESEL_PRICE_EUR_L = 1.65; // estimation, ajuster si besoin

// Mêmes données que api/epa.js — dupliquées volontairement (deux fonctions Vercel
// indépendantes). Penser à mettre à jour les DEUX fichiers avec chaque nouveau
// rapport EPA reçu.
const EPA_DATA = {
  "2026-02": { label: "Février 2026", drivers: {
    "CLAISSE JOSE":9.24,"MONCAUT SONIA":8.21,"LAGUILHON MAGENDIE PHILIPPE":7.20,"GARESTE CHRISTOPHE":7.20,
    "FEROU PATRICK":6.90,"DEGERT ISABELLE":6.78,"GAYAN SEBASTIEN":6.40,"RICAU CHRISTOPHE":6.00,
    "RAMAT JULIEN":5.35,"MAUVY MICHEL":4.88,"GRUEL PIERRE":4.66
  }},
  "2026-04": { label: "Avril 2026", drivers: {
    "MONCAUT SONIA":8.45,"CLAISSE JOSE":8.13,"LAGUILHON MAGENDIE PHILIPPE":8.03,"GAYAN SEBASTIEN":8.01,
    "OGNJANOVIC CYRIL":7.59,"DUFOURG THIERRY":7.23,"FEROU PATRICK":7.14,"DEGERT ISABELLE":5.67,
    "GARESTE CHRISTOPHE":5.49,"RAMAT JULIEN":5.27,"GRUEL PIERRE":5.21,"MAUVY MICHEL":4.63,"RICAU CHRISTOPHE":4.60
  }}
};
function normName(s){return(s||"").toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^A-Z ]/g," ").replace(/\s+/g," ").trim();}
function epaScoreFor(fullname){
  const months=Object.keys(EPA_DATA).sort();
  const last=months[months.length-1];
  const target=normName(fullname);
  const key=Object.keys(EPA_DATA[last].drivers).find(k=>{
    const wa=new Set(normName(k).split(" ")),wb=new Set(target.split(" "));
    let common=0;for(const w of wa)if(wb.has(w))common++;
    return common>=Math.min(wa.size,wb.size)-1;
  });
  return key?{score:EPA_DATA[last].drivers[key],month:EPA_DATA[last].label}:null;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  const pin = (req.query?.pin || req.body?.pin || "").trim();
  if (pin !== MANAGER_PIN) return res.status(401).json({ error: "Code incorrect" });

  if (!KV_URL || !KV_TOKEN) {
    return res.status(500).json({ error: "Base partagée non configurée." });
  }

  try {
    const fleetKeys = DRIVERS.map(d => "fleet:" + d.fullname);
    const progressKeys = DRIVERS.map(d => "progress:" + d.fullname);
    const [fleetVals, progressVals] = await Promise.all([
      redisCommand(["MGET", ...fleetKeys]),
      redisCommand(["MGET", ...progressKeys]),
    ]);

    const today = new Date().toLocaleDateString("fr-FR");
    const now = Date.now();
    const result = DRIVERS.map((d, i) => {
      let fleet = null, progress = null;
      try { fleet = fleetVals[i] ? JSON.parse(fleetVals[i]) : null; } catch {}
      try { progress = progressVals[i] ? JSON.parse(progressVals[i]) : null; } catch {}

      const hasToday = progress && progress.date === today && progress.total > 0;
      const consoRef = DRIVER_CONSO_REF[d.fullname] || null;
      const epa = epaScoreFor(d.fullname);

      return {
        display: d.display,
        fullname: d.fullname,
        color: d.color,
        status: fleet?.status || null,
        depot: fleet?.depot || null,
        truck: fleet?.truck || null,
        last_update_min_ago: fleet?.time ? Math.round((now - fleet.time) / 60000) : null,
        today: hasToday ? { done: progress.done, total: progress.total, remaining: progress.total - progress.done } : null,
        conso_ref: consoRef,
        diesel_price: DIESEL_PRICE_EUR_L,
        epa: epa,
      };
    });

    const activeToday = result.filter(r => r.today);
    const summary = {
      date: today,
      drivers_active_today: activeToday.length,
      deliveries_done: activeToday.reduce((s, r) => s + r.today.done, 0),
      deliveries_remaining: activeToday.reduce((s, r) => s + r.today.remaining, 0),
      avg_epa: (() => {
        const scores = result.map(r => r.epa?.score).filter(s => s != null);
        return scores.length ? +(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2) : null;
      })(),
    };

    return res.status(200).json({ generated_at: now, summary, drivers: result });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
