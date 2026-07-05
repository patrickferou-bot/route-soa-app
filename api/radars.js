// Proxy vers les données officielles des radars fixes français (data.gouv.fr).
// Le serveur Vercel télécharge et parse le CSV — pas de problème CORS côté téléphone.
// Résultat mis en cache 24h (les radars ne changent pas souvent).

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const CSV_URL = "https://static.data.gouv.fr/resources/liste-des-radars-fixes-en-france/20251230-134204/jeu-de-donnees-liste-des-radars-fixes-en-france-12-2025.csv";
    const r = await fetch(CSV_URL, { headers: { "User-Agent": "Vercel/RouteSOA" } });
    if (!r.ok) throw new Error("CSV " + r.status);
    const text = await r.text();
    const radars = [];
    const lines = text.split('\n').slice(1);
    for (const line of lines) {
      if (!line.trim()) continue;
      const p = line.split(';');
      if (p.length < 6) continue;
      const lat = parseFloat(p[4]), lon = parseFloat(p[5]);
      const vma = parseInt(p[3]) || 0;
      const type = (p[1] || '').trim();
      if (isNaN(lat) || isNaN(lon)) continue;
      if (lat < 41 || lat > 52 || lon < -6 || lon > 10) continue;
      radars.push([+lat.toFixed(4), +lon.toFixed(4), vma, type]);
    }
    res.setHeader("Cache-Control", "public, max-age=86400");
    return res.status(200).json({ radars, total: radars.length });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
