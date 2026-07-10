// Service EPA (éco-conduite) — filtre STRICTEMENT côté serveur par chauffeur.
// Contrairement à un fichier JSON public, ces données ne quittent jamais le serveur
// pour les autres chauffeurs : seul le nom demandé reçoit une réponse, les scores
// des collègues ne transitent jamais vers un téléphone qui n'est pas le leur.

// Données extraites des rapports EPA fournis (POMAREZ). À compléter mois par mois
// au fil des nouveaux rapports — ajouter simplement une nouvelle clé "AAAA-MM".
const EPA_DATA = {
  "2026-02": {
    label: "Février 2026",
    fleet: { score: 6.4, distance: 42028, conso: 38.18, sessions: 21 },
    drivers: {
      "CLAISSE JOSE":            { distance: 6687, conso: 36.86, sessions: 18, score: 9.24, stationnaire: 10.00, roue_libre: 9.27, exces_vitesse: 9.31, freinages: 7.12, decelerations: 10.00, accelerations: 10.00 },
      "MONCAUT SONIA":           { distance: 103,  conso: 27.08, sessions: 10, score: 8.21, stationnaire: 5.24,  roue_libre: 10.00, exces_vitesse: 8.47, freinages: 5.60, decelerations: 7.18,  accelerations: 10.00 },
      "LAGUILHON MAGENDIE PHILIPPE": { distance: 2700, conso: 38.88, sessions: 8, score: 7.20, stationnaire: 3.20, roue_libre: 8.40, exces_vitesse: 8.47, freinages: 5.42, decelerations: 7.29, accelerations: 8.72 },
      "GARESTE CHRISTOPHE":      { distance: 2132, conso: 35.54, sessions: 6,  score: 7.20, stationnaire: 4.26,  roue_libre: 8.65, exces_vitesse: 8.09, freinages: 2.63, decelerations: 7.76,  accelerations: 10.00 },
      "FEROU PATRICK":           { distance: 4925, conso: 36.21, sessions: 13, score: 6.90, stationnaire: 7.44,  roue_libre: 7.67, exces_vitesse: 3.13, freinages: 3.59, decelerations: 10.00, accelerations: 10.00 },
      "DEGERT ISABELLE":         { distance: 5665, conso: 37.91, sessions: 16, score: 6.78, stationnaire: 4.58,  roue_libre: 9.55, exces_vitesse: 5.31, freinages: 7.99, decelerations: 4.14,  accelerations: 9.50 },
      "GAYAN SEBASTIEN":         { distance: 2741, conso: 40.24, sessions: 10, score: 6.40, stationnaire: 2.70,  roue_libre: 9.74, exces_vitesse: 9.30, freinages: 1.50, decelerations: 3.50,  accelerations: 9.85 },
      "RICAU CHRISTOPHE":        { distance: 0,    conso: 200.00, sessions: 1, score: 6.00, stationnaire: 0.00, roue_libre: 0.00, exces_vitesse: 10.00, freinages: 0.00, decelerations: 10.00, accelerations: 10.00 },
      "RAMAT JULIEN":            { distance: 4058, conso: 45.71, sessions: 14, score: 5.35, stationnaire: 3.42,  roue_libre: 9.53, exces_vitesse: 6.97, freinages: 0.94, decelerations: 1.73,  accelerations: 8.21 },
      "MAUVY MICHEL":            { distance: 5349, conso: 39.55, sessions: 17, score: 4.88, stationnaire: 1.32,  roue_libre: 4.92, exces_vitesse: 3.43, freinages: 0.78, decelerations: 8.62,  accelerations: 8.74 },
      "GRUEL PIERRE":            { distance: 7306, conso: 35.42, sessions: 20, score: 4.66, stationnaire: 6.39,  roue_libre: 6.22, exces_vitesse: 6.99, freinages: 1.65, decelerations: 0.14,  accelerations: 8.66 }
    }
  },
  "2026-04": {
    label: "Avril 2026",
    fleet: { score: 6.4, distance: 72588, conso: 37.69, sessions: 21 },
    drivers: {
      "MONCAUT SONIA":           { distance: 5093, conso: 35.85, sessions: 18, score: 8.45, stationnaire: 7.66, roue_libre: 8.90, exces_vitesse: 9.22, freinages: 8.61, decelerations: 7.03, accelerations: 9.52 },
      "CLAISSE JOSE":            { distance: 4136, conso: 39.98, sessions: 12, score: 8.13, stationnaire: 7.73, roue_libre: 9.45, exces_vitesse: 8.94, freinages: 7.69, decelerations: 5.94, accelerations: 9.26 },
      "LAGUILHON MAGENDIE PHILIPPE": { distance: 4195, conso: 38.31, sessions: 13, score: 8.03, stationnaire: 2.53, roue_libre: 9.63, exces_vitesse: 8.79, freinages: 6.17, decelerations: 8.90, accelerations: 9.69 },
      "GAYAN SEBASTIEN":         { distance: 3914, conso: 32.08, sessions: 16, score: 8.01, stationnaire: 8.58, roue_libre: 10.00, exces_vitesse: 8.80, freinages: 6.40, decelerations: 5.07, accelerations: 9.95 },
      "OGNJANOVIC CYRIL":        { distance: 6093, conso: 38.62, sessions: 18, score: 7.59, stationnaire: 3.69, roue_libre: 10.00, exces_vitesse: 8.54, freinages: 8.86, decelerations: 4.13, accelerations: 9.85 },
      "DUFOURG THIERRY":         { distance: 4722, conso: 37.38, sessions: 17, score: 7.23, stationnaire: 2.05, roue_libre: 10.00, exces_vitesse: 9.67, freinages: 8.14, decelerations: 4.34, accelerations: 7.47 },
      "FEROU PATRICK":           { distance: 6103, conso: 33.99, sessions: 16, score: 7.14, stationnaire: 5.41, roue_libre: 7.94, exces_vitesse: 4.81, freinages: 4.22, decelerations: 10.00, accelerations: 10.00 },
      "DEGERT ISABELLE":         { distance: 5237, conso: 36.17, sessions: 16, score: 5.67, stationnaire: 3.78, roue_libre: 9.54, exces_vitesse: 4.67, freinages: 6.07, decelerations: 1.47, accelerations: 9.55 },
      "GARESTE CHRISTOPHE":      { distance: 4794, conso: 40.64, sessions: 15, score: 5.49, stationnaire: 2.24, roue_libre: 9.19, exces_vitesse: 5.34, freinages: 4.09, decelerations: 3.17, accelerations: 8.13 },
      "RAMAT JULIEN":            { distance: 6051, conso: 40.11, sessions: 21, score: 5.27, stationnaire: 6.22, roue_libre: 10.00, exces_vitesse: 5.51, freinages: 1.64, decelerations: 0.72, accelerations: 7.41 },
      "GRUEL PIERRE":            { distance: 8625, conso: 34.62, sessions: 20, score: 5.21, stationnaire: 9.26, roue_libre: 7.40, exces_vitesse: 5.44, freinages: 1.78, decelerations: 0.00, accelerations: 9.34 },
      "MAUVY MICHEL":            { distance: 4481, conso: 46.05, sessions: 15, score: 4.63, stationnaire: 0.79, roue_libre: 6.79, exces_vitesse: 3.69, freinages: 0.82, decelerations: 5.99, accelerations: 8.46 },
      "RICAU CHRISTOPHE":        { distance: 4847, conso: 41.29, sessions: 16, score: 4.60, stationnaire: 0.02, roue_libre: 9.50, exces_vitesse: 6.08, freinages: 3.52, decelerations: 0.00, accelerations: 7.77 }
    }
  }
};

function normName(s) {
  return (s || "").toUpperCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z ]/g, " ").replace(/\s+/g, " ").trim();
}

// Comparaison par ENSEMBLE de mots — insensible à l'ordre (l'app utilise "PATRICK
// FEROU", les rapports EPA utilisent "FEROU PATRICK") et tolère un mot manquant
// (second prénom, tiret manquant...).
function nameMatches(a, b) {
  const wa = new Set(normName(a).split(" ").filter(w => w.length > 1));
  const wb = new Set(normName(b).split(" ").filter(w => w.length > 1));
  if (!wa.size || !wb.size) return false;
  let common = 0;
  for (const w of wa) if (wb.has(w)) common++;
  return common >= Math.min(wa.size, wb.size) - (Math.min(wa.size, wb.size) > 1 ? 1 : 0);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const driverName = (req.query?.driver || req.body?.driver || "").trim();
    if (!driverName) return res.status(400).json({ error: "Paramètre 'driver' requis" });

    const months = Object.keys(EPA_DATA).sort();
    const result = {};
    for (const m of months) {
      const monthData = EPA_DATA[m];
      const foundKey = Object.keys(monthData.drivers).find(k => nameMatches(k, driverName));
      if (foundKey) {
        result[m] = { label: monthData.label, fleet: monthData.fleet, driver: monthData.drivers[foundKey] };
      }
    }

    if (!Object.keys(result).length) {
      return res.status(200).json({ months: {}, found: false });
    }

    // Moyenne du chauffeur sur tous les mois disponibles pour lui.
    const keys = ["score","stationnaire","roue_libre","exces_vitesse","freinages","decelerations","accelerations","conso"];
    const avg = {};
    const vals = Object.values(result);
    keys.forEach(k => { avg[k] = +(vals.reduce((s,v)=>s+v.driver[k],0) / vals.length).toFixed(2); });

    return res.status(200).json({ months: result, average: avg, found: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
