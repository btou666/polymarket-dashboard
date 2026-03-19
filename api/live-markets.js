const REWARDS_PAGE_URL = "https://polymarket.com/rewards";
const QUERY_KEY_PATH = "/api/rewards";
const GAMMA_MARKETS_ENDPOINT = "https://gamma-api.polymarket.com/markets";

function extractNextDataJson(html) {
  const marker = '<script id="__NEXT_DATA__" type="application/json"';
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) {
    throw new Error("Cannot find __NEXT_DATA__ script block");
  }

  const jsonStart = html.indexOf(">", markerIndex);
  if (jsonStart < 0) {
    throw new Error("Malformed __NEXT_DATA__ script start");
  }

  const jsonEnd = html.indexOf("</script>", jsonStart);
  if (jsonEnd < 0) {
    throw new Error("Malformed __NEXT_DATA__ script end");
  }

  return html.slice(jsonStart + 1, jsonEnd);
}

function extractRewardsPayload(nextData) {
  const queries = nextData?.props?.pageProps?.dehydratedState?.queries;
  if (!Array.isArray(queries)) {
    throw new Error("Cannot find dehydrated queries in __NEXT_DATA__");
  }

  const rewardsQuery = queries.find((query) => {
    const key = query?.queryKey;
    return Array.isArray(key) && key[0] === QUERY_KEY_PATH;
  });

  const payload = rewardsQuery?.state?.data;
  if (!payload || !Array.isArray(payload.data)) {
    throw new Error("Cannot find rewards payload rows in __NEXT_DATA__");
  }

  return payload;
}

function chunk(array, size) {
  const out = [];
  for (let index = 0; index < array.length; index += size) {
    out.push(array.slice(index, index + size));
  }
  return out;
}

async function fetchGammaDateMap(marketIds) {
  const dateMap = new Map();
  const idChunks = chunk(marketIds, 40);

  for (const group of idChunks) {
    const url = new URL(GAMMA_MARKETS_ENDPOINT);
    group.forEach((id) => url.searchParams.append("id", String(id)));

    try {
      const response = await fetch(url.toString(), {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) continue;

      const rows = await response.json();
      if (!Array.isArray(rows)) continue;

      rows.forEach((row) => {
        if (row && row.id) {
          dateMap.set(String(row.id), row.endDate || null);
        }
      });
    } catch {
      continue;
    }
  }

  return dateMap;
}

module.exports = async function handler(req, res) {
  try {
    const upstreamResponse = await fetch(REWARDS_PAGE_URL, {
      method: "GET",
      headers: {
        Accept: "text/html",
        "User-Agent": "Mozilla/5.0 (compatible; rewards-dashboard/1.0)",
      },
    });

    if (!upstreamResponse.ok) {
      const body = await upstreamResponse.text();
      res.status(upstreamResponse.status).json({
        error: "Failed to load rewards page HTML",
        detail: body.slice(0, 500),
      });
      return;
    }

    const html = await upstreamResponse.text();
    const jsonText = extractNextDataJson(html);
    const nextData = JSON.parse(jsonText);
    const payload = extractRewardsPayload(nextData);

    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const trimmedRows = payload.data.slice(0, limit);
    const marketIds = trimmedRows.map((row) => String(row.market_id));
    const gammaDateMap = await fetchGammaDateMap(marketIds);
    const mergedRows = trimmedRows.map((row) => ({
      ...row,
      end_date: gammaDateMap.get(String(row.market_id)) || null,
    }));

    res.setHeader("Cache-Control", "s-maxage=45, stale-while-revalidate=180");
    res.status(200).json({
      data: mergedRows,
      next_cursor: payload.next_cursor ?? null,
      limit: mergedRows.length,
      count: payload.count ?? mergedRows.length,
      total_count: payload.total_count ?? mergedRows.length,
      source: "rewards_page_next_data",
    });
  } catch (error) {
    res.status(502).json({
      error: "Failed to extract rewards pools from rewards page",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
};
