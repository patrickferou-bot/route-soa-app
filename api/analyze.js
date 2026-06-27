export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

// Format JJh MM -> minutes depuis minuit. Retourne null si non interprétable.
function toMinutes(t) {
  if (!t) return null;
  const m = String(t).match(/(\d{1,2})\s*h\s*(\d{0,2})/i);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2] || "0", 10);
}

// Une immatriculation française ressemble à "GF385TJ" (2 lettres, 3 chiffres, 2 lettres),
// parfois avec tirets. Le bloc PDF "Dépôt d'arrivée" contient ce type de valeur et est
// une source fréquente de confusion avec le vrai dépôt de chargement.
const PLATE_RE = /^[A-Z]{2}[-\s]?\d{3}[-\s]?[A-Z]{2}$/i;

// Filet de sécurité : convertit les virgules en points dans les coordonnées GPS
// (format français "44,9235199" → 44.9235199), et rejette toute valeur absurde.
// Indispensable car le PDF SOA utilise "Nord : 44,9235199 / Ouest : -0,7069264"
// et l'IA peut oublier de convertir la virgule.
function sanitizeCoords(result) {
  if (!result || !Array.isArray(result.tournees)) return;
  for (const t of result.tournees) {
    for (const l of t.livraisons || []) {
      for (const field of ['lat', 'lon']) {
        if (l[field] === null || l[field] === undefined) continue;
        // Convertir string avec virgule en float (format français "44,9235199")
        const raw = String(l[field]).replace(',', '.');
        const val = parseFloat(raw);
        if (isNaN(val)) { l[field] = null; continue; }
        // Rejeter les valeurs hors France métropolitaine
        if (field === 'lat' && (val < 41 || val > 52)) { l[field] = null; continue; }
        if (field === 'lon' && (val < -6 || val > 10)) { l[field] = null; continue; }
        // CRITIQUE : rejeter les coordonnées sans partie décimale significative.
        // Si l'IA a lu "44,9235199" et s'est arrêtée à la virgule, elle renvoie 44
        // (entier pur). Une coordonnée GPS réelle a TOUJOURS une partie décimale.
        // Sans ce filtre, lat=44 serait accepté comme valide (dans les bornes France)
        // alors qu'il pointe en pleine mer ou sur un point générique.
        if (Math.abs(val - Math.round(val)) < 0.001) { l[field] = null; continue; }
        l[field] = val;
      }
      // Si lat ou lon est nul après correction, on annule les deux — un seul des deux
      // sans l'autre est inutilisable et risque de déclencher un géocodage erroné.
      if (!l.lat || !l.lon) { l.lat = null; l.lon = null; }
    }
  }
}

// Filet de sécurité déterministe, indépendant du modèle : corrige les inversions
// départ/arrivée et les confusions dépôt/immatriculation que le prompt seul ne
// suffit pas toujours à éviter.
function sanitizeDepots(result) {
  if (!result || !Array.isArray(result.tournees)) return;

  if (result.depot_depart && PLATE_RE.test(result.depot_depart.trim())) {
    if (!result.camion) result.camion = result.depot_depart.trim();
    result.depot_depart = "";
  }

  for (const t of result.tournees) {
    // 1. Heure de départ doit précéder l'heure d'arrivée : sinon les deux blocs d'en-tête
    //    ont été inversés, on les échange.
    const dMin = toMinutes(t.depart), aMin = toMinutes(t.arrivee);
    if (dMin !== null && aMin !== null && dMin >= aMin) {
      const tmp = t.depart; t.depart = t.arrivee; t.arrivee = tmp;
    }

    // 2. Le site de chargement ne doit jamais être une immatriculation.
    if (t.site_chargement && PLATE_RE.test(t.site_chargement.trim())) {
      if (!result.camion) result.camion = t.site_chargement.trim();
      t.site_chargement = result.depot_depart || "";
    }

    // 3. Un dépôt intermédiaire identique au site de chargement n'a pas de sens.
    if (t.depot_intermediaire && t.site_chargement &&
        t.depot_intermediaire.trim().toUpperCase() === t.site_chargement.trim().toUpperCase()) {
      t.depot_intermediaire = "";
    }
  }
}

// Le client ne veut JAMAIS de numéro fixe pour le SMS/appel — uniquement un portable
// 06/07. Filet de sécurité indépendant du modèle, au cas où le prompt seul ne suffise pas.
const MOBILE_RE = /^0[67]\d{8}$/;
function sanitizePhones(result) {
  if (!result || !Array.isArray(result.tournees)) return;
  for (const t of result.tournees) {
    for (const l of t.livraisons || []) {
      if (l.phone) {
        const digits = String(l.phone).replace(/\D/g, "");
        l.phone = MOBILE_RE.test(digits) ? digits : "";
      }
    }
  }
}

function normClient(s) {
  return (s || "").toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Z0-9]/g, "");
}

// Filet de sécurité déterministe : quand un même client a plusieurs silos, le PDF ne
// répète pas toujours l'adresse sur chaque ligne. Si le modèle a quand même laissé un
// champ vide malgré l'instruction du prompt, on reporte l'adresse depuis une autre
// livraison du MÊME client dans la MÊME tournée — sans quoi le silo manquant ne peut
// jamais être localisé (ni dénivelé, ni ETA, ni Maps).
function sanitizeAddresses(result) {
  if (!result || !Array.isArray(result.tournees)) return;
  for (const t of result.tournees) {
    const byClient = {};
    for (const l of t.livraisons || []) {
      const k = normClient(l.client);
      if (!k) continue;
      if (!byClient[k]) byClient[k] = [];
      byClient[k].push(l);
    }
    for (const group of Object.values(byClient)) {
      if (group.length < 2) continue;
      const ref = group.find(l => l.adresse && l.ville);
      if (!ref) continue;
      for (const l of group) {
        if (!l.adresse) l.adresse = ref.adresse;
        if (!l.cp) l.cp = ref.cp;
        if (!l.ville) l.ville = ref.ville;
        // On ne recopie les coordonnées GPS que si ce silo n'en a aucune lui-même —
        // des silos différents du même client peuvent être à des emplacements légèrement
        // différents sur l'exploitation, donc on ne les écrase jamais s'ils existent déjà.
        if (!l.lat && !l.lon && ref.lat && ref.lon) { l.lat = ref.lat; l.lon = ref.lon; }
      }
    }
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { base64, conducteur } = req.body;
    if (!base64 || !conducteur) return res.status(400).json({ error: "Paramètres manquants" });
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Clé API manquante" });

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 3000,
        system: `Tu es un assistant logistique. Analyse ce bon de chargement PDF de Sud Ouest Aliment.
Extrait UNIQUEMENT les tournées du conducteur "${conducteur}" (insensible à la casse et aux accents).
Réponds UNIQUEMENT avec un JSON valide, sans markdown, sans texte avant ou après.

═══════════════════════════════════════════════════════════
ÉTAPE 1 — LIS D'ABORD LE TABLEAU "Résumé opérations de la tournée"
═══════════════════════════════════════════════════════════
Ce tableau est LA SOURCE DE VÉRITÉ ABSOLUE. Il liste dans l'ordre :
- La colonne "Ordre" → numéro de passage (1, 2, 3, 4, 5...)
- La colonne "Opération" → LIVRAISON ou CHARGEMENT
- Le nom du client ou du dépôt
- La localité et le code postal

LIS CE TABLEAU EN ENTIER AVANT DE REGARDER LE RESTE DU BON.
L'ordre des opérations dans ton JSON doit respecter EXACTEMENT les numéros de cette colonne "Ordre".

RÈGLE ANTI-DUPLICATION (CRITIQUE) : chaque client ne doit apparaître que dans UNE SEULE tournée — celle indiquée dans le résumé opérations. Si un client a plusieurs silos et que ses silos apparaissent visuellement sur la page au niveau d'une autre tournée, PEU IMPORTE : tous ses silos vont dans la tournée indiquée par le résumé. Ne JAMAIS dupliquer un client dans deux tournées différentes. Si un client est en ordre 5 de la Tournée 1, tous ses silos (SILO 1, SILO 2, SILO 3...) sont dans la Tournée 1, point final.

═══════════════════════════════════════════════════════════
ÉTAPE 2 — RÈGLES DE CONSTRUCTION DU JSON
═══════════════════════════════════════════════════════════

FORMAT JSON :
{
  "conducteur": "${conducteur}",
  "date": "JJ/MM/AAAA",
  "depot_depart": "POMAREZ",
  "camion": "GF385TJ",
  "tournees": [
    {
      "tour": 1,
      "km": 62,
      "depart": "06h15",
      "arrivee": "13h17",
      "site_chargement": "POMAREZ",
      "livraisons": [
        {
          "ordre": 1,
          "type": "LIVRAISON",
          "client": "NOM DU CLIENT",
          "adresse": "adresse complète",
          "cp": "40700",
          "ville": "VILLE",
          "lat": 43.6885,
          "lon": -0.5774,
          "silo_client": "SILO 1",
          "methode": "VIS",
          "total_kg": 7000,
          "phone": "0612345678",
          "commentaire": ""
        }
      ]
    }
  ]
}

RÈGLE 1 — CHARGEMENT INTERMÉDIAIRE :
Si le résumé contient une ligne "CHARGEMENT" (ex: ordre 4, CHARGEMENT, HAUT-MAUCO), crée une entrée dans livraisons avec :
- "ordre": 4  (le numéro exact du résumé)
- "type": "CHARGEMENT"
- "client": "HAUT-MAUCO"  (nom du dépôt)
- "ville": la localité indiquée
- "cp": le code postal indiqué
- lat/lon/silo_client/methode/phone/commentaire → null ou ""
NE JAMAIS ignorer les lignes CHARGEMENT du résumé.

RÈGLE 2 — CLIENT AVEC PLUSIEURS SILOS :
Si un client a plusieurs silos (SILO 1, SILO 2, SILO 3...), crée UNE ENTRÉE PAR SILO dans livraisons, toutes avec LE MÊME numéro d'ordre (celui du résumé). Exemple : client en ordre 2 avec 3 silos → 3 entrées avec "ordre": 2 chacune.
Pour chaque silo : remplis "adresse", "cp", "ville" identiquement (le PDF n'affiche l'adresse qu'une fois pour tous les silos).
Les coordonnées GPS peuvent différer par silo si le PDF les fournit séparément — sinon mets les mêmes pour tous.

RÈGLE 3 — COORDONNÉES GPS (PRIORITÉ ABSOLUE) :
Le bon affiche à droite de chaque client : "Coordonnées : Nord : 44,9235199 / Ouest : -0,7069264"
→ "Nord" = latitude. "Ouest" = longitude. La VIRGULE est le séparateur décimal français.
Convertis : "44,9235199" → 44.9235199  /  "-0,7069264" → -0.7069264
Extrais-les EXACTEMENT. Ne les invente jamais. Si absentes → null.

RÈGLE 4 — TÉLÉPHONE :
Priorité absolue aux portables 06/07. Format 10 chiffres sans espace. "" si absent ou uniquement fixe.

RÈGLE 5 — MÉTHODE DE DÉCHARGEMENT :
VIS (ou VIS SANS FIN, SEMI VIS) → "VIS". SOUFFLERIE (ou PNEUMATIQUE) → "SOUFFLERIE". Sinon "".

RÈGLE 6 — EN-TÊTE TOURNÉE :
- "depart" = heure la plus tôt. "arrivee" = heure la plus tardive. Vérifie que depart < arrivee.
- "site_chargement" = ville après "SITE DE CHARGEMENT :", jamais une immatriculation.
- "camion" = immatriculation (format GF385TJ).

Si aucune tournée pour "${conducteur}": {"conducteur":"${conducteur}","tournees":[],"erreur":"Aucune tournée trouvée"}`,
        messages: [{
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
            { type: "text", text: `Extrais les tournées de ${conducteur} avec les coordonnées GPS et numéros de silos. JSON uniquement.` }
          ]
        }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(500).json({ error: "Erreur Claude API: " + response.status + " - " + errText.substring(0, 200) });
    }

    const data = await response.json();
    const text = data.content.map(i => i.text || "").join("");
    const clean = text.replace(/```json|```/g, "").trim();
    let result;
    try { result = JSON.parse(clean); }
    catch(e) { return res.status(500).json({ error: "Réponse invalide: " + clean.substring(0, 100) }); }

    sanitizeCoords(result);
    sanitizeDepots(result);
    sanitizePhones(result);
    sanitizeAddresses(result);
    return res.status(200).json(result);

  } catch (e) {
    return res.status(500).json({ error: "Erreur serveur: " + e.message });
  }
}
