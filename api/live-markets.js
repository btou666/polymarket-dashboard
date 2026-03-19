const REWARDS_PAGE_URL = "https://polymarket.com/rewards";
const REWARDS_API_URL = "https://polymarket.com/api/rewards";
const QUERY_KEY_PATH = "/api/rewards";
const GAMMA_MARKETS_ENDPOINT = "https://gamma-api.polymarket.com/markets";
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 500;
const REWARDS_PAGE_SIZE = 100;

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

function buildRewardsApiUrl(cursor, limit) {
  const url = new URL(REWARDS_API_URL);
  url.searchParams.set("interval", "current");
  url.searchParams.set("market_type", "market");
  url.searchParams.set("sort", "DESC");
  url.searchParams.set("tag", "");
  url.searchParams.set("category", "all");
  url.searchParams.set("is_terminal", "true");
  url.searchParams.set("cursor", cursor || "MA==");
  url.searchParams.set("limit", String(Math.max(1, Math.min(limit, REWARDS_PAGE_SIZE))));
  return url.toString();
}

async function fetchRewardsApiPage(cursor, limit) {
  const response = await fetch(buildRewardsApiUrl(cursor, limit), {
    method: "GET",
    headers: {
      Accept: "application/json",
      Referer: REWARDS_PAGE_URL,
      Origin: "https://polymarket.com",
      "User-Agent": "Mozilla/5.0 (compatible; rewards-dashboard/1.0)",
    },
  });
  if (!response.ok) {
    throw new Error(`Rewards API HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (!payload || !Array.isArray(payload.data)) {
    throw new Error("Rewards API payload is not an array");
  }
  return payload;
}

async function collectRewardsRows(seedPayload, limit) {
  const rows = [];
  const seen = new Set();
  let nextCursor = seedPayload?.next_cursor ?? null;
  let count = seedPayload?.count ?? null;
  let totalCount = seedPayload?.total_count ?? null;

  const appendRows = (list) => {
    const sourceRows = Array.isArray(list) ? list : [];
    for (const row of sourceRows) {
      const marketId = String(row?.market_id ?? "");
      if (!marketId || seen.has(marketId)) continue;
      rows.push(row);
      seen.add(marketId);
      if (rows.length >= limit) break;
    }
  };

  appendRows(seedPayload?.data);

  // Seed payload from rewards page usually contains 100 rows; fetch cursor pages until reaching desired limit.
  while (rows.length < limit && nextCursor) {
    try {
      const remain = limit - rows.length;
      const page = await fetchRewardsApiPage(nextCursor, remain);
      appendRows(page.data);
      count = page.count ?? count;
      totalCount = page.total_count ?? totalCount;
      if (!page.next_cursor || page.next_cursor === nextCursor) break;
      nextCursor = page.next_cursor;
    } catch {
      break;
    }
  }

  return {
    rows: rows.slice(0, limit),
    nextCursor,
    count: count ?? rows.length,
    totalCount: totalCount ?? rows.length,
  };
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

    const limit = Math.min(Math.max(Number(req.query.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const paged = await collectRewardsRows(payload, limit);
    const marketIds = paged.rows.map((row) => String(row.market_id));
    const gammaDateMap = await fetchGammaDateMap(marketIds);
    const mergedRows = paged.rows.map((row) => ({
      ...row,
      end_date: gammaDateMap.get(String(row.market_id)) || null,
    }));

    res.setHeader("Cache-Control", "s-maxage=45, stale-while-revalidate=180");
    res.status(200).json({
      data: mergedRows,
      next_cursor: paged.nextCursor ?? null,
      limit: mergedRows.length,
      count: paged.count ?? mergedRows.length,
      total_count: paged.totalCount ?? mergedRows.length,
      source: "rewards_page_next_data_with_cursor_pagination",
    });
  } catch (error) {
    res.status(502).json({
      error: "Failed to extract rewards pools from rewards page",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
};
