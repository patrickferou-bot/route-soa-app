// Proxy serveur vers l'API officielle Base Adresse Nationale (api-adresse.data.gouv.fr).
// Pourquoi un proxy plutôt qu'un appel direct depuis le téléphone : certains réseaux
// mobiles / navigateurs bloquent ou perturbent les appels cross-origin vers des domaines
// tiers, ce qui rendait le géocodage silencieusement inopérant pour certains chauffeurs.
// En passant par notre propre serveur (Vercel), l'appel devient serveur-à-serveur —
// aucune restriction CORS ne s'applique, et c'est plus rapide (un seul aller-retour
// téléphone↔serveur au lieu d'un par adresse).
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 60) : [];
    if (!items.length) return res.status(200).json({ results: {} });

    // Petite limite de concurrence pour rester correct vis-à-vis du service public,
    // tout en traitant une tournée complète (15-30 adresses) en une seule requête.
    const CONCURRENCY = 5;
    const results = {};
    let i = 0;
    async function worker() {
      while (i < items.length) {
        const item = items[i++];
        try {
          const q = encodeURIComponent(`${item.q || ""}`.trim());
          if (!q) { results[item.key] = null; continue; }
          const url = `https://api-adresse.data.gouv.fr/search/?q=${q}${item.cp ? `&postcode=${item.cp}` : ""}&limit=1`;
          const r = await fetch(url);
          if (!r.ok) { results[item.key] = null; continue; }
          const d = await r.json();
          const f = d.features && d.features[0];
          results[item.key] = f ? { lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] } : null;
        } catch {
          results[item.key] = null;
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));

    return res.status(200).json({ results });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
