// Pour chaque station DKV proche de l'itinéraire, on tente de trouver son prix
// gasoil dans le jeu de données officiel du gouvernement (prix-carburants.gouv.fr)
// en cherchant une station à moins de 300m de la station DKV. Si le prix est trouvé,
// on peut trier les stations par prix et ne garder que les 3 moins chères.
// Si le prix est introuvable (station non référencée), la station apparaît quand même
// mais sans prix — mieux vaut l'afficher que la cacher.

import { readFileSync } from "fs";
import { join } from "path";

const DATASET = "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records";
const RADIUS_KM = 15;   // rayon de recherche autour de chaque arrêt de la tournée
const TOP_N = 3;        // nombre de stations à retourner
const PRICE_RADIUS = "0.3km"; // rayon pour associer une station DKV à un prix officiel

let dkvCache = null;
function loadDKV() {
  if (dkvCache) return dkvCache;
  try {
    const p = join(process.cwd(), "public", "dkv_stations.json");
    dkvCache = JSON.parse(readFileSync(p, "utf-8"));
  } catch { dkvCache = []; }
  return dkvCache;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371, dLat = (lat2 - lat1) * Math.PI / 180, dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// Stations DKV dans un rayon de RADIUS_KM autour d'un point GPS.
function nearbyDKV(lat, lon) {
  const db = loadDKV();
  return db
    .map(s => ({ ...s, dist: haversineKm(lat, lon, s.lat, s.lon) }))
    .filter(s => s.dist <= RADIUS_KM)
    .sort((a, b) => a.dist - b.dist);
}

// Prix gasoil officiel pour une station DKV donnée (recherche par coordonnées GPS).
async function fetchPriceForDKV(lat, lon) {
  try {
    const where = `gazole_prix is not null and distance(geom, geom'POINT(${lon} ${lat})', ${PRICE_RADIUS})`;
    const url = `${DATASET}?limit=1&where=${encodeURIComponent(where)}&order_by=gazole_prix%20asc`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const d = await r.json();
    const rec = d.results && d.results[0];
    return rec ? parseFloat(rec.gazole_prix) : null;
  } catch { return null; }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const waypoints = Array.isArray(req.body?.waypoints) ? req.body.waypoints.slice(0, 10) : [];

    // Collecter toutes les stations DKV proches de l'itinéraire, sans doublons.
    const seen = new Set();
    const candidates = [];
    for (const wp of waypoints) {
      if (!wp.lat || !wp.lon) continue;
      for (const s of nearbyDKV(wp.lat, wp.lon)) {
        const key = `${s.lat.toFixed(4)},${s.lon.toFixed(4)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push({ ...s, near_city: wp.ville });
      }
    }

    // Enrichir avec les prix en parallèle (limité à 10 stations pour rester rapide).
    const toPrice = candidates.slice(0, 15);
    const prices = await Promise.all(toPrice.map(s => fetchPriceForDKV(s.lat, s.lon)));
    const enriched = toPrice.map((s, i) => ({ ...s, gazole_prix: prices[i] }));

    // Trier : stations avec prix d'abord (du moins cher au plus cher), puis sans prix.
    enriched.sort((a, b) => {
      if (a.gazole_prix !== null && b.gazole_prix !== null) return a.gazole_prix - b.gazole_prix;
      if (a.gazole_prix !== null) return -1;
      if (b.gazole_prix !== null) return 1;
      return a.dist - b.dist;
    });

    const results = enriched.slice(0, TOP_N);
    return res.status(200).json({ results, total: results.length });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
