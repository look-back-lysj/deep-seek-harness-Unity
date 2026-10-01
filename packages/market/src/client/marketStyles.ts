export const MARKET_CSS = `
.eac-market-host { position: relative; display: flex; flex: 1 1 0%; height: 100%; min-height: 0; min-width: 0; overflow: hidden; }
.eac-market {
  --eac-page: var(--dsw-alias-bg-base, #f7f8fa);
  --eac-panel: var(--dsw-alias-bg-layer-1, #fff);
  --eac-panel-2: var(--dsw-alias-bg-layer-2, #f1f3f5);
  --eac-text: var(--dsw-alias-label-primary, #202124);
  --eac-text-2: var(--dsw-alias-label-secondary, #5f6368);
  --eac-text-3: var(--dsw-alias-label-secondary, #626970);
  --eac-border: var(--dsw-alias-border-l1, #dfe2e6);
  --eac-border-strong: var(--dsw-alias-border-l3, #b7bdc5);
  --eac-link: var(--dsw-alias-link, #2563eb);
  --eac-accent: var(--dsw-alias-state-business-primary, var(--dsw-alias-link, #2563eb));
  --eac-success: var(--dsw-alias-state-success-primary, #0f6b3f);
  --eac-success-bg: var(--dsw-alias-state-success-tertiary, #e9f7ef);
  --eac-warning: var(--dsw-alias-state-warn-label, #704500);
  --eac-warning-bg: var(--dsw-alias-state-warn-tertiary, #fff4ce);
  --eac-danger: var(--dsw-alias-state-error-primary, #c62828);
  --eac-danger-bg: var(--dsw-alias-state-error-tertiary, #fdecea);
  --eac-info-bg: var(--dsw-alias-state-business-tertiary, #eaf1ff);
  --eac-radius-sm: var(--dsw-radius-sm, 8px);
  --eac-radius-md: var(--dsw-radius-md, 12px);
  --eac-radius-lg: var(--dsw-radius-lg, 16px);  --eac-space-1: 4px;
  --eac-space-2: 8px;
  --eac-space-3: 12px;
  --eac-space-4: 16px;
  --eac-space-5: 24px;
  --eac-space-6: 32px;
  --eac-space-7: 40px;
  --eac-shadow-popover: var(--dsw-shadow-lv2, 0 12px 30px rgba(20, 28, 40, .14));
  --eac-shadow-modal: var(--dsw-shadow-lv3, 0 22px 70px rgba(20, 28, 40, .20));
  --eac-duration-fast: 120ms;
  --eac-duration-standard: 180ms;
  --eac-duration-panel: 240ms;
  --eac-ease-enter: cubic-bezier(.2, .8, .2, 1);
  --eac-ease-exit: cubic-bezier(.4, 0, 1, 1);
  box-sizing: border-box; padding: 8px;
  container-type: inline-size;
  container-name: eac-market;
  display: flex; flex-direction: column; flex: 1 1 0%; height: 100%; min-height: 0; min-width: 0; overflow: hidden;
  color: var(--eac-text);
  background: var(--eac-page);
  font-family: var(--dsw-font-family, system-ui, -apple-system, "Segoe UI", sans-serif);
  font-size: 14px;
  line-height: 1.6;
  font-variant-numeric: tabular-nums;
}
.eac-market *, .eac-market *::before, .eac-market *::after { box-sizing: border-box; }
.eac-market button, .eac-market input, .eac-market textarea, .eac-market select { font: inherit; }
.eac-market button { letter-spacing: 0; }
.eac-market :focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--eac-accent));
  outline-offset: 2px;
}
.eac-market ::selection { background: color-mix(in srgb, var(--eac-accent) 25%, transparent); }
.eac-market__scroll { flex: 1 1 0%; min-height: 0; min-width: 0; overflow: auto; overscroll-behavior: contain; scrollbar-gutter: stable; scrollbar-color: var(--dsw-alias-scrollbar-bg-l2, var(--eac-border-strong)) transparent; }
.eac-market__shell { min-height: 100%; display: flex; flex-direction: column; }
.eac-market__topbar {
  position: sticky; top: 0; z-index: 20; min-height: 56px; padding: 10px 24px;
  display: flex; align-items: center; gap: 16px; background: color-mix(in srgb, var(--eac-page) 92%, transparent);
  border-bottom: 1px solid var(--eac-border);
}
.eac-market__brand { display: flex; align-items: baseline; gap: 10px; min-width: max-content; }
.eac-market__brand strong { font-size: 18px; font-weight: 720; letter-spacing: -0.02em; }
.eac-market__brand span { color: var(--eac-text-3); font-size: 12px; }
.eac-market__nav { display: flex; gap: 2px; min-width: 0; }
.eac-market__nav button, .eac-market__top-action {
  min-height: 36px; padding: 6px 11px; border: 0; border-radius: var(--eac-radius-sm);
  color: var(--eac-text-2); background: transparent; cursor: pointer;
}
.eac-market__nav button:hover, .eac-market__top-action:hover { color: var(--eac-text); background: var(--dsw-alias-interactive-bg-hover, var(--eac-panel-2)); }
.eac-market__nav button[aria-current="page"] { color: var(--eac-text); background: var(--dsw-alias-interactive-bg-active, var(--eac-panel-2)); font-weight: 650; }
.eac-market__top-spacer { flex: 1; }
.eac-market__top-actions { display: flex; align-items: center; gap: 4px; }
.eac-market__task-count {
  display: inline-flex; min-width: 18px; height: 18px; padding: 0 5px; margin-left: 5px; align-items: center; justify-content: center;
  border-radius: 9px; color: var(--eac-text-2); background: var(--eac-panel-2); font-size: 11px;
}
.eac-market__menu-wrap { position: relative; }
.eac-market__menu {
  position: absolute; right: 0; top: calc(100% + 6px); width: 190px; padding: 6px; z-index: 30;
  border: 1px solid var(--eac-border); border-radius: var(--eac-radius-md); background: var(--eac-panel);
  box-shadow: var(--dsw-shadow-lv2, 0 10px 30px rgba(0,0,0,.12));
}
.eac-market__menu button {
  display: flex; width: 100%; min-height: 36px; padding: 7px 10px; align-items: center;
  border: 0; border-radius: var(--eac-radius-sm); color: var(--eac-text); background: transparent; text-align: left; cursor: pointer;
}
.eac-market__menu button:hover { background: var(--dsw-alias-interactive-bg-hover, var(--eac-panel-2)); }
.eac-market__main { width: min(1200px, 100%); margin: 0 auto; padding: 24px; }
.eac-market__page-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; margin-bottom: 20px; }
.eac-market__page-head h1, .eac-market__page-head h2 { margin: 0 0 5px; font-size: 24px; line-height: 1.25; letter-spacing: -0.025em; }
.eac-market__page-head p { max-width: 72ch; margin: 0; color: var(--eac-text-2); }
.eac-market__eyebrow { margin: 0 0 3px; color: var(--eac-text-2); font-size: 12px; font-weight: 650; }
.eac-market__toolbar { display: grid; grid-template-columns: minmax(240px, 1fr) auto; gap: 12px; align-items: center; margin: 18px 0; }
.eac-market__search { width: 100%; }
.eac-market__search input { min-height: 40px; width: 100%; }
.eac-market__filters { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.eac-market__filters select {
  min-height: 36px; padding: 5px 28px 5px 10px; border: 1px solid var(--eac-border); border-radius: var(--eac-radius-sm);
  color: var(--eac-text); background: var(--eac-panel);
}
.eac-market__advanced {
  display: flex; gap: 12px; align-items: center; margin: -4px 0 18px; padding: 12px;
  border-top: 1px solid var(--eac-border); border-bottom: 1px solid var(--eac-border);
}
.eac-market__advanced label { display: flex; align-items: center; gap: 6px; color: var(--eac-text-2); }
.eac-market__section { margin: 30px 0; }
.eac-market__section-head { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 16px; align-items: baseline; margin-bottom: 13px; }
.eac-market__section-head h2 { margin: 0; font-size: 18px; letter-spacing: -0.015em; }
.eac-market__section-head p { margin: 0; color: var(--eac-text-2); }
.eac-market__section-head > .eac-market__link { flex: 0 0 auto; white-space: nowrap; }
.eac-market__featured { margin-top: 6px; }
.eac-market__poster { display: grid; grid-template-columns: minmax(260px, 1.15fr) minmax(260px, .85fr); min-height: 248px; overflow: hidden; border: 1px solid var(--eac-border); border-radius: var(--eac-radius-lg); background: var(--eac-panel); }
.eac-market__poster-art { display: flex; min-height: 248px; width: 100%; padding: 0; align-items: center; justify-content: center; overflow: hidden; border: 0; color: var(--eac-link); background: var(--eac-info-bg); cursor: pointer; }
.eac-market__poster-art img { display: block; width: 100%; height: 100%; min-height: 248px; object-fit: cover; }
.eac-market__poster-art > span { font-size: clamp(48px, 8vw, 96px); font-weight: 760; }
.eac-market__poster-fallback-copy { display: grid; max-width: 82%; gap: 8px; padding: 20px; text-align: left; color: var(--eac-text); }
.eac-market__poster-fallback-copy strong { font-size: clamp(22px, 3vw, 34px); line-height: 1.15; overflow-wrap: anywhere; }
.eac-market__poster-fallback-copy small { color: var(--eac-text-2); font-size: 14px; line-height: 1.6; overflow-wrap: anywhere; }
.eac-market__poster-copy { display: flex; flex-direction: column; justify-content: center; min-width: 0; padding: 24px; }
.eac-market__poster-copy h3 { margin: 0 0 8px; font-size: 24px; line-height: 1.2; overflow-wrap: anywhere; }
.eac-market__poster-copy > p:not(.eac-market__poster-kicker):not(.eac-market__recommendation) { margin: 0; color: var(--eac-text-2); }
.eac-market__poster-kicker { margin: 0 0 4px; color: var(--eac-link); font-size: 12px; font-weight: 700; }
.eac-market__poster-copy .eac-market__recommendation { margin: 14px 0 18px; color: var(--eac-text-2); }
.eac-market__poster-controls { display: flex; align-items: center; gap: 8px; color: var(--eac-text-2); font-size: 12px; }
.eac-market__poster-controls button { min-height: 30px; padding: 3px 8px; border: 1px solid var(--eac-border); border-radius: var(--eac-radius-sm); color: var(--eac-text); background: var(--eac-panel); cursor: pointer; }
.eac-market__poster-controls button:hover { border-color: var(--eac-border-strong); background: var(--eac-panel-2); }
.eac-market__poster--fallback .eac-market__poster-art { background: linear-gradient(135deg, var(--eac-info-bg), var(--eac-panel-2)); }
.eac-market__ranked-item { position: relative; min-width: 0; }
.eac-market__score { position: absolute; top: 9px; right: 9px; z-index: 1; min-width: 38px; padding: 2px 7px; border: 1px solid color-mix(in srgb, var(--eac-accent) 38%, var(--eac-border)); border-radius: 999px; color: var(--eac-link); background: var(--eac-info-bg); font-size: 12px; font-weight: 700; text-align: center; }
.eac-market__link {
  padding: 2px; border: 0; color: var(--eac-link); background: transparent; cursor: pointer; text-decoration: underline;
  text-underline-offset: 3px; text-decoration-thickness: 1px;
}
.eac-market__hero {
  display: grid; grid-template-columns: minmax(0, 1.7fr) minmax(240px, .8fr); gap: 16px;
  min-height: 230px; padding: 24px; border: 1px solid var(--eac-border); border-radius: var(--eac-radius-lg);
  background: var(--eac-panel);
}
.eac-market__hero h1 { max-width: 18ch; margin: 0 0 10px; font-size: 28px; line-height: 1.18; letter-spacing: -0.035em; }
.eac-market__hero p { max-width: 62ch; margin: 0; color: var(--eac-text-2); font-size: 15px; }
.eac-market__hero-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 22px; }
.eac-market__steps { display: grid; gap: 12px; align-content: center; padding-left: 20px; border-left: 1px solid var(--eac-border); }
.eac-market__step { display: grid; grid-template-columns: 24px 1fr; gap: 9px; align-items: start; }
.eac-market__step-number {
  display: inline-flex; width: 24px; height: 24px; align-items: center; justify-content: center; border-radius: 50%;
  color: var(--eac-link); background: var(--eac-info-bg); font-size: 12px; font-weight: 700;
}
.eac-market__step strong { display: block; font-size: 13px; }
.eac-market__step span { color: var(--eac-text-2); font-size: 12px; }
.eac-market__grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.eac-market__grid--two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.eac-market__card {
  position: relative; min-width: 0; padding: 16px; border: 1px solid var(--eac-border); border-radius: var(--eac-radius-md);
  background: var(--eac-panel); transition: border-color 160ms ease;
}
.eac-market__card:hover { border-color: var(--eac-border-strong); }
.eac-market__plugin-card { display: grid; grid-template-rows: auto auto 1fr auto; min-height: 182px; }
.eac-market__plugin-top { display: flex; align-items: flex-start; gap: 11px; min-width: 0; }
.eac-market__plugin-icon {
  display: inline-flex; flex: 0 0 38px; width: 38px; height: 38px; align-items: center; justify-content: center;
  border: 1px solid var(--eac-border); border-radius: 10px; color: var(--eac-link); background: var(--eac-info-bg); font-weight: 750;
}
.eac-market__plugin-title { min-width: 0; overflow-wrap: anywhere; }
.eac-market__plugin-title h3 {
  margin: 0; display: -webkit-box; overflow: hidden; font-size: 16px; line-height: 1.35;
  overflow-wrap: anywhere; -webkit-box-orient: vertical; -webkit-line-clamp: 2;
}
.eac-market__plugin-title p {
  margin: 2px 0 0; display: -webkit-box; overflow: hidden; color: var(--eac-text-2); font-size: 12px; line-height: 1.45;
  overflow-wrap: anywhere; -webkit-box-orient: vertical; -webkit-line-clamp: 2;
}
.eac-market__usage-guidance { margin: -4px 0 12px; color: var(--eac-text-2); font-size: 12px; }
.eac-market__plugin-summary {
  margin: 12px 0; display: -webkit-box; overflow: hidden; color: var(--eac-text-2); -webkit-box-orient: vertical; -webkit-line-clamp: 2;
}
.eac-market__plugin-bottom { display: flex; justify-content: space-between; gap: 10px; align-items: flex-end; }
.eac-market__tags { display: flex; flex-wrap: wrap; gap: 5px; min-width: 0; }
.eac-market__button-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.eac-market__action-reason {
  margin: 10px 0 0; color: var(--eac-text-2); font-size: 12px; line-height: 1.5; overflow-wrap: anywhere;
}
.eac-market__diagnostics { margin: 8px 0 0; color: var(--eac-text-2); font-size: 12px; }
.eac-market__diagnostics summary { cursor: pointer; font-weight: 650; }
.eac-market__diagnostics ul { margin: 7px 0 0; padding-left: 18px; }
.eac-market__diagnostics li + li { margin-top: 4px; }
.eac-market__status {
  display: inline-flex; min-height: 24px; padding: 2px 8px; align-items: center; gap: 5px;
  border: 1px solid var(--eac-border); border-radius: 6px; color: var(--eac-text-2); background: var(--eac-panel-2);
  font-size: 12px; font-weight: 650; line-height: 1.35;
}
.eac-market__status--success { color: var(--eac-success); background: var(--eac-success-bg); border-color: color-mix(in srgb, var(--eac-success) 38%, var(--eac-border)); }
.eac-market__status--warning { color: var(--eac-warning); background: var(--eac-warning-bg); border-color: color-mix(in srgb, var(--eac-warning) 38%, var(--eac-border)); }
.eac-market__status--danger { color: var(--eac-danger); background: var(--eac-danger-bg); border-color: color-mix(in srgb, var(--eac-danger) 38%, var(--eac-border)); }
.eac-market__status--info { color: var(--eac-link); background: var(--eac-info-bg); border-color: color-mix(in srgb, var(--eac-link) 38%, var(--eac-border)); }
.eac-market__empty, .eac-market__error {
  padding: 32px 24px; border: 1px dashed var(--eac-border-strong); border-radius: var(--eac-radius-md); color: var(--eac-text-2); text-align: center;
}
.eac-market__empty h2, .eac-market__error h2 { margin: 0 0 7px; color: var(--eac-text); font-size: 18px; }
.eac-market__empty p, .eac-market__error p { max-width: 58ch; margin: 0 auto 16px; }
.eac-market__error { border-style: solid; border-color: color-mix(in srgb, var(--eac-danger) 35%, var(--eac-border)); background: var(--eac-danger-bg); }
.eac-market__loading { display: grid; gap: 12px; padding: 22px 0; }
.eac-market__skeleton { height: 18px; border-radius: 5px; background: var(--eac-panel-2); animation: eac-pulse 1.2s ease-in-out infinite; }
.eac-market__skeleton:nth-child(2) { width: 72%; }
.eac-market__skeleton:nth-child(3) { width: 45%; }
@keyframes eac-pulse { 50% { opacity: .55; } }
.eac-market__detail { display: grid; grid-template-columns: minmax(0, 1.65fr) minmax(250px, .75fr); gap: 24px; align-items: start; }
.eac-market__detail-main, .eac-market__detail-side { min-width: 0; }
.eac-market__detail-side { position: sticky; top: 78px; padding: 16px; border: 1px solid var(--eac-border); border-radius: var(--eac-radius-md); background: var(--eac-panel); }
.eac-market__plugin-head { display: flex; align-items: flex-start; gap: 14px; margin: 14px 0; }
.eac-market__plugin-head h1 { margin: 0; font-size: 25px; line-height: 1.22; letter-spacing: -0.03em; }
.eac-market__plugin-head p { margin: 3px 0 0; color: var(--eac-text-2); }
.eac-market__lead { margin: 14px 0 20px; color: var(--eac-text-2); font-size: 15px; }
.eac-market__facts { display: grid; grid-template-columns: 120px minmax(0, 1fr); gap: 7px 12px; margin: 0; }
.eac-market__facts dt { color: var(--eac-text-3); }
.eac-market__facts dd { min-width: 0; margin: 0; overflow-wrap: anywhere; }
.eac-market__notice {
  padding: 12px 14px; border: 1px solid var(--eac-border); border-radius: var(--eac-radius-sm);
  color: var(--eac-text-2); background: var(--eac-panel-2);
}
.eac-market__notice--warning { border-color: color-mix(in srgb, var(--eac-warning) 35%, var(--eac-border)); color: var(--eac-warning); background: var(--eac-warning-bg); }
.eac-market__notice--danger { border-color: color-mix(in srgb, var(--eac-danger) 35%, var(--eac-border)); color: var(--eac-danger); background: var(--eac-danger-bg); }
.eac-market__gallery { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin: 18px 0; }
.eac-market__gallery > button { padding: 0; overflow: hidden; border: 1px solid var(--eac-border); border-radius: var(--eac-radius-md); background: var(--eac-panel-2); cursor: zoom-in; }
.eac-market__gallery > button:hover { border-color: var(--eac-border-strong); }
.eac-market__gallery img { display: block; width: 100%; height: 170px; object-fit: cover; background: var(--eac-panel-2); }
.eac-market__gallery-fallback {
  min-width: 0; min-height: 170px; padding: 16px; display: grid; grid-template-columns: 32px minmax(0, 1fr); gap: 10px 12px;
  align-content: center; border: 1px dashed var(--eac-border-strong); border-radius: var(--eac-radius-md);
  color: var(--eac-text-2); background: var(--eac-panel-2);
}
.eac-market__gallery-fallback .eac-button { grid-column: 2; justify-self: start; }
.eac-market__fallback-icon {
  width: 32px; height: 32px; padding: 5px; border: 1px solid var(--eac-border); border-radius: var(--eac-radius-sm);
  color: var(--eac-text-2); background: var(--eac-panel); fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round;
}
.eac-market__fallback-copy { min-width: 0; display: grid; gap: 3px; }
.eac-market__fallback-copy strong { color: var(--eac-text); font-size: 14px; }
.eac-market__fallback-copy span, .eac-market__fallback-copy small { overflow-wrap: anywhere; }
.eac-market__fallback-source { color: var(--eac-text-3); }
.eac-market__prose { max-width: 75ch; color: var(--eac-text); }
.eac-market__prose h1, .eac-market__prose h2, .eac-market__prose h3 { line-height: 1.3; letter-spacing: -0.02em; }
.eac-market__prose a { color: var(--eac-link); text-underline-offset: 3px; }
.eac-market__prose code { font-family: var(--dsw-font-markdown-code, ui-monospace, monospace); }
.eac-market__table-wrap { overflow-x: auto; border: 1px solid var(--eac-border); border-radius: var(--eac-radius-md); }
.eac-market__table { width: 100%; border-collapse: collapse; }
.eac-market__table th, .eac-market__table td { padding: 10px 12px; border-bottom: 1px solid var(--eac-border); text-align: left; vertical-align: top; }
.eac-market__table th { color: var(--eac-text-2); background: var(--eac-panel-2); font-size: 12px; font-weight: 650; }
.eac-market__table tr:last-child td { border-bottom: 0; }
.eac-market__pagination { display: flex; justify-content: center; gap: 8px; align-items: center; margin: 20px 0; }
.eac-market__pagination span { color: var(--eac-text-2); }
.eac-market__drawer-backdrop { position: fixed; inset: 0; z-index: 60; background: rgba(0,0,0,.28); }
.eac-market__drawer {
  position: absolute; top: 0; right: 0; z-index: 61; width: min(520px, 100%); height: 100%; min-height: 100%; overflow: auto;
  border-left: 1px solid var(--eac-border); background: var(--eac-page); box-shadow: -16px 0 48px rgba(0,0,0,.16);
}
.eac-market__drawer-head {
  position: sticky; top: 0; z-index: 2; display: flex; justify-content: space-between; gap: 16px; align-items: center;
  padding: 18px 20px; border-bottom: 1px solid var(--eac-border); background: var(--eac-page);
}
.eac-market__drawer-head h2 { margin: 0; font-size: 19px; }
.eac-market__drawer-body { display: grid; gap: 12px; padding: 18px 20px 40px; }
.eac-market__task { padding: 15px; border: 1px solid var(--eac-border); border-radius: var(--eac-radius-md); background: var(--eac-panel); }
.eac-market__task-head { display: flex; justify-content: space-between; gap: 12px; align-items: start; }
.eac-market__task-head h3 { margin: 0; font-size: 15px; line-height: 1.4; }
.eac-market__task-head > .eac-market__status { flex: 0 0 auto; }
.eac-market__task .eac-market__action-reason { margin-top: 8px; }
.eac-market__task p { margin: 6px 0 0; color: var(--eac-text-2); }
.eac-market__progress { height: 5px; overflow: hidden; margin: 12px 0; border-radius: 3px; background: var(--eac-panel-2); }
.eac-market__progress div { height: 100%; background: var(--eac-accent); }
.eac-market__event-list { margin: 10px 0 0; padding: 0; list-style: none; }
.eac-market__event-list li { display: grid; grid-template-columns: 8px 1fr; gap: 8px; padding: 5px 0; color: var(--eac-text-2); font-size: 12px; }
.eac-market__event-list li::before { content: ""; width: 6px; height: 6px; margin-top: 7px; border-radius: 50%; background: var(--eac-border-strong); }
.eac-market__event-list li[data-level="warning"]::before { background: var(--eac-warning); }
.eac-market__event-list li[data-level="error"]::before { background: var(--eac-danger); }
.eac-market__form { display: grid; gap: 16px; }
.eac-market__field { display: grid; gap: 6px; }
.eac-market__field > label { font-weight: 650; }
.eac-market__field small { color: var(--eac-text-2); }
.eac-market__field input, .eac-market__field textarea, .eac-market__field select {
  width: 100%; min-height: 40px; padding: 8px 10px; border: 1px solid var(--eac-border); border-radius: var(--eac-radius-sm);
  color: var(--eac-text); background: var(--eac-panel);
}
.eac-market__field textarea { min-height: 300px; resize: vertical; line-height: 1.65; }
.eac-market__split { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; align-items: start; }
.eac-market__preview { min-height: 420px; padding: 18px; border: 1px solid var(--eac-border); border-radius: var(--eac-radius-md); background: var(--eac-panel); }
.eac-market__settings-list { border-top: 1px solid var(--eac-border); }
.eac-market__system-group { margin-top: 18px; border-top: 1px solid var(--eac-border); }
.eac-market__system-group summary { padding: 14px 0; color: var(--eac-text-2); cursor: pointer; font-weight: 650; }
.eac-market__group-warning { display: inline-block; margin-inline-start: 12px; color: var(--eac-warning); font-weight: 500; }
.eac-market__group-action { display: inline-block; margin-inline-start: 12px; color: var(--eac-link); font-size: 12px; }
.eac-market__system-group summary:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--eac-accent)); outline-offset: 2px; }
.eac-market__system-note { margin: 0 0 12px; color: var(--eac-text-2); }
.eac-market__system-group .eac-market__grid { padding-bottom: 12px; }
.eac-market__setting {
  display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 18px; align-items: center;
  padding: 16px 0; border-bottom: 1px solid var(--eac-border);
}
.eac-market__setting h3 { margin: 0 0 3px; font-size: 15px; }
.eac-market__skin-entry h2, .eac-market__skin-center .eac-market__setting h2 { margin: 0 0 4px; font-size: 17px; }
.eac-market__skin-entry { margin-bottom: 20px; }
.eac-market__skin-search { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.eac-market__skin-search input { width: min(100%, 280px); }
.eac-market__skin-controls { padding: 12px 4px; overflow-wrap: anywhere; }
.eac-market__skin-controls p { margin: 6px 0; color: var(--eac-text-2); }
.eac-market__skin-center .eac-market__setting .eac-market__button-row { max-width: 320px; }
.eac-market__pending-list { list-style: none; padding: 0; margin: 0; }
.eac-market__pending-list .eac-market__setting { overflow-wrap: anywhere; }
.eac-market__pending-list a { color: var(--eac-link); text-underline-offset: 3px; }
.eac-market__setting p { max-width: 68ch; margin: 0; color: var(--eac-text-2); }
.eac-market__help-steps { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.eac-market__help-step { padding: 18px 0; border-top: 2px solid var(--eac-border-strong); }
.eac-market__help-step h3 { margin: 8px 0 4px; }
.eac-market__help-step p { margin: 0; color: var(--eac-text-2); }
.eac-market__footer-note { margin: 32px 0 8px; padding-top: 16px; border-top: 1px solid var(--eac-border); color: var(--eac-text-3); font-size: 12px; }
.eac-market__sr-only {
  position: absolute !important; width: 1px !important; height: 1px !important; padding: 0 !important; margin: -1px !important;
  overflow: hidden !important; clip: rect(0, 0, 0, 0) !important; white-space: nowrap !important; border: 0 !important;
}
@container eac-market (max-width: 999px) {
  .eac-market__grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .eac-market__detail { grid-template-columns: 1fr; }
  .eac-market__detail-side { position: static; order: -1; }
}
@container eac-market (max-width: 719px) {
  .eac-market__topbar { align-items: flex-start; flex-wrap: wrap; padding: 10px 16px; gap: 8px; }
  .eac-market__page-head { align-items: flex-start; flex-direction: column; gap: 6px; }
  .eac-market__section-head { display: grid; grid-template-columns: 1fr; gap: 6px; }
  .eac-market__section-head > .eac-market__link { justify-self: start; }
  .eac-market__brand { width: 100%; justify-content: space-between; }
  .eac-market__nav { width: 100%; overflow-x: auto; }
  .eac-market__top-actions { margin-left: auto; }
  .eac-market__main { padding: 16px; }
  .eac-market__poster { grid-template-columns: 1fr; }
  .eac-market__poster-art, .eac-market__poster-art img { min-height: 180px; max-height: 240px; }
  .eac-market__poster-copy { padding: 18px; }
  .eac-market__toolbar { grid-template-columns: 1fr; }
  .eac-market__hero { grid-template-columns: 1fr; padding: 18px; }
  .eac-market__hero h1 { font-size: 23px; }
  .eac-market__steps { padding: 16px 0 0; border-left: 0; border-top: 1px solid var(--eac-border); }
  .eac-market__grid, .eac-market__grid--two, .eac-market__split, .eac-market__help-steps { grid-template-columns: 1fr; }
  .eac-market__gallery { grid-template-columns: 1fr; }
  .eac-market__plugin-bottom, .eac-market__setting { align-items: stretch; grid-template-columns: 1fr; }
  .eac-market__plugin-bottom .eac-market__button-row { justify-content: flex-end; }
  .eac-market__button-row > .eac-button, .eac-market__gallery-fallback > .eac-button { min-height: 44px; }
  .eac-market__gallery-fallback { grid-template-columns: 1fr; text-align: left; }
  .eac-market__gallery-fallback .eac-button { grid-column: 1; }
  .eac-market__fallback-icon { width: 36px; height: 36px; }
}
@media (prefers-reduced-motion: reduce) {
  .eac-market *, .eac-market *::before, .eac-market *::after {
    scroll-behavior: auto !important; animation: none !important; transition: none !important;
  }
  .eac-button:active:not(:disabled) { transform: none; }
}
@media (forced-colors: active) {
  .eac-market__status, .eac-market__card, .eac-market__notice { border: 1px solid CanvasText; }
}

.eac-button {
  display: inline-flex; min-height: 36px; padding: 6px 12px; align-items: center; justify-content: center; gap: 6px;
  border: 1px solid transparent; border-radius: var(--eac-radius-sm); cursor: pointer;
  color: var(--eac-text); background: transparent; text-decoration: none;
}
.eac-button--sm { min-height: 30px; padding: 4px 9px; font-size: 12px; }
.eac-button--primary { color: #fff; background: var(--eac-accent); }
.eac-button--primary:hover { background: color-mix(in srgb, var(--eac-accent) 86%, black); }
.eac-button--outline { border-color: var(--eac-border-strong); background: var(--eac-panel); }
.eac-button--outline:hover, .eac-button--ghost:hover, .eac-button--toolbar:hover { background: var(--dsw-alias-interactive-bg-hover, var(--eac-panel-2)); }
.eac-button:hover:not(:disabled) { filter: brightness(.98); }
.eac-button:active:not(:disabled) { transform: translateY(1px); }
.eac-button:disabled {
  color: var(--eac-text-2); border-color: var(--eac-border); background: var(--eac-panel-2);
  cursor: not-allowed; filter: none; opacity: 1; transform: none;
}
.eac-button[aria-busy="true"] { cursor: progress; }
.eac-button[aria-busy="true"]::after {
  content: ""; width: 12px; height: 12px; margin-inline-start: 7px; border: 2px solid currentColor;
  border-right-color: transparent; border-radius: 50%; animation: eac-spin 700ms linear infinite;
}
@keyframes eac-spin { to { transform: rotate(360deg); } }
.eac-input {
  min-height: 38px; padding: 7px 10px; border: 1px solid var(--eac-border); border-radius: var(--eac-radius-sm);
  color: var(--eac-text); background: var(--eac-panel);
}
.eac-input::placeholder { color: var(--eac-text-3); }
.eac-tag {
  display: inline-flex; min-height: 22px; padding: 1px 7px; align-items: center; border: 1px solid var(--eac-border);
  border-radius: 999px; color: var(--eac-text-2); background: var(--eac-panel-2); font-size: 11px;
}
.eac-tag--success { color: var(--eac-success); background: var(--eac-success-bg); }
.eac-tag--info { color: var(--eac-link); background: var(--eac-info-bg); }
.eac-tag--warning { color: var(--eac-warning); background: var(--eac-warning-bg); }
.eac-tag--danger { color: var(--eac-danger); background: var(--eac-danger-bg); }
.eac-pill { min-height: 32px; padding: 5px 11px; border: 1px solid var(--eac-border); border-radius: 999px; color: var(--eac-text-2); background: var(--eac-panel); cursor: pointer; }
.eac-pill--active { color: #fff; border-color: var(--eac-accent); background: var(--eac-accent); }
.eac-modal-overlay {
  position: fixed; inset: 0; z-index: 100; display: grid; padding: 20px; place-items: center;
  background: rgba(0, 0, 0, .38);
}
.eac-modal {
  width: min(680px, 100%); max-height: min(820px, calc(100vh - 40px)); overflow: hidden; display: grid; grid-template-rows: auto 1fr auto;
  border: 1px solid var(--eac-border); border-radius: var(--eac-radius-lg); color: var(--eac-text); background: var(--eac-panel);
  box-shadow: 0 22px 70px rgba(0, 0, 0, .24);
}
.eac-modal__head { display: flex; justify-content: space-between; gap: 18px; align-items: start; padding: 18px 20px; border-bottom: 1px solid var(--eac-border); }
.eac-modal__head h2 { margin: 0; font-size: 19px; }
.eac-modal__head p { margin: 4px 0 0; color: var(--eac-text-2); }
.eac-modal__content { overflow: auto; padding: 18px 20px; }
.eac-modal__footer { padding: 14px 20px; border-top: 1px solid var(--eac-border); }
.eac-code { margin: 14px 0; overflow: hidden; border: 1px solid var(--eac-border); border-radius: var(--eac-radius-md); background: var(--eac-panel-2); }
.eac-code__bar { display: flex; justify-content: space-between; align-items: center; padding: 5px 8px 5px 12px; border-bottom: 1px solid var(--eac-border); color: var(--eac-text-2); font-size: 12px; }
.eac-code pre { margin: 0; padding: 14px; overflow-x: auto; color: var(--eac-text); font: var(--dsw-font-markdown-code, 12px/1.6 ui-monospace, monospace); }
.eac-market__prose ul, .eac-market__prose ol { padding-left: 22px; }
.eac-market__prose li + li { margin-top: 5px; }
@media (max-width: 719px) {
  .eac-market__section-head { display: grid !important; grid-template-columns: 1fr !important; gap: 6px !important; }
  .eac-market__section-head > .eac-market__link { justify-self: start !important; }
}
.eac-market__drawer,
.eac-modal-overlay {
  --eac-page: var(--dsw-alias-bg-base, #f7f8fa);
  --eac-panel: var(--dsw-alias-bg-layer-1, #fff);
  --eac-panel-2: var(--dsw-alias-bg-layer-2, #f1f3f5);
  --eac-text: var(--dsw-alias-label-primary, #202124);
  --eac-text-2: var(--dsw-alias-label-secondary, #5f6368);
  --eac-text-3: var(--dsw-alias-label-secondary, #626970);
  --eac-border: var(--dsw-alias-border-l1, #dfe2e6);
  --eac-border-strong: var(--dsw-alias-border-l3, #b7bdc5);
  --eac-link: var(--dsw-alias-link, #2563eb);
  --eac-accent: var(--dsw-alias-state-business-primary, var(--dsw-alias-link, #2563eb));
  --eac-success: var(--dsw-alias-state-success-primary, #0f6b3f);
  --eac-success-bg: var(--dsw-alias-state-success-tertiary, #e9f7ef);
  --eac-warning: var(--dsw-alias-state-warn-label, #704500);
  --eac-warning-bg: var(--dsw-alias-state-warn-tertiary, #fff4ce);
  --eac-danger: var(--dsw-alias-state-error-primary, #c62828);
  --eac-danger-bg: var(--dsw-alias-state-error-tertiary, #fdecea);
  --eac-info-bg: var(--dsw-alias-state-business-tertiary, #eaf1ff);
  --eac-radius-sm: var(--dsw-radius-sm, 8px);
  --eac-radius-md: var(--dsw-radius-md, 12px);
  --eac-radius-lg: var(--dsw-radius-lg, 16px);  --eac-space-1: 4px;
  --eac-space-2: 8px;
  --eac-space-3: 12px;
  --eac-space-4: 16px;
  --eac-space-5: 24px;
  --eac-space-6: 32px;
  --eac-space-7: 40px;
  --eac-shadow-popover: var(--dsw-shadow-lv2, 0 12px 30px rgba(20, 28, 40, .14));
  --eac-shadow-modal: var(--dsw-shadow-lv3, 0 22px 70px rgba(20, 28, 40, .20));
  --eac-duration-fast: 120ms;
  --eac-duration-standard: 180ms;
  --eac-duration-panel: 240ms;
  --eac-ease-enter: cubic-bezier(.2, .8, .2, 1);
  --eac-ease-exit: cubic-bezier(.4, 0, 1, 1);
}
/* Dialogs share the official palette and keyboard affordances even outside main. */
.eac-modal-overlay, .eac-modal-overlay * { box-sizing: border-box; }
.eac-modal-overlay { font: 14px/1.6 var(--dsw-font-family, system-ui, sans-serif); }
.eac-modal-overlay :focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--eac-accent)); outline-offset: 3px; }
.eac-modal-overlay button, .eac-modal-overlay input { font: inherit; }
.eac-modal-overlay ::selection { background: color-mix(in srgb, var(--eac-accent) 25%, transparent); }
.eac-market__main, .eac-modal__content { overflow-wrap: anywhere; }
.eac-market__task-list, .eac-market__plan-items { display: grid; gap: 16px; }
.eac-market__plan-items { padding: 0; margin: 0; list-style: none; }
.eac-market__plan-items li { padding: 10px 0; border-bottom: 1px solid var(--eac-border); }
.eac-market__plan-items p { margin: 4px 0; }
.eac-market__task-items { padding-left: 20px; }
.eac-market__task .eac-market__notice { margin-top: 12px; }
.eac-market__task details { margin-top: 12px; }
.eac-market__task h4 { margin: 0; }
.eac-market__recommendation { color: var(--eac-text-2); margin: 0 0 8px; }
.eac-market__discover-head { align-items: flex-start; padding-block: 8px; }
.eac-market__author-layout { display: grid; grid-template-columns: minmax(160px, 220px) minmax(0, 1fr); gap: 24px; }
.eac-market__author-layout > * { min-width: 0; }
.eac-market__draft-list { margin: 12px 0; padding: 0; list-style: none; }
.eac-market__draft-list button { width: 100%; padding: 10px; text-align: left; background: transparent; color: var(--eac-text); border: 1px solid transparent; border-radius: var(--eac-radius-sm); overflow-wrap: anywhere; cursor: pointer; }
.eac-market__draft-list button:hover, .eac-market__draft-list button[aria-current="true"] { background: var(--eac-panel-2); border-color: var(--eac-border); }
.eac-market__draft-list small { display: block; color: var(--eac-text-2); }
.eac-market__media-list { list-style: none; margin: 0; padding: 0; }
.eac-market__media-list li { display: grid; grid-template-columns: 72px minmax(0, 1fr); gap: 8px; margin-block: 12px; align-items: center; }
.eac-market__media-list img { width: 72px; height: 60px; object-fit: contain; }
.eac-market__prose img { display: block; max-width: 100%; height: auto; }
.eac-market__diff { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 45vh; overflow: auto; padding: 12px; background: var(--eac-panel-2); border: 1px solid var(--eac-border); font: inherit; }
.eac-market__detail-side summary { cursor: pointer; font-weight: 650; }
.eac-market__detail-side .eac-market__section-head { margin-top: 14px; }
.eac-market__field input, .eac-market__field textarea { caret-color: var(--eac-accent); }
@container eac-market (max-width: 850px) { .eac-market__author-layout { grid-template-columns: 1fr; } }
@media (max-width: 600px) {
  .eac-modal-overlay { padding: 12px; }
  .eac-modal { max-height: calc(100dvh - 24px); min-width: 0; }
  .eac-modal__head, .eac-modal__content { padding: 14px; }
  .eac-modal .eac-market__split { grid-template-columns: 1fr; }
  .eac-market__task-head { flex-direction: column; gap: 6px; }
}
/* Compatibility baseline: these declarations must work before optional CSS enhancements. */
.eac-market :focus { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--eac-accent)); outline-offset: 2px; }
.eac-market :focus:not(:focus-visible) { outline: none; }
.eac-market ::selection { background: var(--eac-info-bg); }
.eac-market__topbar { background: var(--eac-page); }
@supports not (container-type: inline-size) {
  .eac-market__grid { grid-template-columns: minmax(0, 1fr); }
  .eac-market__grid--two { grid-template-columns: minmax(0, 1fr); }
}
.eac-market__status--success { border-color: var(--eac-success); }
.eac-market__status--warning { border-color: var(--eac-warning); }
.eac-market__status--danger { border-color: var(--eac-danger); }
.eac-market__status--info { border-color: var(--eac-link); }
.eac-market__error { border-color: var(--eac-danger); }
.eac-market__notice--warning { border-color: var(--eac-warning); }
.eac-market__notice--danger { border-color: var(--eac-danger); }
.eac-button--primary { color: var(--dsw-alias-label-on-primary, #fff); background: var(--eac-accent); }
.eac-market__poster-controls button { min-height: 36px; }
.eac-market__poster-art { min-height: 220px; }
.eac-modal { max-height: calc(100vh - 40px); }
.eac-market__sr-only { position: absolute !important; width: 1px !important; height: 1px !important; padding: 0 !important; margin: -1px !important; overflow: hidden !important; clip: rect(0, 0, 0, 0) !important; white-space: nowrap !important; border: 0 !important; }
@media (max-width: 719px) {
  .eac-market__nav button, .eac-market__top-action, .eac-pill, .eac-market__poster-controls button { min-height: 44px; }
  .eac-market__topbar { padding: 8px 16px; }
}
@media (pointer: coarse) {
  .eac-market__nav button, .eac-market__top-action, .eac-pill, .eac-market__poster-controls button { min-height: 44px; }
}
@media (min-width: 320px) and (max-width: 559px) {
  .eac-market__poster { grid-template-columns: 1fr; }
  .eac-market__poster-art, .eac-market__poster-art img { min-height: 180px; max-height: 240px; }
  .eac-market__poster-copy { padding: 18px; }
}
@supports (height: 100dvh) {
  .eac-modal { max-height: min(820px, calc(100dvh - 40px)); }
}
@media (forced-colors: active) {
  .eac-market :focus, .eac-modal-overlay :focus { outline: 2px solid Highlight; outline-offset: 2px; }
  .eac-market__nav button[aria-current="page"], .eac-button--primary, .eac-pill--active { color: HighlightText; background: Highlight; forced-color-adjust: none; }
  .eac-market__status, .eac-market__card, .eac-market__notice, .eac-button, .eac-pill { border: 1px solid CanvasText; }
  .eac-market__status--success, .eac-market__status--warning, .eac-market__status--danger, .eac-market__status--info { color: CanvasText; background: Canvas; border-color: CanvasText; }
}
/* Navigation transitions: one bounded content motion, safe to disable. */
.eac-market__main { will-change: opacity, transform; }
.eac-market__main--entering { animation: eac-market-main-enter 240ms cubic-bezier(.2,.8,.2,1) both; }
@keyframes eac-market-main-enter {
  from { opacity: .76; transform: translateY(5px); }
  to { opacity: 1; transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  .eac-market__main { animation: none !important; transition: none !important; transform: none !important; }
}
.eac-market__discover-results { animation: eac-market-results-enter 180ms cubic-bezier(.2,.8,.2,1) both; }
@keyframes eac-market-results-enter {
  from { opacity: .72; transform: translateY(3px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Editorial marketplace pass: stronger hierarchy, fewer repeated cards, quieter motion. */
.eac-market__eyebrow {
  margin: 0 0 7px;
  color: var(--eac-link);
  font-size: 11px;
  font-weight: 750;
  letter-spacing: .08em;
  text-transform: uppercase;
}
.eac-market__page-head { padding-bottom: 20px; border-bottom: 1px solid var(--eac-border); }
.eac-market__page-head h1 { max-width: 18ch; font-size: clamp(27px, 3.4vw, 44px); line-height: 1.08; letter-spacing: -.045em; }
.eac-market__page-head p:not(.eac-market__eyebrow) { max-width: 56ch; }
.eac-market__section { margin: 40px 0; }
.eac-market__section + .eac-market__section { padding-top: 28px; border-top: 1px solid var(--eac-border); }
.eac-market__section-head { margin-bottom: 18px; }
.eac-market__section-head h2 { font-size: 20px; letter-spacing: -.025em; }
.eac-market__section-head p { max-width: 62ch; }
.eac-market__poster { min-height: 330px; grid-template-columns: minmax(0, 1.35fr) minmax(300px, .65fr); border-radius: var(--eac-radius-lg); border-color: var(--eac-border-strong); box-shadow: var(--dsw-shadow-lv1, 0 12px 32px rgba(20, 28, 40, .08)); }
.eac-market__poster-art { min-height: 330px; background: var(--eac-panel-2); }
.eac-market__poster-art img { min-height: 330px; }
.eac-market__poster-fallback-copy { max-width: 74%; gap: 11px; padding: 30px; }
.eac-market__poster-fallback-copy strong { font-size: clamp(25px, 3.8vw, 48px); letter-spacing: -.045em; }
.eac-market__poster-fallback-copy small { font-size: 15px; line-height: 1.65; }
.eac-market__poster-copy { padding: 32px; }
.eac-market__poster-copy h3 { max-width: 18ch; font-size: clamp(23px, 2.6vw, 34px); letter-spacing: -.04em; }
.eac-market__poster-kicker { letter-spacing: .08em; text-transform: uppercase; }
.eac-market__poster-controls { gap: 6px; }
.eac-market__poster-controls button { border-radius: 999px; }
.eac-market__skin-strip { margin-top: 34px; }
.eac-market__skin-grid { grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); }
.eac-market__skin-grid .eac-market__plugin-card { min-height: 172px; }
.eac-market__score-section .eac-market__grid { grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
.eac-market__score-section .eac-market__plugin-card { min-height: 194px; }
.eac-market__score-section .eac-market__ranked-item { display: grid; grid-template-columns: 42px minmax(0, 1fr); gap: 12px; align-items: stretch; }
.eac-market__score-section .eac-market__score { position: static; display: flex; min-width: 42px; height: 42px; align-items: center; justify-content: center; border-radius: 12px; }
.eac-market__grid { grid-template-columns: repeat(auto-fit, minmax(270px, 1fr)); gap: 16px; }
.eac-market__grid--two { grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); }
.eac-market__card { padding: 18px; border-radius: 14px; transition: transform 180ms cubic-bezier(.2,.8,.2,1), border-color 180ms ease, background-color 180ms ease; }
.eac-market__card:hover { transform: translateY(-2px); }
.eac-market__plugin-icon { width: 42px; height: 42px; flex-basis: 42px; border-radius: 12px; }
.eac-market__plugin-title h3 { font-size: 17px; }
.eac-market__plugin-summary { max-width: 48ch; }
.eac-market__plugin-bottom { padding-top: 14px; border-top: 1px solid var(--eac-border); }
.eac-market__button-row { gap: 7px; }

@media (max-width: 719px) {
  .eac-market__page-head h1 { max-width: none; font-size: 30px; }
  .eac-market__poster { min-height: 0; }
  .eac-market__poster-art, .eac-market__poster-art img { min-height: 210px; max-height: 280px; }
  .eac-market__poster-copy { padding: 22px; }
  .eac-market__poster-fallback-copy { max-width: 90%; padding: 22px; }
  .eac-market__score-section .eac-market__ranked-item { grid-template-columns: 34px minmax(0, 1fr); gap: 8px; }
  .eac-market__score-section .eac-market__score { min-width: 34px; height: 34px; border-radius: 10px; }
}
@media (prefers-reduced-motion: reduce) {
  .eac-market__card, .eac-market__main--entering, .eac-market__discover-results { transform: none !important; animation: none !important; transition: none !important; }
}.eac-market__skin-entry {
  display: flex; align-items: center; justify-content: space-between; gap: 18px;
  margin: 24px 0 6px; padding: 14px 0;
  border-top: 1px solid var(--eac-border); border-bottom: 1px solid var(--eac-border);
}
.eac-market__skin-entry-meta { display: flex; min-width: 0; align-items: center; gap: 12px; }
.eac-market__skin-entry-meta h2 { margin: 0; font-size: 15px; letter-spacing: -.01em; }
.eac-market__skin-entry-meta p { margin: 2px 0 0; color: var(--eac-text-2); font-size: 12px; }
.eac-market__skin-entry-mark { display: inline-flex; width: 42px; height: 42px; align-items: center; justify-content: center; border: 1px solid var(--eac-border-strong); border-radius: 50%; color: var(--eac-link); font-size: 9px; font-weight: 800; letter-spacing: .08em; }
.eac-market__skin-grid { display: flex; overflow-x: auto; overscroll-behavior-inline: contain; scroll-snap-type: x proximity; scrollbar-width: thin; }
.eac-market__skin-grid > div { flex: 0 0 min(320px, 82%); scroll-snap-align: start; }
.eac-market__skin-grid .eac-market__plugin-card { min-height: 168px; }
.eac-market__score-section .eac-market__grid { display: grid; grid-template-columns: 1fr; gap: 0; }
.eac-market__score-section .eac-market__ranked-item { grid-template-columns: 46px minmax(0, 1fr); padding: 12px 0; border-top: 1px solid var(--eac-border); }
.eac-market__score-section .eac-market__ranked-item:last-child { border-bottom: 1px solid var(--eac-border); }
.eac-market__score-section .eac-market__plugin-card { min-height: 0; padding: 8px 0; border: 0; border-radius: 0; background: transparent; box-shadow: none; }
.eac-market__score-section .eac-market__plugin-card:hover { transform: none; }
.eac-market__score-section .eac-market__plugin-bottom { border-top: 0; padding-top: 8px; }
.eac-market__score-section .eac-market__score { width: 38px; min-width: 38px; height: 38px; border: 0; border-radius: 50%; color: var(--eac-text-2); background: var(--eac-panel-2); font-size: 13px; }
@media (max-width: 719px) {
  .eac-market__skin-entry { align-items: flex-start; flex-direction: column; }
  .eac-market__skin-entry .eac-button { width: 100%; }
  .eac-market__score-section .eac-market__ranked-item { grid-template-columns: 36px minmax(0, 1fr); }
}/* Directory, detail and state surfaces. */
.eac-market__directory-meta { display: flex; justify-content: space-between; gap: 16px; margin: 18px 0 8px; color: var(--eac-text-2); font-size: 12px; }
.eac-market__directory-meta > span:first-child { color: var(--eac-text); font-weight: 700; font-variant-numeric: tabular-nums; }
.eac-market__directory-hint { color: var(--eac-text-3); }
.eac-market__directory-grid { align-items: stretch; }
.eac-market__directory-grid .eac-market__plugin-card { min-height: 206px; }
.eac-market__directory-grid .eac-market__plugin-summary { max-width: 58ch; }
.eac-market__directory-grid .eac-market__plugin-bottom { margin-top: 12px; }
.eac-market__advanced { padding: 14px; border: 1px solid var(--eac-border); border-radius: 12px; background: var(--eac-panel-2); }
.eac-market__advanced label { color: var(--eac-text-2); font-size: 12px; font-weight: 650; }
.eac-market__advanced select { margin-top: 5px; }
.eac-market__detail-side { box-shadow: none; }
.eac-market__detail-side h2, .eac-market__detail-side h3 { letter-spacing: -.02em; }
.eac-market__facts { padding-top: 12px; border-top: 1px solid var(--eac-border); }
.eac-market__facts dt { font-size: 12px; }
.eac-market__facts dd { font-size: 13px; }
.eac-market__plugin-head .eac-market__plugin-icon { width: 48px; height: 48px; flex-basis: 48px; }
.eac-market__notice { line-height: 1.55; }
.eac-market__notice .eac-button { margin-inline-start: 8px; }
.eac-market__plugin-card .eac-button { white-space: nowrap; }
@media (max-width: 719px) {
  .eac-market__directory-meta { align-items: flex-start; flex-direction: column; gap: 3px; }
  .eac-market__advanced { display: grid; gap: 12px; }
  .eac-market__notice .eac-button { display: block; margin: 9px 0 0; }
}
/* Stage 1 foundation: surfaces, typography, rhythm and control states. */
.eac-market__topbar { min-height: 64px; padding: 12px 28px; background: var(--eac-page); }
.eac-market__main { width: min(1280px, 100%); padding: 32px 32px 56px; }
.eac-market__page-head { margin-bottom: 28px; }
.eac-market__page-head h1 { margin: 0; color: var(--eac-text); font-weight: 740; }
.eac-market__page-head p:not(.eac-market__eyebrow) { margin: var(--eac-space-2) 0 0; color: var(--eac-text-2); }
.eac-market__section { margin: var(--eac-space-7) 0; }
.eac-market__section-head { margin-bottom: var(--eac-space-4); }
.eac-market__section-head h2 { color: var(--eac-text); font-weight: 720; }
.eac-market__section-head p { color: var(--eac-text-2); }
.eac-market__button-row { gap: var(--eac-space-2); }
.eac-market__card { border-radius: var(--eac-radius-md); box-shadow: none; transition: transform var(--eac-duration-standard) var(--eac-ease-enter), border-color var(--eac-duration-standard) ease, background-color var(--eac-duration-standard) ease; }
.eac-market__card:hover { border-color: var(--eac-border-strong); background: var(--eac-panel); }
.eac-market__card:focus-within { border-color: var(--eac-accent); }
.eac-button { transition: background-color var(--eac-duration-fast) ease, border-color var(--eac-duration-fast) ease, color var(--eac-duration-fast) ease, transform var(--eac-duration-fast) var(--eac-ease-enter); }
.eac-button:active:not(:disabled) { transform: scale(.985); }
.eac-pill { transition: background-color var(--eac-duration-fast) ease, border-color var(--eac-duration-fast) ease, color var(--eac-duration-fast) ease; }
.eac-market__status { transition: background-color var(--eac-duration-fast) ease, border-color var(--eac-duration-fast) ease, color var(--eac-duration-fast) ease; }
.eac-market__nav button, .eac-market__top-action { transition: background-color var(--eac-duration-fast) ease, color var(--eac-duration-fast) ease; }
.eac-market__section + .eac-market__section { padding-top: var(--eac-space-6); }
@media (max-width: 719px) {
  .eac-market__topbar { min-height: 56px; padding: 8px 16px; }
  .eac-market__main { padding: 24px 16px 40px; }
  .eac-market__section { margin: 32px 0; }
  .eac-market__section + .eac-market__section { padding-top: 24px; }
}
/* Stage 2: the featured item is an editorial stage, not an enlarged tile. */
.eac-market__featured { margin-top: 44px; }
.eac-market__featured .eac-market__section-head { align-items: end; }
.eac-market__poster { border-radius: 0; border-right: 0; border-left: 0; border-color: var(--eac-border-strong); box-shadow: none; background: transparent; }
.eac-market__poster-art { background: var(--eac-panel-2); border-right: 1px solid var(--eac-border); }
.eac-market__poster-art:hover { background: var(--eac-info-bg); }
.eac-market__poster-copy { min-height: 330px; background: var(--eac-panel); }
.eac-market__poster-copy h3 { max-width: 15ch; }
.eac-market__poster-copy .eac-market__button-row { margin-top: auto; padding-top: 20px; }
.eac-market__poster--fallback .eac-market__poster-art { background: var(--eac-panel-2); }
.eac-market__poster--fallback .eac-market__poster-art::after { content: ''; position: absolute; inset: 0; pointer-events: none; opacity: .24; background-image: linear-gradient(135deg, transparent 0 48%, var(--eac-border-strong) 49% 50%, transparent 51% 100%); background-size: 28px 28px; }
.eac-market__poster--fallback .eac-market__poster-art { position: relative; }
.eac-market__poster-fallback-copy { position: relative; z-index: 1; }
@media (max-width: 719px) {
  .eac-market__featured { margin-top: 32px; }
  .eac-market__poster-art { border-right: 0; border-bottom: 1px solid var(--eac-border); }
  .eac-market__poster-copy { min-height: 0; }
}.eac-market__skin-card { flex: 0 0 min(320px, 82%); display: grid; grid-template-columns: 78px minmax(0, 1fr); gap: 14px; padding: 14px 0; scroll-snap-align: start; border-top: 1px solid var(--eac-border); }
.eac-market__skin-card-art { display: flex; width: 78px; height: 78px; align-items: center; justify-content: center; border: 1px solid var(--eac-border-strong); border-radius: 50%; color: var(--eac-link); background: var(--eac-panel-2); font-size: 22px; font-weight: 760; cursor: pointer; }
.eac-market__skin-card-copy { min-width: 0; }
.eac-market__skin-card-copy h3 { margin: 0; font-size: 16px; letter-spacing: -.02em; }
.eac-market__skin-card-copy p { margin: 4px 0 0; color: var(--eac-text-2); font-size: 12px; line-height: 1.5; }
.eac-market__skin-card-reason { color: var(--eac-link) !important; }
.eac-market__skin-card .eac-market__button-row { margin-top: 10px; }
.eac-market__skin-grid { gap: 20px; }
.eac-market__skin-grid > div { flex: 0 0 min(360px, 82%); }
/* Stage 4: detail, management and task surfaces share one information hierarchy. */
.eac-market__detail { gap: 32px; }
.eac-market__detail-main { max-width: 78ch; }
.eac-market__detail-side { top: 88px; padding: 20px; border-radius: 14px; background: var(--eac-panel-2); }
.eac-market__detail-side details[open] summary { margin-bottom: 14px; }
.eac-market__detail-side .eac-market__section-head { margin-top: 16px; margin-bottom: 10px; }
.eac-market__plugin-head { margin: 20px 0 10px; }
.eac-market__plugin-head h1 { font-size: clamp(25px, 3vw, 36px); letter-spacing: -.04em; }
.eac-market__lead { max-width: 62ch; margin: 12px 0 22px; font-size: 16px; line-height: 1.7; }
.eac-market__detail-main > .eac-market__button-row { padding-bottom: 18px; border-bottom: 1px solid var(--eac-border); }
.eac-market__task-dialog .eac-modal__content { padding: 20px; }
.eac-market__task-list { gap: 24px; }
.eac-market__task { padding: 20px; border-radius: 14px; box-shadow: none; }
.eac-market__task + .eac-market__task { border-top: 1px solid var(--eac-border); }
.eac-market__task-head { padding-bottom: 12px; border-bottom: 1px solid var(--eac-border); }
.eac-market__task-head h3 { font-size: 17px; letter-spacing: -.02em; }
.eac-market__task-items { margin: 14px 0; padding: 0; list-style: none; }
.eac-market__task-items li { display: flex; justify-content: space-between; gap: 14px; padding: 9px 0; border-bottom: 1px solid var(--eac-border); color: var(--eac-text-2); font-size: 12px; }
.eac-market__task-items li:last-child { border-bottom: 0; }
.eac-market__task details { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--eac-border); }
.eac-market__task .eac-market__notice { margin-top: 16px; background: var(--eac-page); }
.eac-market__setting { padding: 18px 0; }
.eac-market__settings-list { border-top: 1px solid var(--eac-border); }
@media (max-width: 899px) {
  .eac-market__detail { gap: 20px; }
  .eac-market__detail-side { position: static; order: 0; }
}
@media (max-width: 719px) {
  .eac-market__detail { gap: 18px; }
  .eac-market__detail-main > .eac-market__button-row { align-items: stretch; flex-direction: column; }
  .eac-market__task { padding: 16px; }
  .eac-market__task-items li { align-items: flex-start; flex-direction: column; gap: 4px; }
}.eac-market__filter-summary { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 8px 0 14px; padding: 9px 0; border-bottom: 1px solid var(--eac-border); color: var(--eac-text-2); font-size: 12px; }
.eac-market__filter-summary > span { min-width: 0; overflow-wrap: anywhere; }
@media (max-width: 719px) { .eac-market__filter-summary { align-items: flex-start; flex-direction: column; } }

/* Unified async action feedback: one stable block for preparation, execution and recovery. */
.eac-market__action-feedback {
  display: grid;
  gap: 7px;
  margin: 12px 0;
  padding: 13px 15px;
  border: 1px solid var(--eac-border);
  border-radius: var(--eac-radius-md);
  color: var(--eac-text-2);
  background: var(--eac-panel);
  box-shadow: 0 5px 18px rgba(20, 28, 40, .05);
}
.eac-market__action-feedback-head { display: flex; align-items: center; gap: 9px; min-width: 0; }
.eac-market__action-feedback-head strong { color: var(--eac-text); overflow-wrap: anywhere; }
.eac-market__action-feedback p { margin: 0; overflow-wrap: anywhere; }
.eac-market__action-feedback-next { color: var(--eac-text); }
.eac-market__action-feedback--preparing,
.eac-market__action-feedback--running { border-color: color-mix(in srgb, var(--eac-link) 35%, var(--eac-border)); background: var(--eac-info-bg); }
.eac-market__action-feedback--completed { border-color: color-mix(in srgb, var(--eac-success) 35%, var(--eac-border)); background: var(--eac-success-bg); }
.eac-market__action-feedback--partial,
.eac-market__action-feedback--needs-recheck { border-color: color-mix(in srgb, var(--eac-warning) 38%, var(--eac-border)); background: var(--eac-warning-bg); }
.eac-market__action-feedback--failed { border-color: color-mix(in srgb, var(--eac-danger) 38%, var(--eac-border)); background: var(--eac-danger-bg); }
.eac-market__action-feedback--unknown { border-color: var(--eac-border-strong); background: var(--eac-panel-2); }
@media (prefers-reduced-motion: no-preference) {
  .eac-market__action-feedback--preparing,
  .eac-market__action-feedback--running { animation: eac-action-feedback-in 180ms var(--eac-ease-enter) both; }
}
@keyframes eac-action-feedback-in {
  from { opacity: .7; transform: translateY(2px); }
  to { opacity: 1; transform: translateY(0); }
}


/* Phase 1–2 visual rebuild: quiet editorial utility system. */
.eac-market {
  --eac-page: var(--dsw-alias-bg-base, #f4f5f2);
  --eac-panel: var(--dsw-alias-bg-layer-1, #fbfbf9);
  --eac-panel-2: var(--dsw-alias-bg-layer-2, #eef0ec);
  --eac-text: var(--dsw-alias-label-primary, #1f2522);
  --eac-text-2: var(--dsw-alias-label-secondary, #64706a);
  --eac-text-3: var(--dsw-alias-label-secondary, #8a948e);
  --eac-border: var(--dsw-alias-border-l1, #d8ddd7);
  --eac-border-strong: var(--dsw-alias-border-l3, #aeb8b0);
  --eac-accent: var(--dsw-alias-state-business-primary, var(--dsw-alias-link, #2463e8));
  --eac-link: var(--dsw-alias-link, #2463e8);
  --eac-radius-sm: var(--dsw-radius-sm, 9px);
  --eac-radius-md: var(--dsw-radius-md, 13px);
  --eac-radius-lg: var(--dsw-radius-lg, 20px);
  --eac-shadow-popover: var(--dsw-shadow-lv2, 0 16px 36px rgba(21, 29, 25, .14));
  --eac-shadow-modal: var(--dsw-shadow-lv3, 0 26px 80px rgba(21, 29, 25, .22));
  --eac-content-max: 1160px;
  --eac-gutter: clamp(20px, 4vw, 48px);
  color-scheme: light dark;
  padding: 0;
}
.eac-market__topbar--editorial {
  min-height: 64px;
  padding: 12px var(--eac-gutter);
  background: var(--eac-page);
  border-bottom: 1px solid var(--eac-border);
}
.eac-market__brand { align-items: center; gap: 10px; }
.eac-market__brand-mark {
  display: inline-flex; width: 30px; height: 30px; align-items: center; justify-content: center;
  border: 1px solid var(--eac-text); border-radius: 9px;
  color: var(--eac-page); background: var(--eac-text);
  font-size: 14px; font-weight: 800; letter-spacing: -.04em;
}
.eac-market__brand-copy { display: flex; align-items: baseline; gap: 8px; }
.eac-market__brand-copy strong { font-size: 15px; letter-spacing: .01em; }
.eac-market__brand-copy span { color: var(--eac-text-2); font-size: 12px; }
.eac-market__nav { gap: 10px; }
.eac-market__nav button {
  position: relative; min-height: 38px; padding: 6px 4px; border-radius: 0;
  color: var(--eac-text-2); background: transparent;
}
.eac-market__nav button::after {
  position: absolute; right: 4px; bottom: 0; left: 4px; height: 2px;
  border-radius: 999px; background: transparent; content: '';
}
.eac-market__nav button:hover { color: var(--eac-text); background: transparent; }
.eac-market__nav button[aria-current="page"] { color: var(--eac-text); background: transparent; font-weight: 750; }
.eac-market__nav button[aria-current="page"]::after { background: var(--eac-accent); }
.eac-market__top-actions { gap: 10px; }
.eac-market__top-action { min-height: 36px; padding: 6px 8px; border-radius: 8px; }
.eac-market__task-count { color: var(--eac-accent); background: var(--eac-info-bg); }
.eac-market__main {
  width: min(100%, var(--eac-content-max)); margin: 0 auto; padding: 34px var(--eac-gutter) 72px;
}
.eac-market__page-head {
  align-items: flex-end; gap: 28px; margin-bottom: 48px; padding: 0; border-bottom: 0;
}
.eac-market__page-head h1 {
  max-width: 16ch; margin: 0; color: var(--eac-text);
  font-size: clamp(30px, 4.2vw, 44px); font-weight: 760; line-height: 1.02; letter-spacing: -.055em;
  text-wrap: balance;
}
.eac-market__page-head p:not(.eac-market__eyebrow) { max-width: 58ch; margin-top: 12px; color: var(--eac-text-2); font-size: 15px; line-height: 1.65; }
.eac-market__section { margin: 56px 0; }
.eac-market__section + .eac-market__section { padding-top: 42px; border-top: 1px solid var(--eac-border); }
.eac-market__section-head { align-items: flex-end; gap: 20px; margin-bottom: 18px; }
.eac-market__section-head h2 { margin: 0; color: var(--eac-text); font-size: 21px; font-weight: 740; letter-spacing: -.035em; }
.eac-market__section-head p { max-width: 62ch; margin: 5px 0 0; color: var(--eac-text-2); font-size: 13px; line-height: 1.55; }
.eac-market__discover-page > .eac-market__page-head { margin-bottom: 54px; }
.eac-market__discover-page > .eac-market__section:first-of-type { margin-top: 0; }
.eac-market__featured-stage { margin-top: 0; }
.eac-market__featured-stage .eac-market__section-head { margin-bottom: 14px; }
.eac-market__poster-stage {
  min-height: 360px; grid-template-columns: minmax(0, 1.35fr) minmax(300px, .65fr);
  border: 1px solid var(--eac-border-strong); border-radius: var(--eac-radius-lg);
  background: var(--eac-panel); box-shadow: 0 18px 45px rgba(21, 29, 25, .08);
}
.eac-market__poster-stage .eac-market__poster-art { min-height: 360px; background: var(--eac-panel-2); }
.eac-market__poster-stage .eac-market__poster-art img { min-height: 360px; filter: saturate(.88) contrast(1.02); transition: transform 360ms cubic-bezier(.2,.8,.2,1), filter 360ms ease; }
.eac-market__poster-stage .eac-market__poster-art:hover img,
.eac-market__poster-stage .eac-market__poster-art:focus-visible img { transform: scale(1.018); filter: saturate(1) contrast(1.03); }
.eac-market__poster-stage .eac-market__poster-fallback-copy { max-width: 76%; gap: 13px; padding: 32px; }
.eac-market__poster-stage .eac-market__poster-fallback-copy strong { font-size: clamp(27px, 4vw, 52px); font-weight: 760; letter-spacing: -.055em; line-height: 1.02; }
.eac-market__poster-stage .eac-market__poster-copy { padding: 34px; }
.eac-market__poster-stage .eac-market__poster-copy h3 { max-width: 17ch; font-size: clamp(24px, 2.8vw, 36px); font-weight: 760; letter-spacing: -.05em; line-height: 1.08; }
.eac-market__poster-stage .eac-market__poster-kicker { margin-bottom: 12px; color: var(--eac-accent); font-size: 11px; letter-spacing: .12em; text-transform: uppercase; }
.eac-market__poster-stage .eac-market__poster-copy > p:not(.eac-market__poster-kicker):not(.eac-market__recommendation) { max-width: 34ch; font-size: 14px; line-height: 1.7; }
.eac-market__poster-stage .eac-market__recommendation { max-width: 34ch; margin: 18px 0 24px; color: var(--eac-text); font-size: 13px; line-height: 1.65; }
.eac-market__poster-controls { gap: 10px; color: var(--eac-text-2); }
.eac-market__poster-controls button { min-height: 32px; border: 0; border-bottom: 1px solid var(--eac-border-strong); border-radius: 0; color: var(--eac-text); background: transparent; }
.eac-market__poster-controls button:hover { color: var(--eac-accent); border-bottom-color: var(--eac-accent); background: transparent; }
.eac-market__skin-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
.eac-market__skin-grid .eac-market__skin-card { min-height: 196px; border-radius: 14px; background: var(--eac-panel); }
.eac-market__score-section .eac-market__score-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 22px; }
.eac-market__score-section .eac-market__ranked-item { display: grid; grid-template-columns: 40px minmax(0, 1fr); gap: 12px; align-items: stretch; }
.eac-market__score-section .eac-market__score { position: static; width: 40px; height: 40px; border-radius: 10px; color: var(--eac-text); background: var(--eac-panel-2); font-size: 13px; }
.eac-market__score-section .eac-market__plugin-card { min-height: 0; }
.eac-market__discover-results { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 22px; }
.eac-market__discover-results .eac-market__plugin-card { border-radius: 14px; background: var(--eac-panel); }
.eac-market__card,
.eac-market__plugin-card { border-color: var(--eac-border); border-radius: 14px; box-shadow: none; }
.eac-market__card:hover,
.eac-market__plugin-card:hover { transform: translateY(-1px); border-color: var(--eac-border-strong); box-shadow: 0 10px 26px rgba(21, 29, 25, .06); }
.eac-market__plugin-icon { width: 40px; height: 40px; flex-basis: 40px; border-radius: 11px; color: var(--eac-text); background: var(--eac-panel-2); }
.eac-market__plugin-title h3 { font-size: 16px; font-weight: 720; letter-spacing: -.02em; }
.eac-market__plugin-title p { color: var(--eac-text-3); }
.eac-market__plugin-summary { color: var(--eac-text-2); line-height: 1.58; }
.eac-market__plugin-bottom { gap: 12px; padding-top: 16px; border-top-color: var(--eac-border); }
.eac-market__button-row { gap: 8px; }
.eac-button--primary { box-shadow: 0 5px 14px rgba(36, 99, 232, .16); }
.eac-button--primary:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 8px 18px rgba(36, 99, 232, .2); }
.eac-button--outline:hover:not(:disabled), .eac-button--ghost:hover:not(:disabled) { border-color: var(--eac-border-strong); }
.eac-market__filter-summary { margin: 14px 0 18px; padding: 12px 0; border-bottom-color: var(--eac-border); }
.eac-market__action-feedback { border-radius: 14px; box-shadow: 0 7px 20px rgba(21, 29, 25, .05); }
.eac-market__footer-note { max-width: 72ch; margin: 56px auto 0; padding-top: 18px; border-top: 1px solid var(--eac-border); color: var(--eac-text-3); text-align: center; }

.eac-market[data-theme="dark"] .eac-market__brand-mark { color: var(--eac-page); background: var(--eac-text); border-color: var(--eac-text); }
.eac-market[data-theme="dark"] .eac-market__poster-stage { box-shadow: 0 18px 45px rgba(0, 0, 0, .18); }

@media (max-width: 899px) {
  .eac-market__main { padding-inline: 24px; }
  .eac-market__poster-stage { grid-template-columns: minmax(0, 1.1fr) minmax(260px, .9fr); }
}
@media (max-width: 719px) {
  .eac-market__topbar--editorial { display: grid; grid-template-columns: minmax(0, 1fr) auto; row-gap: 12px; padding-inline: 16px; }
  .eac-market__topbar--editorial .eac-market__brand { grid-column: 1; grid-row: 1; }
  .eac-market__topbar--editorial .eac-market__top-spacer { display: none; }
  .eac-market__topbar--editorial .eac-market__top-actions { grid-column: 2; grid-row: 1; margin-left: 0; }
  .eac-market__topbar--editorial .eac-market__nav { grid-column: 1 / -1; grid-row: 2; overflow-x: auto; padding-bottom: 2px; }
  .eac-market__main { padding: 24px 16px 48px; }
  .eac-market__page-head { align-items: flex-start; flex-direction: column; gap: 18px; margin-bottom: 36px; }
  .eac-market__page-head h1 { max-width: 12ch; font-size: 34px; }
  .eac-market__page-head .eac-market__button-row { width: 100%; }
  .eac-market__page-head .eac-market__button-row > * { flex: 1; }
  .eac-market__section { margin: 42px 0; }
  .eac-market__section + .eac-market__section { padding-top: 30px; }
  .eac-market__poster-stage { grid-template-columns: 1fr; min-height: 0; }
  .eac-market__poster-stage .eac-market__poster-art { min-height: 220px; }
  .eac-market__poster-stage .eac-market__poster-art img { min-height: 220px; }
  .eac-market__poster-stage .eac-market__poster-copy { padding: 22px; }
  .eac-market__poster-stage .eac-market__poster-fallback-copy { max-width: 100%; min-height: 220px; padding: 24px; }
  .eac-market__poster-stage .eac-market__poster-fallback-copy strong { max-width: 12ch; font-size: 35px; }
  .eac-market__skin-grid, .eac-market__score-section .eac-market__score-grid, .eac-market__discover-results { grid-template-columns: 1fr; }
  .eac-market__score-section .eac-market__ranked-item { grid-template-columns: 36px minmax(0, 1fr); }
  .eac-market__score-section .eac-market__score { width: 36px; height: 36px; }
}
@media (prefers-reduced-motion: reduce) {
  .eac-market__poster-stage .eac-market__poster-art img,
  .eac-button--primary,
  .eac-market__card,
  .eac-market__plugin-card { transition: none !important; }
}
@media (forced-colors: active) {
  .eac-market__brand-mark { color: Canvas; background: CanvasText; border-color: CanvasText; }
  .eac-market__nav button[aria-current="page"]::after { background: Highlight; }
  .eac-market__poster-stage { box-shadow: none; }
}


/* Phase 3–4 visual system: directory tools and work surfaces. */
.eac-market__directory-meta {
  align-items: baseline; margin: 22px 0 10px; padding-bottom: 10px; border-bottom: 1px solid var(--eac-border);
  color: var(--eac-text-2); font-size: 12px;
}
.eac-market__directory-meta > span:first-child { color: var(--eac-text); font-size: 13px; font-weight: 760; }
.eac-market__directory-hint { letter-spacing: .02em; }
.eac-market__toolbar {
  margin: 16px 0 20px; padding: 12px; grid-template-columns: minmax(240px, 1fr) auto;
  border: 1px solid var(--eac-border); border-radius: 14px; background: var(--eac-panel);
}
.eac-market__toolbar .eac-market__filters { gap: 8px; }
.eac-market__toolbar select,
.eac-market__advanced select,
.eac-market__toolbar .eac-input {
  min-height: 42px; border-color: var(--eac-border); border-radius: 9px; background: var(--eac-panel-2);
}
.eac-market__toolbar .eac-input { padding-inline: 14px; }
.eac-market__advanced {
  display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; margin: 14px 0 20px;
  padding: 16px; border: 1px solid var(--eac-border); border-radius: 14px; background: var(--eac-panel-2);
}
.eac-market__advanced label { display: grid; gap: 5px; color: var(--eac-text-2); font-size: 12px; font-weight: 700; }
.eac-market__advanced-actions { display: flex; flex-wrap: wrap; align-items: end; justify-content: flex-end; gap: 8px; }
.eac-market__advanced select { width: 100%; color: var(--eac-text); }
.eac-market__directory-grid { align-items: stretch; }
.eac-market__directory-grid .eac-market__plugin-card { min-height: 208px; }
.eac-market__directory-grid .eac-market__plugin-bottom { margin-top: auto; }
.eac-market__detail-side {
  border-color: var(--eac-border); border-radius: 16px; background: var(--eac-panel); box-shadow: 0 14px 34px rgba(21, 29, 25, .06);
}
.eac-market__detail-main > .eac-market__button-row { align-items: center; padding: 16px 0 20px; border-bottom: 1px solid var(--eac-border); }
.eac-market__facts { gap: 10px 16px; }
.eac-market__facts dt { color: var(--eac-text-3); font-size: 12px; }
.eac-market__facts dd { color: var(--eac-text); font-size: 13px; }
.eac-market__detail .eac-market__notice { border-radius: 12px; }
.eac-market__prose { max-width: 72ch; }
.eac-market__prose h2 { font-size: 24px; letter-spacing: -.04em; }
.eac-market__task-dialog .eac-modal__content { padding: 20px clamp(16px, 3vw, 28px); }
.eac-market__task-list { gap: 18px; }
.eac-market__task { padding: 20px 0; border: 0; border-radius: 0; background: transparent; }
.eac-market__task + .eac-market__task { border-top: 1px solid var(--eac-border); }
.eac-market__task-head { padding-bottom: 14px; border-bottom: 1px solid var(--eac-border); }
.eac-market__task-head h3 { font-size: 19px; font-weight: 740; letter-spacing: -.035em; }
.eac-market__task-items { margin: 16px 0; padding: 0; }
.eac-market__task-items li { padding: 11px 0; border-bottom-color: var(--eac-border); }
.eac-market__task .eac-market__notice { border-radius: 12px; background: var(--eac-panel-2); }
.eac-market__task details { border-top-color: var(--eac-border); }
.eac-market__skin-center .eac-market__page-head { margin-bottom: 32px; }
.eac-market__skin-center .eac-market__settings-list { border-top: 0; }
.eac-market__skin-center .eac-market__setting { padding: 20px 0; border-top: 1px solid var(--eac-border); border-bottom: 0; }
.eac-market__skin-center .eac-market__setting:first-child { padding-top: 0; border-top: 0; }
.eac-market__skin-installed { padding: 16px; border: 1px solid var(--eac-border); border-radius: 14px; background: var(--eac-panel); }
.eac-market__skin-controls { padding: 16px 4px 0; }
.eac-market__author-layout { grid-template-columns: minmax(170px, 230px) minmax(0, 1fr); gap: 30px; }
.eac-market__author-layout > aside { padding-right: 18px; border-right: 1px solid var(--eac-border); }
.eac-market__draft-list button { padding: 12px; border-radius: 10px; }
.eac-market__author-layout > .eac-market__form { min-width: 0; }
.eac-market__preview { padding: 24px; border-color: var(--eac-border); border-radius: 14px; background: var(--eac-panel); }
.eac-market__field textarea { min-height: 340px; padding: 14px; border-color: var(--eac-border); border-radius: 12px; background: var(--eac-panel-2); }
.eac-market__field input:not([type="file"]) { min-height: 42px; border-color: var(--eac-border); border-radius: 9px; background: var(--eac-panel-2); }
.eac-market__settings-list { border-top-color: var(--eac-border); }
.eac-market__setting { padding: 20px 0; border-bottom-color: var(--eac-border); }
.eac-market__setting h3 { font-size: 16px; font-weight: 720; letter-spacing: -.02em; }
.eac-market__help-steps { gap: 22px; }
.eac-market__help-step { padding: 20px 0; border-top-width: 1px; border-top-color: var(--eac-border-strong); }

@media (max-width: 899px) {
  .eac-market__advanced { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .eac-market__author-layout { gap: 22px; }
  .eac-market__author-layout > aside { padding-right: 0; border-right: 0; border-bottom: 1px solid var(--eac-border); padding-bottom: 18px; }
}
@media (max-width: 719px) {
  .eac-market__toolbar { grid-template-columns: 1fr; padding: 10px; }
  .eac-market__toolbar .eac-market__filters { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .eac-market__advanced { grid-template-columns: 1fr; }
  .eac-market__advanced-actions { align-items: stretch; justify-content: flex-start; }
  .eac-market__directory-meta { align-items: flex-start; flex-direction: column; gap: 5px; }
  .eac-market__detail-side { box-shadow: none; }
  .eac-market__author-layout { grid-template-columns: 1fr; gap: 18px; }
  .eac-market__author-layout > aside { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: start; gap: 12px; }
  .eac-market__author-layout > aside .eac-market__draft-list { grid-column: 1 / -1; }
  .eac-market__author-layout > .eac-market__form { grid-column: 1; }
  .eac-market__author-layout .eac-market__button-row { align-items: stretch; }
}

/* Phase 5 motion budget: short, contextual, interruptible. */
.eac-market__main--entering { animation-duration: 180ms; animation-timing-function: cubic-bezier(.2, .8, .2, 1); }
.eac-market__discover-results { animation-duration: 160ms; animation-timing-function: cubic-bezier(.2, .8, .2, 1); }
.eac-market__poster-stage .eac-market__poster-copy,
.eac-market__poster-stage .eac-market__poster-art { transition: border-color 180ms ease, background-color 180ms ease; }

/* Phase 5 overlay finish. */
.eac-modal-overlay { background: rgba(17, 23, 19, .44); }
.eac-modal {
  border-color: var(--eac-border-strong); border-radius: 20px; background: var(--eac-panel); box-shadow: var(--eac-shadow-modal);
}
.eac-modal__head { padding: 20px 24px; }
.eac-modal__head h2 { font-size: 21px; font-weight: 760; letter-spacing: -.035em; }
.eac-modal__content { padding: 22px 24px; }
.eac-modal__footer { padding: 16px 24px; }
.eac-market__task-dialog .eac-modal { width: min(720px, 100%); }
@media (max-width: 719px) {
  .eac-modal__head, .eac-modal__content, .eac-modal__footer { padding-inline: 16px; }
  .eac-market__task-dialog .eac-modal { width: 100%; }
}
`
