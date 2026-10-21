/** Static UI only. Model-authored content always enters the DOM as textContent. */
export function browserPage({ token, nonce }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sphinx — understanding check</title>
<style nonce="${nonce}">
:root{color-scheme:light;--ink:#292524;--muted:#6b6259;--line:#dfd8cf;--paper:#faf8f5;--amber:#a45009;--focus:#b45309;--pass:#3d6b35;--retry:#8d271e;--add:#e8f1e3;--add-ink:#2f5d28;--del:#f8e6e2;--del-ink:#8d271e;--mark:#fdf0cc;--mono:ui-monospace,SFMono-Regular,Menlo,monospace}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.6 "Avenir Next",Avenir,sans-serif}
button,textarea{font:inherit}button{cursor:pointer}button:disabled{cursor:default;opacity:.5}
button:focus-visible,textarea:focus-visible,input:focus-visible,[tabindex]:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
.shell{height:100vh;height:100dvh;display:flex;flex-direction:column}
header{min-height:52px;border-bottom:1px solid var(--line);padding:8px 24px;display:flex;align-items:center;justify-content:space-between;gap:16px}
.brand{display:flex;align-items:baseline;gap:14px}.brand strong{font:600 19px ui-monospace,SFMono-Regular,Menlo,monospace}.brand strong::before{content:"◆";color:var(--amber);font-size:.7em;margin-right:.45em;vertical-align:.12em}.brand span{color:var(--muted);font-size:14px}
.scope{border-bottom:1px solid var(--line);padding:8px 24px 9px;font-size:13px;line-height:1.45;background:#f5f1eb}
.facts{display:flex;flex-wrap:wrap;gap:2px 20px;margin:0;align-items:baseline}.facts div{display:flex;gap:6px;min-width:0}.facts dt{color:var(--muted)}.facts dd{margin:0;font-weight:600;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}
.facts .mono{font:600 12.5px var(--mono)}.scope-note{margin:2px 0 0;color:var(--muted);font-size:12px}#usage{color:var(--muted);font-weight:400;font-variant-numeric:tabular-nums}
.tabs{display:none}.scope-short{display:none}
.workspace{flex:1;min-height:0;display:grid;grid-template-columns:minmax(210px,20%) minmax(0,45%) minmax(340px,35%)}
.pane{min-width:0;min-height:0;display:flex;flex-direction:column;border-right:1px solid var(--line)}.pane:last-child{border-right:0}
.pane h2{font-size:13px;font-weight:600;margin:0;overflow-wrap:anywhere;line-height:1.4}.pane-note{font-size:12px;color:var(--muted);margin:0;padding:8px 14px;overflow-wrap:anywhere}
.filters{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:10px 12px 6px}.filters button{min-height:44px;font-size:12.5px;line-height:1.25;padding:4px 8px}
.filters button[aria-pressed=true]{background:#efe5d8;border-color:var(--amber);font-weight:600}.filters .count{display:block;font:11.5px var(--mono);color:var(--muted)}
#file-search{margin:4px 12px 6px;font:inherit;font-size:13px;padding:8px 10px;border:1px solid #b9afa3;border-radius:6px;background:#fff;color:var(--ink);min-height:40px}
.filelist{list-style:none;margin:0;padding:0 0 8px;overflow-y:auto;flex:1;min-height:0}
.file{display:flex;align-items:flex-start;gap:8px;width:100%;min-height:44px;border:0;border-radius:0;padding:7px 12px;text-align:left;font-size:13px;line-height:1.35}
.file[aria-current=true]{background:#efe5d8;box-shadow:inset 3px 0 0 var(--amber)}.file .name{flex:1;min-width:0;overflow-wrap:anywhere}.file .from{display:block;color:var(--muted);font-size:12px}
.badge{flex-shrink:0;min-width:5.6em;font:600 10.5px/1.9 var(--mono);text-transform:uppercase;letter-spacing:.02em;text-align:center;border:1px solid #cfc4b6;border-radius:4px;color:var(--muted)}
.badge.added{color:var(--add-ink);border-color:#a9c39f}.badge.deleted{color:var(--del-ink);border-color:#d6aaa3}.counts{flex-shrink:0;font:12px/1.6 var(--mono);white-space:nowrap}.counts .plus{color:var(--add-ink)}.counts .minus{color:var(--del-ink)}
.file .relevant{display:block;color:var(--amber);font-size:11.5px}
.diffhead{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:flex-start;justify-content:space-between;padding:10px 16px;border-bottom:1px solid var(--line)}.diffhead>div:first-child{min-width:0;flex:1 1 220px}
#diff-meta{margin:2px 0 0;font-size:12px;color:var(--muted)}.diffactions{display:flex;gap:6px;flex-wrap:wrap}.diffactions button{min-height:44px;font-size:13px}
.diffbody{flex:1;min-height:0;overflow:auto;background:#fff}.diffbody:empty{background:transparent}
table.diff{border-collapse:collapse;font:12.5px/1.55 var(--mono);min-width:100%;tab-size:4}
.diff td{padding:0 8px;vertical-align:top}.diff .num{width:1%;text-align:right;color:#8a7f73;white-space:nowrap;user-select:none}.diff .sign{width:1%;padding:0 2px;user-select:none;text-align:center}
.diff .code{white-space:pre;padding-right:16px}.diff .mark{width:1%;padding:0 2px;color:var(--amber);user-select:none}
.diff tr.addition{background:var(--add)}.diff tr.addition .sign{color:var(--add-ink)}.diff tr.deletion{background:var(--del)}.diff tr.deletion .sign{color:var(--del-ink)}
.diff tr.evidence .mark{background:var(--mark);box-shadow:inset 3px 0 0 var(--amber)}.diff tr.evidence .num{color:var(--ink)}
.diff tr.hunk td{background:#f1ece5;color:var(--muted);padding:3px 12px;white-space:pre-wrap;overflow-wrap:anywhere}.diff tr.gap td{background:#f7f3ee;color:var(--muted);padding:2px 12px;font-family:inherit}
.diff tr:focus{outline:2px solid var(--focus);outline-offset:-2px}.legend{font-size:12px;color:var(--muted);margin:0;padding:6px 16px;border-bottom:1px solid var(--line)}
main{width:100%;padding:0 20px;display:flex;flex-direction:column;min-height:0}
.evidence{flex-shrink:0;border-top:1px solid var(--line);padding:10px 0 4px;max-height:34%;overflow-y:auto}.evidence ul{list-style:none;margin:6px 0 0;padding:0;display:grid;gap:4px}
.evidence li button{width:100%;min-height:44px;text-align:left;font-size:13px;line-height:1.35;padding:6px 10px}.evidence li .ref-path{display:block;overflow-wrap:anywhere;font:12.5px var(--mono)}.evidence li .ref-lines{display:block;color:var(--muted);font-size:12px}
.evidence li.static{border:1px dashed #cfc4b6;border-radius:6px;padding:6px 10px;font-size:13px}.evidence .pane-note{padding:6px 0 0}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.conversation{flex:1;min-height:0;overflow-y:auto;padding:24px 8px 8px 0;scrollbar-width:thin}
#messages{list-style:none;margin:0;padding:0}.turn{margin:0 0 24px}.turn.human{margin-left:32px;padding:12px 16px;background:#f0ebe4;border-left:2px solid #c6b7a5}
.speaker{font-size:13px;font-weight:600;margin-bottom:6px}.turn-text{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}.turn.question .turn-text{font-size:18px;line-height:1.6;font-weight:500}
.turn-note{font-size:12px;color:var(--muted);margin-top:6px}.turn.notice{color:var(--muted)}.question-number{font-size:13px;color:var(--muted);margin-bottom:6px}
.question{font-size:18px;line-height:1.6;white-space:pre-wrap;margin:8px 0 20px;font-weight:500}.feedback,.message{white-space:pre-wrap;overflow-wrap:anywhere;margin:0 0 20px}
ul{padding-left:22px}.status{font-size:13px;color:var(--muted);margin:0 0 12px}
.composer{flex-shrink:0;border-top:1px solid var(--line);padding:16px 0 12px}.error{font-size:14px;color:#8d271e;white-space:pre-wrap;overflow-wrap:anywhere;margin:0 0 12px}
label{display:block;font-size:14px;font-weight:600;margin-bottom:8px}
textarea{display:block;width:100%;min-height:76px;max-height:180px;resize:vertical;padding:12px 14px;border:1px solid #b9afa3;border-radius:6px;background:#fff;color:var(--ink);line-height:1.5}
textarea:disabled{background:#f6f2ed;color:var(--muted)}textarea::placeholder{color:#82796f}
.actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px}.actions button,.recovery button,.skipbar button{min-height:44px}
button{border:1px solid #c3b8aa;border-radius:6px;padding:7px 12px;background:transparent;color:var(--ink);font-size:14px;line-height:1.5}
button.primary{background:var(--amber);color:#fff;border-color:var(--amber);margin-left:auto;min-width:72px}.actions button,header .tools button{min-height:44px}
button:hover:not(:disabled){background:#eee7dc}button.primary:hover:not(:disabled){background:#8b4208}
.disputing textarea{border-color:#8d271e}.disputing #submit{background:#8d271e;border-color:#8d271e}
button.quiet{border-color:transparent;color:var(--muted)}button.quiet:hover:not(:disabled){color:var(--ink)}
.hint{font-size:12px;color:var(--muted);margin:10px 0 0}.recovery{display:grid;gap:12px;margin:0 0 20px}.recovery button{text-align:left;width:100%}.recovery p{margin:4px 0 0;font-size:13px;color:var(--muted)}
header .tools{display:flex;gap:4px}
.skipbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:12px 0;border-bottom:1px solid var(--line);font-size:14px}.skipbar p{flex-basis:100%;margin:0;color:var(--muted);font-size:13px}
.skipbar input{flex:1;min-width:180px;font:inherit;font-size:14px;padding:6px 10px;border:1px solid #b9afa3;border-radius:6px;background:#fff;color:var(--ink)}
button.danger{background:#8d271e;border-color:#8d271e;color:#fff}button.danger:hover:not(:disabled){background:#6f1f18}
.turn.activity{margin:0 0 20px;font-size:13px;color:var(--muted)}.activity summary{cursor:pointer;list-style:none;display:flex;gap:8px;align-items:baseline}.activity summary::-webkit-details-marker{display:none}
.activity summary .latest::before{content:"✓ ";color:#7c8a5c}.activity.live summary .latest::before{content:"● ";color:var(--amber);animation:pulse 1.2s ease-in-out infinite}
.activity .count{color:#8f857a;white-space:nowrap}.activity .count::after{content:" ▸"}.activity details[open] .count::after{content:" ▾"}
.activity ol{list-style:none;margin:8px 0 0;padding:0 0 0 14px;border-left:1px solid var(--line);max-height:220px;overflow-y:auto}.activity ol li{padding:1px 0 1px 8px}
.turn.streaming .turn-text::after{content:"▍";color:var(--amber);animation:pulse 1s steps(2) infinite}
.status.busy::before{content:"● ";color:var(--amber);animation:pulse 1.2s ease-in-out infinite}.status.phase-question,.status.phase-passed,.status.phase-paused,.status.phase-error,.status.phase-skipped{display:inline-block;font-size:13px;font-weight:600;line-height:1;padding:6px 10px;border:1px solid currentColor;border-radius:999px}.status.phase-question{color:var(--amber)}.status.phase-question::before{content:"◆ "}.status.phase-question.retry{color:var(--retry)}.status.phase-question.retry::before{content:"↺ "}.status.phase-passed{color:var(--pass)}.status.phase-passed::before{content:"✓ "}.status.phase-paused,.status.phase-skipped{color:var(--muted)}.status.phase-paused::before{content:"‖ "}.status.phase-skipped::before{content:"↷ "}.status.phase-error{color:var(--retry)}.status.phase-error::before{content:"! "}@keyframes pulse{50%{opacity:.25}}
@media(prefers-reduced-motion:reduce){.status.busy::before,.activity.live summary .latest::before{animation:none}}
footer{flex-shrink:0;padding:0 0 14px;color:var(--muted);font-size:12px;line-height:1.5}footer p{margin:0}#waiting{margin-top:3px}[hidden]{display:none!important}
@media(max-width:1099px){.workspace{grid-template-columns:minmax(200px,26%) minmax(0,1fr) minmax(320px,40%)}}
@media(max-width:899px){.tabs{display:flex;gap:4px;padding:6px 12px;border-bottom:1px solid var(--line)}.tabs button{flex:1;min-height:44px;font-size:14px}.tabs button[aria-selected=true]{background:#efe5d8;border-color:var(--amber);font-weight:600}
.workspace{display:flex}.pane{display:none;flex:1;border-right:0}.workspace.show-files #files-pane,.workspace.show-diff #diff-pane,.workspace.show-question #question-pane{display:flex}
#question-pane{overflow-y:auto}.conversation{flex:none;overflow:visible;padding-right:0}.evidence{max-height:none;overflow:visible}}
@media(max-width:600px){header{padding:8px 12px}.brand{gap:8px}.brand span{display:none}.scope{padding:6px 12px 7px;font-size:12.5px}.facts{gap:0 12px}.facts .mono{font-size:12px}#scope-note{display:none}.scope-short{display:block}.hint,footer{font-size:11.5px}main{padding:0 14px}.conversation{padding-top:16px}.turn.human{margin-left:16px}.actions{gap:4px}button{padding:7px 10px}.hint{max-width:34em}.diffhead{padding:8px 12px}.legend{padding:6px 12px}}
</style></head><body><div class="shell">
<header><div class="brand"><strong>sphinx</strong><span>Understanding check</span></div><div class="tools"><button id="skip" class="quiet" type="button">Skip this time</button><button id="pause" class="quiet" type="button">Pause check</button></div></header>
<section class="scope" aria-label="Change under review"><dl class="facts"><div><dt>Repository</dt><dd id="meta"></dd></div><div><dt id="scope-op-label">Operation</dt><dd id="scope-op">Loading…</dd></div><div><dt>Comparison</dt><dd id="scope-range" class="mono">Loading…</dd></div><div><dt>Changed</dt><dd id="scope-stats">Loading…</dd></div><div id="scope-excluded-row" hidden><dt>Excluded</dt><dd id="scope-excluded"></dd></div><div><dt>Progress</dt><dd id="scope-progress">Connecting…</dd></div><div><dd id="usage"></dd></div></dl>
<p id="scope-note" class="scope-note">Checkpoint changes: the exact range Sphinx froze for this check, not necessarily an entire pull request.</p><p class="scope-note scope-short">Checkpoint range only — not necessarily a whole pull request.</p></section>
<nav class="tabs" role="tablist" aria-label="Questionnaire views"><button id="tab-question" role="tab" type="button" aria-controls="question-pane" aria-selected="true">Question</button><button id="tab-files" role="tab" type="button" aria-controls="files-pane" aria-selected="false">Files</button><button id="tab-diff" role="tab" type="button" aria-controls="diff-pane" aria-selected="false">Diff</button></nav>
<div id="announce" class="sr" aria-live="polite"></div>
<div id="workspace" class="workspace show-question">
<aside id="files-pane" class="pane" aria-label="Changed files">
<div class="filters" role="group" aria-label="Which files to list"><button id="filter-all" type="button" aria-pressed="true">All changed files<span id="count-all" class="count"></span></button><button id="filter-relevant" type="button" aria-pressed="false">Relevant to this question<span id="count-relevant" class="count"></span></button></div>
<input id="file-search" type="search" autocomplete="off" spellcheck="false" placeholder="Filter by path" aria-label="Filter files by path">
<p id="filter-total" class="pane-note" aria-live="polite"></p>
<ul id="file-list" class="filelist" aria-label="Files"></ul><p id="files-note" class="pane-note"></p></aside>
<section id="diff-pane" class="pane" aria-label="Diff">
<div class="diffhead"><div><h2 id="diff-title">No file selected</h2><p id="diff-meta">Choose a file from the list, or a code reference beside the question.</p></div>
<div class="diffactions"><button id="context-more" type="button" hidden>More context</button><button id="context-all" type="button" hidden>Full file</button><button id="back-question" type="button">Back to question</button></div></div>
<p id="diff-legend" class="legend" hidden>+ added · − removed · ▸ lines the reviewer read for the current question</p>
<p id="diff-note" class="pane-note" role="status" hidden></p><div id="diff-body" class="diffbody"></div></section>
<main id="question-pane" class="pane" aria-label="Question">
<div id="skipbar" class="skipbar" hidden><input id="skipreason" maxlength="500" autocomplete="off" placeholder="Why is this urgent? (optional)" aria-label="Reason for skipping"><button id="skipconfirm" class="danger" type="button">Skip and continue</button><button id="skipcancel" class="quiet" type="button">Cancel</button><p>The push goes through without the check. The skip is logged.</p></div>
<div id="conversation" class="conversation" aria-label="Understanding check conversation">
<ol id="messages" aria-label="Conversation"></ol>
<p id="feedback" class="feedback" hidden></p><section id="question" hidden><p id="prompt" class="question"></p><ul id="choices" hidden></ul></section>
<p id="message" class="message" hidden></p><div id="status" class="status" role="status" aria-live="polite">Connecting to your local checkpoint…</div><div id="recovery" class="recovery" hidden></div>
</div>
<section id="evidence" class="evidence" aria-labelledby="evidence-title" hidden><h2 id="evidence-title">Code behind this question</h2><ul id="evidence-list"></ul><p id="evidence-note" class="pane-note"></p></section>
<div id="composer" class="composer"><p id="error" class="error" role="alert" hidden></p>
<form id="form"><label id="label" for="response">Your answer</label><textarea id="response" rows="2" maxlength="8000" autocomplete="off" spellcheck="true" placeholder="Your prediction and a short reason…"></textarea>
<div class="actions"><button type="button" class="quiet" data-action="learn">Explain this</button><button type="button" class="quiet" id="dispute">Dispute question</button><button id="submit" class="primary" type="submit">Send</button></div>
<p class="hint">Enter to send · Shift+Enter for a new line. Open-book—inspect the code whenever useful.</p></form></div>
<footer><p>Your answers go directly to Sphinx. The coding agent receives status only.</p><p id="waiting">Closing this tab leaves the check waiting. Use Pause check to stop.</p></footer>
</main></div></div>
<script nonce="${nonce}">
const token=${JSON.stringify(token)},base='/'+token,$=id=>document.getElementById(id);
let disputing=false,current,submitting=false,finished=false,connected=false,lastQuestion,lastGraded,lastMessages='';const openGroups=new Set();
const text=(id,value)=>{$(id).textContent=value||'';$(id).hidden=!value;};
const compact=n=>n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e3?(n/1e3).toFixed(1)+'k':String(n);
const usageText=(u,t)=>{if(!t)return '';const total=(t.input||0)+(t.output||0);if(!total&&t.cost==null)return '';
 return [compact(total)+' tokens',...(t.cost!=null?[t.cost===0?'$0':t.cost<0.0001?'<$0.0001':t.cost<0.01?'$'+t.cost.toFixed(4):'$'+t.cost.toFixed(2)]:[]),...(u?.limit!=null?[u.calls+'/'+u.limit+' calls']:[])].join(' · ');};
const resize=()=>{$('response').style.height='auto';$('response').style.height=Math.min($('response').scrollHeight||76,180)+'px';};
function controls(){
 if(!current)return;
 const canAnswer=current.phase==='question'&&!current.operationClosed&&connected&&!submitting;
 // Only answer controls follow the question state; browsing the change never locks.
 for(const button of document.querySelectorAll('#composer button'))button.disabled=!canAnswer;
 $('pause').disabled=!connected||submitting||finished;
 for(const id of ['skip','skipconfirm','skipcancel'])$(id).disabled=!connected||finished;
 for(const button of $('recovery').querySelectorAll('button'))button.disabled=!connected||submitting||finished;
 $('response').disabled=current.phase!=='question'||current.operationClosed||submitting;
}
function history(messages){
 const signature=JSON.stringify([current?.phase,messages]);
 if(signature===lastMessages)return;
 lastMessages=signature;
 const scroll=$('conversation'),nearBottom=scroll.scrollHeight-scroll.scrollTop-scroll.clientHeight<100;
 $('messages').replaceChildren();
 for(let index=0;index<messages.length;index++){
  const item=messages[index];
  if(item.kind==='activity'){
   // Consecutive review steps collapse to one line showing the latest step.
   const steps=[item];while(messages[index+1]?.kind==='activity')steps.push(messages[++index]);
   const row=document.createElement('li'),details=document.createElement('details'),summary=document.createElement('summary'),latest=document.createElement('span'),count=document.createElement('span'),list=document.createElement('ol');
   const live=index===messages.length-1&&current?.phase==='working';
   row.className='turn activity'+(live?' live':'');latest.className='latest';latest.textContent=steps.at(-1).text;
   count.className='count';count.textContent=steps.length===1?'':steps.length+' steps';
   summary.append(latest,count);
   for(const step of steps){const li=document.createElement('li');li.textContent=step.text;list.append(li);}
   details.open=openGroups.has(item.id);details.ontoggle=()=>{if(details.open)openGroups.add(item.id);else openGroups.delete(item.id);};
   details.append(summary,list);row.append(details);$('messages').append(row);continue;
  }
  const row=document.createElement('li'),name=document.createElement('div'),body=document.createElement('p');
  row.className='turn '+(item.role==='human'?'human':'sphinx')+(item.kind==='question'?' question':item.kind==='notice'?' notice':'')+(item.streaming?' streaming':'');
  name.className='speaker';name.textContent=item.role==='human'?'You':'Sphinx';body.className='turn-text';body.textContent=item.text;
  row.append(name);
  if(item.kind==='question'&&item.number){const caption=document.createElement('div');caption.className='question-number';caption.textContent='Question '+item.number+(item.followUp?' · Follow-up':'');row.append(caption);}
  row.append(body);
  if(item.choices?.length){const list=document.createElement('ul');for(const choice of item.choices){const li=document.createElement('li');li.textContent=choice;list.append(li);}row.append(list);}
  if(item.role==='human'&&['checking','not-graded'].includes(item.status)){const note=document.createElement('div');note.className='turn-note';note.textContent=item.status==='checking'?'Checking your reasoning…':'Not assessed. Your draft is still available below.';row.append(note);}
  $('messages').append(row);
 }
 if(nearBottom)scroll.scrollTop=scroll.scrollHeight;
}
function render(state){
 if(current&&state.sequence<current.sequence)return;
 const previous=current;current=state;finished=state.operationClosed||['passed','paused','error','skipped'].includes(state.phase);
 const repo=state.repoRoot?.split(/[\\\\/]/).filter(Boolean).at(-1),branch=state.target?.replace(/^refs\\/heads\\//,'');
 text('meta',repo||state.change?.header?.repository||'');$('meta').title=state.repoRoot||'';
 text('usage',usageText(state.usage,state.tokens));const messages=state.messages||[];
 text('waiting',finished?'':state.waitingGit?'Git continues after you pass. Closing this tab leaves it waiting; Pause check stops it.':'Closing this tab leaves the check waiting. Use Pause check to stop.');
 const label=state.phase==='question'?'Question '+(state.progress.completed+1)+' of '+state.progress.total:state.phase==='working'?'Reviewing…':state.phase==='recovery'?'Review needs your decision':state.phase==='passed'?'Passed':state.phase==='paused'?'Paused':state.phase==='skipped'?'Skipped':state.phase==='error'?'Check stopped':'Waiting…';
 const retry=state.phase==='question'&&[...messages].reverse().find(item=>item.kind==='question')?.followUp;
 text('status',label+(retry?' · Needs another answer':''));scope(state,branch,label);$('status').className='status phase-'+state.phase+(state.phase==='working'?' busy':'')+(retry?' retry':'');text('message',state.message);text('error',state.error);
 history(messages);
 // Live activity already shows progress; avoid stacking generic spinners under it.
 if(state.phase==='working'&&(messages.at(-1)?.kind==='activity'||messages.at(-1)?.streaming)){$('status').hidden=true;$('message').hidden=true;}
 text('feedback',messages.length?'':state.feedback);
 $('question').hidden=state.phase!=='question'||messages.some(item=>item.kind==='question'&&item.questionId===state.question?.id);
 $('composer').hidden=!['question','working'].includes(state.phase)&&!state.error;
 $('form').hidden=!['question','working'].includes(state.phase);
 $('recovery').hidden=state.phase!=='recovery';$('pause').hidden=finished;$('skip').hidden=finished;if(finished)$('skipbar').hidden=true;
 if(state.question){
  text('prompt',state.question.prompt);$('choices').replaceChildren();
  for(const choice of state.question.choices||[]){const li=document.createElement('li');li.textContent=choice;$('choices').append(li);}
  $('choices').hidden=!(state.question.choices||[]).length;
  const key=state.id+':'+state.question.id;
  // A saved, ungraded response (for example after a provider failure) is restored when the question is first shown.
  if(lastQuestion!==key){const draft=state.draft;$('response').value=draft?.text||'';lastQuestion=key;if(disputing!==(draft?.kind==='dispute')){setDispute(!disputing);text('error',state.error);}resize();}
 }
 const graded=[...messages].reverse().find(item=>item.role==='human'&&item.status==='graded');
 if(graded&&lastGraded!==graded.id){lastGraded=graded.id;$('response').value='';resize();if(disputing)setDispute(false);}
 $('recovery').replaceChildren();
 if(state.phase==='recovery')for(const choice of state.choices||[]){
  if(choice.value==='pause')continue;
  const row=document.createElement('div'),button=document.createElement('button'),description=document.createElement('p');
  button.type='button';button.textContent=choice.label;button.onclick=()=>send(choice.value);description.textContent=choice.description;row.append(button,description);$('recovery').append(row);
 }
 checkpoint(state);evidenceList();controls();
 // A new step (question, recovery decision, result) must never sit below the fold.
 if(previous?.phase!==state.phase||previous?.question?.id!==state.question?.id){const scroll=$('conversation');scroll.scrollTop=scroll.scrollHeight;
  if(globalThis.matchMedia?.('(max-width: 899px)').matches)[...document.querySelectorAll('#messages .turn.question')].at(-1)?.scrollIntoView?.({block:'start'});}
 if(state.phase==='question'&&(previous?.phase!=='question'||previous?.question?.id!==state.question?.id)&&document.visibilityState!=='hidden')$('response').focus({preventScroll:true});
}
async function send(action){
 if(!current||submitting||finished||!connected)return;
 if(['answer','learn','dispute'].includes(action)&&current.phase!=='question')return;
 const response=$('response').value.trim();
 if(['answer','dispute'].includes(action)&&!response){text('error',action==='dispute'?'Describe what is ambiguous or unsupported in the answer box.':'Enter your prediction and a short reason.');$('response').focus();return;}
 submitting=true;controls();
 try{
  const res=await fetch(base+'/action',{method:'POST',headers:{'Content-Type':'application/json','X-Sphinx-Token':token},body:JSON.stringify({id:current.id,revision:current.revision,action,...(['answer','learn','dispute'].includes(action)?{questionId:current.question.id,response}:action==='skip'&&$('skipreason').value.trim()?{response:$('skipreason').value.trim()}:{})})});
  const data=await res.json();if(!res.ok){text('error',data.error||'This response could not be submitted.');return;}render(data);
 }catch{if(!finished)text('error','Connection interrupted. Your response is not resent automatically. Wait for the current state before trying again.');}
 finally{submitting=false;controls();}
}
// Dispute is a reversible mode: the same box and Send button carry the reason.
function setDispute(on){
 disputing=on;$('form').classList.toggle('disputing',on);
 $('label').textContent=on?'What is ambiguous or wrong about this question?':'Your answer';
 $('response').placeholder=on?'Explain the missing assumption or the evidence that contradicts it…':'Your prediction and a short reason…';
 $('submit').textContent=on?'Send dispute':'Send';$('dispute').textContent=on?'Back to answering':'Dispute question';
 text('error','');$('response').focus();
}
$('dispute').onclick=()=>setDispute(!disputing);
const submit=()=>send(disputing?'dispute':'answer');
$('form').onsubmit=event=>{event.preventDefault();submit();};
$('response').oninput=resize;
$('response').onkeydown=event=>{
 if(event.key!=='Enter'||event.shiftKey||event.isComposing||event.keyCode===229)return;
 event.preventDefault();if(!event.repeat)submit();
};
for(const button of document.querySelectorAll('[data-action]'))button.onclick=()=>send(button.dataset.action);
$('pause').onclick=()=>send('pause');
$('skip').onclick=()=>{$('skipbar').hidden=false;$('skipreason').focus();};
$('skipcancel').onclick=()=>{$('skipbar').hidden=true;};
$('skipconfirm').onclick=()=>send('skip');
$('skipreason').onkeydown=event=>{if(event.key==='Enter'&&!event.isComposing){event.preventDefault();send('skip');}else if(event.key==='Escape')$('skipbar').hidden=true;};

// Change context: a read-only view of the exact frozen comparison. Every value
// from the repository enters the DOM through textContent, never markup.
let change,changeFor,changeLoading=false,filter='all',query='',selected,diff,diffSeq=0,tab='question',lastFiles='',lastEvidence='';const contextFor=new Map();
const el=(tag,className,value)=>{const node=document.createElement(tag);if(className)node.className=className;if(value!=null)node.textContent=value;return node;};
const num=n=>Number(n).toLocaleString('en-US');
const plural=(n,word)=>num(n)+' '+word+(n===1?'':'s');
const short=oid=>oid?oid.slice(0,10):'';
const announce=value=>{$('announce').textContent='';$('announce').textContent=value;};
function totalsText(t){
 if(!t)return '';
 const parts=[plural(t.files,'file'),'+'+num(t.additions)+' −'+num(t.deletions)+' lines'];
 if(t.binaryFiles)parts.push(plural(t.binaryFiles,'binary file')+' (no line counts)');
 if(t.uncountedFiles)parts.push(num(t.uncountedFiles)+' without line counts');
 return parts.join(' · ');
}
function scope(state,branch,label){
 const c=state.change,h=c?.header;
 $('scope-progress').textContent=label;
 if(!c){$('scope-op').textContent=branch?(state.event==='pre-commit'?'Commit to ':'Push to ')+branch:'Waiting…';$('scope-range').textContent='Loading…';$('scope-stats').textContent='Loading…';return;}
 if(h){
  const dest=(h.destination||'').replace(/^refs\\/heads\\//,'');
  $('scope-op').textContent=h.event==='pre-commit'?'Commit to '+dest+' (staged changes)':'Push to '+(h.remote&&h.remote!=='.'?h.remote+' / ':'')+dest;
  $('scope-range').textContent=h.staged?(h.base?short(h.base):'empty repository')+' → staged index':(h.base?short(h.base):'new branch (no destination history)')+' → '+short(h.head);
  $('scope-range').title='Checkpoint '+h.checkpoint+(h.base?'\\nBase '+h.base:'')+(h.head?'\\nHead '+h.head:'');
  $('scope-stats').textContent=totalsText(c.totals);
  $('scope-excluded-row').hidden=!h.excludedFiles;$('scope-excluded').textContent=h.excludedFiles?plural(h.excludedFiles,'file')+' not shown or counted':'';
  $('scope-note').textContent='Checkpoint changes: the exact range Sphinx froze for this check, not necessarily an entire pull request.'+(h.excludedFiles?' '+plural(h.excludedFiles,'more changed file')+' excluded by privacy or ignore rules; names, contents and line counts are not shown or counted.':'');
 }else{
  $('scope-op').textContent=branch?(state.event==='pre-commit'?'Commit to ':'Push to ')+branch:'—';
  $('scope-range').textContent=c.status==='loading'?'Loading…':'Unavailable';
  $('scope-stats').textContent=c.status==='loading'?'Loading changed files…':'Unavailable'+(c.reason?': '+c.reason:'');
 }
}
function checkpoint(state){
 if(changeFor&&changeFor!==state.id){change=undefined;changeFor=undefined;selected=undefined;diff=undefined;contextFor.clear();lastFiles='';clearDiff();}
 if(state.change?.status==='ready'&&changeFor!==state.id&&!changeLoading)loadChange(state.id);
 if(state.change?.status!=='ready'&&!change)$('files-note').textContent=state.change?.status==='unavailable'?'Changed files are unavailable: '+(state.change.reason||'unknown reason')+' The question can still be answered.':'Loading changed files…';
 files();
}
async function getJSON(path){const res=await fetch(base+path);let data={};try{data=await res.json();}catch{}return {ok:res.ok,status:res.status,data};}
async function loadChange(id){
 changeLoading=true;
 try{
  const r=await getJSON('/change?id='+encodeURIComponent(id));
  if(current?.id!==id)return;
  if(r.ok&&r.data.status==='ready'){change=r.data;changeFor=id;lastFiles='';$('files-note').textContent=filesNote();files();evidenceList();}
  else $('files-note').textContent='Changed files are unavailable: '+(r.data.error||r.data.reason||'the request failed.');
 }catch{$('files-note').textContent='Changed files could not be loaded. The question can still be answered.';}
 finally{changeLoading=false;}
}
function filesNote(){
 if(!change)return '';
 const notes=[];
 if(change.listed<change.totals.files)notes.push('Listing the first '+num(change.listed)+' of '+plural(change.totals.files,'file')+'. Totals count every file.');
 if(change.header.excludedFiles)notes.push(plural(change.header.excludedFiles,'changed file')+' excluded by privacy or ignore rules are not listed or counted.');
 return notes.join(' ');
}
function refs(){return current?.evidence&&current.question&&current.evidence.questionId===current.question.id?current.evidence.refs:null;}
function relevantPaths(){return new Set((refs()||[]).filter(ref=>ref.inChange).map(ref=>ref.viewPath));}
function statsOf(list){return list.reduce((t,f)=>{t.files++;if(f.binary)t.binaryFiles++;else if(f.additions==null)t.uncountedFiles++;else{t.additions+=f.additions;t.deletions+=f.deletions;}return t;},{files:0,additions:0,deletions:0,binaryFiles:0,uncountedFiles:0});}
const STATUS={added:'Added',modified:'Modified',deleted:'Deleted',renamed:'Renamed'};
function files(){
 const relevant=relevantPaths(),all=change?.files||[];
 const subset=filter==='relevant'?all.filter(f=>relevant.has(f.path)):all;
 const shown=query?subset.filter(f=>(f.path+' '+(f.oldPath||'')).toLowerCase().includes(query.toLowerCase())):subset;
 const signature=JSON.stringify([changeFor,filter,query,selected,[...relevant],all.length]);
 $('filter-all').setAttribute('aria-pressed',String(filter==='all'));$('filter-relevant').setAttribute('aria-pressed',String(filter==='relevant'));
 const cited=statsOf(all.filter(f=>relevant.has(f.path)));
 $('count-all').textContent=change?plural(change.totals.files,'file'):'';
 $('count-relevant').textContent=change?(refs()?plural(cited.files,'file'):'—'):'';
 if(signature===lastFiles)return;lastFiles=signature;
 const list=$('file-list');list.replaceChildren();
 if(!change){$('filter-total').textContent='';return;}
 $('filter-total').textContent=filter==='relevant'
  ?(relevant.size?'Cited by this question: '+totalsText(cited)+'. Question evidence, not everything that changed.':(refs()?'This question cites no changed file with a known location.':'No question is active.'))
  :'All changed files: '+totalsText(change.totals)+(query?'. Showing paths matching “'+query+'”.':'.');
 for(const f of shown){
  const li=el('li'),button=el('button','file');button.type='button';button.dataset.path=f.path;
  if(f.path===selected)button.setAttribute('aria-current','true');
  const badge=el('span','badge '+f.status,f.binary?'Binary':STATUS[f.status]);
  const name=el('span','name',f.path);
  if(f.oldPath)name.append(el('span','from','from '+f.oldPath));
  if(relevant.has(f.path))name.append(el('span','relevant','▸ cited by this question'));
  const counts=el('span','counts');
  if(f.binary||f.additions==null)counts.textContent=f.binary?'binary':'n/a';
  else{counts.append(el('span','plus','+'+num(f.additions)),' ',el('span','minus','−'+num(f.deletions)));}
  button.setAttribute('aria-label',(f.binary?'Binary file ':'')+STATUS[f.status]+' '+f.path+(f.oldPath?' from '+f.oldPath:'')+(f.binary||f.additions==null?', no line counts':', '+f.additions+' added, '+f.deletions+' removed lines')+(relevant.has(f.path)?', cited by this question':''));
  button.append(badge,name,counts);button.onclick=()=>openFile(f.path,{show:true});
  li.append(button);list.append(li);
 }
 if(!shown.length)list.append(el('li','pane-note',filter==='relevant'?'No changed files are linked to this question.':'No files match this filter.'));
}
$('filter-all').onclick=()=>{filter='all';files();announce('Showing all changed files.');};
$('filter-relevant').onclick=()=>{filter='relevant';files();announce('Showing files relevant to this question.');};
$('file-search').oninput=()=>{query=$('file-search').value.trim();files();};
$('file-list').onkeydown=event=>{
 if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
 const buttons=[...$('file-list').querySelectorAll('button')];if(!buttons.length)return;
 const at=buttons.indexOf(document.activeElement);event.preventDefault();
 const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:Math.max(0,Math.min(buttons.length-1,at+(event.key==='ArrowDown'?1:-1)));
 buttons[next].focus();
};
function setTab(name){
 tab=name;$('workspace').className='workspace show-'+name;
 for(const id of ['question','files','diff'])$('tab-'+id).setAttribute('aria-selected',String(id===name));
}
for(const id of ['question','files','diff'])$('tab-'+id).onclick=()=>{setTab(id);announce(id==='question'?'Question view. Your answer is kept.':id==='files'?'Changed files view.':'Diff view.');};
$('back-question').onclick=()=>{setTab('question');$('response').focus({preventScroll:true});announce('Back to the question. Your answer is kept.');};
function clearDiff(){$('diff-title').textContent='No file selected';$('diff-meta').textContent='Choose a file from the list, or a code reference beside the question.';$('diff-body').replaceChildren();$('diff-note').hidden=true;$('diff-legend').hidden=true;$('context-more').hidden=true;$('context-all').hidden=true;}
const NOTES={binary:'Binary file. Its contents are not shown and no line counts are reported.',symlink:'Symbolic link changed. The link target is not shown.',submodule:'Submodule pointer changed. Its contents are outside this repository diff.',unsupported:'This file type is not shown.','rename-only':'Renamed without content changes.','mode-only':'Only the file mode changed; no lines changed.',empty:'Empty file. There are no lines to show.','too-large':'This diff is too large to display here. The totals above still count it.','non-utf8':'Not valid UTF-8 text, so the contents are not shown.'};
async function openFile(path,{show=false,range,quiet=false}={}){
 if(!current||!change)return;
 selected=path;files();if(show)setTab('diff');
 const level=contextFor.get(path)||'3',id=current.id,seq=++diffSeq;
 $('diff-title').textContent=path;$('diff-meta').textContent='Loading diff…';
 try{
  const r=await getJSON('/diff?id='+encodeURIComponent(id)+'&path='+encodeURIComponent(path)+'&context='+encodeURIComponent(level));
  if(seq!==diffSeq||current?.id!==id)return;
  if(!r.ok){diff=undefined;$('diff-body').replaceChildren();$('diff-meta').textContent='';$('diff-note').textContent=r.data.error||'This diff is unavailable.';$('diff-note').hidden=false;return;}
  diff=r.data;
  if(range&&level!=='all'&&!visible(range)&&!diff.note){contextFor.set(path,'all');return openFile(path,{range,quiet});}
  drawDiff(quiet?undefined:range,quiet);
 }catch{if(seq===diffSeq){$('diff-meta').textContent='';$('diff-note').textContent='The diff could not be loaded. Your answer is unaffected.';$('diff-note').hidden=false;}}
}
function rowsOf(d){return (d?.hunks||[]).flatMap(h=>h.rows);}
function visible(range){return rowsOf(diff).some(row=>row[range.side]!=null&&row[range.side]>=range.start&&row[range.side]<=range.end);}
function marked(row,ranges){return ranges.some(r=>row[r.side]!=null&&row[r.side]>=r.start&&row[r.side]<=r.end);}
function drawDiff(focus,quiet=false){
 const d=diff,ranges=(refs()||[]).filter(ref=>ref.viewPath===d.path).flatMap(ref=>ref.ranges);
 const level=d.context;
 $('diff-title').textContent=d.path;
 $('diff-meta').textContent=[(d.binary?'Binary · ':'')+STATUS[d.status]+(d.oldPath?' from '+d.oldPath:''),d.binary||d.additions==null?'no line counts':'+'+num(d.additions)+' −'+num(d.deletions),d.modeChange?'mode '+d.modeChange.from+' → '+d.modeChange.to:'',d.hunks.length?(level==='all'?'full file':level+' lines of context'):''].filter(Boolean).join(' · ');
 const notes=[];if(d.note)notes.push(NOTES[d.note]||'Contents are not shown.');
 if(d.truncated)notes.push('Showing the first '+num(d.truncated.shownRows)+' of '+num(d.truncated.totalRows)+' diff lines. The rest of this file is not displayed; the totals still count it.');
 if(ranges.length&&!rowsOf(d).some(row=>marked(row,ranges)))notes.push('The lines the reviewer read in this file are outside the displayed content.');
 $('diff-note').textContent=notes.join(' ');$('diff-note').hidden=!notes.length;
 $('context-more').hidden=$('context-all').hidden=!d.hunks.length||level==='all';
 $('diff-legend').hidden=!d.hunks.length;
 const table=el('table','diff'),body=el('tbody');table.append(body);table.setAttribute('aria-label','Diff of '+d.path);
 let previous,first;
 for(const hunk of d.hunks){
  const hiddenLines=previous?hunk.newStart-(previous.newStart+previous.newLines):Math.max(hunk.newStart,hunk.oldStart)-1;
  if(hiddenLines>0&&level!=='all'){const tr=el('tr','gap'),td=el('td',null,'⋯ '+plural(hiddenLines,'unchanged line')+' not shown');td.colSpan=5;tr.append(td);body.append(tr);}
  const head=el('tr','hunk'),cell=el('td',null,'@@ −'+hunk.oldStart+','+hunk.oldLines+' +'+hunk.newStart+','+hunk.newLines+' @@'+(hunk.section?' '+hunk.section:''));cell.colSpan=5;head.append(cell);body.append(head);
  for(const row of hunk.rows){
   const hit=ranges.length&&marked(row,ranges);
   const tr=el('tr',row.type+(hit?' evidence':''));
   const sign=row.type==='addition'?'+':row.type==='deletion'?'−':' ';
   tr.append(el('td','mark',hit?'▸':''),el('td','num',row.old??''),el('td','num',row.new??''),el('td','sign',sign),el('td','code',row.text+(row.noNewline?'  ⏎ no newline at end of file':'')));
   tr.setAttribute('aria-label',(row.type==='addition'?'Added line '+row.new:row.type==='deletion'?'Removed line '+row.old:'Unchanged line '+row.new)+(hit?', read by the reviewer for this question':''));
   if(hit&&!first&&focus&&marked(row,[focus]))first=tr;
   body.append(tr);
  }
  if(hunk.cut){const tr=el('tr','gap'),td=el('td',null,'⋯ display limit reached');td.colSpan=5;tr.append(td);body.append(tr);}
  previous=hunk;
 }
 $('diff-body').replaceChildren(...(d.hunks.length?[table]:[]));
 if(first){first.tabIndex=-1;first.scrollIntoView?.({block:'center'});first.focus?.({preventScroll:true});announce('Showing '+d.path+', lines the reviewer read for this question are marked.');}
 else if(!quiet)announce('Showing '+d.path+'.');
}
$('context-more').onclick=()=>{if(!diff)return;const now=contextFor.get(diff.path)||'3';contextFor.set(diff.path,now==='3'?'25':'all');openFile(diff.path);};
$('context-all').onclick=()=>{if(!diff)return;contextFor.set(diff.path,'all');openFile(diff.path);};
function rangeText(r){return (r.side==='old'?'old ':'')+'line'+(r.end>r.start?'s '+r.start+'–'+r.end:' '+r.start);}
function evidenceList(){
 const active=current&&['question','working'].includes(current.phase)&&current.question;
 $('evidence').hidden=!active;
 if(!active){if(lastEvidence!=='inactive'){lastEvidence='inactive';if(diff&&diff.path===selected)drawDiff(undefined,true);}return;}
 const list=refs(),signature=JSON.stringify([current.id,current.question.id,list,Boolean(change),current.change?.status]);
 if(signature===lastEvidence)return;lastEvidence=signature;
 $('evidence-list').replaceChildren();
 if(!list){$('evidence-note').textContent=current.change?.status==='unavailable'?'Code references are unavailable because the change could not be loaded.':'Loading code references…';return;}
 for(const ref of list){
  const li=el('li'),path=el('span','ref-path',ref.path),lines=el('span','ref-lines',ref.ranges.length?ref.ranges.map(rangeText).join(', '):'No verified line range; the file as a whole is cited.');
  if(ref.inChange&&change){
   const button=el('button');button.type='button';button.append(path,lines);
   button.setAttribute('aria-label','Open '+ref.path+(ref.ranges.length?', '+ref.ranges.map(rangeText).join(', '):''));
   button.onclick=()=>openFile(ref.viewPath,{show:true,range:ref.ranges[0]});li.append(button);
  }else{li.className='static';lines.textContent=(ref.inChange?'':'Unchanged file, not part of this change. ')+lines.textContent;li.append(path,lines);}
  $('evidence-list').append(li);
 }
 $('evidence-note').textContent=list.length
  ?'Ranges the reviewer read while preparing this question. They point to context; they are not a claim that every changed line was read or checked.'
  :'No specific code location is available for this question.';
 files();
 // Keep the code beside the question: open its first cited hunk once, without
 // switching views. Never replace a file the person chose; refresh its markers.
 const firstRef=list.find(ref=>ref.inChange);
 if(change&&!selected&&firstRef)openFile(firstRef.viewPath,{range:firstRef.ranges[0],quiet:true});
 else if(diff&&diff.path===selected)drawDiff(undefined,true);
}
const events=new EventSource(base+'/events');events.onmessage=event=>{try{connected=true;render(JSON.parse(event.data));if(current?.operationClosed){connected=false;events.close();}}catch{}};
events.onerror=()=>{connected=false;controls();if(current?.operationClosed){events.close();return;}text('error','Connection interrupted. Reconnecting… No response is retried automatically. If Git has stopped, check its output.');};
</script></body></html>`;
}
