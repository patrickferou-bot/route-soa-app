// Enseignes retenues par l'équipe — le jeu de données officiel n'a pas de champ
// "marque" séparé, donc on filtre sur le nom de la station (qui contient toujours
// l'enseigne en pratique, ex: "INTERMARCHE GARLIN", "CARREFOUR MARKET").
const BRAND_PATTERNS = [
  /LECLERC/i,
  /CARREFOUR/i,
  /INTERMARCH/i,
  /\bTOTAL/i, // couvre TOTAL, TOTALENERGIES, TOTAL ACCESS
];
function matchesBrand(nom) {
  if (!nom) return false;
  return BRAND_PATTERNS.some((re) => re.test(nom));
}

const DATASET = "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records";

// Recherche dans un rayon de 5 km autour d'un point GPS (dépôt ou client), via la
// fonction distance() du langage de requête Opendatasoft (syntaxe v2.1).
async function fetchNearPoint(lat, lon) {
  const where = `gazole_prix is not null and distance(geom, geom'POINT(${lon} ${lat})', 5km)`;
  const url = `${DATASET}?limit=20&where=${encodeURIComponent(where)}&order_by=gazole_prix%20asc`;
  const r = await fetch(url);
  if (!r.ok) return [];
  const d = await r.json();
  return d.results || [];
}

// Solution de secours par département si la recherche par rayon ne renvoie rien
// (ex: champ géographique différent selon les évolutions du jeu de données).
async function fetchNearCity(cp) {
  const dep = cp ? cp.substring(0, 2) : "";
  let where = `gazole_prix is not null`;
  if (dep) where += ` AND cp like "${dep}%"`;
  const url = `${DATASET}?limit=20&where=${encodeURIComponent(where)}&order_by=gazole_prix%20asc`;
  const r = await fetch(url);
  if (!r.ok) return [];
  const d = await r.json();
  return d.results || [];
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const waypoints = Array.isArray(req.body?.waypoints) ? req.body.waypoints.slice(0, 8) : [];
    const cities = Array.isArray(req.body?.cities) ? req.body.cities : [];

    const allStations = [];
    const seenIds = new Set();
    function addResults(list, nearLabel) {
      for (const s of list) {
        if (matchesBrand(s.nom) && !seenIds.has(s.id)) {
          seenIds.add(s.id);
          allStations.push({ ...s, near_city: nearLabel || s.ville || "" });
        }
      }
    }

    if (waypoints.length) {
      for (const wp of waypoints) {
        if (!wp.lat || !wp.lon) continue;
        try {
          const results = await fetchNearPoint(wp.lat, wp.lon);
          addResults(results, wp.ville);
        } catch { /* on continue avec les autres points */ }
      }
    }

    // Pas de résultat par rayon (ou pas de coordonnées disponibles) : on retombe sur
    // une recherche par ville/département, plus large mais toujours filtrée par enseigne.
    if (!allStations.length && cities.length) {
      for (const city of cities.slice(0, 6)) {
        try {
          const results = await fetchNearCity(city.cp);
          addResults(results, city.ville);
        } catch { /* on continue avec les autres villes */ }
      }
    }

    // Toujours rien (pas de tournée chargée) : stations les moins chères des
    // départements habituels, toujours filtrées par enseigne.
    if (!allStations.length && !waypoints.length && !cities.length) {
      const url = `${DATASET}?limit=60&where=${encodeURIComponent("gazole_prix is not null")}&order_by=gazole_prix%20asc&refine=dep_name%3A%22Landes%22%20OR%20dep_name%3A%22Gers%22%20OR%20dep_name%3A%22Pyr%C3%A9n%C3%A9es-Atlantiques%22`;
      try {
        const r = await fetch(url);
        if (r.ok) { const d = await r.json(); addResults(d.results || []); }
      } catch { /* tant pis, liste vide */ }
    }

    // Tri global par prix gasoil croissant, on ne garde que les 3 stations les moins chères.
    allStations.sort((a, b) => parseFloat(a.gazole_prix || 99) - parseFloat(b.gazole_prix || 99));
    const top = allStations.slice(0, 3);

    return res.status(200).json({ results: top, total: top.length });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
