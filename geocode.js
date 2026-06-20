// Proxy générique vers une base Redis REST (Vercel KV ou Upstash for Redis).
// Toutes les fonctionnalités "partagées entre chauffeurs" (flotte, points de repos,
// vis/soufflerie, numéro du manager) passent par ici plutôt que par window.storage,
// qui n'existe que dans l'environnement Claude.ai et ne fonctionne donc PAS en
// déploiement réel sur Vercel (c'était un bug silencieux : les chauffeurs ne se
// voyaient jamais entre eux, chacun retombait sur son propre stockage local).
//
// Configuration requise côté Vercel (Project Settings → Storage → ajouter
// "Upstash for Redis" ou "Vercel KV") : ça injecte automatiquement les variables
// d'environnement ci-dessous, aucune autre action n'est nécessaire.
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

async function redisPipeline(cmds) {
  const r = await fetch(`${KV_URL}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmds)
  });
  const data = await r.json();
  return data.map(d => d.result);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (!KV_URL || !KV_TOKEN) {
    return res.status(500).json({ error: "Base partagée non configurée (variables KV_REST_API_URL / KV_REST_API_TOKEN manquantes sur Vercel)." });
  }

  try {
    if (req.method === "GET") {
      const { key, keys, prefix } = req.query;

      if (prefix) {
        // Liste des clés correspondant au préfixe (utilisé pour les listes partagées,
        // ex: tous les points de repos). SCAN par paquets jusqu'à épuisement du curseur.
        let cursor = "0", found = [];
        do {
          const out = await redisCommand(["SCAN", cursor, "MATCH", `${prefix}*`, "COUNT", "200"]);
          cursor = out[0];
          found = found.concat(out[1]);
        } while (cursor !== "0" && found.length < 5000);
        if (!found.length) return res.status(200).json({ keys: [], values: {} });
        const vals = await redisCommand(["MGET", ...found]);
        const values = {};
        found.forEach((k, i) => { values[k] = vals[i] ?? null; });
        return res.status(200).json({ keys: found, values });
      }

      if (keys) {
        const list = keys.split(",").filter(Boolean);
        if (!list.length) return res.status(200).json({ values: {} });
        const result = await redisCommand(["MGET", ...list]);
        const values = {};
        list.forEach((k, i) => { values[k] = result[i] ?? null; });
        return res.status(200).json({ values });
      }

      if (!key) return res.status(400).json({ error: "key manquante" });
      const value = await redisCommand(["GET", key]);
      return res.status(200).json({ key, value: value ?? null });
    }

    if (req.method === "POST") {
      const { op, key, value, entries } = req.body || {};

      if (op === "mset" && Array.isArray(entries) && entries.length) {
        await redisPipeline(entries.map(e => ["SET", e.key, e.value]));
        return res.status(200).json({ ok: true });
      }
      if (!key) return res.status(400).json({ error: "key manquante" });
      if (op === "delete") {
        await redisCommand(["DEL", key]);
        return res.status(200).json({ ok: true });
      }
      await redisCommand(["SET", key, value]);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
