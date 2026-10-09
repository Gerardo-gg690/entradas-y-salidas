// Modo local por defecto. Sincronización de prototipo con servidor HTTPS opcional.
window.TimeCoreSync=(()=>{
 const cfgKey='timecore_sync_cfg',pendingKey='timecore_sync_pending';let cfg={},getState=()=>({}),onStatus=()=>{},busy=false;
 const config=()=>{try{return JSON.parse(localStorage.getItem(cfgKey)||'{}')}catch{return {}}};
 const pending=()=>{try{return JSON.parse(localStorage.getItem(pendingKey)||'[]')}catch{return []}};
 const setPending=v=>localStorage.setItem(pendingKey,JSON.stringify(v));
 const status=t=>onStatus(t);
 const queueSnapshot=state=>{if(!cfg.url)return;const q=pending();q.push({id:crypto.randomUUID(),created:new Date().toISOString(),state:JSON.parse(JSON.stringify(state))});setPending(q);status('Cambios pendientes de sincronizar: '+q.length);if(navigator.onLine)sync()};
 async function sync(){if(busy||!cfg.url)return;busy=true;try{
   const q=pending();const res=await fetch(cfg.url.replace(/\/$/,'')+'/api/sync',{method:'POST',headers:{'Content-Type':'application/json','X-TimeCore-Key':cfg.key},body:JSON.stringify({changes:q})});if(!res.ok)throw Error('HTTP '+res.status);
   const data=await res.json();if(!data.state)throw Error('Respuesta inválida');
   setPending([]);window.dispatchEvent(new CustomEvent('timecore-remote',{detail:data.state}));status('Sincronizado · '+new Date().toLocaleTimeString('es-SV'));
 }catch(e){status('Sin conexión al servidor · '+pending().length+' cambios pendientes');}finally{busy=false}}
 function init(args){getState=args.getState;onStatus=args.onStatus;cfg=config();const u=document.querySelector('#syncUrl'),k=document.querySelector('#syncKey');if(u)u.value=cfg.url||'';if(k)k.value=cfg.key||'';
 document.querySelector('#saveSync')?.addEventListener('click',()=>{const url=u.value.trim().replace(/\/$/,'');if(url&&!/^https:\/\//i.test(url)&&!/^http:\/\/localhost(:\d+)?$/i.test(url)){alert('Usa una dirección HTTPS');return}cfg={url,key:k.value.trim()};localStorage.setItem(cfgKey,JSON.stringify(cfg));status(cfg.url?'Conexión configurada':'Modo local');if(cfg.url)sync()});
 document.querySelector('#disconnectSync')?.addEventListener('click',()=>{cfg={};localStorage.removeItem(cfgKey);status('Modo local · datos en este dispositivo')});
 document.querySelector('#syncNow')?.addEventListener('click',()=>sync());window.addEventListener('online',sync);if(cfg.url){status('Conexión configurada');sync();setInterval(()=>{if(document.visibilityState==='visible')sync()},20000)}else status('Modo local · datos en este dispositivo');}
 return {init,queueSnapshot,sync};
})();
