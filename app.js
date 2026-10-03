const sb = (window.APP_CONFIG?.SUPABASE_URL || "").includes("YOUR-PROJECT")
  ? null
  : supabase.createClient(window.APP_CONFIG.SUPABASE_URL, window.APP_CONFIG.SUPABASE_ANON_KEY);

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
  if(!sb) return;
  const {data:{user}}=await sb.auth.getUser();
  state.user=user;
  if(!user){ showAuth(false); return; }
  showAuth(true);
  const [{data:records},{data:words}] = await Promise.all([
    sb.from("learning_records").select("*").eq("user_id",user.id),
    sb.from("user_words").select("*").eq("user_id",user.id).order("created_at",{ascending:true})
  ]);
  state.records.clear();
  for(const r of records||[]) state.records.set(norm(r.latin),r);
  state.userWords=(words||[]).map(x=>({...x, morph:x.morph||null}));
  renderHome();
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
  if(error){console.error(error);return old}
  state.records.set(norm(word.latin),data); return data;
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
function renderHome(){
  $("homePanel").classList.remove("hidden");
  const words=allWords(), rs=words.map(rec);
  const due=dueWords().length, mastered=rs.filter(r=>r.status==="mastered").length;
  const learning=rs.filter(r=>r.seen>0&&r.status!=="mastered").length;
  const right=rs.reduce((n,r)=>n+Number(r.quiz_right||0),0), wrong=rs.reduce((n,r)=>n+Number(r.quiz_wrong||0),0);
  $("dueCount").textContent=due;$("masteredCount").textContent=mastered;$("learningCount").textContent=learning;
  $("accuracy").textContent=(right+wrong)?Math.round(right/(right+wrong)*100)+"%":"—";
  $("welcome").textContent=state.user?.email || "";
  const days=new Set(rs.filter(r=>r.last_studied).map(r=>localDay(new Date(r.last_studied))));
  $("streakBox").innerHTML=`${days.size}<br><span>学习天数</span>`;
}
function showView(view){
  state.view=view;
  ["home","study","inflection","library","wrong"].forEach(v=>{
    const el=$(v+"Panel"); if(el) el.classList.toggle("hidden",v!==view);
  });
  if(view==="home") renderHome();
  if(view==="study") startStudy();
  if(view==="inflection") startInflection();
  if(view==="library") renderLibrary();
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
function renderLibrary(){
  const q=norm($("searchBox")?.value||"");
  const rows=allWords().filter(w=>!q||norm(w.latin).includes(q)||norm(w.meaning).includes(q));
  $("libraryList").innerHTML=rows.map(w=>{const r=rec(w);return `<div class="lib-row"><div class="lib-main"><div class="lib-latin">${w.latin}</div><div class="lib-meaning">${w.meaning||"—"}</div></div><span class="pill ${r.status}">${r.status==="mastered"?"已掌握":r.status==="learning"?"学习中":"新词"}</span></div>`}).join("");
}
function renderWrong(){
  const rows=allWords().filter(w=>(rec(w).quiz_wrong||0)>0 || (rec(w).wrong_cells||[]).length);
  $("wrongList").innerHTML=rows.length?rows.map(w=>`<div class="lib-row"><div class="lib-main"><div class="lib-latin">${w.latin}</div><div class="lib-meaning">答错 ${rec(w).quiz_wrong||0} 次 · 词形错 ${rec(w).wrong_cells?.length||0} 格</div></div><button class="ghost" onclick='window.studyOne(${JSON.stringify(w.latin)})'>复习</button></div>`).join(""):"<div class='auth-panel'><p>目前没有错题。</p></div>";
}
window.studyOne=latin=>{const w=allWords().find(x=>norm(x.latin)===norm(latin));if(w){state.queue=[w];state.index=0;state.current=w;state.phase="reveal";showView("study")}};

$("searchBox")?.addEventListener("input",renderLibrary);
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
