const spreadTiers = [
  { id: "tight", label: "近 midpoint", ratio: 0.22, risk: "高" },
  { id: "balanced", label: "中档距离", ratio: 0.46, risk: "中" },
  { id: "wide", label: "宽档距离", ratio: 0.72, risk: "低" },
];

const fallbackMarkets = [
  {
    id: "fallback-1",
    name: "Fallback: US CPI Above 3.0%",
    category: "Macro",
    state: "进行中",
    dailyReward: 2.4,
    maxSpread: 3.5,
    minSize: 20,
    midpoint: 0.56,
    bookDepth: 32000,
    marketScore: 6100,
    concentration: 54,
    depthDensity: 58,
    twoSidedShare: 61,
    lastUpdatedMinutes: 2,
  },
  {
    id: "fallback-2",
    name: "Fallback: BTC Above 120k",
    category: "Crypto",
    state: "进行中",
    dailyReward: 3.1,
    maxSpread: 3.5,
    minSize: 20,
    midpoint: 0.43,
    bookDepth: 47000,
    marketScore: 8400,
    concentration: 66,
    depthDensity: 72,
    twoSidedShare: 65,
    lastUpdatedMinutes: 3,
  },
  {
    id: "fallback-3",
    name: "Fallback: Fed Cuts In 2026",
    category: "Rates",
    state: "进行中",
    dailyReward: 1.8,
    maxSpread: 3.5,
    minSize: 20,
    midpoint: 0.49,
    bookDepth: 24000,
    marketScore: 4600,
    concentration: 42,
    depthDensity: 39,
    twoSidedShare: 52,
    lastUpdatedMinutes: 1,
  },
  {
    id: "fallback-4",
    name: "Fallback: Oil Above 100",
    category: "Commodities",
    state: "进行中",
    dailyReward: 1.2,
    maxSpread: 3.5,
    minSize: 20,
    midpoint: 0.31,
    bookDepth: 18000,
    marketScore: 3300,
    concentration: 35,
    depthDensity: 33,
    twoSidedShare: 46,
    lastUpdatedMinutes: 5,
  },
  {
    id: "fallback-5",
    name: "Fallback: Team A Wins Finals",
    category: "Sports",
    state: "即将结算",
    dailyReward: 0.9,
    maxSpread: 3.0,
    minSize: 20,
    midpoint: 0.62,
    bookDepth: 12000,
    marketScore: 2500,
    concentration: 29,
    depthDensity: 25,
    twoSidedShare: 41,
    lastUpdatedMinutes: 7,
  },
];

const state = {
  amount: 1000,
  sortBy: "roi",
  search: "",
  settlementRange: "all",
  filters: new Set(),
  selectedMarketId: fallbackMarkets[0].id,
  markets: fallbackMarkets,
  dataSource: "mock",
  dataSourceText: "Mock 兜底",
  isLoading: false,
  lastSyncAt: null,
  loadError: "",
  detail: {
    amount: 1000,
    strategy: "single",
    direction: "buy",
    spreadTier: "balanced",
    duration: 4,
  },
};

const elements = {
  globalAmount: document.querySelector("#global-amount"),
  sortBy: document.querySelector("#sort-by"),
  marketSearch: document.querySelector("#market-search"),
  settlementFilter: document.querySelector("#settlement-filter"),
  chips: document.querySelectorAll(".chip"),
  refreshData: document.querySelector("#refresh-data"),
  dataStatus: document.querySelector("#data-status"),
  summaryStrip: document.querySelector("#summary-strip"),
  marketList: document.querySelector("#market-list"),
  detailEmpty: document.querySelector("#detail-empty"),
  detailView: document.querySelector("#detail-view"),
  detailState: document.querySelector("#detail-state"),
  detailTitle: document.querySelector("#detail-title"),
  detailSubtitle: document.querySelector("#detail-subtitle"),
  detailFreshness: document.querySelector("#detail-freshness"),
  detailAmount: document.querySelector("#detail-amount"),
  detailStrategy: document.querySelector("#detail-strategy"),
  detailDirection: document.querySelector("#detail-direction"),
  detailSpreadTier: document.querySelector("#detail-spread-tier"),
  detailDuration: document.querySelector("#detail-duration"),
  detailMetrics: document.querySelector("#detail-metrics"),
  amountChart: document.querySelector("#amount-chart"),
  spreadChart: document.querySelector("#spread-chart"),
  strategySummary: document.querySelector("#strategy-summary"),
  riskSummary: document.querySelector("#risk-summary"),
};

spreadTiers.forEach((tier) => {
  const option = document.createElement("option");
  option.value = tier.id;
  option.textContent = `${tier.label} · ${tier.risk}风险`;
  elements.detailSpreadTier.appendChild(option);
});

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function safeJsonParse(value, fallback = []) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return fallback;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function formatCurrency(value) {
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 0 : abs >= 1 ? 2 : 4;
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: digits,
    minimumFractionDigits: abs > 0 && abs < 1 ? Math.min(3, digits) : 0,
  }).format(value);
}

function formatPercent(value) {
  return `${toNumber(value).toFixed(2)}%`;
}

function minutesSince(isoDate) {
  const ts = Date.parse(isoDate || "");
  if (!Number.isFinite(ts)) return 10;
  return Math.max(0, Math.round((Date.now() - ts) / 60000));
}

function hoursUntil(isoDate) {
  const ts = Date.parse(isoDate || "");
  if (!Number.isFinite(ts)) return null;
  return (ts - Date.now()) / 3600000;
}

function matchesSettlementRange(hoursToSettlement, settlementRange) {
  if (settlementRange === "all") return true;
  if (hoursToSettlement === null) return false;
  if (settlementRange === "lt1d") return hoursToSettlement >= 0 && hoursToSettlement < 24;
  if (settlementRange === "d1to3") return hoursToSettlement >= 24 && hoursToSettlement <= 72;
  if (settlementRange === "gt3d") return hoursToSettlement > 72;
  return true;
}

function formatSettlementLabel(hoursToSettlement) {
  if (hoursToSettlement === null) return "结算时间未知";
  if (hoursToSettlement < 0) return "已过结算时间";
  if (hoursToSettlement < 24) return "结算时间：1天内";
  if (hoursToSettlement <= 72) return "结算时间：1-3天";
  return "结算时间：>3天";
}

function freshnessLabel(minutes) {
  if (minutes <= 2) return "数据新鲜";
  if (minutes <= 5) return "数据一般";
  return "数据延迟";
}

function competitionLabel(score) {
  if (score <= 33) return "低";
  if (score <= 66) return "中";
  return "高";
}

function getSpreadTierById(id) {
  return spreadTiers.find((tier) => tier.id === id) || spreadTiers[1];
}

function calcDailyRewardFromConfig(rewardsConfig) {
  const rewards = Array.isArray(rewardsConfig) ? rewardsConfig : [];
  const rate = rewards.reduce((sum, reward) => sum + toNumber(reward.rate_per_day), 0);
  if (rate > 0) return rate;
  return rewards.reduce((sum, reward) => sum + toNumber(reward.total_rewards), 0);
}

function inferCategoryFromRewardsRow(row) {
  const slug = typeof row.event_slug === "string" ? row.event_slug : "";
  if (slug) {
    return slug.split("-")[0].toUpperCase();
  }
  return "Rewards";
}

function toPolymarketUrl(value) {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;

  try {
    const url = new URL(raw, "https://polymarket.com");
    if (url.origin !== "https://polymarket.com") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function inferEventUrlFromRewardsRow(row) {
  const directCandidates = [row.event_url, row.eventUrl, row.url, row.market_url, row.marketUrl, row.href];
  for (const candidate of directCandidates) {
    const normalized = toPolymarketUrl(candidate);
    if (normalized) return normalized;
  }

  const eventSlug = typeof row.event_slug === "string" ? row.event_slug.trim() : "";
  if (eventSlug) {
    return toPolymarketUrl(`/event/${eventSlug}`);
  }

  const marketSlug = typeof row.market_slug === "string" ? row.market_slug.trim() : "";
  if (!marketSlug) return null;
  if (marketSlug.startsWith("/") || marketSlug.startsWith("http")) {
    return toPolymarketUrl(marketSlug);
  }
  return toPolymarketUrl(`/event/${marketSlug}`);
}

function mapRewardsMarket(row) {
  const dailyReward = calcDailyRewardFromConfig(row.rewards_config);
  if (dailyReward <= 0) return null;

  const tokens = Array.isArray(row.tokens) ? row.tokens : [];
  const yesToken = tokens.find((token) => String(token.outcome || "").toLowerCase() === "yes");
  const fallbackToken = tokens[0];
  const midpoint = clamp(toNumber((yesToken || fallbackToken || {}).price, 0.5), 0.01, 0.99);

  const volume24h = toNumber(row.volume_24hr, 0);
  const competitiveness = clamp(toNumber(row.market_competitiveness, 0.5) * 100, 5, 99);
  const depthDensity = clamp((Math.log10(volume24h + 10) - 0.7) * 40, 8, 96);
  const minSize = Math.max(toNumber(row.rewards_min_size, 5), 5);
  const spreadNow = toNumber(row.spread, 0.05);
  // Calibrated denominator: rewards pool competition should not scale linearly with 24h volume.
  const marketScore = Math.max(minSize * 2.4 + competitiveness * 1.8 + spreadNow * 120, 90);
  const endDate = row.end_date || null;
  const hoursToSettlement = hoursUntil(endDate);

  return {
    id: String(row.market_id),
    name: row.question || row.market_slug || `Market ${row.market_id}`,
    category: inferCategoryFromRewardsRow(row),
    state: "进行中",
    dailyReward,
    maxSpread: toNumber(row.rewards_max_spread, 3.5),
    minSize,
    midpoint,
    bookDepth: volume24h,
    marketScore,
    concentration: competitiveness,
    depthDensity,
    twoSidedShare: tokens.length >= 2 ? 64 : 44,
    lastUpdatedMinutes: 1,
    url: inferEventUrlFromRewardsRow(row),
    endDate,
    hoursToSettlement,
  };
}

async function fetchWithTimeout(url, timeoutMs = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchLiveMarketPayload() {
  const query = "limit=200";
  const endpoints = [{ url: `/api/live-markets?${query}`, label: "实时 (Rewards池)" }];

  let lastError = null;
  for (const endpoint of endpoints) {
    try {
      const response = await fetchWithTimeout(endpoint.url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = await response.json();
      const rows = Array.isArray(payload) ? payload : Array.isArray(payload.data) ? payload.data : null;
      if (!rows) {
        throw new Error("返回数据不是数组");
      }
      return { payload: rows, label: endpoint.label };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("实时数据请求失败");
}

function computeCompetitionScore(market) {
  const raw =
    market.depthDensity * 0.45 +
    market.concentration * 0.35 +
    market.twoSidedShare * 0.2;
  return Math.round(clamp(raw, 0, 100));
}

function computeSimulation(market, config) {
  const amount = Number(config.amount);
  const spreadTier = getSpreadTierById(config.spreadTier);
  const hourlyPool = market.dailyReward / 24;
  const sideAllocation = config.strategy === "both" ? amount / 2 : amount;
  const minSizePenalty = sideAllocation >= market.minSize ? 1 : 0.25;
  const spreadScore = Math.pow(1 - spreadTier.ratio, 2);
  const strategyFactor = config.strategy === "both" ? 1.22 : 0.76;
  const directionFactor = config.strategy === "both" ? 1 : config.direction === "buy" ? 0.98 : 0.94;
  const durationFactor = config.duration >= 24 ? 1.08 : config.duration >= 4 ? 1 : 0.9;
  const stateFactor = market.state === "即将结算" ? 0.88 : 1;

  const userScore =
    Math.pow(Math.max(amount, 0), 0.62) *
    spreadScore *
    strategyFactor *
    directionFactor *
    durationFactor *
    minSizePenalty *
    stateFactor;

  const estimatedShare = userScore / (market.marketScore + userScore);
  const hourlyReward = hourlyPool * estimatedShare;
  const dailyReward = hourlyReward * 24;
  const rewardPer1000 = amount > 0 ? (hourlyReward / amount) * 1000 : 0;
  const roi = amount > 0 ? (hourlyReward / amount) * 100 : 0;
  const competitionScore = computeCompetitionScore(market);

  return {
    amount,
    hourlyPool,
    userScore,
    estimatedShare,
    hourlyReward,
    dailyReward,
    rewardPer1000,
    roi,
    competitionScore,
    competitionLevel: competitionLabel(competitionScore),
    freshness: freshnessLabel(market.lastUpdatedMinutes),
  };
}

function getHighRewardThreshold(markets) {
  const sorted = [...markets].map((market) => market.dailyReward).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  return sorted[Math.floor(sorted.length * 0.75)] || sorted[sorted.length - 1];
}

function buildOverviewRows() {
  const highRewardThreshold = getHighRewardThreshold(state.markets);
  return state.markets.map((market) => {
    const baseSimulation = computeSimulation(market, {
      amount: state.amount,
      strategy: "single",
      direction: "buy",
      spreadTier: "balanced",
      duration: 4,
    });

    const tags = [];
    if (market.dailyReward >= highRewardThreshold) tags.push({ label: "高奖励", tone: "reward" });
    if (baseSimulation.competitionScore <= 33) tags.push({ label: "低竞争", tone: "safe" });
    if (baseSimulation.competitionScore >= 67) tags.push({ label: "竞争激烈", tone: "alert" });

    return { market, simulation: baseSimulation, tags };
  });
}

function filterAndSortRows(rows) {
  const search = state.search.trim().toLowerCase();
  const filtered = rows.filter(({ market, tags, simulation }) => {
    const name = (market.name || "").toLowerCase();
    const category = (market.category || "").toLowerCase();
    const matchesSearch = !search || name.includes(search) || category.includes(search);
    const matchesSettlement = matchesSettlementRange(market.hoursToSettlement, state.settlementRange);
    const matchesFilters = [...state.filters].every((filter) => {
      if (filter === "highReward") return tags.some((tag) => tag.label === "高奖励");
      if (filter === "lowCompetition") return simulation.competitionScore <= 33;
      return true;
    });
    return matchesSearch && matchesSettlement && matchesFilters;
  });

  filtered.sort((a, b) => {
    if (state.sortBy === "hourlyReward") return b.simulation.hourlyReward - a.simulation.hourlyReward;
    if (state.sortBy === "competition") return a.simulation.competitionScore - b.simulation.competitionScore;
    if (state.sortBy === "hourlyPool") return b.simulation.hourlyPool - a.simulation.hourlyPool;
    return b.simulation.roi - a.simulation.roi;
  });

  return filtered;
}

function renderDataStatus() {
  if (!elements.dataStatus || !elements.refreshData) return;
  const lastSyncText = state.lastSyncAt
    ? `上次同步 ${new Date(state.lastSyncAt).toLocaleTimeString("zh-CN", { hour12: false })}`
    : "尚未同步";
  const loadingText = state.isLoading ? "正在同步 Polymarket..." : state.dataSourceText;
  const errorText = state.loadError ? " · 连接失败已使用兜底数据" : "";

  elements.dataStatus.textContent = `${loadingText} · ${lastSyncText}${errorText}`;
  elements.refreshData.disabled = state.isLoading;
  elements.refreshData.textContent = state.isLoading ? "同步中..." : "刷新数据";
}

function renderSummary(rows) {
  if (!rows.length) {
    elements.summaryStrip.innerHTML = `
      <article class="summary-card">
        <p>当前筛选下没有可展示的奖励池。</p>
        <strong>0</strong>
      </article>
    `;
    return;
  }

  const bestByRoi = rows[0];
  const bestByReward = [...rows].sort((a, b) => b.simulation.hourlyReward - a.simulation.hourlyReward)[0];
  const averageRoi = rows.reduce((sum, row) => sum + row.simulation.roi, 0) / rows.length;
  const filteredCount = rows.length;
  const totalCount = state.markets.length;

  elements.summaryStrip.innerHTML = `
    <article class="summary-card">
      <p>当前 ROI/h 最优池子</p>
      <strong>${bestByRoi.market.name}</strong>
    </article>
    <article class="summary-card">
      <p>预估小时收益最高</p>
      <strong>${formatCurrency(bestByReward.simulation.hourlyReward)}</strong>
    </article>
    <article class="summary-card">
      <p>当前平均 ROI/h</p>
      <strong>${formatPercent(averageRoi)}</strong>
    </article>
    <article class="summary-card">
      <p>${state.dataSource === "live" ? "展示池子数（筛选后）" : "兜底池子数（筛选后）"}</p>
      <strong>${filteredCount}/${totalCount}</strong>
    </article>
  `;
}

function renderMarketList(rows) {
  if (!rows.length) {
    elements.marketList.innerHTML = `
      <div class="empty-state">
        <p>没有找到符合条件的奖励池，试试调整搜索词或关闭筛选。</p>
      </div>
    `;
    return;
  }

  if (!rows.some((row) => row.market.id === state.selectedMarketId)) {
    state.selectedMarketId = rows[0].market.id;
  }

  elements.marketList.innerHTML = rows
    .map(({ market, simulation, tags }) => {
      const selectedClass = market.id === state.selectedMarketId ? "selected" : "";
      return `
        <article class="market-card ${selectedClass}" data-market-id="${market.id}">
          <div class="market-topline">
            <div>
              <p class="market-name">
                ${
                  market.url
                    ? `<a class="market-name-link" href="${market.url}" target="_blank" rel="noopener noreferrer">${market.name}</a>`
                    : market.name
                }
              </p>
              <p class="market-meta">
                ${market.category} · ${market.state} · midpoint ${market.midpoint.toFixed(2)} · min size ${market.minSize} · ${formatSettlementLabel(market.hoursToSettlement)}
              </p>
            </div>
            <div class="metric-pair">
              <span>每小时奖励</span>
              <strong>${formatCurrency(simulation.hourlyReward)}</strong>
            </div>
            <div class="metric-pair">
              <span>ROI/h</span>
              <strong>${formatPercent(simulation.roi)}</strong>
            </div>
          </div>
          <div class="market-bottomline">
            <div class="metric-pair">
              <span>每小时总池子奖励</span>
              <strong>${formatCurrency(simulation.hourlyPool)}</strong>
            </div>
            <div class="metric-pair">
              <span>每 1000 USDC</span>
              <strong>${formatCurrency(simulation.rewardPer1000)}</strong>
            </div>
            <div class="metric-pair">
              <span>竞争强度</span>
              <strong>${simulation.competitionLevel}</strong>
            </div>
            <div class="metric-pair">
              <span>数据状态</span>
              <strong>${simulation.freshness}</strong>
            </div>
          </div>
          <div class="tag-row">
            ${tags.map((tag) => `<span class="tag ${tag.tone}">${tag.label}</span>`).join("")}
          </div>
        </article>
      `;
    })
    .join("");

  document.querySelectorAll(".market-card").forEach((card) => {
    card.addEventListener("click", () => {
      state.selectedMarketId = card.dataset.marketId;
      state.detail.amount = state.amount;
      renderAll();
    });
  });

  document.querySelectorAll(".market-name-link").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.stopPropagation();
    });
  });
}

function renderMetricCards(simulation) {
  const metrics = [
    { label: "预估每小时奖励", value: formatCurrency(simulation.hourlyReward), subtext: `当前每小时总奖励 ${formatCurrency(simulation.hourlyPool)}` },
    { label: "预估每日奖励", value: formatCurrency(simulation.dailyReward), subtext: "按当前快照线性外推 24 小时" },
    { label: "每 1000 USDC 收益", value: formatCurrency(simulation.rewardPer1000), subtext: "用于横向比较不同池子的资金效率" },
    { label: "ROI/h", value: formatPercent(simulation.roi), subtext: `竞争强度 ${simulation.competitionLevel} · ${simulation.competitionScore}/100` },
    { label: "用户预估有效分数", value: simulation.userScore.toFixed(1), subtext: "受金额、挂单侧数、报价距离和时长影响" },
    { label: "预估奖励占比", value: formatPercent(simulation.estimatedShare * 100), subtext: "用户得分 / (市场当前总分 + 用户得分)" },
  ];

  elements.detailMetrics.innerHTML = metrics
    .map(
      (metric) => `
        <article class="metric-card">
          <p class="metric-label">${metric.label}</p>
          <p class="metric-value">${metric.value}</p>
          <p class="metric-subtext">${metric.subtext}</p>
        </article>
      `,
    )
    .join("");
}

function buildBarChart(container, rows, formatter) {
  const maxValue = Math.max(...rows.map((row) => row.value), 0.0001);
  container.innerHTML = rows
    .map((row) => {
      const width = clamp((row.value / maxValue) * 100, 4, 100);
      return `
        <div class="bar-row">
          <span class="bar-label">${row.label}</span>
          <div class="bar-track">
            <span class="bar-fill" style="width: ${width}%"></span>
          </div>
          <span class="bar-value">${formatter(row.value)}</span>
        </div>
      `;
    })
    .join("");
}

function getSelectedMarketSimulation() {
  const market = state.markets.find((item) => item.id === state.selectedMarketId);
  if (!market) return null;
  return { market, simulation: computeSimulation(market, state.detail) };
}

function updateDetailStateFromGlobal() {
  state.detail.amount = state.amount;
  elements.detailAmount.value = state.detail.amount;
  elements.detailStrategy.value = state.detail.strategy;
  elements.detailDirection.value = state.detail.direction;
  elements.detailSpreadTier.value = state.detail.spreadTier;
  elements.detailDuration.value = String(state.detail.duration);
}

function renderDetail() {
  const selected = state.markets.find((item) => item.id === state.selectedMarketId);
  if (!selected) {
    elements.detailEmpty.hidden = false;
    elements.detailView.hidden = true;
    return;
  }

  const simulation = computeSimulation(selected, state.detail);
  elements.detailEmpty.hidden = true;
  elements.detailView.hidden = false;
  elements.detailState.textContent = `${selected.category} · ${selected.state}`;
  elements.detailTitle.textContent = selected.name;
  elements.detailSubtitle.textContent = `max spread ${selected.maxSpread.toFixed(1)} · min size ${selected.minSize} · midpoint ${selected.midpoint.toFixed(2)}`;
  elements.detailFreshness.textContent = `${freshnessLabel(selected.lastUpdatedMinutes)} · ${selected.lastUpdatedMinutes} 分钟前更新`;

  renderMetricCards(simulation);

  const amountCurve = [250, 500, 1000, 2500, 5000].map((amount) => ({
    label: `${amount}`,
    value: computeSimulation(selected, { ...state.detail, amount }).hourlyReward,
  }));
  const spreadCurve = spreadTiers.map((tier) => ({
    label: tier.label,
    value: computeSimulation(selected, { ...state.detail, spreadTier: tier.id }).hourlyReward,
  }));

  buildBarChart(elements.amountChart, amountCurve, (value) => formatCurrency(value));
  buildBarChart(elements.spreadChart, spreadCurve, (value) => formatCurrency(value));

  elements.strategySummary.textContent =
    state.detail.strategy === "both"
      ? "双边通常会拿到更高有效分数，但需要两侧同时挂单并分摊资金。"
      : "单边模式更贴近当前默认策略，适合方向明确、希望资金更集中的挂单方式。";

  const spreadTier = getSpreadTierById(state.detail.spreadTier);
  const minSizeWarning =
    (state.detail.strategy === "both" ? state.detail.amount / 2 : state.detail.amount) < selected.minSize
      ? "当前金额低于有效最小挂单要求，结果会被明显折损。"
      : "";
  const freshnessWarning =
    selected.lastUpdatedMinutes > 5 ? "当前市场数据有延迟，建议刷新后再决策。" : "";
  const spreadWarning =
    spreadTier.id === "tight" ? "当前选择贴近 midpoint，成交风险较高。" : "当前报价距离更保守，奖励效率会更低但成交风险更可控。";

  elements.riskSummary.textContent = [spreadWarning, minSizeWarning, freshnessWarning].filter(Boolean).join(" ");
}

function renderAll() {
  renderDataStatus();
  const rows = filterAndSortRows(buildOverviewRows());
  renderSummary(rows);
  renderMarketList(rows);
  updateDetailStateFromGlobal();
  renderDetail();
}

async function loadLiveMarkets() {
  state.isLoading = true;
  state.loadError = "";
  renderDataStatus();

  try {
    const { payload, label } = await fetchLiveMarketPayload();
    const mapped = payload
      .map(mapRewardsMarket)
      .filter(Boolean)
      .sort((a, b) => b.dailyReward - a.dailyReward || b.bookDepth - a.bookDepth);

    if (!mapped.length) {
      throw new Error("实时接口返回为空");
    }

    state.markets = mapped;
    state.dataSource = "live";
    state.dataSourceText = label;
    state.lastSyncAt = Date.now();
    if (!state.markets.some((market) => market.id === state.selectedMarketId)) {
      state.selectedMarketId = state.markets[0].id;
    }
  } catch (error) {
    state.markets = fallbackMarkets;
    state.dataSource = "mock";
    state.dataSourceText = "Mock 兜底";
    state.lastSyncAt = Date.now();
    state.loadError = error instanceof Error ? error.message : String(error);
    if (!state.markets.some((market) => market.id === state.selectedMarketId)) {
      state.selectedMarketId = state.markets[0].id;
    }
  } finally {
    state.isLoading = false;
    renderAll();
  }
}

elements.globalAmount.addEventListener("input", (event) => {
  state.amount = Math.max(Number(event.target.value) || 0, 0);
  state.detail.amount = state.amount;
  renderAll();
});

elements.sortBy.addEventListener("change", (event) => {
  state.sortBy = event.target.value;
  renderAll();
});

elements.marketSearch.addEventListener("input", (event) => {
  state.search = event.target.value;
  renderAll();
});

elements.settlementFilter.addEventListener("change", (event) => {
  state.settlementRange = event.target.value;
  renderAll();
});

elements.chips.forEach((chip) => {
  chip.addEventListener("click", () => {
    const filter = chip.dataset.filter;
    if (state.filters.has(filter)) {
      state.filters.delete(filter);
      chip.classList.remove("active");
    } else {
      state.filters.add(filter);
      chip.classList.add("active");
    }
    renderAll();
  });
});

elements.refreshData.addEventListener("click", () => {
  if (!state.isLoading) loadLiveMarkets();
});

elements.detailAmount.addEventListener("input", (event) => {
  state.detail.amount = Math.max(Number(event.target.value) || 0, 0);
  renderDetail();
});

elements.detailStrategy.addEventListener("change", (event) => {
  state.detail.strategy = event.target.value;
  if (state.detail.strategy === "both") {
    state.detail.direction = "both";
    elements.detailDirection.value = "both";
    elements.detailDirection.disabled = true;
  } else {
    if (state.detail.direction === "both") {
      state.detail.direction = "buy";
      elements.detailDirection.value = "buy";
    }
    elements.detailDirection.disabled = false;
  }
  renderDetail();
});

elements.detailDirection.addEventListener("change", (event) => {
  state.detail.direction = event.target.value;
  renderDetail();
});

elements.detailSpreadTier.addEventListener("change", (event) => {
  state.detail.spreadTier = event.target.value;
  renderDetail();
});

elements.detailDuration.addEventListener("change", (event) => {
  state.detail.duration = Number(event.target.value);
  renderDetail();
});

elements.detailDirection.disabled = state.detail.strategy === "both";
renderAll();
loadLiveMarkets();
