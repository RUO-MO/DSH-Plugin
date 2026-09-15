window.__ModuleLoader__.load({
	id: "dsh-deepseek-web",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		const { createElement: h, useCallback, useEffect, useRef, useState } = react;

		//#region shared constants (keep in sync with lib/index.js)
		const PLUGIN_NAME = "deepseek-web";
		const LOCALE_NS = "deepseekWeb";
		const PANEL_ID = "deepseek-web";
		const PING_PATH = "/dsh-deepseek-web/ping";
		const PROBE_BASE_PORT = 3838;
		const PROBE_PORT_COUNT = 11;
		const PROBE_TIMEOUT_MS = 800;
		const DEFAULT_UPSTREAM = "https://chat.deepseek.com";
		const DEFAULT_START_PATH = "/";
		//#endregion

		//#region probe cache — survives panel unmounts so re-opening is instant
		let cachedBase;
		let cachedStartPath;
		//#endregion

		//#region locales
		const zh = {
			"panel.label": "DeepSeek 网页",
			"panel.probing": "正在连接本地代理（127.0.0.1:3838+）…",
			"panel.title": "DeepSeek 网页",
			"panel.body":
				"chat.deepseek.com 禁止被 iframe 直接嵌入（CSP frame-ancestors 'none'），本插件通过 Harness 进程内的本地回环代理内嵌网页版。未探测到代理，通常是插件未随 Harness 启动，或配置端口范围内没有空闲端口。",
			"panel.retry": "重试",
			"panel.copy": "复制直链",
			"panel.copied": "已复制",
			"panel.open": "在浏览器打开",
		};
		const en = {
			"panel.label": "DeepSeek Web",
			"panel.probing": "Connecting to the local proxy (127.0.0.1:3838+)…",
			"panel.title": "DeepSeek Web",
			"panel.body":
				"chat.deepseek.com refuses direct embedding (CSP frame-ancestors 'none'); this plugin embeds the web chat through a loopback reverse proxy inside the Harness process. No proxy answered, so the plugin is probably not loaded with this Harness instance, or every configured port was taken.",
			"panel.retry": "Retry",
			"panel.copy": "Copy link",
			"panel.copied": "Copied",
			"panel.open": "Open in browser",
		};
		//#endregion

		//#region panel icon (sidebar.panellist registrant receives { size, active })
		function PanelIcon({ size }) {
			return h(
				"svg",
				{
					width: size,
					height: size,
					viewBox: "0 0 24 24",
					fill: "none",
					stroke: "currentColor",
					strokeWidth: 2,
					strokeLinecap: "round",
					strokeLinejoin: "round",
					"aria-hidden": true,
				},
				h("path", { d: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" }),
			);
		}
		//#endregion

		//#region proxy discovery
		async function probePorts() {
			for (let offset = 0; offset < PROBE_PORT_COUNT; offset += 1) {
				const base = `http://127.0.0.1:${PROBE_BASE_PORT + offset}`;
				try {
					const controller = new AbortController();
					const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
					const answer = await fetch(base + PING_PATH, { signal: controller.signal });
					clearTimeout(timer);
					if (!answer.ok) continue;
					const data = await answer.json();
					if (data !== null && typeof data === "object" && data.plugin === "dsh-deepseek-web") {
						return {
							base,
							startPath: typeof data.startPath === "string" && data.startPath.startsWith("/")
								? data.startPath
								: DEFAULT_START_PATH,
						};
					}
				} catch {
					// Closed port, abort, or non-JSON service: keep scanning.
				}
			}
			return null;
		}
		//#endregion

		//#region fallback card (proxy unreachable)
		const CARD_STYLE = {
			width: "100%",
			height: "100%",
			display: "flex",
			flexDirection: "column",
			alignItems: "center",
			justifyContent: "center",
			gap: 14,
			padding: 32,
			textAlign: "center",
			color: "var(--dsw-text-secondary, rgba(255, 255, 255, 0.62))",
		};
		const CARD_TITLE_STYLE = {
			fontSize: 16,
			fontWeight: 600,
			color: "var(--dsw-text-primary, rgba(255, 255, 255, 0.9))",
		};
		const CARD_BODY_STYLE = { maxWidth: 460, lineHeight: 1.7, fontSize: 13 };
		const CARD_ROW_STYLE = { display: "flex", gap: 10, marginTop: 6 };
		const BUTTON_STYLE = {
			padding: "6px 14px",
			borderRadius: 8,
			border: "1px solid var(--dsw-border, rgba(255, 255, 255, 0.14))",
			background: "transparent",
			color: "inherit",
			fontSize: 13,
			cursor: "pointer",
		};

		function FallbackCard({ t, onRetry, busy }) {
			const [copied, setCopied] = useState(false);
			const target = DEFAULT_UPSTREAM + (cachedStartPath ?? DEFAULT_START_PATH);
			const isElectron = navigator.userAgent.includes("Electron");
			const copy = useCallback(() => {
				void navigator.clipboard?.writeText(target).then(() => {
					setCopied(true);
					setTimeout(() => setCopied(false), 1600);
				}, () => {});
			}, [target]);
			return h(
				"div",
				{ style: CARD_STYLE },
				h("div", { style: CARD_TITLE_STYLE }, t("panel.title")),
				h("div", { style: CARD_BODY_STYLE }, t("panel.body")),
				h(
					"div",
					{ style: CARD_ROW_STYLE },
					h("button", { type: "button", style: BUTTON_STYLE, disabled: busy, onClick: onRetry }, t("panel.retry")),
					h("button", { type: "button", style: BUTTON_STYLE, onClick: copy }, copied ? t("panel.copied") : t("panel.copy")),
					!isElectron && h(
						"button",
						{ type: "button", style: BUTTON_STYLE, onClick: () => window.open(target, "_blank") },
						t("panel.open"),
					),
				),
			);
		}
		//#endregion

		//#region main panel ('main' keyed slot, key deepseek-web)
		const FRAME_STYLE = { width: "100%", height: "100%", border: "0", display: "block", background: "#111318" };

		function DeepSeekPanel({ t }) {
			const [status, setStatus] = useState(cachedBase === undefined ? "probing" : "ready");
			const latestProbe = useRef(0);
			useEffect(() => {
				if (cachedBase !== undefined) return;
				const ticket = ++latestProbe.current;
				probePorts().then((found) => {
					if (ticket !== latestProbe.current) return;
					if (found === null) {
						setStatus("failed");
						return;
					}
					cachedBase = found.base;
					cachedStartPath = found.startPath;
					setStatus("ready");
				});
			}, []);
			const onRetry = useCallback(() => {
				cachedBase = undefined;
				latestProbe.current += 1;
				const ticket = latestProbe.current;
				setStatus("probing");
				probePorts().then((found) => {
					if (ticket !== latestProbe.current) return;
					if (found === null) {
						setStatus("failed");
						return;
					}
					cachedBase = found.base;
					cachedStartPath = found.startPath;
					setStatus("ready");
				});
			}, []);
			if (status === "probing") {
				return h("div", { style: CARD_STYLE }, h("div", { style: CARD_BODY_STYLE }, t("panel.probing")));
			}
			if (status === "failed" || cachedBase === undefined) {
				return h(FallbackCard, { t, onRetry, busy: status === "probing" });
			}
			return h(
				"div",
				{ style: { width: "100%", height: "100%", overflow: "hidden" } },
				h("iframe", {
					src: cachedBase + (cachedStartPath ?? DEFAULT_START_PATH),
					title: t("panel.title"),
					style: FRAME_STYLE,
					allow: "clipboard-read; clipboard-write",
				}),
			);
		}
		//#endregion

		//#region plugin body: sidebar row above the workspace section + main panel
		function apply(ctx) {
			const t = ctx.locale.bind(LOCALE_NS);
			ctx.effect(() => ctx.locale.register(LOCALE_NS, { zh, en }), "deepseek-web: dictionaries");
			ctx.slots.inject("sidebar.panellist", () => ctx.slots.register(
				{ name: "sidebar.panellist", id: PANEL_ID, order: 0, label: () => t("panel.label") },
				PanelIcon,
			));
			ctx.slots.inject("main", () => ctx.slots.register(
				{ name: "main", key: PANEL_ID, locale: LOCALE_NS, inject: () => ({ t }) },
				DeepSeekPanel,
			));
		}
		//#endregion

		exports.name = PLUGIN_NAME;
		exports.inject = ["slots", "locale"];
		exports.apply = apply;
		return module.exports;
	},
});
