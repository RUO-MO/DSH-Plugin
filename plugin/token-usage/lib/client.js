window.__ModuleLoader__.load({
	id: "dsh-plugin-token-usage",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		var react = require("react");
		const { createElement: h, useEffect, useMemo, useState } = react;

		//#region constants
		const PLUGIN_NAME = "token-usage";
		const LOCALE_NS = "tokenUsage";
		const MAIN_KEY = "token-usage";
		const VIEW_ID = "token-usage";

		// Theme-aware dashboard palette. Each value is a DSH Semantic CSS
		// variable (so the panel recolor automatically when the app theme
		// changes) with the original dark TraeCode value as fallback — if a
		// token is ever renamed/undefined the panel still renders in dark.
		const D = {
			bg: "var(--dsw-alias-bg-module-platform, #0d0d0d)",
			card: "var(--dsw-alias-bg-layer-1, #171717)",
			border: "var(--dsw-alias-border-l2, #2a2a2a)",
			brand: "var(--dsw-alias-brand-primary, #3ddc84)",
			text: "var(--dsw-alias-label-primary, #e6e6e6)",
			text2: "var(--dsw-alias-label-secondary, #8a8a8a)",
			text3: "var(--dsw-alias-label-tertiary, #5a5a5a)",
			track: "var(--dsw-alias-bg-layer-3, #222222)",
			overlay: "var(--dsw-alias-bg-layer-3, #222222)",
			// heat cell palette: class names (see HEAT_CSS, injected via <style>
			// in apply()) so the ramp resolves per theme: level 0 is a neutral
			// "no data" cell, levels 1..5 ramp from the card background to green.
			cells: ["tu-cell-0", "tu-cell-1", "tu-cell-2", "tu-cell-3", "tu-cell-4", "tu-cell-5"],
		};
		// Theme-aware heat palette. The plain rules are the original dark ramp
		// (fallback for engines without color-mix); where color-mix() exists the
		// ramp is mixed from the current card background, so empty cells stay
		// visible and the green ramp reads in both light and dark themes.
		const HEAT_CSS =
			".tu-cell-0{background:var(--dsw-alias-border-l2,#2a2a2a)}" +
			".tu-cell-1{background:#1f5c3a}.tu-cell-2{background:#2ea043}.tu-cell-3{background:#3ddc84}.tu-cell-4{background:#59e6a0}.tu-cell-5{background:#a6f3c6}" +
			"@supports (color:color-mix(in srgb,red 50%,blue)){" +
			".tu-cell-1{background:color-mix(in srgb,#2ea043 25%,var(--dsw-alias-bg-layer-1,#171717))}" +
			".tu-cell-2{background:color-mix(in srgb,#2ea043 45%,var(--dsw-alias-bg-layer-1,#171717))}" +
			".tu-cell-3{background:color-mix(in srgb,#2ea043 65%,var(--dsw-alias-bg-layer-1,#171717))}" +
			".tu-cell-4{background:color-mix(in srgb,#2ea043 85%,var(--dsw-alias-bg-layer-1,#171717))}" +
			".tu-cell-5{background:#2ea043}" +
			"}";
		//#endregion

		//#region shared reactive account (module-level: both the session tab and
		// the root main panel live in this same bundle, so a plain JS emitter
		// carries real per-turn usage from the tab into the panel without any
		// harness modification).
		function createAccount() {
			let records = [];
			const listeners = new Set();
			return {
				getSnapshot: () => records,
				subscribe: (listener) => {
					listeners.add(listener);
					return () => listeners.delete(listener);
				},
				set: (next) => {
					// Keep a stable reference so unchanged renders no-op.
					records = next;
					listeners.forEach((l) => l());
				},
			};
		}
		const account = createAccount();
		function useAccountRecords() {
			const [records, setRecords] = useState(account.getSnapshot());
			useEffect(() => account.subscribe(() => setRecords(account.getSnapshot())), []);
			return records;
		}
		//#endregion

		//#region i18n
		const zh = {
			"panel.label": "Token 用量",
			"hello": "Hello!",
			"greeting.days": "这是你使用 DSH 的第 {n} 天",
			"heatmap.title": "活跃度",
			"heatmap.empty": "暂无 Token 用量数据",
			"heatmap.less": "Less",
			"heatmap.more": "More",
			"metric.tokens": "Token 消耗",
			"metric.tokens.calls": "共 {n} 个回合",
			"metric.turns": "对话次数",
			"partner.best": "最佳拍档",
			"partner.model": "模型调用偏好",
			"partner.empty": "暂无数据",
			"partner.calls": "{n} 次模型调用",
			"curve.title": "编程时段",
			"curve.empty": "暂无时段数据",
			"footer.note": "由本机宿主汇总 DSH 会话日志（session-query）生成，统计范围：全部历史会话；数据约每 5 秒刷新。",
			"conversation.label": "Token 用量",
			"panel.noData.title": "暂无可用用量数据",
			"panel.noData.desc": "未能从本机宿主读取用量统计（host 聚合/127.0.0.1 数据桥未连通或尚未产生用量）。明细见下方 Debug 探针。",
			"panel.debug.title": "可用数据探针（Debug）",
			"panel.debug.none": "（运行时捕获的上下文信息为空）",
			"range.total": "总共",
			"range.today": "今天",
			"range.7d": "近 7 天",
			"range.month": "本月",
			"range.365d": "近 365 天",
			"range.title": "使用范围",
			"partner.scoped": "模型细分仅在「总共」时提供",
		};
		const en = {
			"panel.label": "Token Usage",
			"hello": "Hello!",
			"greeting.days": "Day {n} with DSH",
			"heatmap.title": "Activity",
			"heatmap.empty": "No token usage yet",
			"heatmap.less": "Less",
			"heatmap.more": "More",
			"metric.tokens": "Token Spend",
			"metric.tokens.calls": "{n} turns total",
			"metric.turns": "Conversations",
			"partner.best": "Best Partner",
			"partner.model": "Model Preference",
			"partner.empty": "No data yet",
			"partner.calls": "{n} model calls",
			"curve.title": "Coding Hours",
			"curve.empty": "No hourly data yet",
			"footer.note": "Aggregated on this machine from the DSH session corpus (session-query). Scope: all historical sessions; refreshes roughly every 5s.",
			"conversation.label": "Token Usage",
			"panel.noData.title": "No usage data available",
			"panel.noData.desc": "Could not read usage stats from the local host (host aggregation / 127.0.0.1 bridge unreachable or no usage yet). See the Debug probe below.",
			"panel.debug.title": "Data probe (Debug)",
			"panel.debug.none": "(no captured context info at runtime)",
			"range.total": "All time",
			"range.today": "Today",
			"range.7d": "Last 7 days",
			"range.month": "This month",
			"range.365d": "Last 365 days",
			"range.title": "Range",
			"partner.scoped": "Model breakdown is shown in All time only",
		};
		//#endregion

		//#region hand-drawn inline icons (no library)
		function InfoIcon({ size = 13, color = D.text3 }) {
			return h("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: color, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true, style: { flex: "none" } },
				h("circle", { cx: 12, cy: 12, r: 9 }),
				h("path", { d: "M12 11v5" }),
				h("path", { d: "M12 8h.01" }),
			);
		}
		function ZzIcon({ size = 40, color = D.text3 }) {
			return h("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: color, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true },
				h("path", { d: "M3 3h6V7H3zM9 3c0 4 6 8 6 12" }),
				h("path", { d: "M15 11v6h6" }),
			);
		}
		function UsageIcon({ size }) {
			// sidebar.panellist icon: slim bar chart (gauge).
			return h("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true },
				h("path", { d: "M3 3v18h18" }),
				h("path", { d: "M7 15v2M11 10v7M15 6v11M19 9v8" }),
			);
		}
		//#endregion

		//#region shared helpers
		function fmtTokens(n) {
			if (!Number.isFinite(n)) return "—";
			if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
			if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
			return String(n);
		}
		const DAY_MS = 86400000;
		const pad = (n) => (n < 10 ? "0" + n : String(n));
		// Runtime data probe: at apply() time we record which services/keys DSH
		// actually gave this bundle, so the debug block and console can tell us
		// what is really available (no guessing, no fabricating data).
		let INSPECT = "";
			function safeKeys(o) {
				try { return Object.keys(o || {}); } catch (e) { return []; }
			}
			// Host usage bridge location. The host half reads the DSH session corpus
			// and serves an aggregate over 127.0.0.1; this renderer polls it. Port
			// can be overridden through Config (dashboard.http.port).
			let USAGE_URL = "http://127.0.0.1:47820/api/usage";
			let BRIDGE_STATUS = "untried";
			// Normalizes any usage source into one StatsView the dashboard consumes.
			//   records  day-bucketed [{ time, total }]   → heatmap
			//   hours   24-bucket token counts             → hourly curve
			//   models  sorted [[name,{tokens,calls}]]    → partner / preference
			//   turns   count                             → metric
			//   totalTokens / firstUsedAt
			function buildStatsFromLive(records) {
				const dayMap = new Map(), modelMap = new Map(), hours = new Array(24).fill(0);
				let totalTokens = 0, firstUsedAt = null;
				for (const r of records) {
					if (!Number.isFinite(r.time)) continue;
					totalTokens += r.total;
					if (firstUsedAt === null || r.time < firstUsedAt) firstUsedAt = r.time;
					const d = new Date(r.time);
					const key = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
					dayMap.set(key, (dayMap.get(key) || 0) + r.total);
					hours[d.getHours()] += r.total;
					if (r.model) {
						const m = modelMap.get(r.model) || { tokens: 0, calls: 0 };
						m.tokens += r.total; m.calls += 1;
						modelMap.set(r.model, m);
					}
				}
				return {
					records: [...dayMap.entries()].map(([time, total]) => ({ time, total })),
					hours, models: [...modelMap.entries()].sort((a, b) => b[1].tokens - a[1].tokens),
					turns: records.length, totalTokens, firstUsedAt,
				};
			}
			function statsFromHost(json) {
				if (!json || json.ok !== true) return null;
				const modelMap = new Map();
				const rawModels = json.models || {};
				const rawTokens = json.modelTokens || {};
				for (const key of Object.keys(rawModels)) {
					modelMap.set(key, { tokens: rawTokens[key] || 0, calls: rawModels[key] });
				}
				const hours = Array.isArray(json.hours) ? json.hours.slice() : new Array(24).fill(0);
				const hoursToday = Array.isArray(json.hoursToday) ? json.hoursToday.slice() : new Array(24).fill(0);
				// Day keys are "YYYY-MM-DD" in the host's LOCAL calendar. Parse them
				// as local midnight — Date.parse() would assume UTC and shift the
				// day by one in timezones west of UTC.
				const parseDayKey = (day) => {
					const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
					return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() : Date.parse(day);
				};
				return {
					records: Object.entries(json.days || {}).map(([day, total]) => ({ time: parseDayKey(day), total })),
					hours, hoursToday, models: [...modelMap.entries()].sort((a, b) => b[1].tokens - a[1].tokens),
					turns: json.turns || 0, totalTokens: json.totalTokens || 0, firstUsedAt: json.firstUsedAt || null,
				};
			}
			function useHostStats() {
				const [stats, setStats] = useState(null);
				useEffect(() => {
					let alive = true;
					let timer;
					const tick = () => {
						fetch(USAGE_URL, { mode: "cors" })
							.then((r) => (r.ok ? r.json() : Promise.reject(new Error("http " + r.status))))
							.then((j) => {
								if (!alive) return;
								const s = statsFromHost(j);
								if (s) { BRIDGE_STATUS = "ok"; setStats(s); }
								else { BRIDGE_STATUS = "empty"; setStats(null); }
							})
							.catch((e) => {
								if (!alive) return;
								BRIDGE_STATUS = String((e && e.message) || e);
								setStats(null);
							});
					};
					tick();
					timer = setInterval(tick, 2000);
					return () => { alive = false; clearInterval(timer); };
				}, []);
				return stats;
			}
			//#endregion

			//#region time-range selector for the TOTAL dashboard
			// All-session total, switchable今日/近7天/本月/近365天/总共 by calendar
			// window. Pure slice of a StatsView: only the day-bucketed `records` are
			// time-keyed, so range totals/heatmap are exact. The host does NOT persist
			// per-day model/hours attribution, so hours come from `hoursToday` only for
			// "today", the global 24h `hours` for broad ranges, and are left empty
			// elsewhere; model breakdown stays on "total" (honest, no fabrication).
			const RANGE_KEYS = [
				{ key: "total", i18n: "range.total" },
				{ key: "today", i18n: "range.today" },
				{ key: "7d", i18n: "range.7d" },
				{ key: "month", i18n: "range.month" },
				{ key: "365d", i18n: "range.365d" },
			];
			function startOfDay(ts) { const x = new Date(ts); x.setHours(0, 0, 0, 0); return x.getTime(); }
			// Returns a NEW StatsView scoped to [rangeStart("key"), now]. Empty tuple
			// for missing keys. total is full history.
			function rangeSlice(stats, key) {
				if (!stats) return null;
				const now = Date.now();
				const today = startOfDay(now);
				let start = null;
				let hours = new Array(24).fill(0);
				if (key === "today") { start = today; hours = stats.hoursToday ? stats.hoursToday.slice() : hours; }
				else if (key === "7d") { start = today - 6 * DAY_MS; }
				else if (key === "month") { const d = new Date(now); d.setDate(1); d.setHours(0, 0, 0, 0); start = d.getTime(); }
				else if (key === "365d") { start = today - 364 * DAY_MS; }
				else { hours = stats.hours ? stats.hours.slice() : hours; } // total → global 24h
				const records = (stats.records || []).filter((r) => start === null || r.time >= start);
				const totalTokens = records.reduce((a, r) => a + (r.total || 0), 0);
				const models = key === "total" ? (stats.models || []) : [];
				return {
					records, hours, models,
					turns: key === "total" ? (stats.turns || 0) : null,
					totalTokens, firstUsedAt: stats.firstUsedAt, scoped: key !== "total",
				};
			}
			function RangeSwitcher({ t, value, onChange }) {
				return h("div", { style: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 16 } },
					h("span", { style: { fontSize: 13, color: D.text2, marginRight: 2 } }, t("range.title")),
					RANGE_KEYS.map((r) => {
						const active = value === r.key;
						return h("button", {
							key: r.key,
							type: "button",
							onClick: () => onChange(r.key),
							style: {
								padding: "5px 11px", fontSize: 13, lineHeight: 1, borderRadius: 6, cursor: "pointer",
								border: "1px solid " + (active ? D.brand : D.border),
								background: active ? D.brand : D.card,
								color: active ? "#062112" : D.text2,
							},
						}, t(r.i18n));
					}),
				);
			}
			//#endregion

		//#region GreetingSection — "Hello!", "使用第 N 天"
			// Username / derived badges are not exposed to the composition, so only the
			// title renders. When a first-use timestamp exists (host aggregate or live
			// records) we can honestly report "使用 DSH 的第 N 天".
			function GreetingSection({ t, stats }) {
				let days = null;
				const first = stats && stats.firstUsedAt;
				if (Number.isFinite(first)) {
					const now = new Date();
					now.setHours(0, 0, 0, 0);
					const start = new Date(first);
					start.setHours(0, 0, 0, 0);
					days = Math.max(1, Math.floor((now.getTime() - start.getTime()) / DAY_MS) + 1);
				}
				return h("section", { style: { marginBottom: 4 } },
					h("div", { style: { fontSize: 28, fontWeight: 600, color: D.text } }, t("hello")),
					days !== null && h("div", { style: { marginTop: 4, fontSize: 13, color: D.text2 } }, t("greeting.days", { n: String(days) })),
				);
			}
			//#endregion

			//#region TokenDashboard — full page composition, fed by a StatsView
			function TokenDashboard({ t, stats, scroll, activity, greeting }) {
				const [range, setRange] = useState("total");
				const sliced = rangeSlice(stats, range);
				const st = sliced || stats || { records: [], hours: new Array(24).fill(0), models: [], turns: 0, totalTokens: 0, firstUsedAt: null, scoped: false };
				const inner = h("div", { style: { padding: 20, paddingBottom: 40, background: D.bg, minHeight: "100%", boxSizing: "border-box" } },
					h(RangeSwitcher, { t, value: range, onChange: setRange }),
					// The greeting ("Day N") and the 52-week activity grid belong to
					// the workspace main panel (host aggregate). The
					// per-conversation tab shows only this session's live data, so
					// both are omitted there.
					greeting ? h(GreetingSection, { t, stats: st }) : null,
					activity ? h(ActivityHeatmap, { records: st.records, t }) : null,
					h(MetricRow, { tokensTotal: st.totalTokens, turns: st.turns, t }),
					h(PartnerCards, { models: st.models, t, scoped: st.scoped }),
					h(HourlyCurve, { hours: st.hours, t }),
					h(FooterNote, { t, range }),
				);
				// In the root main slot the outer container clips; wrap a scroll
				// viewport so the whole dashboard can be reached on short windows.
				return scroll ? h("div", { style: { height: "100%", overflowY: "auto", background: D.bg } }, inner) : inner;
			}
			//#endregion

		//#region ActivityHeatmap — GitHub style, Monday-aligned weeks
		// Aggregates usage by local day into a trailing 52-week window. The window
		// ends in the week that contains today and every column is a full Monday..
		// Sunday week, so the M/W/F gutter and the month header stay aligned and
		// today lands on its real weekday row (no column extends into the future).
		const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
		function buildWeeks(records) {
			const byDay = new Map();
			for (const r of records) {
				if (!Number.isFinite(r.time)) continue;
				const d = new Date(r.time);
				const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
				byDay.set(day, (byDay.get(day) || 0) + r.total);
			}
			const today = new Date();
			today.setHours(0, 0, 0, 0);
			// Align the last column to the Monday of the week containing today,
			// so row 0 is always Monday and no column extends into the future.
			const dow = (today.getDay() + 6) % 7; // 0=Mon .. 6=Sun
			const start = today.getTime() - dow * DAY_MS - 51 * 7 * DAY_MS;
			const weeks = [];
			for (let w = 0; w < 52; w += 1) {
				const col = [];
				for (let d = 0; d < 7; d += 1) {
					const day = start + (w * 7 + d) * DAY_MS;
					col.push({ day, total: byDay.get(day) || 0 });
				}
				weeks.push(col);
			}
			return { weeks, max: Math.max(1, ...byDay.values()), hasData: byDay.size > 0 };
		}
		function heatLevel(total, max) {
			if (!total) return 0;
			const ratio = total / max;
			if (ratio < 0.2) return 1;
			if (ratio < 0.4) return 2;
			if (ratio < 0.7) return 3;
			if (ratio < 0.9) return 4;
			return 5;
		}
		function colMonth(col, i) {
			const first = new Date(col[0].day);
			if (i === 0) return MONTHS[first.getMonth()];
			// Label a column only when it starts a new month versus the previous
			// column's first day. Columns are full weeks, so step back exactly
			// 7 days (the old "now - i days" form mislabeled nearly every week).
			const prev = new Date(col[0].day - 7 * DAY_MS);
			return prev.getMonth() !== first.getMonth() ? MONTHS[first.getMonth()] : "";
		}
		function rowLabel(i) {
			return ["M", "", "W", "", "F", "", ""][i] || null;
		}
		function ActivityHeatmap({ records, t }) {
			const [tip, setTip] = useState(null);
			const { weeks, max, hasData } = useMemo(() => buildWeeks(records), [records]);
			const gutter = 44, cell = 12, gap = 3;
			return h("section", { style: { background: D.card, border: "1px solid " + D.border, borderRadius: 8, padding: 20 } },
				h("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between" } },
					h("div", { style: { fontSize: 15, fontWeight: 600, color: D.text } }, t("heatmap.title")),
					h(InfoIcon, {}),
				),
				h("div", { style: { marginTop: 16, overflowX: "auto", paddingBottom: 6 } },
					h("div", { style: { minWidth: gutter + 52 * (cell + gap), marginTop: 14 } },
						// month header row — pitch matches week columns below
						h("div", { style: { display: "flex", gap: gap, marginBottom: 6 } },
							h("div", { style: { width: gutter, flex: "none" } }),
							// Label cells are exactly `cell` wide; the flex gap supplies
							// the pitch, so the header pitch equals the body column pitch.
							// Only month-boundary columns carry text; overflow stays
							// visible so 3-letter names spill into the empty cells that
							// follow instead of being clipped to "No"/"Ma".
							weeks.map((col, i) => h("div", { key: "m" + i, style: { width: cell, flex: "none", fontSize: 10, color: D.text3, whiteSpace: "nowrap" } }, colMonth(col, i))),
						),
						// body: gutter (M/W/F) + 52 week columns of 7 cells
						h("div", { style: { display: "flex", gap: gap } },
							h("div", { style: { display: "flex", flexDirection: "column", gap: gap, width: gutter, flex: "none", fontSize: 10, color: D.text3 } },
								[0, 1, 2, 3, 4, 5, 6].map((r) => h("div", { key: "r" + r, style: { height: cell, lineHeight: cell + "px" } }, rowLabel(r))),
							),
							weeks.map((col, i) => h("div", { key: "c" + i, onMouseLeave: () => setTip(null), style: { display: "flex", flexDirection: "column", gap: gap, flex: "none" } },
								col.map((d) => h("div", { key: d.day, onMouseEnter: (e) => setTip({ x: e.clientX, y: e.clientY, day: d.day, total: d.total }), className: D.cells[heatLevel(d.total, max)], style: { width: cell, height: cell, borderRadius: 2 } })),
							)),
						),
					),
				),
				!hasData && h("div", { style: { marginTop: 10, fontSize: 12, color: D.text3 } }, t("heatmap.empty")),
				h("div", { style: { display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4, marginTop: 10, fontSize: 11, color: D.text3 } },
					h("span", {}, t("heatmap.less")),
					[1, 2, 3, 4, 5].map((k) => h("span", { key: k, className: D.cells[k], style: { width: 10, height: 10, borderRadius: 2, display: "inline-block" } })),
					h("span", {}, t("heatmap.more")),
				),
				tip && h("div", { style: { position: "fixed", zIndex: 999, left: tip.x + 10, top: tip.y + 10, background: D.overlay, color: D.text, border: "1px solid " + D.border, borderRadius: 6, padding: "5px 8px", fontSize: 11, whiteSpace: "nowrap", pointerEvents: "none" } },
					h("div", {}, new Date(tip.day).toLocaleDateString()),
					h("div", { style: { color: D.brand } }, tip.total > 0 ? fmtTokens(tip.total) + " tokens" : "—"),
				),
			);
		}
		//#endregion

		//#region MetricRow — two stacked value blocks
		function MetricBlock({ label, value, caption, muted }) {
			return h("div", { style: { flex: 1, minWidth: 0 } },
				h("div", { style: { display: "flex", alignItems: "center", gap: 6, fontSize: 15, fontWeight: 600, color: D.text } },
					h("span", {}, label),
					h(InfoIcon, {}),
				),
				h("div", { style: { marginTop: 8, fontSize: 32, fontWeight: 600, lineHeight: 1, color: muted ? D.text3 : D.brand } },
					value, caption && h("span", { style: { marginLeft: 8, fontSize: 13, fontWeight: 400, color: D.text3 } }, caption)),
			);
		}
		function MetricRow({ tokensTotal, turns, t }) {
				const has = Number.isFinite(tokensTotal) && tokensTotal > 0;
				const turnsExact = Number.isFinite(turns) && turns >= 0;
				return h("section", { style: { marginTop: 16, display: "flex", gap: 20 } },
					h(MetricBlock, { label: t("metric.tokens"), value: has ? fmtTokens(tokensTotal) : "—", caption: has && turnsExact ? t("metric.tokens.calls", { n: String(turns) }) : null, muted: !has }),
					h(MetricBlock, { label: t("metric.turns"), value: turnsExact ? String(turns) : (has ? "—" : "—"), caption: null, muted: !has }),
				);
			}
		//#endregion

		//#region PartnerCards — best partner + model preference
		function ZzEmpty({ text }) {
			return h("div", { style: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: D.text3, gap: 10 } },
				h(ZzIcon, {}),
				h("div", { style: { fontSize: 13 } }, text),
			);
		}
		function UsageCard({ title, children }) {
			return h("section", { style: { flex: 1, minWidth: 0, background: D.card, border: "1px solid " + D.border, borderRadius: 8, padding: 20, height: 160 } },
				h("div", { style: { display: "flex", alignItems: "center", gap: 6, fontSize: 15, fontWeight: 600, color: D.text, marginBottom: 12 } },
					h("span", {}, title),
					h(InfoIcon, {}),
				),
				children,
			);
		}
		function PartnerCards({ models, t, scoped }) {
				const total = models.reduce((a, m) => a + m[1].tokens, 0);
				if (!models.length) {
					return h("section", { style: { marginTop: 16, display: "flex", gap: 16, flexWrap: "wrap" } },
						h(UsageCard, { title: t("partner.best") }, h(ZzEmpty, { text: scoped ? t("partner.scoped") : t("partner.empty") })),
						h(UsageCard, { title: t("partner.model") }, h(ZzEmpty, { text: scoped ? t("partner.scoped") : t("partner.empty") })),
					);
				}
				const best = models[0];
			return h("section", { style: { marginTop: 16, display: "flex", gap: 16, flexWrap: "wrap" } },
				h(UsageCard, { title: t("partner.best") },
					h("div", { style: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", textAlign: "center" } },
						h("div", { style: { fontSize: 16, fontWeight: 600, color: D.text } }, best[0]),
						h("div", { style: { fontSize: 22, fontWeight: 600, color: D.brand } }, fmtTokens(best[1].tokens)),
						h("div", { style: { fontSize: 12, color: D.text3 } }, t("partner.calls", { n: String(best[1].calls) })),
					)),
				h(UsageCard, { title: t("partner.model") },
					h("div", { style: { display: "flex", flexDirection: "column", gap: 10, justifyContent: "center", minHeight: 40 } },
						models.slice(0, 5).map(([model, stat]) => {
							const pct = total > 0 ? Math.round((stat.tokens / total) * 100) : 0;
							return h("div", { key: model, style: { fontSize: 12, color: D.text2 } },
								h("div", { style: { display: "flex", justifyContent: "space-between", marginBottom: 3 } },
									h("span", { style: { color: D.text2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, model),
									h("span", { style: { color: D.text3 } }, pct + "%"),
								),
								h("div", { style: { background: D.track, borderRadius: 3, height: 6, overflow: "hidden" } },
									h("div", { style: { width: pct + "%", height: "100%", background: D.brand, borderRadius: 3 } })),
							);
						}),
					)),
			);
		}
		//#endregion

		//#region HourlyCurve — real 24-hour usage curve across 06:00 -> next 06:00
		const W = 760, H = 200, PAD = 34, BASE_Y = H - PAD;
		// Chart order for the 24 buckets: 06:00 at the left edge through 05:00,
		// so the curve is monotonic left→right across the midnight wrap.
		const CHART_HOURS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5];
		function hourX(h) { return ((h - 6 + 24) % 24) / 24 * W; }
		// Catmull-Rom → cubic Bézier smoothing through the given [x, y] points.
		function smoothPath(pts) {
			if (pts.length < 2) return "";
			let d = "M" + pts[0][0].toFixed(1) + "," + pts[0][1].toFixed(1);
			for (let i = 0; i < pts.length - 1; i += 1) {
				const p0 = pts[i - 1] || pts[i];
				const p1 = pts[i];
				const p2 = pts[i + 1];
				const p3 = pts[i + 2] || p2;
				d += "C" + (p1[0] + (p2[0] - p0[0]) / 6).toFixed(1) + "," + (p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)
					+ " " + (p2[0] - (p3[0] - p1[0]) / 6).toFixed(1) + "," + (p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)
					+ " " + p2[0].toFixed(1) + "," + p2[1].toFixed(1);
			}
			return d;
		}
		function HourlyCurve({ hours, t }) {
				const data = useMemo(() => {
					const arr = (hours && hours.slice()) || new Array(24).fill(0);
					const max = Math.max(0, ...arr);
					const yFor = (v) => (max > 0 ? BASE_Y - (v / max) * (H - PAD * 2) : BASE_Y);
					const pts = CHART_HOURS.map((hh) => [hourX(hh), yFor(arr[hh])]);
					// Close the loop at the right edge with the wrapped 06:00 value
					// so the curve and its fill reach the edge instead of stopping
					// one bucket short.
					const linePts = pts.concat([[W, yFor(arr[6])]]);
					return { arr, max, line: smoothPath(linePts), pts };
				}, [hours]);
			const area = data.max > 0 && data.line ? data.line + "L" + W + "," + BASE_Y + "L0," + BASE_Y + "Z" : "";
			const ticks = [
				[hourX(6), "06:00"], [hourX(12), "12:00"], [hourX(18), "18:00"],
				[hourX(0), "0:00"], [W, "06:00"],
			];
			return h("section", { style: { marginTop: 16, background: D.card, border: "1px solid " + D.border, borderRadius: 8, padding: 20 } },
				h("div", { style: { display: "flex", alignItems: "center", gap: 6, fontSize: 15, fontWeight: 600, color: D.text } },
					h("span", {}, t("curve.title")), h(InfoIcon, {}),
				),
				h("div", { style: { marginTop: 12, fontSize: 12, color: D.text3, position: "relative" } },
					h("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", style: { display: "block" } },
						// grid lines + dashed base (style-based so theme var() resolves)
						[0.25, 0.5, 0.75].map((g) => h("line", { key: "g" + g, x1: 0, x2: W, y1: BASE_Y - (H - PAD * 2) * g, y2: BASE_Y - (H - PAD * 2) * g, strokeWidth: 1, style: { stroke: D.border } })),
						h("line", { x1: 0, x2: W, y1: BASE_Y, y2: BASE_Y, strokeWidth: 1, strokeDasharray: "4 4", style: { stroke: D.text3 } }),
						// the curve IS the data (smoothed), with a soft area fill
						area && h("path", { d: area, style: { fill: D.brand, opacity: 0.15 } }),
						data.line && h("path", { d: data.line, fill: "none", strokeWidth: 2, strokeLinecap: "round", style: { stroke: D.brand } }),
						// one node per hour on the curve (solid=has data, hollow=empty)
						data.pts.map(([cx, cy], i) => {
							const has = data.arr[CHART_HOURS[i]] > 0;
							return h("circle", { key: "c" + i, cx, cy, r: 4, strokeWidth: 1, style: has ? { fill: D.brand, stroke: "none" } : { fill: "none", stroke: D.border } });
						}),
						ticks.map(([x, lbl], i) => h("text", { key: "tk" + i, x: Math.min(x, W - 24), y: H - 8, fontSize: 11, textAnchor: "middle", style: { fill: D.text3 } }, lbl)),
					),
					data.max === 0 && h("div", { style: { position: "absolute", left: 0, right: 0, top: "38%", textAlign: "center", color: D.text3 } }, t("curve.empty")),
				),
			);
		}
		//#endregion

		//#region FooterNote
		function FooterNote({ t, range }) {
				if (range && range !== "total") {
					const label = RANGE_KEYS.find(r => r.key === range);
					if (label) {
						return h("div", { style: { marginTop: 14, fontSize: 12, color: D.text3 } },
							t("footer.note").replace(/全部历史会话/, `${t(label.i18n)} (聚合自全部历史会话)`));
					}
				}
				return h("div", { style: { marginTop: 14, fontSize: 12, color: D.text3 } }, t("footer.note"));
			}
			//#endregion

		//#region session view tab — the real data source
		// Reads per-turn token usage through the ChatView-standard `useChat`
		// selector (props injected by the conversation.view ring). Every settled
		// turn carries a tokenUsage field; we forward those records into the
		// shared account so the root main panel renders the same live data.
		function collectRecords(nodeStore) {
			const out = [];
			if (!nodeStore || typeof nodeStore.values !== "function") return out;
			for (const node of nodeStore.values()) {
				const data = node && node.data ? node.data : null;
				if (!data) continue;
				const tu = data.tokenUsage;
				if (!tu || typeof tu.totalTokens !== "number") continue;
				// Keep the same "provider/model" keying as the host aggregate so
				// the live fallback and the history view name models identically.
				const route0 = (tu.routes && tu.routes[0]) || null;
				const model = route0 && route0.model
					? (route0.provider ? route0.provider + "/" + route0.model : route0.model)
					: "unknown";
				out.push({
					time: typeof data.time === "number" ? data.time : (node.time || 0),
					model,
					total: tu.totalTokens,
					input: tu.uncachedInputTokens || 0,
					output: tu.outputTokens || 0,
				});
			}
			out.sort((a, b) => a.time - b.time);
			return out;
		}
		function UsageTab({ useChat, t }) {
				const nodeStore = useChat ? useChat((s) => (s && s.nodes) || undefined) : undefined;
				const records = useMemo(() => collectRecords(nodeStore), [nodeStore]);
				const stats = useMemo(() => buildStatsFromLive(records), [records]);
				useEffect(() => { account.set(records); }, [records]);
				return h(TokenDashboard, { t, stats, activity: false, greeting: false });
			}
			//#endregion

			//#region root main panel — host aggregate (preferred) + live fallback
			// Data priority on desktop: the host half's cross-session aggregate (served
			// over 127.0.0.1) — this is the rich historical view. If the bridge is down
			// or empty, fall back to whatever the session tab has already streamed into
			// the shared account, then to an honest degraded state with a probe.
			function UsagePanel({ t }) {
				const hostStats = useHostStats();
				const liveRecords = useAccountRecords();
				const liveStats = useMemo(() => buildStatsFromLive(liveRecords), [liveRecords]);
				const hostReady = hostStats && (hostStats.totalTokens > 0 || hostStats.records.length > 0 || hostStats.turns > 0);
				const liveReady = liveStats && liveStats.totalTokens > 0;
				if (hostReady || liveReady) {
					return h(TokenDashboard, { t, stats: hostReady ? hostStats : liveStats, scroll: true, activity: true, greeting: true });
				}
				const probe = INSPECT + "\nusageBridge: " + BRIDGE_STATUS;
				return h("div", { style: { padding: 20, paddingBottom: 40, background: D.bg, minHeight: "100%", boxSizing: "border-box" } },
					h(GreetingSection, { t, stats: liveStats }),
					h("section", { style: { marginTop: 16, background: D.card, border: "1px solid " + D.border, borderRadius: 8, padding: 20 } },
						h("div", { style: { fontSize: 15, fontWeight: 600, color: D.text, marginBottom: 8 } }, t("panel.noData.title")),
						h("div", { style: { fontSize: 13, color: D.text2, lineHeight: 1.6 } }, t("panel.noData.desc")),
					),
					h("section", { style: { marginTop: 16, background: D.card, border: "1px solid " + D.border, borderRadius: 8, padding: 20 } },
						h("div", { style: { display: "flex", alignItems: "center", gap: 6, fontSize: 15, fontWeight: 600, color: D.text, marginBottom: 8 } },
							h("span", {}, t("panel.debug.title")), h(InfoIcon, {}),
						),
						h("div", { style: { fontSize: 12, color: D.text2, fontFamily: "ui-monospace, monospace", whiteSpace: "pre-wrap", wordBreak: "break-all", lineHeight: 1.6 } },
							probe || t("panel.debug.none")),
					),
					h(FooterNote, { t }),
				);
			}
			//#endregion

		//#region plugin body
		function apply(ctx, config) {
				const sessionTabEnabled = !(config && config.sessionTab === false);
				// Mirrors the host Config so the renderer knows where to poll the bridge.
				const httpCfg = (config && config.dashboard && config.dashboard.http) || {};
				if (httpCfg.enabled !== false) {
					const host = httpCfg.host || "127.0.0.1";
					const port = typeof httpCfg.port === "number" ? httpCfg.port : 47820;
					USAGE_URL = "http://" + host + ":" + port + "/api/usage";
				}
				// Runtime data probe: record + log exactly what DSH gave this bundle,
				// so an actual availability report replaces any guessing.
				try {
					INSPECT = "ctx: [" + (safeKeys(ctx).join(", ") || "(none)") + "]\n"
						+ "locale: " + (typeof ctx.locale !== "undefined") + "\n"
						+ "slots: " + (typeof ctx.slots !== "undefined") + "\n"
						+ "sessionQuery: " + (typeof ctx.sessionQuery !== "undefined") + "\n"
						+ "chat: " + (typeof ctx.chat !== "undefined") + "\n"
						+ "sessions: " + (typeof ctx.sessions !== "undefined") + "\n"
						+ "webServer: " + (typeof ctx.webServer !== "undefined");
					console.log("[token-usage] data probe:", INSPECT);
				} catch (e) {
					INSPECT = "probe error: " + (e && e.message);
					console.error("[token-usage] probe failed", e);
				}
			const t = ctx.locale.bind(LOCALE_NS);
			ctx.effect(() => ctx.locale.register(LOCALE_NS, { zh, en }), "token-usage: dictionaries");
			// Inject the theme-aware heat-cell palette (HEAT_CSS). Cordis effect
			// callbacks run IMMEDIATELY and must return the disposer, so the tag
			// is created inside the callback and removal is returned from it —
			// removing the tag from the callback body would delete it the moment
			// it is appended (leaving every tu-cell class unstyled/transparent).
			if (typeof document !== "undefined" && document.head) {
				ctx.effect(() => {
					const heatStyle = document.createElement("style");
					heatStyle.setAttribute("data-token-usage-heat", "1");
					heatStyle.textContent = HEAT_CSS;
					document.head.appendChild(heatStyle);
					return () => heatStyle.remove();
				}, "token-usage: heat palette css");
			}

			ctx.slots.inject("sidebar.panellist", () => ctx.slots.register(
				{ name: "sidebar.panellist", id: MAIN_KEY, order: 0, label: () => t("panel.label") },
				UsageIcon,
			));
			ctx.slots.inject("main", () => ctx.slots.register(
				{ name: "main", key: MAIN_KEY, locale: LOCALE_NS, inject: () => ({ t }) },
				UsagePanel,
			));

			if (sessionTabEnabled) {
				ctx.effect(() => ctx.slots.inject("conversation.view", () => ctx.slots.register(
					{ name: "conversation.view", id: VIEW_ID, order: 0, label: () => t("conversation.label"), locale: LOCALE_NS },
					UsageTab,
				)), "token-usage: session view tab");
			}
		}
		//#endregion

		exports.name = PLUGIN_NAME;
		exports.inject = ["slots", "locale"];
		exports.apply = apply;
		return module.exports;
	},
});