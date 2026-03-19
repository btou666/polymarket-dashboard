const REWARDS_ENDPOINT = "https://polymarket.com/api/rewards";

module.exports = async function handler(req, res) {
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
  const cursor = req.query.cursor ?? "MA==";
  const interval = req.query.interval ?? "current";
  const marketType = req.query.market_type ?? "market";
  const sort = req.query.sort ?? "DESC";
  const tag = req.query.tag ?? "";
  const category = req.query.category ?? "all";
  const isTerminal = req.query.is_terminal ?? "true";

  const upstreamUrl = new URL(REWARDS_ENDPOINT);
  upstreamUrl.searchParams.set("interval", String(interval));
  upstreamUrl.searchParams.set("market_type", String(marketType));
  upstreamUrl.searchParams.set("sort", String(sort));
  upstreamUrl.searchParams.set("tag", String(tag));
  upstreamUrl.searchParams.set("category", String(category));
  upstreamUrl.searchParams.set("cursor", String(cursor));
  upstreamUrl.searchParams.set("limit", String(limit));
  upstreamUrl.searchParams.set("is_terminal", String(isTerminal));

  try {
    const upstreamResponse = await fetch(upstreamUrl.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    if (!upstreamResponse.ok) {
      const body = await upstreamResponse.text();
      res.status(upstreamResponse.status).json({
        error: "Upstream request failed",
        detail: body.slice(0, 500),
      });
      return;
    }

    const payload = await upstreamResponse.json();
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    res.status(200).json(payload);
  } catch (error) {
    res.status(502).json({
      error: "Failed to fetch Polymarket rewards API",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
};
