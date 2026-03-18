const GAMMA_ENDPOINT = "https://gamma-api.polymarket.com/markets";

module.exports = async function handler(req, res) {
  const limit = Math.min(Math.max(Number(req.query.limit) || 300, 1), 500);
  const active = req.query.active ?? "true";
  const closed = req.query.closed ?? "false";
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  const upstreamUrl = new URL(GAMMA_ENDPOINT);
  upstreamUrl.searchParams.set("active", String(active));
  upstreamUrl.searchParams.set("closed", String(closed));
  upstreamUrl.searchParams.set("limit", String(limit));
  if (offset > 0) {
    upstreamUrl.searchParams.set("offset", String(offset));
  }

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
      error: "Failed to fetch Polymarket gamma API",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
};
