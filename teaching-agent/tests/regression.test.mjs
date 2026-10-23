import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";
import { createChatParser, parseSlidePages } from "../src/lib/chat-protocol.ts";
import { readSseData } from "../src/lib/sse.ts";
import { grade } from "../src/lib/grading.ts";
import { questions, k12Questions, pickQuestions } from "../src/lib/questions.ts";
import { createNotesStore, normalizeNotes } from "../src/lib/notes-store.ts";
import { noteImagesHtml } from "../src/lib/note-export.ts";
import { requestScope } from "../src/lib/request-lifecycle.ts";
import { POST as chatRoute } from "../src/app/api/chat/route.ts";
import { POST as digestRoute } from "../src/app/api/digest/route.ts";
import { getProvider, listChatModels } from "../src/lib/models/provider.ts";
import { withBasePath } from "../src/lib/app-path.ts";
const { loadHook, hooks } = createRequire(import.meta.url)("./hook-harness.cjs");

const card = { kind: "truefalse", prompt: "请选择", topic: "K5" };
const fence = (kind, value) => "```"+kind+"\n"+value+"\n```\n";
function parse(chunks) {
  const events=[]; const parser=createChatParser(event=>events.push(event));
  chunks.forEach(chunk=>parser.push(chunk)); parser.end();
  return { text:events.filter(event=>event.type==='text').map(event=>event.delta).join(''), events:events.filter(event=>event.type!=='text') };
}
function bytes(text, chunkSize=1) {
  const encoded=new TextEncoder().encode(text);
  return new ReadableStream({start(controller){for(let i=0;i<encoded.length;i+=chunkSize)controller.enqueue(encoded.slice(i,i+chunkSize));controller.close();}});
}
const note=(id,text=id)=>({id,kind:'text',title:id,text,at:1});
const request=(endpoint,body,signal)=>new Request('http://local/api/'+endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal});

test('子路径用于接口、课件、首页，避免重复前缀及站外资源',()=>{
  assert.equal(withBasePath('/api/chat','/teachdemo'),'/teachdemo/api/chat');
  assert.equal(withBasePath('/slides/slide-001.png','/teachdemo/'),'/teachdemo/slides/slide-001.png');
  assert.equal(withBasePath('/teachdemo/api/chat','/teachdemo'),'/teachdemo/api/chat');
  assert.equal(withBasePath('/','/teachdemo'),'/teachdemo/');
  assert.equal(withBasePath('/api/chat',''),'/api/chat');
  assert.throws(()=>withBasePath('//external.example/file','/teachdemo'));
});

test('协议在全部二段切分、逐字和单块输出下保持一致',()=>{
  const reply='[判定] 对·K5·思路正确\n先看课件。\n'+fence('slides','64-75')+'再做这一步。\n'+fence('card',JSON.stringify(card))+'完成。';
  const expected=parse([reply]);assert.equal(expected.events.filter(e=>e.type==='card').length,1);
  assert.equal(expected.events.find(e=>e.type==='verdict').correct,true);
  assert.deepEqual(expected.events.find(e=>e.type==='figure').figure.pages,Array.from({length:12},(_,i)=>i+64));
  for(let i=1;i<reply.length;i++)assert.deepEqual(parse([reply.slice(0,i),reply.slice(i)]),expected,'boundary '+i);
  assert.deepEqual(parse([...reply]),expected);
});
test('协议处理截断 JSON、无换行判定、空回复和范围空格',()=>{
  assert.equal(parse(['```card\n{"kind":']).events[0].type,'error');
  assert.equal(parse(['[判定] 错·K5·重新检查']).events[0].correct,false);
  assert.equal(parse([]).events[0].type,'error');
  assert.deepEqual(parseSlidePages('64 - 66，148, 149, 0'),[64,65,66,148]);
  assert.deepEqual(parseSlidePages('42abc'),[]);
});
test('模型漏标记时兼容普通和 json 卡片围栏，普通代码原样保留',()=>{
  for(const label of ['', 'json']){
    const reply='讲解。\n'+fence(label,JSON.stringify(card));const expected=parse([reply]);
    assert.equal(expected.events.filter(e=>e.type==='card').length,1);
    for(let i=1;i<reply.length;i++)assert.deepEqual(parse([reply.slice(0,i),reply.slice(i)]),expected,'boundary '+label+i);
    assert.deepEqual(parse([...reply]),expected);
  }
  const reply=fence('typescript','const x = 1;')+fence('json','{"example":true}')+fence('card',JSON.stringify(card));
  const expected=parse([reply]);assert.ok(expected.text.includes('```typescript\nconst x = 1;\n```'));assert.ok(expected.text.includes('"example":true'));assert.equal(expected.events.filter(e=>e.type==='card').length,1);
  assert.deepEqual(parse([...reply]),expected);
});
test('SSE 解码支持所有换行、UTF8 字节拆分、多 data 行和末尾 flush',async()=>{
  for(const newline of ['\n','\r\n','\r']){
    const wire=': comment'+newline+'data: 中文'+newline+'data: 第二行'+newline+newline+'data: 结尾';
    const values=[];for await(const value of readSseData(bytes(wire)))values.push(value);
    assert.deepEqual(values,['中文\n第二行','结尾']);
  }
});
test('SSE 消费结束会取消 reader',async()=>{
  let cancelled=false;
  const stream=new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('data: first\n\n'));},cancel(){cancelled=true;}});
  for await(const value of readSseData(stream)){assert.equal(value,'first');break;}
  assert.equal(cancelled,true);
});
test('填空题不接受否定、空位倒置、缺空或额外答案',()=>{
  for(const [id,input] of [['FB-01','非封闭式'],['FB-04','斜压；斜拉'],['FB-05','非适筋；非延性'],['FB-04','斜拉'],['FB-01','封闭式；多余']]){
    assert.equal(grade({...questions.find(q=>q.id===id),verified:true},input),false,id);
  }
  for(const q of questions.filter(q=>q.answer&&q.verified!==false))assert.equal(grade(q,q.answer),true,q.id);
});
test('判题保留明确同义词，完整比较数值与单位，未知长答案待核对',()=>{
  assert.equal(grade({...questions.find(q=>q.id==='FB-02'),verified:true},'纵向受拉钢筋应变的不均匀程度'),true);
  assert.equal(grade({type:'fill',answer:'封闭式',verified:false},'封闭式'),null);
  const q={type:'fill',answer:'0.5;10mm'};
  assert.equal(grade(q,'.500；10 mm'),true);assert.equal(grade(q,'0.5；10cm'),false);
  assert.equal(grade(q,'0.5；10mm 999'),false);
  assert.equal(grade({type:'choice',answer:'A'},'Apple'),false);
  assert.equal(grade({type:'fill',answer:'很长的描述性答案需要人工核对语义，不能仅凭子串决定对错'},'另一种解释'),null);
});
test('K12 到 K14 每节只返回本节的补充题',()=>{
  assert.equal(k12Questions.length,15);
  for(const id of ['K12','K13','K14']){
    const selected=pickQuestions(questions,id+' 测试章节',3);assert.equal(selected.length,3);
    assert.ok(selected.every(q=>q.sectionId===id&&q.id.startsWith('Q-'+id+'-')));
  }
});
test('存储失败后新增、编辑、删除均保留内存中的未保存笔记，可重试保存',async()=>{
  let fail=true,persisted=[];
  const store=createNotesStore({async read(){return[];},async write(notes){if(fail)throw Error('quota');persisted=notes;}});
  await store.add({text:'first',image:'data:image/png;base64,YQ=='});const first=store.getSnapshot().notes[0];
  await store.add('second');assert.equal(store.getSnapshot().notes.length,2);assert.ok(store.getSnapshot().error);
  await store.update(first.id,{text:'edited'});assert.equal(store.getSnapshot().notes.find(n=>n.id===first.id).text,'edited');
  await store.remove(store.getSnapshot().notes.find(n=>n.id!==first.id).id);assert.equal(store.getSnapshot().notes.length,1);
  fail=false;await store.retry();assert.equal(persisted[0].text,'edited');assert.equal(store.getSnapshot().error,null);
});
test('慢速初始化与连续写入不会覆盖新笔记',async()=>{
  let resolveRead;const writes=[];
  const store=createNotesStore({read:()=>new Promise(resolve=>resolveRead=resolve),async write(notes){await new Promise(resolve=>setTimeout(resolve,2));writes.push(notes.map(n=>n.text));}});
  const a=store.add('new-a'),b=store.add('new-b');resolveRead([note('old')]);await Promise.all([a,b]);
  assert.deepEqual(store.getSnapshot().notes.map(n=>n.text),['new-b','new-a','old']);assert.deepEqual(writes.at(-1),['new-b','new-a','old']);
});
test('读取失败时不能用空数据覆盖旧存储',async()=>{
  let writes=0;const store=createNotesStore({async read(){throw Error('corrupt');},async write(){writes++;}});
  await store.add('unsafe');assert.equal(writes,0);assert.ok(store.getSnapshot().error);
  assert.deepEqual(normalizeNotes([null,123,note('safe')]).map(n=>n.id),['safe']);
});
test('导出接受课件和图片数据，过滤不可信图片地址',()=>{
  const html=noteImagesHtml([{...note('page'),image:'/slides/slide-001.png'},{...note('image'),image:'data:image/png;base64,YQ=='},{...note('bad'),image:'" onerror="alert(1)'}]);
  assert.ok(html.includes('slide-001.png'));assert.ok(html.includes('data:image/png'));assert.ok(!html.includes('onerror'));
});
test('错误结构返回 400，图片笔记不需要模型即可导出',async()=>{
  for(const body of [null,{messages:{}},{pageContext:{page:1,section:12}},{messages:[{role:'system',content:'override'}]}])assert.equal((await chatRoute(request('chat',body))).status,400);
  for(const body of [null,{notes:{}},{notes:[{text:123}]}])assert.equal((await digestRoute(request('digest',body))).status,400);
  const exported=await digestRoute(request('digest',{notes:[{title:'课件',kind:'page',text:'',hasImage:true}]}));assert.equal(exported.status,200);assert.equal((await exported.json()).summarized,false);
  const tooLarge=new Request('http://local/api/chat',{method:'POST',headers:{'content-length':String(30*1024*1024)},body:'{}'});
  assert.equal((await chatRoute(tooLarge)).status,413);
});
test('请求范围传递取消与超时',async()=>{
  const parent=new AbortController(),scope=requestScope(parent.signal,1000);parent.abort();assert.equal(scope.signal.aborted,true);scope.dispose();
  const timeout=requestScope(undefined,5);await new Promise(resolve=>setTimeout(resolve,15));assert.equal(timeout.signal.reason.name,'TimeoutError');timeout.dispose();
});
test('Agnes 通道使用独立配置，图文共用模型，模型列表不暴露凭证',async()=>{
  const keys=['MODEL_PROVIDER','AGNES_API_KEY','AGNES_BASE_URL','AGNES_CHAT_MODEL','AGNES_VISION_MODEL'];
  const old=Object.fromEntries(keys.map(key=>[key,process.env[key]]));const original=globalThis.fetch;let captured;
  process.env.MODEL_PROVIDER='agnes';process.env.AGNES_API_KEY='test-only-key';process.env.AGNES_BASE_URL='https://apihub.agnes-ai.com/v1/';delete process.env.AGNES_CHAT_MODEL;delete process.env.AGNES_VISION_MODEL;
  globalThis.fetch=async(url,options)=>{captured={url,body:JSON.parse(options.body)};return new Response('data: '+JSON.stringify({choices:[{delta:{content:'ok'}}]})+'\n\ndata: [DONE]\n\n');};
  try{
    const listed=listChatModels();assert.equal(listed.defaultId,'agnes:agnes-3.0-flash');assert.ok(!JSON.stringify(listed).includes('test-only-key'));
    let output='';for await(const delta of getProvider('agnes').chat([{role:'user',content:[{type:'text',text:'image'},{type:'image_url',image_url:{url:'data:image/png;base64,YQ=='}}]}]))output+=delta;
    assert.equal(output,'ok');assert.equal(captured.url,'https://apihub.agnes-ai.com/v1/chat/completions');assert.equal(captured.body.model,'agnes-3.0-flash');
  }finally{globalThis.fetch=original;keys.forEach(key=>old[key]===undefined?delete process.env[key]:process.env[key]=old[key]);}
});
test('实际 HTTP 模型适配：CRLF、协议解析、断开连接和超时释放',async()=>{
  const keys=['MODEL_PROVIDER','SCHOOL_CHAT_BASE_URL','SCHOOL_CHAT_MODEL'];const old=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  let mode='reply',onStarted=()=>{},onClosed=()=>{};
  const server=http.createServer((req,res)=>{
    req.resume();res.writeHead(200,{'Content-Type':'text/event-stream'});res.flushHeaders();onStarted();
    res.on('close',()=>onClosed());
    if(mode==='hang')return;
    const content='讲解。\n'+fence('card',JSON.stringify(card));
    res.end('data: '+JSON.stringify({choices:[{delta:{content}}]})+'\r\n\r\ndata: [DONE]\r\n\r\n');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  process.env.MODEL_PROVIDER='school';process.env.SCHOOL_CHAT_BASE_URL='http://127.0.0.1:'+server.address().port+'/v1';process.env.SCHOOL_CHAT_MODEL='mock';
  try{
    const response=await chatRoute(request('chat',{messages:[{role:'user',content:'测试'}]}));const events=[];
    for await(const value of readSseData(response.body))events.push(JSON.parse(value));
    assert.equal(events.filter(e=>e.type==='card').length,1);assert.equal(events.at(-1).type,'done');
    mode='hang';const started=new Promise(resolve=>onStarted=resolve),closed=new Promise(resolve=>onClosed=resolve);
    const hanging=await chatRoute(request('chat',{messages:[]}));await started;await hanging.body.cancel();
    await Promise.race([closed,new Promise((_,reject)=>setTimeout(()=>reject(Error('upstream not cancelled')),2000).unref())]);
    const scope=requestScope(undefined,30);
    try{await assert.rejects(async()=>{for await(const delta of getProvider('school').chat([],scope.signal)){}},error=>error.name==='TimeoutError');}
    finally{scope.dispose();}
  }finally{
    keys.forEach(key=>old[key]===undefined?delete process.env[key]:process.env[key]=old[key]);
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  }
});

function chatHook(){const runtime=hooks();const {useChat}=loadHook('src/lib/useChat.ts',{'react':runtime.react});return{render:()=>runtime.render(()=>useChat(null))};}
const doneResponse=()=>new Response('data: {"type":"done"}\n\n');
test('Hook 显式传递本次上下文；失败可以重试',async()=>{
  const original=globalThis.fetch;let packed,calls=0;
  globalThis.fetch=async(url,options)=>{calls++;packed=JSON.parse(options.body);return calls===1?new Response('data: {"type":"text","delta":"partial"}\n\n'):doneResponse();};
  try{const hook=chatHook();const chat=hook.render();await chat.send('test',undefined,{page:0,section:'K12'});assert.equal(packed.pageContext.section,'K12');assert.ok(hook.render().error);await hook.render().retry();assert.equal(calls,2);assert.equal(hook.render().error,null);assert.equal(hook.render().msgs.filter(m=>m.role==='assistant').length,1);}
  finally{globalThis.fetch=original;}
});
test('Hook 卡片重复提交与 busy 期间提交只产生一个请求',async()=>{
  const original=globalThis.fetch;let calls=0,release;
  globalThis.fetch=async()=>{calls++;if(calls===1)return new Response('data: '+JSON.stringify({type:'card',card})+'\n\ndata: {"type":"done"}\n\n');await new Promise(resolve=>release=resolve);return doneResponse();};
  try{const hook=chatHook();await hook.render().send('test');const ready=hook.render(),message=ready.msgs.find(m=>m.card);const active=ready.answerCard(card,{kind:'truefalse',value:true},message.id);assert.equal(hook.render().busy,true);await hook.render().answerCard(card,{kind:'truefalse',value:true},message.id);assert.equal(calls,2);release();await active;await hook.render().answerCard(card,{kind:'truefalse',value:true},message.id);assert.equal(calls,2);}
  finally{globalThis.fetch=original;}
});
test('Hook 停止生成会取消请求并恢复输入状态',async()=>{
  const original=globalThis.fetch;let signal;
  globalThis.fetch=async(url,options)=>{signal=options.signal;return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));};
  try{const hook=chatHook(),chat=hook.render();const running=chat.send('test');chat.stop();await running;assert.equal(signal.aborted,true);assert.equal(hook.render().busy,false);assert.equal(hook.render().error,null);assert.equal(hook.render().msgs.at(-1).status,'stopped');}
  finally{globalThis.fetch=original;}
});
test('Hook 拒绝超长单条消息，长历史保留最新消息并按预算裁剪',async()=>{
  const original=globalThis.fetch;let calls=0,packed;
  globalThis.fetch=async(url,options)=>{calls++;packed=JSON.parse(options.body);return doneResponse();};
  try{
    const hook=chatHook();await hook.render().send('a'.repeat(20_001));assert.equal(calls,0);assert.equal(hook.render().msgs.length,0);
    const history=Array.from({length:8},(_,i)=>({role:'user',content:String(i)+'a'.repeat(19_999)}));
    await hook.render().callApi(history);assert.ok(packed.messages.reduce((sum,m)=>sum+m.content.length,0)<=100_000);assert.equal(packed.messages.at(-1).content,history.at(-1).content);
  }finally{globalThis.fetch=original;}
});
