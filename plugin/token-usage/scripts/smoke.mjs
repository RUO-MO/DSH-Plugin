// Independent smoke test for dsh-plugin-token-usage.
//   host half: imports lib/index.js and runs apply() against a fake ctx.
//   client half: stubs window.__ModuleLoader__/require("react"), executes the
//   bundle factory, and runs apply() to prove the registration scaffolding
//   resolves without throwing.
// This is a build-free check — the plugin ships as plain JS, no compilation.
import assert from "node:assert/strict";

async function hostSmoke() {
	const host = await import("../lib/index.js");
	assert.equal(typeof host.apply, "function", "host half must export apply()");
	assert.equal(host.name, "token-usage");
	assert.ok(Array.isArray(host.inject), "host inject must be an array");

	const disposed = [];
	const ctx = { effect: (fn) => { const d = fn(); if (typeof d === "function") disposed.push(d); } };
	// Disable the 127.0.0.1 usage bridge during the smoke so it does not bind a port.
	host.apply(ctx, { sessionTab: true, dashboard: { http: { enabled: false } } });
	assert.equal(disposed.length, 1, "host apply() must register one effect disposer");
	disposed.forEach((d) => d()); // unload leaves nothing behind
	console.log("[host] OK — apply(xxx){...} registers an effect and unloads cleanly (bridge off).");
}

async function clientSmoke() {
	let captured = null;
	globalThis.window = {
		__ModuleLoader__: {
			load: (spec) => { captured = spec; },
		},
	};
	const reactStub = {
		createElement: (type) => ({ type }),
		useEffect: () => {},
		useMemo: (fn) => (typeof fn === "function" ? fn() : undefined),
		useState: (initial) => [initial, () => {}],
	};
	const load = new URL("../lib/client.js", import.meta.url);

	// client.js evaluates top-level, calling window.__ModuleLoader__.load(factory).
	await import(load.href);
	assert.ok(captured !== null, "client bundle must call __ModuleLoader__.load()");
	assert.equal(typeof captured.factory, "function");

	let registered = [];
	const slots = {
		inject: (slot, thunk) => { registered.push({ slot, thunk }); return () => {}; },
		register: () => {},
	};
	let bound = null;
	// Effect contract (mirrors the harness): the callback runs IMMEDIATELY and
	// may return a disposer. Collect disposers per apply() so unload is testable.
	const disposers = [];
	// Minimal document stub so the heat-palette <style> injection is exercised.
	const headChildren = [];
	globalThis.document = {
		head: { appendChild: (el) => { headChildren.push(el); } },
		createElement: (tag) => ({
			tagName: tag,
			attrs: {},
			textContent: "",
			setAttribute(k, v) { this.attrs[k] = v; },
			remove() { const i = headChildren.indexOf(this); if (i >= 0) headChildren.splice(i, 1); },
		}),
	};
	const heatStyles = () => headChildren.filter((el) => el.tagName === "style" && el.attrs["data-token-usage-heat"] === "1");
	const ctx = {
		effect: (fn) => { const d = fn(); if (typeof d === "function") disposers.push(d); },
		locale: { register: () => {}, bind: () => ((k) => k) },
		slots,
	};
	// Bind ctx.slots to the module's own register so evaluate() closures resolve.
	slots.register = (opts, comp) => ({ opts, comp });

	const mod = captured.factory((reqId) => {
		if (reqId === "react") return reactStub;
		throw new Error("unexpected require: " + reqId);
	});
	assert.equal(mod.name, "token-usage");
	assert.deepEqual(mod.inject, ["slots", "locale"]);

	// Case 1: sessionTab enabled (default) => registers sidebar + main + conversation.view.
	registered = [];
	disposers.length = 0;
	mod.apply(ctx, { sessionTab: true });
	const slotsInjected = registered.map((r) => r.slot);
	assert.ok(slotsInjected.includes("sidebar.panellist"), "must inject sidebar.panellist");
	assert.ok(slotsInjected.includes("main"), "must inject main");
	assert.ok(slotsInjected.includes("conversation.view"), "session tab must be present when enabled");
	// Heat palette: apply() must leave exactly one themed <style> in <head>…
	assert.equal(heatStyles().length, 1, "apply() must inject the heat palette <style>");
	assert.ok(heatStyles()[0].textContent.includes(".tu-cell-0"), "heat <style> must carry the tu-cell ramp");
	// …and unload must remove it. Regression guard: the effect callback runs
	// immediately, so the tag must be created inside it and removal returned —
	// a callback body that removes the tag would leave zero styles after apply().
	disposers.forEach((d) => d());
	assert.equal(heatStyles().length, 0, "unload must remove the heat palette <style>");
	console.log("[client] OK — enabled registers sidebar + main + conversation.view tab; heat <style> injects and unloads.");

	// Case 2: sessionTab disabled => no conversation.view registration.
	registered = [];
	mod.apply(ctx, { sessionTab: false });
	const slots2 = registered.map((r) => r.slot);
	assert.ok(!slots2.includes("conversation.view"), "session tab must be omitted when disabled");
	console.log("[client] OK — disabled omits the session tab (main + sidebar remain).");

	return mod;
}

await hostSmoke();
await clientSmoke();
console.log("smoke passed: host + client registration scaffolding resolve and degrade as specified.");