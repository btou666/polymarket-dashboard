const REWARDS_PAGE_URL = "https://polymarket.com/rewards";
const REWARDS_API_URL = "https://polymarket.com/api/rewards";
const QUERY_KEY_PATH = "/api/rewards";
const GAMMA_MARKETS_ENDPOINT = "https://gamma-api.polymarket.com/markets";
const POLYGON_RPC_ENDPOINT = process.env.POLYGON_RPC_URL || "https://polygon-bor-rpc.publicnode.com";
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 500;
const REWARDS_PAGE_SIZE = 100;
const GAMMA_PAGE_SIZE = 500;
const GAMMA_MAX_SCAN = 5000;
const GAMMA_CONDITION_SCAN_MAX = 6000;
const DISTRIBUTE_REWARD_TOPIC0 = "0x0be934154273ab5bf3a024f88561955bee89ea6d9aac33477620b101ca5704d9";
const MULTICALL3_CONTRACT = "0xca11bde05977b3631167028862be2a173976ca11";
const USER_DISTRIBUTE_CONTRACT = "0xf7cd89be08af4d4d6b1522852ced49fc10169f64";
const OFFICIAL_DISTRIBUTOR_SENDER = "0xc288480574783bd7615170660d71753378159c47";
const USER_DISTRIBUTOR_SENDER = "0x823c0e04afe04b7aac419f7001e5eaadfb1b33f1";
const METHOD_AGGREGATE = "0x252dba42";
const METHOD_DISTRIBUTE_REWARDS = "0x143ba4f3";

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

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function safeJsonParseArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeHexAddress(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(raw)) return null;
  return raw;
}

function parseTxHashes(query) {
  const raw = query.tx_hashes || query.tx_hash || "";
  const text = Array.isArray(raw) ? raw.join(",") : String(raw || "");
  if (!text.trim()) return [];
  const hashes = text
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => /^0x[0-9a-f]{64}$/.test(item));
  return [...new Set(hashes)];
}

async function rpcCall(method, params) {
  const response = await fetch(POLYGON_RPC_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method,
      params,
      id: 1,
    }),
  });
  if (!response.ok) {
    throw new Error(`RPC HTTP ${response.status}`);
  }
  const payload = await response.json();
  if (payload.error) {
    const message = payload.error?.message || JSON.stringify(payload.error);
    throw new Error(`RPC ${method} failed: ${message}`);
  }
  return payload.result || null;
}

function formatUnits(rawValue, decimals = 6) {
  const value = BigInt(rawValue);
  const base = BigInt(10) ** BigInt(decimals);
  const integer = value / base;
  const fraction = value % base;
  if (fraction === 0n) return integer.toString();
  const fractionText = fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${integer}.${fractionText}`;
}

function decodeAddressFromTopic(topic) {
  const hex = String(topic || "").toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(hex)) return null;
  return `0x${hex.slice(26)}`;
}

function decodeDistributeRewardLog(log) {
  const topics = Array.isArray(log?.topics) ? log.topics : [];
  if (!topics.length) return null;
  if (String(topics[0]).toLowerCase() !== DISTRIBUTE_REWARD_TOPIC0) return null;

  const recipient = decodeAddressFromTopic(topics[1]);
  const data = String(log?.data || "");
  if (!recipient || !/^0x[0-9a-fA-F]+$/.test(data)) return null;

  const rawAmount = BigInt(data);
  return {
    recipient,
    amount_raw: rawAmount.toString(),
    amount_usdc: formatUnits(rawAmount, 6),
    topic0: DISTRIBUTE_REWARD_TOPIC0,
  };
}

function classifyTxSource(tx) {
  const from = normalizeHexAddress(tx?.from) || "";
  const to = normalizeHexAddress(tx?.to) || "";
  const input = String(tx?.input || "").toLowerCase();
  const method = input.slice(0, 10);

  if (from === OFFICIAL_DISTRIBUTOR_SENDER && to === MULTICALL3_CONTRACT && method === METHOD_AGGREGATE) {
    return "official";
  }
  if (from === USER_DISTRIBUTOR_SENDER && to === USER_DISTRIBUTE_CONTRACT && method === METHOD_DISTRIBUTE_REWARDS) {
    return "user";
  }
  if (to === USER_DISTRIBUTE_CONTRACT && method === METHOD_DISTRIBUTE_REWARDS) {
    return "user";
  }
  return "unknown";
}

async function decodeRewardDistributionsFromTx(txHash) {
  const [tx, receipt] = await Promise.all([
    rpcCall("eth_getTransactionByHash", [txHash]),
    rpcCall("eth_getTransactionReceipt", [txHash]),
  ]);
  if (!tx || !receipt) {
    return {
      tx_hash: txHash,
      found: false,
      error: "tx_not_found",
    };
  }

  const decoded = (Array.isArray(receipt.logs) ? receipt.logs : [])
    .map(decodeDistributeRewardLog)
    .filter(Boolean);
  const totalRaw = decoded.reduce((sum, item) => sum + BigInt(item.amount_raw), 0n);

  return {
    tx_hash: txHash,
    found: true,
    tx_from: normalizeHexAddress(tx.from),
    tx_to: normalizeHexAddress(tx.to),
    method_id: String(tx.input || "").slice(0, 10).toLowerCase(),
    source_type: classifyTxSource(tx),
    distribute_log_count: decoded.length,
    total_amount_usdc: formatUnits(totalRaw, 6),
    payouts: decoded,
  };
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
  let pageFetchError = null;

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
    } catch (error) {
      pageFetchError = error instanceof Error ? error.message : String(error);
      break;
    }
  }

  return {
    rows: rows.slice(0, limit),
    nextCursor,
    count: count ?? rows.length,
    totalCount: totalCount ?? rows.length,
    pageFetchError,
  };
}

function isPositiveRewardRow(row) {
  const rewards = Array.isArray(row?.clobRewards) ? row.clobRewards : [];
  return rewards.some((reward) => toNumber(reward?.rewardsDailyRate, 0) > 0);
}

function mapGammaToRewardsRow(row) {
  const rewards = Array.isArray(row?.clobRewards) ? row.clobRewards : [];
  const outcomes = safeJsonParseArray(row?.outcomes);
  const outcomePrices = safeJsonParseArray(row?.outcomePrices);
  const tokens = outcomes.map((outcome, index) => ({
    outcome,
    price: toNumber(outcomePrices[index], 0.5),
  }));

  return {
    market_id: row?.id,
    condition_id: row?.conditionId || null,
    question: row?.question || "",
    market_slug: row?.slug || "",
    event_slug: row?.events?.[0]?.slug || row?.slug || "",
    volume_24hr: toNumber(row?.volume24hr, 0),
    market_competitiveness: toNumber(row?.competitive, 0.5),
    spread: toNumber(row?.spread, 0.05),
    rewards_min_size: toNumber(row?.rewardsMinSize, 5),
    rewards_max_spread: toNumber(row?.rewardsMaxSpread, 3.5),
    rewards_config: rewards.map((reward) => ({
      id: toNumber(reward?.id, 0),
      start_date: reward?.startDate || null,
      end_date: reward?.endDate || null,
      rate_per_day: toNumber(reward?.rewardsDailyRate, 0),
      total_rewards: toNumber(reward?.rewardsAmount, 0),
    })),
    tokens,
    end_date: row?.endDate || null,
  };
}

async function fetchGammaRewardsFallbackRows(limit, seenMarketIds) {
  const rows = [];
  const seen = new Set(seenMarketIds || []);
  let offset = 0;

  while (rows.length < limit && offset < GAMMA_MAX_SCAN) {
    const url = new URL(GAMMA_MARKETS_ENDPOINT);
    url.searchParams.set("active", "true");
    url.searchParams.set("closed", "false");
    url.searchParams.set("limit", String(GAMMA_PAGE_SIZE));
    url.searchParams.set("offset", String(offset));

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) break;

    const payload = await response.json();
    if (!Array.isArray(payload) || !payload.length) break;

    for (const row of payload) {
      if (!isPositiveRewardRow(row)) continue;
      const marketId = String(row?.id ?? "");
      if (!marketId || seen.has(marketId)) continue;

      rows.push(mapGammaToRewardsRow(row));
      seen.add(marketId);
      if (rows.length >= limit) break;
    }

    if (payload.length < GAMMA_PAGE_SIZE) break;
    offset += payload.length;
  }

  return rows;
}

async function fetchGammaDateMaps(rewardRows) {
  const dateMapByMarketId = new Map();
  const dateMapByConditionId = new Map();
  const marketIds = (Array.isArray(rewardRows) ? rewardRows : [])
    .map((row) => String(row?.market_id ?? ""))
    .filter(Boolean);
  const unresolvedConditionIds = new Set(
    (Array.isArray(rewardRows) ? rewardRows : [])
      .map((row) => String(row?.condition_id || "").toLowerCase())
      .filter(Boolean),
  );
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
        if (!row) return;
        if (row.id) {
          dateMapByMarketId.set(String(row.id), row.endDate || null);
        }
        const conditionId = String(row.conditionId || "").toLowerCase();
        if (conditionId) {
          dateMapByConditionId.set(conditionId, row.endDate || null);
          unresolvedConditionIds.delete(conditionId);
        }
      });
    } catch {
      continue;
    }
  }

  // Rewards payload uses condition_id widely; scan active gamma pages to backfill missing dates by conditionId.
  if (unresolvedConditionIds.size > 0) {
    let offset = 0;
    while (offset < GAMMA_CONDITION_SCAN_MAX && unresolvedConditionIds.size > 0) {
      const url = new URL(GAMMA_MARKETS_ENDPOINT);
      url.searchParams.set("active", "true");
      url.searchParams.set("closed", "false");
      url.searchParams.set("limit", String(GAMMA_PAGE_SIZE));
      url.searchParams.set("offset", String(offset));

      try {
        const response = await fetch(url.toString(), {
          method: "GET",
          headers: { Accept: "application/json" },
        });
        if (!response.ok) break;

        const rows = await response.json();
        if (!Array.isArray(rows) || !rows.length) break;

        rows.forEach((row) => {
          if (!row) return;
          const conditionId = String(row.conditionId || "").toLowerCase();
          if (!conditionId || !unresolvedConditionIds.has(conditionId)) return;
          dateMapByConditionId.set(conditionId, row.endDate || null);
          unresolvedConditionIds.delete(conditionId);
        });

        if (rows.length < GAMMA_PAGE_SIZE) break;
        offset += rows.length;
      } catch {
        break;
      }
    }
  }

  return { dateMapByMarketId, dateMapByConditionId };
}

module.exports = async function handler(req, res) {
  try {
    const query = req?.query || {};
    const txHashes = parseTxHashes(query);

    // Debug mode: decode reward distribution tx logs by hash.
    if (txHashes.length > 0) {
      const results = await Promise.all(txHashes.map((hash) => decodeRewardDistributionsFromTx(hash)));
      res.setHeader("Cache-Control", "no-store");
      res.status(200).json({
        source: "polygon_rpc_tx_decode",
        rpc_endpoint: POLYGON_RPC_ENDPOINT,
        topic0: DISTRIBUTE_REWARD_TOPIC0,
        decimals: 6,
        count: results.length,
        results,
      });
      return;
    }

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

    const limit = Math.min(Math.max(Number(query.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const paged = await collectRewardsRows(payload, limit);
    let rewardRows = paged.rows;
    let source = "rewards_page_next_data_with_cursor_pagination";

    if (rewardRows.length < limit) {
      const missing = limit - rewardRows.length;
      const gammaFallbackRows = await fetchGammaRewardsFallbackRows(
        missing,
        rewardRows.map((row) => String(row.market_id)),
      );
      if (gammaFallbackRows.length > 0) {
        rewardRows = rewardRows.concat(gammaFallbackRows);
        source = "rewards_page_with_gamma_rewards_fallback";
      }
    }

    const { dateMapByMarketId, dateMapByConditionId } = await fetchGammaDateMaps(rewardRows);
    const mergedRows = rewardRows.map((row) => ({
      ...row,
      end_date:
        row.end_date ||
        dateMapByMarketId.get(String(row.market_id)) ||
        dateMapByConditionId.get(String(row.condition_id || "").toLowerCase()) ||
        null,
    }));

    res.setHeader("Cache-Control", "s-maxage=45, stale-while-revalidate=180");
    res.status(200).json({
      data: mergedRows,
      next_cursor: paged.nextCursor ?? null,
      limit: mergedRows.length,
      count: paged.count ?? mergedRows.length,
      total_count: paged.totalCount ?? mergedRows.length,
      page_fetch_error: paged.pageFetchError ?? null,
      source,
    });
  } catch (error) {
    res.status(502).json({
      error: "Failed to extract rewards pools from rewards page",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
};
