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
        max_tokens: 2500,
        system: `Tu es un assistant logistique. Analyse ce bon de chargement PDF de Sud Ouest Aliment.
Extrait UNIQUEMENT les tournées du conducteur "${conducteur}" (insensible à la casse et aux accents).
Réponds UNIQUEMENT avec un JSON valide, sans markdown, sans texte avant ou après.

Format EXACT (respecte tous les champs) :
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
      "arrivee": "08h48",
      "site_chargement": "POMAREZ",
      "depot_intermediaire": "BAIGTS DE BEARN",
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
          "commentaire": "texte ou vide",
          "horaire": "journée"
        }
      ]
    }
  ]
}

CHAMPS NOUVEAUX À EXTRAIRE :
- "type" : "LIVRAISON" par défaut. Si la ligne contient les mots REPRISE, RETOUR, ENLÈVEMENT ou COLLECT → mettre "REPRISE".
- "methode" : cherche dans la ligne du client ou la colonne "Silo" / "Mode déchargement" les mots VIS, VIS SANS FIN, SOUFFLERIE, SOUFFLAGE, PNEUMATIQUE. Mettre "VIS", "SOUFFLERIE" ou "" si rien trouvé.
- "phone" : numéro de téléphone du CLIENT s'il est présent dans le bon (souvent sur la ligne du client ou en note/remarque). Si PLUSIEURS numéros apparaissent pour ce client (fixe + portable), donne TOUJOURS la priorité à un numéro de PORTABLE commençant par 06 ou 07 plutôt qu'un fixe (01-05/09). Format : 10 chiffres sans espace ni tiret ni point (ex: "0612345678"). Laisser "" si aucun numéro de portable n'est trouvé, même si un fixe existe.
- Ne pas inclure le champ "produits" — inutile.

CLIENT AVEC PLUSIEURS SILOS (IMPORTANT) : quand un même client a plusieurs silos à livrer (ex: SILO 1, SILO 2, SILO 3...), le PDF n'imprime SOUVENT l'adresse complète (rue, code postal, ville) qu'UNE SEULE FOIS, au-dessus de la liste des silos — les lignes suivantes ne montrent parfois que le numéro de silo, sans répéter l'adresse. Dans ce cas, tu DOIS quand même remplir "adresse", "cp" et "ville" IDENTIQUEMENT sur CHAQUE silo de ce client (recopie la même adresse sur toutes ses lignes) — ne laisse JAMAIS ces champs vides sous prétexte que le PDF ne les répète pas visuellement. Chaque livraison du JSON doit être autonome, avec sa propre adresse complète, même si plusieurs livraisons partagent la même adresse.

RÈGLES IMPORTANTES SUR LE BLOC ENTÊTE (CRITIQUE) :
- Le bloc "Dépôt de départ" : ligne du HAUT = nom du site de chargement réel (POMAREZ, HAUT-MAUCO...), ligne du BAS = date+heure de DÉPART (la plus tôt).
- Le bloc "Dépôt d'arrivée" contient l'immatriculation du camion — PAS une ville, PAS un horaire de retour.
- "depart" = l'heure la PLUS TÔT dans l'en-tête. "arrivee" = l'heure la PLUS TARDIVE.
- "site_chargement" = ville juste après "SITE DE CHARGEMENT :", jamais une immatriculation.
- "camion" = immatriculation (format GF385TJ).
- "depot_intermediaire" = dépôt de chargement intermédiaire AVANT les livraisons (ex: BAIGTS DE BEARN, HAUT-MAUCO). "" si absent.

AUTO-VÉRIFICATION AVANT DE RÉPONDRE (pour CHAQUE tournée) :
1. "depart" doit être STRICTEMENT inférieur à "arrivee" en minutes. Sinon échange-les.
2. "site_chargement" ne doit jamais ressembler à une immatriculation (2L-3chiffres-2L). Si oui → mets l'immatriculation dans "camion" et utilise le vrai nom de ville.
3. "depot_intermediaire" ne doit pas être identique à "site_chargement" → mettre "" si c'est le cas.

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

    sanitizeDepots(result);
    sanitizePhones(result);
    sanitizeAddresses(result);
    return res.status(200).json(result);

  } catch (e) {
    return res.status(500).json({ error: "Erreur serveur: " + e.message });
  }
}
