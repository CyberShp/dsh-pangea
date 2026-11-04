// Shared composition for task creation, monitoring and result reading.
export const workflowLayoutCss = `
.pangea-companion { --workflow-gap:16px; --workflow-line:#dfe3e7; --workflow-muted:#626d76; --workflow-surface:#fff; }
.pangea-companion .pangea-task-header { margin-bottom:16px; }
.pangea-companion .pangea-task-header .pangea-page-header { margin-bottom:4px; }
.pangea-companion .pangea-task-header h1 { display:block; -webkit-line-clamp:unset; overflow:visible; }
.pangea-companion .pangea-task-context { margin:0 0 0 48px; font-size:12px; line-height:1.5; color:var(--workflow-muted); }
.pangea-companion :is(.pangea-task-info-name,.pangea-task-request) { margin-top:22px; }
.pangea-companion :is(.pangea-task-info-name,.pangea-task-request) h3 { margin:0 0 8px; font-size:12px; font-weight:500; color:var(--workflow-muted); }
.pangea-companion .pangea-task-info-name p { margin:0; font-size:17px; font-weight:600; }
.pangea-companion .pangea-task-request p { margin:0; font-size:14px; line-height:1.8; white-space:pre-wrap; overflow-wrap:anywhere; }
.pangea-companion .pangea-task-request { padding-bottom:22px; border-bottom:1px solid var(--workflow-line); }
.pangea-companion .pangea-create-request { margin:16px 0; padding:12px 0; border-bottom:1px solid var(--workflow-line); }
.pangea-companion :is(button,input,select,textarea):focus-visible { outline:2px solid var(--pangea-red,#b32638); outline-offset:2px; }
.pangea-companion :is(.b03-task-metrics,.b06-metrics,.b05-metrics) { margin:0 0 16px; border:1px solid var(--workflow-line); border-radius:8px; background:var(--workflow-surface); padding:12px 16px; gap:16px; }
.pangea-companion :is(.b03-task-stat,.b05-metric) { display:grid; grid-template-columns:auto 1fr; align-items:baseline; gap:3px 12px; padding:0 16px 0 0; min-width:0; }
.pangea-companion :is(.b03-task-stat,.b05-metric) strong { font-size:22px; font-weight:650; margin:0; }
.pangea-companion .b05-metric small { order:1; font-size:13px; color:var(--workflow-muted); }
.pangea-companion .b05-metric strong { order:0; }
.pangea-companion .b05-metric>span { order:2; grid-column:1/-1; font-size:12px; color:var(--workflow-muted); }
.pangea-companion .b03-task-metrics { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); }
.pangea-companion :is(.b03-task-action-primary,.b03-task-action.primary) { background:var(--pangea-red,#b32638); border-color:var(--pangea-red,#b32638); color:#fff; }
.pangea-companion .b03-task-stat { display:flex; flex-direction:row-reverse; justify-content:flex-end; flex:1; }
.pangea-companion .b03-task-controls { display:flex; align-items:center; flex-wrap:wrap; gap:12px; padding:14px 16px; }
.pangea-companion .b03-task-search { max-width:310px; margin:0; }
.pangea-companion .b03-task-control-row { flex:1; gap:12px; margin:0; }
.pangea-companion .b03-task-panel { border-radius:8px; }
.pangea-companion .b03-task-table td { padding-top:14px; padding-bottom:14px; }
.pangea-companion .b03-task-first-use,.pangea-companion .b03-task-filter-empty { min-height:260px; padding:40px 24px; }
.pangea-companion .b06-head-actions { margin-top:0; }
.pangea-companion .b06-metrics { gap:0; }
.pangea-companion .b06-metric { min-height:56px; padding:0 16px; gap:12px; border:0; border-right:1px solid var(--workflow-line); box-shadow:none; border-radius:0; }
.pangea-companion .b06-metric:last-child { border:0; }
.pangea-companion .b06-metric strong { font-size:24px; }
.pangea-companion .b06-metric .b06-icon { width:32px; height:32px; flex-basis:32px; }
.pangea-companion .b06-home-grid { grid-template-columns:minmax(0,1.7fr) minmax(260px,1fr); gap:20px; }
.pangea-companion .b06-panel { padding:18px; }
.pangea-companion .b06-section-head { margin-bottom:12px; }
.pangea-companion .b06-attention { padding:14px 16px; border:1px solid var(--workflow-line); border-left:3px solid #c49b56; background:#fff; border-radius:6px; }
.pangea-companion .b06-attention + .b06-attention { margin-top:12px; }
.pangea-companion .b06-attention h3 { font-size:15px; line-height:1.55; margin:10px 0 6px; }
.pangea-companion .b06-attention-foot { margin-top:12px; gap:16px; }
.pangea-companion .b06-attention-foot .b06-meta { min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.pangea-companion .b06-attention-foot button { flex-shrink:0; }
.pangea-companion :is(.b06-report,.b06-running) { min-width:0; padding:14px 0; gap:12px; }
.pangea-companion :is(.b06-report,.b06-running)>:nth-child(2) { min-width:0; }
.pangea-companion :is(.b06-report,.b06-running) strong { line-height:1.55; font-weight:600; }
.pangea-companion .b06-report .b06-meta { display:block; margin-top:6px; }
.pangea-companion :is(.pangea-preview-title,.b06-attention h3,.b06-report strong,.b06-running strong,.b03-run-record-summary-title) { display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; overflow:hidden; overflow-wrap:anywhere; }
.pangea-companion :is(.b06-attention>p,.b06-running p) { display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; overflow:hidden; }
.pangea-companion .b03-task-repository small { margin-top:4px; color:var(--workflow-muted); }
.pangea-companion .b03-unlinked-row .b03-task-subtitle { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.pangea-companion .pangea-text-preview { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:8px 16px; align-items:end; min-width:0; }
.pangea-companion .pangea-preview-copy { margin:0; font-size:13px; line-height:1.65; color:var(--workflow-muted); display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:3; overflow:hidden; overflow-wrap:anywhere; }
.pangea-companion .pangea-preview-open { white-space:nowrap; font-size:12px; min-height:28px; }
.pangea-companion .pangea-full-text { white-space:pre-wrap; overflow-wrap:anywhere; font-size:14px; line-height:1.8; max-width:900px; }
.pangea-companion .pangea-finding-list { list-style:none; padding:0; margin:0; }
.pangea-companion .pangea-finding-row { padding:16px 0; border-top:1px solid var(--workflow-line); }
.pangea-companion .pangea-finding-row:first-child { border-top:0; padding-top:4px; }
.pangea-companion .pangea-finding-heading { display:flex; gap:16px; justify-content:space-between; align-items:flex-start; margin-bottom:8px; }
.pangea-companion .pangea-finding-heading h4 { margin:0; min-width:0; font-size:14px; line-height:1.55; font-weight:600; }
.pangea-companion .pangea-finding-heading>span { flex-shrink:0; white-space:nowrap; }
.pangea-companion .pangea-finding-row .pangea-preview-copy { -webkit-line-clamp:2; }
.pangea-companion .pangea-finding-actions { display:flex; flex-wrap:wrap; gap:16px; padding-top:16px; }
.pangea-companion .pangea-basis-original pre { white-space:pre-wrap; overflow-wrap:anywhere; }
.pangea-companion .b06-shortcuts { gap:12px; }
.pangea-companion .pangea-create-workspace .create-frame { max-width:none; }
.pangea-companion .pangea-create-workspace .wizard { gap:12px; margin:0 0 16px; }
.pangea-companion .pangea-create-workspace .wizard-step { padding:8px 0 12px; }
.pangea-companion .pangea-create-workspace .create-frame .cols { grid-template-columns:minmax(0,1fr) 280px; gap:20px; margin-top:16px!important; align-items:start; }
.pangea-companion .pangea-create-workspace .create-frame .panel { padding:20px; }
.pangea-companion .pangea-create-workspace .create-scenes { grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; }
.pangea-companion .pangea-create-workspace .create-option { padding:12px; gap:10px; min-height:0; }
.pangea-companion .pangea-create-workspace .create-subhead { margin:16px 0 10px; }
.pangea-companion .pangea-create-workspace .create-heading { font-size:19px; }
.pangea-companion .pangea-create-workspace .create-context-title { font-size:17px; margin:8px 0; }
.pangea-companion .pangea-create-workspace .create-copy { line-height:1.65; margin:8px 0 16px; color:var(--workflow-muted); }
.pangea-companion .pangea-create-workspace .wizard-footer { padding-top:16px; margin-top:20px; }
.pangea-companion .pangea-create-workspace .create-review-row { padding:14px 0; }
.pangea-companion .pangea-run-workspace .run-context-actions { margin:0; flex-wrap:wrap; }
.pangea-companion .pangea-run-workspace .hero-band { padding:12px 0 16px; margin-bottom:16px; gap:20px; }
.pangea-companion .pangea-run-workspace .hero-band h2 { font-size:19px; }
.pangea-companion .pangea-run-workspace .hero-band .metrics { gap:20px; flex-shrink:0; }
.pangea-companion .pangea-run-workspace .hero-band .stat strong { font-size:21px; }
.pangea-companion .pangea-run-workspace .run-execution-details { padding:10px 14px; margin-bottom:16px; }
.pangea-companion .pangea-run-workspace .run-layout { gap:16px; grid-template-columns:minmax(0,1fr) 250px; }
.pangea-companion .pangea-run-workspace .run-stages .stage { padding:10px 12px; min-width:130px; }
.pangea-companion .pangea-run-workspace .run-stage-heading { padding:16px; gap:12px; }
.pangea-companion .pangea-run-workspace .run-focus .activity { padding:16px; }
.pangea-companion .pangea-run-workspace .run-aside { padding:16px; border:1px solid var(--workflow-line); border-radius:8px; background:#fff; }
.pangea-companion :is(.run-output-heading strong,.run-stage-heading h2,.b03-report-head h2) { display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; overflow:hidden; overflow-wrap:anywhere; }
.pangea-companion .run-output-heading { min-width:0; }
.pangea-companion .run-output-verdict { font-size:12px; font-weight:500; line-height:1.6; color:#926316; }
.pangea-companion .pangea-result-status h2 { font-size:20px; }
.pangea-companion .b03-overview-hero { margin:16px 0; padding:0 0 16px; }
.pangea-companion .b03-overview-layout { gap:20px; grid-template-columns:minmax(0,1fr) 270px; }
.pangea-companion :is(.b03-overview-card,.b03-run-record-card) { padding:18px; }
.pangea-companion .b03-overview-card h3 { font-size:16px; }
.pangea-companion :is(.b03-overview-kv dd,.pangea-case-review-list button span,.pangea-bottom-drawer>header p) { display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; overflow:hidden; overflow-wrap:anywhere; }
.pangea-companion .pangea-bottom-drawer>header>div { min-width:0; }
.pangea-companion .pangea-bottom-drawer>header>button { flex-shrink:0; }
.pangea-companion .b05-section-head { margin-bottom:14px; gap:12px; }
.pangea-companion .b05-section-head h2 { font-size:19px; line-height:1.4; }
.pangea-companion .b05-section-head p { font-size:13px; line-height:1.55; }
.pangea-companion .b05-card { padding:18px; margin-bottom:16px; }
.pangea-companion .b05-toolbar { display:flex; align-items:center; gap:12px; margin:10px 0; }
.pangea-companion .b05-toolbar input { flex:1; max-width:480px; min-width:180px; }
.pangea-companion .pangea-case-filters { gap:10px 16px; padding:10px 0 0; margin:0; }
.pangea-companion .pangea-case-filters label { gap:6px; font-size:13px; }
.pangea-companion .b05-case-table td { padding:12px 14px; }
.pangea-companion .pangea-detail-head.b05-section-head { margin:16px 0 12px; }
.pangea-companion .b05-case-layout { gap:16px; grid-template-columns:minmax(0,1fr) 240px; }
.pangea-companion .b05-bullet > span:last-child { min-width:0; overflow-wrap:anywhere; }
.pangea-companion .b05-detail-grid,.pangea-companion .b05-detail-bottom { gap:16px; }
.pangea-companion .pangea-case-review-actions { padding:10px 12px; margin-bottom:12px; }
.pangea-companion .b04-workspace,.pangea-companion .b04-flow-layout { gap:16px; }
.pangea-companion .b04-modebar { margin-bottom:14px; gap:12px; }
.pangea-companion .pangea-flow-reader { padding:16px; }
.pangea-companion .pangea-bottom-layer[aria-hidden="true"] { visibility:hidden; }
.pangea-companion .pangea-bottom-drawer { max-height:78vh; }
.pangea-companion .pangea-bottom-drawer>header { padding:16px 24px; }
.pangea-companion .pangea-bottom-content { padding:16px 24px 24px; }
.pangea-companion .pangea-case-code-links { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }
.pangea-case-code-links h4 { grid-column:1/-1; margin:8px 0; }
.pangea-companion .pangea-case-code-links button { display:flex; flex-direction:column; align-items:flex-start; text-align:left; gap:4px; padding:10px 12px; border:1px solid var(--workflow-line); border-radius:6px; background:#fff; }
.pangea-case-code-links button strong { font-size:13px; font-weight:500; overflow-wrap:anywhere; }
.pangea-case-code-links button small { font-size:12px; color:var(--workflow-muted); overflow-wrap:anywhere; }
.pangea-basis-original { margin:16px 0; padding:12px 0; border-top:1px solid var(--workflow-line); }
.pangea-basis-original summary { cursor:pointer; font-weight:600; font-size:14px; }
.pangea-companion .b05-source-drawer { width:min(1080px,94vw); display:flex; flex-direction:column; padding:0; overflow:hidden; }
.pangea-companion .b05-source-drawer>header { flex:none; padding:16px 20px; }
.pangea-companion .b05-source-drawer h2 { margin:2px 0; font-size:18px; }
.pangea-companion .b05-source-drawer>footer { flex:none; margin:0; padding:12px 20px; gap:12px; flex-wrap:wrap; }
.pangea-source-workspace { min-height:0; flex:1; display:grid; grid-template-columns:minmax(0,1fr); overflow:hidden; }
.pangea-source-workspace.with-index { grid-template-columns:260px minmax(0,1fr); }
.pangea-companion .pangea-evidence-options { overflow:auto; padding:12px; margin:0; border-right:1px solid var(--workflow-line); gap:6px; background:#f8f9fa; }
.pangea-companion .pangea-evidence-options button { display:flex; flex-direction:column; align-items:flex-start; text-align:left; gap:6px; padding:10px; flex:none; }
.pangea-evidence-options strong { font-size:13px; line-height:1.55; font-weight:500; overflow-wrap:anywhere; }
.pangea-evidence-options small { color:var(--workflow-muted); font-size:11px; overflow-wrap:anywhere; }
.pangea-source-reading { overflow:auto; min-width:0; padding:0 20px 20px; }
.pangea-companion .b05-source-meta { padding:12px 0; }
.pangea-companion .b05-source-context { margin:12px 0; padding:12px; font-size:13px; }
.pangea-companion .b05-source-code { font-size:12px; line-height:1.85; }
.pangea-case-workspace .b05-section-head { align-items:center; margin:0 0 16px; }
.pangea-companion :is(h1,h2)[tabindex="-1"]:focus { outline:none!important; }
.pangea-case-workspace .b05-section-head h2 { font-size:20px; font-weight:600; }
.pangea-case-workspace .b05-section-head p { margin:6px 0 0; color:#68727c; }
.pangea-case-tools { position:relative; padding:14px 16px; border:1px solid var(--workflow-line); border-bottom:0; border-radius:8px 8px 0 0; background:#fff; }
.pangea-case-search-row { display:flex; align-items:center; gap:16px; padding-right:96px; }
.pangea-case-search-row input { width:min(480px,65%); min-width:180px; height:36px; padding:8px 12px; border:1px solid #d7dce0; border-radius:6px; background:#fff; font-size:13px; }
.pangea-case-search-row>span { margin-left:auto; white-space:nowrap; }
.pangea-case-filter-panel>summary { position:absolute; top:14px; right:16px; display:flex; align-items:center; gap:7px; min-height:36px; padding:0 10px; border:1px solid #d7dce0; border-radius:6px; list-style:none; cursor:pointer; font-size:13px; }
.pangea-case-filter-panel>summary::-webkit-details-marker { display:none; }
.pangea-case-filter-panel>summary svg { width:14px; height:14px; }
.pangea-case-filter-panel[open]>summary { color:var(--pangea-red,#b32638); background:#fbf1f3; border-color:#d7b1b8; }
.pangea-case-workspace .pangea-case-filters { margin:14px 0 0; padding:14px 0 0; border-top:1px solid var(--workflow-line); gap:12px 20px; }
.pangea-case-workspace .pangea-case-filters select { max-width:260px; min-height:34px; font-size:13px; }
.pangea-case-workspace .b05-table-scroll { border:1px solid var(--workflow-line); border-radius:0 0 8px 8px; background:#fff; }
.pangea-case-workspace .b05-case-table { border:0; border-radius:0; table-layout:fixed; }
.pangea-case-workspace .b05-case-table :is(th,td):nth-child(1) { width:44px; }
.pangea-case-workspace .b05-case-table :is(th,td):nth-child(2) { width:80px; }
.pangea-case-workspace .b05-case-table :is(th,td):nth-child(4) { width:100px; }
.pangea-case-workspace .b05-case-table :is(th,td):nth-child(5) { width:100px; }
.pangea-case-workspace .b05-case-table :is(th,td):nth-child(6) { width:180px; }
.pangea-case-workspace .b05-case-table :is(th,td):nth-child(7) { width:72px; }
.pangea-case-workspace .b05-case-table th { background:#f8f9fa; color:#5e6872; font-size:12px; font-weight:500; }
.pangea-case-workspace .b05-case-table td { padding:16px 14px; }
.pangea-case-workspace .b05-case-table td:nth-child(3)>button { font-size:14px; font-weight:500; color:#252b32; line-height:1.5; text-align:left; }
.pangea-case-workspace .b05-case-table td:nth-child(3)>small { margin-top:5px; color:#6d7780; font-size:12px; line-height:1.55; }
.pangea-case-workspace .b05-case-table td:nth-child(3)>:is(button,small) { display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; overflow:hidden; overflow-wrap:anywhere; }
.pangea-case-workspace .b05-case-table tr:hover td { background:#fcfcfd; }
.pangea-case-preparation { max-width:220px; color:#656b72; font-size:12px; line-height:1.6; overflow-wrap:anywhere; }
.pangea-case-preparation-note { margin-top:16px; padding:12px 14px; border-left:2px solid #c49b56; background:#fcfaf5; }
.pangea-case-preparation-note h4 { margin:0 0 6px; font-size:13px; font-weight:500; }
.pangea-case-preparation-note p { margin:0; font-size:13px; line-height:1.6; }
.pangea-case-preparation-source { margin-top:14px; font-size:12px; color:#68727c; }
@container pangea-panel (max-width:950px) {
 .pangea-case-workspace .b05-case-table { min-width:0; }
 .pangea-case-workspace .b05-case-table :is(th,td):is(:nth-child(4),:nth-child(5),:nth-child(7)) { display:none; }
 .pangea-case-workspace .b05-case-table td:nth-child(2) { white-space:nowrap; }
 .pangea-case-workspace .b05-case-table td:nth-child(3) { min-width:180px; }
 .pangea-case-workspace .b05-case-table td:nth-child(6) { width:170px; }

 .pangea-companion .b06-home-grid { grid-template-columns:minmax(0,1fr); }
 .pangea-companion .pangea-create-workspace .create-frame .cols { grid-template-columns:minmax(0,1fr); }
 .pangea-companion .pangea-create-workspace .create-frame .cols>aside { border-top:1px solid var(--workflow-line); padding-top:16px; }
 .pangea-companion .b05-case-layout { grid-template-columns:minmax(0,1fr); }
}
@container pangea-panel (max-width:600px) {
 .pangea-companion .pangea-create-workspace .create-scenes { grid-template-columns:minmax(0,1fr); }
 .pangea-companion :is(.b03-task-metrics,.b05-metrics,.b06-metrics) { grid-template-columns:repeat(2,minmax(0,1fr)); display:grid; gap:12px; }
 .pangea-companion .b03-task-controls { align-items:stretch; }.pangea-companion .b03-task-search { max-width:none; width:100%; }
 .pangea-companion .b03-task-control-row { flex-wrap:wrap; }
 .pangea-companion .pangea-create-workspace .wizard { gap:8px; }.pangea-companion .pangea-create-workspace .wizard-step { flex-direction:column; align-items:flex-start; gap:6px; }
 .pangea-companion .pangea-case-code-links { grid-template-columns:minmax(0,1fr); }
}
@media(max-width:760px) {
 .pangea-source-workspace.with-index { grid-template-columns:minmax(0,1fr); grid-template-rows:150px minmax(0,1fr); }
 .pangea-companion .pangea-evidence-options { border-right:0; border-bottom:1px solid var(--workflow-line); }
 .pangea-companion .b05-source-drawer { width:100vw; }
}
`
