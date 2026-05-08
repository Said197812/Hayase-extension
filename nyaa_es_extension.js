// ============================================================
//  nyaa-es.js  |  Extensión Hayase para Nyaa.si - Sub Español
//  Busca anime con subtítulos en español en Nyaa.si
// ============================================================

// Palabras clave de subs en español para filtrar/detectar
const ES_KEYWORDS = ['español', 'spanish', ' esp', 'castellano', 'latino', 'lat'];

// Grupos conocidos que publican sub español en Nyaa
const ES_GROUPS = [
  'kaizoku', 'judas', 'summertime', 'hikari no akari',
  'erai-raws', 'subtitulo', 'subtítulo', 'anime no sekai'
];

/**
 * Devuelve true si el título del torrent parece tener sub español
 */
function isSpanishSub(title) {
  const lower = title.toLowerCase();
  return ES_KEYWORDS.some(k => lower.includes(k)) || ES_GROUPS.some(g => lower.includes(g));
}

/**
 * Extrae el número de episodio del título del torrent (ej. " - 05 ", "[05]", "E05")
 */
function extractEpNumber(title) {
  const m =
    title.match(/[-–]\s*(\d{1,4})\s*[-–\[\(v]/) ||
    title.match(/\[(\d{1,4})\]/) ||
    title.match(/E(\d{1,4})/i);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Parsea los ítems de un feed RSS de Nyaa y devuelve un array de resultados.
 */
function parseRSS(xml) {
  const results = [];
  const items = xml.split('<item>').slice(1);

  for (const item of items) {
    const titleMatch =
      item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ||
      item.match(/<title>(.*?)<\/title>/);
    const magnetMatch =
      item.match(/<nyaa:magnetLink><!\[CDATA\[(.*?)\]\]><\/nyaa:magnetLink>/) ||
      item.match(/<nyaa:magnetLink>(.*?)<\/nyaa:magnetLink>/);
    const guidMatch = item.match(/<guid[^>]*>(.*?)<\/guid>/);
    const seedersMatch = item.match(/<nyaa:seeders>(.*?)<\/nyaa:seeders>/);
    const leechersMatch = item.match(/<nyaa:leechers>(.*?)<\/nyaa:leechers>/);
    const sizeMatch = item.match(/<nyaa:size>(.*?)<\/nyaa:size>/);
    const pubDateMatch = item.match(/<pubDate>(.*?)<\/pubDate>/);
    const hashMatch = item.match(/<nyaa:infoHash>(.*?)<\/nyaa:infoHash>/);

    if (!titleMatch) continue;

    const title = titleMatch[1].trim();
    const magnet = magnetMatch ? magnetMatch[1].trim() : null;
    const pageUrl = guidMatch ? guidMatch[1].trim() : '';
    const seeders = seedersMatch ? parseInt(seedersMatch[1]) : 0;
    const leechers = leechersMatch ? parseInt(leechersMatch[1]) : 0;
    const size = sizeMatch ? sizeMatch[1].trim() : '';
    const time = pubDateMatch ? pubDateMatch[1] : '';
    const hash = hashMatch ? hashMatch[1].toLowerCase() : '';

    results.push({
      title,
      url: magnet || pageUrl,  // Usamos magnet si está disponible
      seeders,
      leechers,
      size,
      time,
      hash
    });
  }

  return results;
}

// ─────────────────────────────────────────────
//  FUNCIÓN PRINCIPAL: search
//  Hayase la llama cuando el usuario busca un anime
// ─────────────────────────────────────────────
export async function search(request, query) {
  // Buscamos dos queries en paralelo:
  // 1) query + "español"   → resultados con keyword español
  // 2) query con grupos conocidos (kaizoku, judas, etc.)
  const baseQ = encodeURIComponent(query);
  const esQ   = encodeURIComponent(`${query} español`);

  // Construimos las URLs del RSS de Nyaa
  // c=1_0 = categoría "Anime" completa, f=0 = sin filtro
  const urlEs    = `https://nyaa.si/?page=rss&q=${esQ}&c=1_0&f=0`;
  const urlBase  = `https://nyaa.si/?page=rss&q=${baseQ}&c=1_0&f=0`;

  let xmlEs = '', xmlBase = '';

  try {
    [xmlEs, xmlBase] = await Promise.all([
      request.text(urlEs).catch(() => ''),
      request.text(urlBase).catch(() => '')
    ]);
  } catch {
    return [];
  }

  // Parseamos ambos feeds
  const fromEs   = parseRSS(xmlEs);
  const fromBase = parseRSS(xmlBase).filter(r => isSpanishSub(r.title));

  // Fusionamos y deduplicamos por magnet/hash
  const seen = new Set();
  const merged = [];

  for (const r of [...fromEs, ...fromBase]) {
    const key = r.hash || r.url;
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    merged.push(r);
  }

  // Ordenamos: más seeders primero
  merged.sort((a, b) => b.seeders - a.seeders);

  return merged;
}

// ─────────────────────────────────────────────
//  FUNCIÓN PRINCIPAL: detail
//  Hayase la llama cuando el usuario selecciona un resultado
// ─────────────────────────────────────────────
export async function detail(request, url) {
  // Si ya es un magnet link, lo devolvemos directamente
  if (url.startsWith('magnet:')) {
    return {
      episodes: [{ title: 'Reproducir', url }]
    };
  }

  // Si es una URL de página de Nyaa, la scrapeamos para obtener el magnet
  try {
    const html = await request.text(url);
    const magnetMatch = html.match(/href="(magnet:\?xt=urn:btih:[^"]+)"/);
    const magnet = magnetMatch ? magnetMatch[1] : url;
    return {
      episodes: [{ title: 'Reproducir', url: magnet }]
    };
  } catch {
    return { episodes: [{ title: 'Reproducir', url }] };
  }
}

// ─────────────────────────────────────────────
//  FUNCIÓN EXTRA: searchBatch (por episodio)
//  Filtra automáticamente por número de episodio
// ─────────────────────────────────────────────
export async function searchBatch(request, query, episode) {
  const all = await search(request, query);
  if (!episode) return all;

  // Intentamos filtrar por número de episodio
  const filtered = all.filter(r => {
    const ep = extractEpNumber(r.title);
    return ep === null || ep === episode;
  });

  return filtered.length > 0 ? filtered : all;
}
