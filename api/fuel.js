export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    // Get cities from request body (from the route)
    const cities = req.body?.cities || [];
    
    if (!cities.length) {
      // Default: show stations near main depots
      const url = "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records?limit=30&where=gazole_prix%20is%20not%20null&order_by=gazole_prix%20asc&refine=dep_name%3A%22Landes%22%20OR%20dep_name%3A%22Gers%22%20OR%20dep_name%3A%22Pyr%C3%A9n%C3%A9es-Atlantiques%22";
      const response = await fetch(url);
      if (!response.ok) return res.status(500).json({ error: "Erreur API" });
      const data = await response.json();
      return res.status(200).json(data);
    }

    // Get stations for each city in the route
    const allStations = [];
    const seenIds = new Set();

    for (const city of cities.slice(0, 6)) { // Max 6 cities to avoid timeout
      const cityName = city.ville || city;
      const cp = city.cp || '';
      const dep = cp ? cp.substring(0, 2) : '';
      
      let where = `gazole_prix is not null`;
      if (dep) {
        where += ` AND cp like "${dep}%"`;
      }
      
      const url = `https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records?limit=5&where=${encodeURIComponent(where)}&order_by=gazole_prix asc`;
      
      try {
        const response = await fetch(url);
        if (response.ok) {
          const data = await response.json();
          if (data.results) {
            data.results.forEach(s => {
              if (!seenIds.has(s.id)) {
                seenIds.add(s.id);
                allStations.push({ ...s, near_city: cityName });
              }
            });
          }
        }
      } catch (e) {
        console.warn('Error fetching for city', cityName, e.message);
      }
    }

    return res.status(200).json({ results: allStations, total: allStations.length });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
