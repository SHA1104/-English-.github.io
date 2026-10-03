const sb = (window.APP_CONFIG?.SUPABASE_URL || "").includes("YOUR-PROJECT") || !window.supabase
  ? null
  : window.supabase.createClient(window.APP_CONFIG.SUPABASE_URL, window.APP_CONFIG.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });

function syncStatus(text, kind=""){
  const el=$("syncStatus");
  if(el){ el.textContent=text; el.className=`sync-status ${kind}`; }
}

const state = {
  user:null, records:new Map(), userWords:[], view:"home",
  queue:[], index:0, phase:"reveal", current:null,
  inflCurrent:null, inflCell:null
};

const $ = id => document.getElementById(id);
const norm = s => String(s??"").toLowerCase().trim()
  .replaceAll("ā","a").replaceAll("ē","e").replaceAll("ī","i")
  .replaceAll("ō","o").replaceAll("ū","u").replaceAll("ȳ","y");

function localDay(d=new Date()){
  return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);
}
function interval(level){
  return ({0:0,1:86400,2:3*86400,3:7*86400,4:14*86400}[level] ?? 30*86400);
}
function recordDefault(){
  return {seen:0,known:0,unknown:0,quiz_right:0,quiz_wrong:0,status:"new",
    streak:0,srs_level:0,due_at:new Date().toISOString(),last_studied:null,
    wrong_cells:[]};
}
function allWords(){
  const m=new Map();
  for(const w of window.CORE_WORDS||[]) m.set(norm(w.latin),structuredClone(w));
  for(const w of state.userWords) m.set(norm(w.latin),w);
  return [...m.values()];
}
function rec(word){ return state.records.get(norm(word.latin)) || recordDefault(); }

async function loadData(){
  if(!sb){ syncStatus("⚠️ Supabase 客户端没有加载成功", "error"); return; }
  syncStatus("☁️ 正在读取云端学习记录…");
  const {data:{user}}=await sb.auth.getUser();
  state.user=user;
  if(!user){ showAuth(false); return; }
  showAuth(true);
  const [recordsResult, wordsResult] = await Promise.all([
    sb.from("learning_records").select("*").eq("user_id",user.id),
    sb.from("user_words").select("*").eq("user_id",user.id).order("created_at",{ascending:true})
  ]);
  if(recordsResult.error){
    console.error("读取 learning_records 失败", recordsResult.error);
    syncStatus(`⚠️ 读取学习记录失败：${recordsResult.error.message}`, "error");
  }
  if(wordsResult.error){ console.error("读取 user_words 失败", wordsResult.error); }
  const records=recordsResult.data, words=wordsResult.data;
  state.records.clear();
  for(const r of records||[]) state.records.set(norm(r.latin),r);
  state.userWords=(words||[]).map(x=>({...x, morph:x.morph||null}));
  renderHome();
  if(!recordsResult.error) syncStatus(`☁️ 云端已连接 · 已同步 ${state.records.size} 条学习记录`, "ok");
}
function showAuth(logged){
  $("authPanel").classList.toggle("hidden",logged);
  $("homePanel").classList.toggle("hidden",!logged);
  $("bottomNav").classList.toggle("hidden",!logged);
  $("setupPanel").classList.add("hidden");
  $("authArea").innerHTML=logged
    ? `<button class="ghost" id="logoutBtn">退出</button>`
    : `<button class="ghost" id="loginBtn">登录 / 注册</button>`;
  if(logged) $("logoutBtn").onclick=async()=>{await sb.auth.signOut();location.reload()};
  else $("loginBtn").onclick=()=>{$("authPanel").classList.remove("hidden")};
}
async function saveRecord(word, patch){
  const old=rec(word), next={...old,...patch,user_id:state.user.id,latin:word.latin,
    updated_at:new Date().toISOString()};
  const {data,error}=await sb.from("learning_records").upsert(next,{onConflict:"user_id,latin"}).select().single();
  if(error){
    console.error("Supabase 保存学习记录失败:",error);
    const msg=error.message||"无法保存学习记录";
    syncStatus(`❌ 保存失败：${msg}`, "error");
    const homeMsg=$("welcome"); if(homeMsg) homeMsg.textContent=`${state.user?.email||""} · ${msg}`;
    return old;
  }
  syncStatus("☁️ 已同步到 Supabase", "ok");
  state.records.set(norm(word.latin),data);
  return data;
}
async function studyAction(word, known){
  const r=rec(word), now=new Date();
  let level=Number(r.srs_level||0), streak=Number(r.streak||0);
  const patch={seen:Number(r.seen||0)+1, last_studied:now.toISOString(), status:"learning"};
  if(known){patch.known=Number(r.known||0)+1; streak++; level=Math.min(4,level+1); patch.streak=streak;patch.srs_level=level;
    patch.due_at=new Date(now.getTime()+interval(level)*1000).toISOString();
  }else{patch.unknown=Number(r.unknown||0)+1;patch.streak=0;patch.srs_level=0;patch.due_at=new Date(now.getTime()+60000).toISOString();}
  if(streak>=2) patch.status="mastered";
  await saveRecord(word,patch);
}
async function quizAction(word,correct){
  const r=rec(word);
  await saveRecord(word,{quiz_right:Number(r.quiz_right||0)+(correct?1:0),
    quiz_wrong:Number(r.quiz_wrong||0)+(correct?0:1),
    due_at:correct?r.due_at:new Date(Date.now()+60000).toISOString()});
}
function dueWords(){
  const now=Date.now();
  return allWords().filter(w=>{const r=rec(w);return r.status!=="mastered" || !r.due_at || new Date(r.due_at).getTime()<=now});
}
function wordForRecord(r){return allWords().find(w=>norm(w.latin)===norm(r.latin))||{latin:r.latin,meaning:""};}
function renderRecordRow(r){
  const w=wordForRecord(r);
  const t=r.last_studied?new Date(r.last_studied).toLocaleString("zh-CN",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"}):"—";
  const status=r.status==="mastered"?"已掌握":r.seen>0?"学习中":"新词";
  return `<div class="lib-row"><div class="lib-main"><div class="lib-latin">${w.latin}</div><div class="lib-meaning">${w.meaning||"—"} · ${t}</div></div><span class="pill ${r.status}">${status}</span></div>`;
}
function renderRecords(){
  const rows=[...state.records.values()].filter(r=>Number(r.seen||0)>0).sort((a,b)=>new Date(b.last_studied||0)-new Date(a.last_studied||0));
  $("recordsList").innerHTML=rows.length?rows.map(renderRecordRow).join(""):`<div class="auth-panel"><p>还没有学习记录。</p></div>`;
}
function renderHome(){
  $("homePanel").classList.remove("hidden");
  const words=allWords(), rs=words.map(rec);
  const studied=rs.filter(r=>Number(r.seen||0)>0), due=dueWords().filter(w=>Number(rec(w).seen||0)>0).length;
  const mastered=rs.filter(r=>r.status==="mastered").length;
  const learning=rs.filter(r=>r.seen>0&&r.status!=="mastered").length;
  const right=rs.reduce((n,r)=>n+Number(r.quiz_right||0),0), wrong=rs.reduce((n,r)=>n+Number(r.quiz_wrong||0),0);
  $("studiedCount").textContent=studied.length;$("dueCount").textContent=due;$("masteredCount").textContent=mastered;$("learningCount").textContent=learning;
  $("accuracy").textContent=(right+wrong)?Math.round(right/(right+wrong)*100)+"%":"—";
  $("welcome").textContent=state.user?.email || "";
  const days=new Set(rs.filter(r=>r.last_studied).map(r=>localDay(new Date(r.last_studied))));
  $("streakBox").innerHTML=`${days.size}<br><span>学习天数</span>`;
  const recent=[...state.records.values()].filter(r=>r.seen>0).sort((a,b)=>new Date(b.last_studied||0)-new Date(a.last_studied||0)).slice(0,10);
  $("recentRecords").innerHTML=recent.length?recent.map(renderRecordRow).join(""):`<div class="auth-panel"><p>还没有学习记录。</p></div>`;
}
function showView(view){
  state.view=view;
  ["home","study","inflection","library","records","wrong"].forEach(v=>{
    const el=$(v+"Panel"); if(el) el.classList.toggle("hidden",v!==view);
  });
  if(view==="home") renderHome();
  if(view==="study") startStudy();
  if(view==="inflection") startInflection();
  if(view==="library") renderLibrary();
  if(view==="records") renderRecords();
  if(view==="wrong") renderWrong();
}
document.addEventListener("click",e=>{
  const b=e.target.closest("[data-view]"); if(b) showView(b.dataset.view);
});

function startStudy(){
  const due=dueWords();
  const fresh=allWords().filter(w=>!rec(w).seen);
  state.queue=[...due,...fresh.filter(w=>!due.some(d=>norm(d.latin)===norm(w.latin)))].sort(()=>Math.random()-.5).slice(0,10);
  state.index=0;state.phase="reveal";state.current=state.queue[0];renderStudy();
}
function renderStudy(){
  const w=state.current, card=$("studyCard");
  if(!w){card.innerHTML="<p class='muted'>暂时没有需要学习的单词。</p>";return}
  const r=rec(w), pct=Math.round((state.index/state.queue.length)*100);
  if(state.phase==="reveal"){
    card.innerHTML=`<div class="progress"><i style="width:${Math.max(5,pct)}%"></i></div>
      <div class="meta">${state.index+1} / ${state.queue.length} · ${r.status==="mastered"?"已掌握":"学习中"}</div>
      <div class="word">${w.latin}</div><div class="syll">${w.syll||""}</div>
      <div class="meaning">${w.meaning||"—"}</div><div class="meta">${w.pos||""}</div>
      ${(w.ex_la||w.ex_zh)?`<div class="example"><div class="la">${w.ex_la||""}</div><div class="zh">${w.ex_zh||""}</div></div>`:""}
      <div class="actions"><button id="dontKnow">还不认识</button><button class="known" id="know">我认识</button></div>`;
    $("dontKnow").onclick=async()=>{await studyAction(w,false);state.phase="quiz";renderStudy()};
    $("know").onclick=async()=>{await studyAction(w,true);state.phase="quiz";renderStudy()};
  }else if(state.phase==="quiz"){
    card.innerHTML=`<div class="progress"><i style="width:${pct+10}%"></i></div>
      <div class="quiz-title">${w.latin} 的意思是什么？</div>
      <input id="quizInput" class="quiz-input" autocomplete="off" placeholder="输入中文释义">
      <div class="actions"><button id="skipQuiz">显示答案</button><button class="known" id="checkQuiz">检查</button></div>
      <div id="quizFeedback" class="feedback"></div>`;
    $("quizInput").focus();
    $("checkQuiz").onclick=()=>checkQuiz(w);
    $("quizInput").onkeydown=e=>{if(e.key==="Enter")checkQuiz(w)};
    $("skipQuiz").onclick=()=>{ $("quizFeedback").innerHTML=`<span class="muted">答案：${w.meaning}</span>` };
  }
}
async function checkQuiz(w){
  const input=norm($("quizInput").value), answer=norm(w.meaning||"");
  const correct=!!input && (answer.includes(input)||input.includes(answer));
  await quizAction(w,correct);
  $("quizFeedback").innerHTML=correct?`<span class="ok">✓ 正确</span>`:`<span class="bad">✕ ${w.meaning}</span>`;
  setTimeout(()=>{state.index++;state.current=state.queue[state.index];state.phase="reveal";if(state.current)renderStudy();else showView("home")},650);
}

function generateNoun(w){
  const m=w.morph||{}; const lemma=w.latin, g=m.genitive||"";
  if(!g)return null;
  const stem=g.endsWith("ae")?g.slice(0,-2):g.endsWith("ī")?g.slice(0,-2):g.endsWith("is")?g.slice(0,-2):null;
  if(!stem)return null;
  if(m.declension===1)return {type:"noun",columns:["主格","属格","与格","宾格","夺格"],rows:{"单数":[lemma, g, stem+"ae",stem+"am",stem+"ā"],"复数":[stem+"ae",stem+"ārum",stem+"īs",stem+"ās",stem+"īs"]}};
  if(m.declension===2 && m.gender==="中性")return {type:"noun",columns:["主格","属格","与格","宾格","夺格"],rows:{"单数":[lemma,g,stem+"ō",lemma,stem+"ō"],"复数":[stem+"a",stem+"ōrum",stem+"īs",stem+"a",stem+"īs"]}};
  if(m.declension===2)return {type:"noun",columns:["主格","属格","与格","宾格","夺格"],rows:{"单数":[lemma,g,stem+"ō",stem+"um",stem+"ō"],"复数":[stem+"ī",stem+"ōrum",stem+"īs",stem+"ōs",stem+"īs"]}};
  if(m.declension===3)return {type:"noun",columns:["主格","属格","与格","宾格","夺格"],rows:{"单数":[lemma,g,stem+"ī",stem+"em",stem+"e"],"复数":[stem+"ēs",stem+"um",stem+"ibus",stem+"ēs",stem+"ibus"]}};
  return null;
}
function generateAdj(w){
  const m=w.morph||{}, base=w.latin, f=m.feminine, n=m.neuter;
  if(!f||!n)return null;
  const stem=base.endsWith("us")?base.slice(0,-2):base;
  return {type:"adjective",columns:["阳性","阴性","中性"],rows:{"单数":[base,f,n],"复数":[stem+"ī",f.slice(0,-1)+"ae",n.slice(0,-2)+"a"]}};
}
function generateVerb(w){
  const m=w.morph||{}, p=m.present, inf=m.infinitive;
  if(m.irregular==="sum")return {type:"verb",columns:["人称"],rows:{"现在时":["sum","es","est","sumus","estis","sunt"]}};
  if(!p||!inf)return null;
  const s=inf.slice(0,-3), c=String(m.conjugation);
  let endings=c==="1"?["ō","ās","at","āmus","ātis","ant"]:c==="2"?["eō","ēs","et","ēmus","ētis","ent"]:c==="4"?["iō","īs","it","īmus","ītis","iunt"]:["ō","is","it","imus","itis","unt"];
  return {type:"verb",columns:["人称"],rows:{"现在时":endings.map(x=>s+x)}};
}
function inflection(w){
  return w.morph?.kind==="verb"?generateVerb(w):w.morph?.kind==="adjective"?generateAdj(w):generateNoun(w);
}
function startInflection(){
  const candidates=allWords().filter(w=>w.morph && inflection(w));
  state.inflCurrent=candidates[Math.floor(Math.random()*candidates.length)]||null;
  renderInflection();
}
function renderInflection(){
  const w=state.inflCurrent, card=$("inflCard");
  if(!w){card.innerHTML="<p class='muted'>当前没有可训练的词形。</p>";return}
  const data=inflection(w); const rows=[];
  for(const [k,vals] of Object.entries(data.rows)) for(let i=0;i<vals.length;i++) rows.push({group:k,i,val:vals[i]});
  const target=rows[Math.floor(Math.random()*rows.length)];
  state.inflCell=target;
  const shown=target.val;
  card.innerHTML=`<div class="meta">${w.latin} · ${w.meaning||""}</div><div class="word">${w.latin}</div>
    <p class="quiz-title">填写：${target.group} · ${data.columns[target.i]||"人称"}</p>
    <input id="inflInput" class="quiz-input" placeholder="输入拉丁语词形">
    <div class="view-buttons"><button id="inflCheck">检查</button><button id="inflShow">查看表格</button></div>
    <div id="inflFeedback" class="feedback"></div><div id="inflTable"></div>`;
  $("inflInput").focus();$("inflCheck").onclick=checkInfl;
  $("inflInput").onkeydown=e=>{if(e.key==="Enter")checkInfl()};
  $("inflShow").onclick=()=>showInflTable(w,data,target);
}
async function checkInfl(){
  const w=state.inflCurrent, data=inflection(w), target=state.inflCell;
  const input=norm($("inflInput").value), answer=norm(target.val), ok=input===answer;
  const r=rec(w), cells=Array.isArray(r.wrong_cells)?r.wrong_cells:[];
  const key=`${target.group}:${target.i}`;
  const nextCells=ok?cells.filter(x=>x!==key):[...new Set([...cells,key])];
  await saveRecord(w,{wrong_cells:nextCells});
  $("inflFeedback").innerHTML=ok?`<span class="ok">✓ 正确：${target.val}</span>`:`<span class="bad">✕ 正确答案：${target.val}</span>`;
  if(ok)setTimeout(startInflection,600);
}
function showInflTable(w,data,target){
  let html=`<div class="table-wrap"><table class="infl-table"><thead><tr><th></th>${data.columns.map(x=>`<th>${x}</th>`).join("")}</tr></thead><tbody>`;
  for(const [g,vals] of Object.entries(data.rows)) html+=`<tr><th>${g}</th>${vals.map((v,i)=>`<td>${g===target.group&&i===target.i?"？":v}</td>`).join("")}</tr>`;
  $("inflTable").innerHTML=html+"</tbody></table></div>";
}
function escapeHtml(value){
  return String(value??"").replace(/[&<>'"]/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[ch]));
}
function isCoreWord(w){
  return (window.CORE_WORDS||[]).some(x=>norm(x.latin)===norm(w.latin));
}
function getUserWord(latin){
  return state.userWords.find(w=>norm(w.latin)===norm(latin));
}
function morphFromForm(){
  const kind=$("morphKind").value;
  if(!kind)return null;
  if(kind==="noun"){
    const genitive=$("mGenitive")?.value.trim()||"";
    const declension=Number($("mDeclension")?.value||0);
    const gender=$("mGender")?.value.trim()||"";
    if(!genitive||!declension||!gender)return {kind,genitive,declension,gender};
    return {kind,genitive,declension,gender};
  }
  if(kind==="adjective") return {kind,feminine:$("mFeminine")?.value.trim()||"",neuter:$("mNeuter")?.value.trim()||""};
  return {kind,conjugation:$("mConjugation")?.value.trim()||"",infinitive:$("mInfinitive")?.value.trim()||"",present:$("mPresent")?.value.trim()||"",irregular:$("mIrregular")?.value.trim()||""};
}
function renderMorphFields(morph=null){
  const kind=$("morphKind").value, box=$("morphFields");
  if(!kind){box.innerHTML="<p class='muted form-help'>不设置词形训练也可以。以后仍可编辑补充。</p>";return;}
  if(kind==="noun"){
    box.innerHTML=`<div class="form-grid"><input id="mGenitive" placeholder="属格，如 rosae"><input id="mDeclension" type="number" min="1" max="5" placeholder="变格，如 1"></div><input id="mGender" placeholder="性别，如 阴性 / 阳性 / 中性">`;
    if(morph){$("mGenitive").value=morph.genitive||"";$("mDeclension").value=morph.declension||"";$("mGender").value=morph.gender||"";}
  }else if(kind==="adjective"){
    box.innerHTML=`<div class="form-grid"><input id="mFeminine" placeholder="阴性，如 bona"><input id="mNeuter" placeholder="中性，如 bonum"></div>`;
    if(morph){$("mFeminine").value=morph.feminine||"";$("mNeuter").value=morph.neuter||"";}
  }else{
    box.innerHTML=`<div class="form-grid"><input id="mConjugation" placeholder="变位，如 1"><input id="mInfinitive" placeholder="不定式，如 amare"></div><input id="mPresent" placeholder="现在时词干，如 am"><input id="mIrregular" placeholder="特殊动词可填 sum">`;
    if(morph){$("mConjugation").value=morph.conjugation||"";$("mInfinitive").value=morph.infinitive||"";$("mPresent").value=morph.present||"";$("mIrregular").value=morph.irregular||"";}
  }
}
let editingWordLatin=null;
let libraryFilter="all";
function openWordForm(word=null){
  editingWordLatin=word?.latin||null;
  $("wordForm").classList.remove("hidden");
  $("wordFormTitle").textContent=word?`编辑：${word.latin}`:"添加单词";
  $("wordFormMsg").textContent="";
  $("wordLatin").value=word?.latin||"";
  $("wordSyll").value=word?.syll||"";
  $("wordPos").value=word?.pos||"";
  $("wordMeaning").value=word?.meaning||"";
  $("wordExLa").value=word?.ex_la||"";
  $("wordExZh").value=word?.ex_zh||"";
  const kind=word?.morph?.kind||"";
  $("morphKind").value=kind;
  renderMorphFields(word?.morph||null);
  $("wordLatin").focus();
}
function closeWordForm(){editingWordLatin=null;$("wordForm").classList.add("hidden");}
async function saveUserWord(){
  if(!state.user){$("wordFormMsg").textContent="请先登录。";return;}
  const latin=$("wordLatin").value.trim(), meaning=$("wordMeaning").value.trim();
  if(!latin||!meaning){$("wordFormMsg").textContent="请至少填写拉丁词和中文释义。";return;}
  const coreExists=isCoreWord({latin});
  if(coreExists && !editingWordLatin){$("wordFormMsg").textContent="这个词已经在核心词库中，不需要重复添加。";return;}
  if(coreExists && editingWordLatin && norm(editingWordLatin)!==norm(latin)){$("wordFormMsg").textContent="不能把自定义词改名为核心词。";return;}
  const payload={user_id:state.user.id,latin,syll:$("wordSyll").value.trim()||null,pos:$("wordPos").value.trim()||null,meaning,ex_la:$("wordExLa").value.trim()||null,ex_zh:$("wordExZh").value.trim()||null,morph:morphFromForm()};
  $("saveWordBtn").disabled=true;$("wordFormMsg").textContent="正在保存…";
  try{
    if(editingWordLatin && norm(editingWordLatin)!==norm(latin)){
      const existing=getUserWord(latin);
      if(existing){$("wordFormMsg").textContent="这个拉丁词已经存在于你的词库中。";return;}
      const {error:delErr}=await sb.from("user_words").delete().eq("user_id",state.user.id).eq("latin",editingWordLatin);
      if(delErr)throw delErr;
      await sb.from("learning_records").delete().eq("user_id",state.user.id).eq("latin",editingWordLatin);
    }
    const {data,error}=await sb.from("user_words").upsert(payload,{onConflict:"user_id,latin"}).select().single();
    if(error)throw error;
    const idx=state.userWords.findIndex(w=>norm(w.latin)===norm(editingWordLatin||latin));
    if(idx>=0)state.userWords[idx]={...data,morph:data.morph||null};else state.userWords.push({...data,morph:data.morph||null});
    syncStatus("☁️ 自定义单词已同步", "ok");
    closeWordForm();renderLibrary();renderHome();
  }catch(err){
    console.error("保存自定义单词失败",err);$("wordFormMsg").textContent=`保存失败：${err.message||err}`;syncStatus(`❌ 自定义单词保存失败：${err.message||err}`,"error");
  }finally{$("saveWordBtn").disabled=false;}
}
async function deleteUserWord(latin){
  const word=getUserWord(latin);if(!word)return;
  if(!confirm(`确定删除「${latin}」吗？\n该词的学习记录也会一起删除。`))return;
  try{
    const {error}=await sb.from("user_words").delete().eq("user_id",state.user.id).eq("latin",latin);
    if(error)throw error;
    await sb.from("learning_records").delete().eq("user_id",state.user.id).eq("latin",latin);
    state.userWords=state.userWords.filter(w=>norm(w.latin)!==norm(latin));
    state.records.delete(norm(latin));
    syncStatus("☁️ 已删除并同步", "ok");renderLibrary();renderHome();
  }catch(err){syncStatus(`❌ 删除失败：${err.message||err}`,"error");}
}
function csvEscape(v){return `"${String(v??"").replaceAll('"','""')}"`;}
function exportMyWords(){
  const cols=["latin","syll","pos","meaning","ex_la","ex_zh","kind","genitive","declension","gender","feminine","neuter","conjugation","infinitive","present","irregular"];
  const lines=[cols.join(",")];
  for(const w of state.userWords){const m=w.morph||{};lines.push(cols.map(c=>csvEscape(c==="kind"?m.kind:c==="genitive"?m.genitive:c==="declension"?m.declension:c==="gender"?m.gender:c==="feminine"?m.feminine:c==="neuter"?m.neuter:c==="conjugation"?m.conjugation:c==="infinitive"?m.infinitive:c==="present"?m.present:c==="irregular"?m.irregular:w[c])).join(","));}
  const blob=new Blob(["\uFEFF"+lines.join("\n")],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="我的拉丁词库.csv";a.click();URL.revokeObjectURL(url);
}
function parseCsv(text){
  const rows=[];let row=[],cell="",quote=false;
  for(let i=0;i<text.length;i++){const ch=text[i],next=text[i+1];if(ch==='"'){if(quote&&next==='"'){cell+='"';i++;}else quote=!quote;}else if(ch===','&&!quote){row.push(cell);cell="";}else if((ch==='\n'||ch==='\r')&&!quote){if(ch==='\r'&&next==='\n')i++;row.push(cell);if(row.some(x=>x.trim()!==""))rows.push(row);row=[];cell="";}else cell+=ch;}
  row.push(cell);if(row.some(x=>x.trim()!==""))rows.push(row);return rows;
}
async function importWordsFile(file){
  const text=await file.text(), rows=parseCsv(text);if(rows.length<2){syncStatus("❌ CSV 没有可导入的数据","error");return;}
  const headers=rows[0].map(x=>x.trim().toLowerCase());
  const get=(r,k)=>r[headers.indexOf(k)]?.trim()||"";
  const payloads=[];
  for(const r of rows.slice(1)){
    const latin=get(r,"latin"),meaning=get(r,"meaning");if(!latin||!meaning)continue;
    let morph=null;const kind=get(r,"kind");
    if(kind==="noun")morph={kind,genitive:get(r,"genitive"),declension:Number(get(r,"declension")||0),gender:get(r,"gender")};
    else if(kind==="adjective")morph={kind,feminine:get(r,"feminine"),neuter:get(r,"neuter")};
    else if(kind==="verb")morph={kind,conjugation:get(r,"conjugation"),infinitive:get(r,"infinitive"),present:get(r,"present"),irregular:get(r,"irregular")};
    payloads.push({user_id:state.user.id,latin,syll:get(r,"syll")||null,pos:get(r,"pos")||null,meaning,ex_la:get(r,"ex_la")||null,ex_zh:get(r,"ex_zh")||null,morph});
  }
  if(!payloads.length){syncStatus("❌ 没有找到有效单词。CSV 至少需要 latin 和 meaning。","error");return;}
  const {data,error}=await sb.from("user_words").upsert(payloads,{onConflict:"user_id,latin"}).select();
  if(error){syncStatus(`❌ 批量导入失败：${error.message}`,"error");return;}
  const by=new Map(state.userWords.map(w=>[norm(w.latin),w]));for(const w of data||[])by.set(norm(w.latin),{...w,morph:w.morph||null});state.userWords=[...by.values()];
  syncStatus(`☁️ 已导入 ${data?.length||0} 个自定义单词`,"ok");renderLibrary();renderHome();
}
function renderLibrary(){
  const q=norm($("searchBox")?.value||"");
  const rows=allWords().filter(w=>{
    const mine=isCoreWord(w) ? false : !!getUserWord(w.latin);
    const matchFilter=libraryFilter==="all"||(libraryFilter==="mine"&&mine)||(libraryFilter==="core"&&!mine);
    return matchFilter&&(!q||norm(w.latin).includes(q)||norm(w.meaning).includes(q));
  });
  $("libraryList").innerHTML=rows.map(w=>{
    const r=rec(w), mine=!!getUserWord(w.latin), status=r.status==="mastered"?"已掌握":r.status==="learning"?"学习中":"新词";
    return `<div class="lib-row"><div class="lib-main"><div class="lib-latin">${escapeHtml(w.latin)} ${mine?'<span class="mine-tag">我的词</span>':''}</div><div class="lib-meaning">${escapeHtml(w.meaning||"—")}</div></div><span class="pill ${r.status}">${status}</span>${mine?`<div class="lib-actions"><button class="ghost" data-edit-word="${escapeHtml(w.latin)}">编辑</button><button class="ghost" data-delete-word="${escapeHtml(w.latin)}">删除</button></div>`:""}</div>`;
  }).join("")||`<div class="auth-panel"><p>没有找到单词。</p></div>`;
}
function renderWrong(){
  const rows=allWords().filter(w=>(rec(w).quiz_wrong||0)>0 || (rec(w).wrong_cells||[]).length);
  $("wrongList").innerHTML=rows.length?rows.map(w=>`<div class="lib-row"><div class="lib-main"><div class="lib-latin">${escapeHtml(w.latin)}</div><div class="lib-meaning">答错 ${rec(w).quiz_wrong||0} 次 · 词形错 ${rec(w).wrong_cells?.length||0} 格</div></div><button class="ghost" onclick='window.studyOne(${JSON.stringify(w.latin)})'>复习</button></div>`).join(""):"<div class='auth-panel'><p>目前没有错题。</p></div>";
}
window.syncNow=()=>loadData();
window.studyOne=latin=>{const w=allWords().find(x=>norm(x.latin)===norm(latin));if(w){state.queue=[w];state.index=0;state.current=w;state.phase="reveal";showView("study")}};

$("searchBox")?.addEventListener("input",renderLibrary);
$("addWordBtn")?.addEventListener("click",()=>openWordForm());
$("cancelWordBtn")?.addEventListener("click",closeWordForm);
$("saveWordBtn")?.addEventListener("click",saveUserWord);
$("morphKind")?.addEventListener("change",()=>renderMorphFields());
$("importWordsBtn")?.addEventListener("click",()=>$("importWordsFile").click());
$("importWordsFile")?.addEventListener("change",e=>{const f=e.target.files?.[0];if(f)importWordsFile(f);e.target.value=""});
$("exportWordsBtn")?.addEventListener("click",exportMyWords);
document.addEventListener("click",e=>{
  const edit=e.target.closest("[data-edit-word]");if(edit){const w=getUserWord(edit.dataset.editWord);if(w)openWordForm(w);return;}
  const del=e.target.closest("[data-delete-word]");if(del){deleteUserWord(del.dataset.deleteWord);return;}
  const filter=e.target.closest("[data-libfilter]");if(filter){libraryFilter=filter.dataset.libfilter;document.querySelectorAll("[data-libfilter]").forEach(x=>x.classList.toggle("active",x===filter));renderLibrary();}
});

$("signInBtn").onclick=async()=>{
  if(!sb)return;
  const {error}=await sb.auth.signInWithPassword({email:$("email").value,password:$("password").value});
  $("authMsg").textContent=error?.message||"登录成功"; if(!error)await loadData();
};
$("signUpBtn").onclick=async()=>{
  if(!sb)return;
  const {error}=await sb.auth.signUp({email:$("email").value,password:$("password").value});
  $("authMsg").textContent=error?.message||"注册成功，请检查邮箱后登录。";
};

if(!sb){
  $("setupPanel").classList.remove("hidden");
  $("authPanel").classList.add("hidden");
  $("homePanel").classList.add("hidden");
  $("bottomNav").classList.add("hidden");
}else{
  sb.auth.onAuthStateChange((_e,session)=>{if(session)loadData()});
  loadData();
}
