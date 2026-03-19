const REWARDS_PAGE_URL = "https://polymarket.com/rewards";
const QUERY_KEY_PATH = "/api/rewards";

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

    res.setHeader("Cache-Control", "s-maxage=45, stale-while-revalidate=180");
    res.status(200).json({
      data: trimmedRows,
      next_cursor: payload.next_cursor ?? null,
      limit: trimmedRows.length,
      count: payload.count ?? trimmedRows.length,
      total_count: payload.total_count ?? trimmedRows.length,
      source: "rewards_page_next_data",
    });
  } catch (error) {
    res.status(502).json({
      error: "Failed to extract rewards pools from rewards page",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
};
