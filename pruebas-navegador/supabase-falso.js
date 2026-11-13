/* Supabase falso para probar la app de caja en el navegador sin tocar la base real.
   Imita las funciones (RPC) con datos en memoria; window.__S guarda el estado. */
(function(){
  var menu=window.__MENU, id=100, tables=[];
  [['Feria',20],['Tokio',8],['Edo',5]].forEach(function(a){ for(var n=1;n<=a[1];n++) tables.push({id:++id,area:a[0],number:n}); });
  var S={rate:52.5, session:null, orders:[], items:[], payments:[], jobs:[], staff:[{id:1,name:'Mesera',pin:'1111',cc:false},{id:2,name:'Cajera',pin:'2222',cc:true}], alerts:[]};
  window.__S=S;
  function lbl(o){ if(o.kind==='delivery') return 'Delivery: '+o.label; if(o.kind==='mesa'){ var t=tables.find(function(x){return x.id===o.table_id}); return t.area+' '+t.number;} return 'Para llevar'+(o.label?': '+o.label:''); }
  function tot(o){ var sub=S.items.filter(function(i){return i.order_id===o.id&&i.status!=='anulado'}).reduce(function(s,i){return s+i.qty*i.unit_price},0), d=Math.min(o.discount||0,sub), svc=Math.round((sub-d)*o.service_pct)/100, dl=o.delivery_fee||0; return {subtotal:sub,discount:d,service:svc,delivery:dl,total:sub-d+svc+dl,paid:o.paid||0}; }
  function auth(a){ var e=S.staff.find(function(x){return x.id===a.p_emp}); if(!e||e.pin!==a.p_pin) throw {message:'PIN incorrecto. Vuelve a entrar.'}; return e; }
  function splitTot(o){ if(!o.split||o.split.n<2) return []; var t=tot(o), units=[]; S.items.filter(function(i){return i.order_id===o.id&&i.status!=='anulado'}).forEach(function(i){ var u=o.split.units[i.id]||[]; for(var k=0;k<Math.ceil(i.qty);k++) units.push({p:u[k]||0,price:i.unit_price*Math.min(1,i.qty-k)}); });
    var free=units.some(function(u){return !u.p}), last=0; units.forEach(function(u){ if(u.p>last) last=u.p; }); var list=[]; for(var p=1;p<=o.split.n;p++) list.push(p); if(free) list.push(0); var acc=0;
    return list.map(function(p){ var s=units.filter(function(u){return u.p===p}).reduce(function(a,u){return a+u.price},0), d=t.subtotal?Math.round(t.discount*s/t.subtotal*100)/100:0, sv=Math.round((s-d)*o.service_pct)/100, tt=Math.round((s-d+sv)*100)/100; if(p===last&&p>0&&!free) tt=Math.round((t.total-acc)*100)/100; acc+=tt;
      var pd=S.payments.filter(function(x){return x.order_id===o.id&&x.person===p}).reduce(function(a,x){return a+x.amount_ref},0); return {person:p,subtotal:s,discount:d,service:sv,delivery:0,total:tt,paid:pd}; }); }
  var R={
    pos_mark_status:function(a){ auth(a); var ev=(S.marks||[]).filter(function(m){return m.emp===a.p_emp;}); var last=ev.length?ev[ev.length-1].kind:null; return {name:'X',events:ev.map(function(m){return {kind:m.kind,at:m.at};}),next:!last||last==='out'?['in']:last==='break_start'?['break_end']:['break_start','out']}; },
    pos_mark:function(a){ auth(a); (S.marks=S.marks||[]).push({emp:a.p_emp,kind:a.p_kind,at:new Date().toISOString()}); return R.pos_mark_status(a); },
    pos_uniform_list:function(a){ auth(a); return S.staff.filter(function(e){ return (S.marks||[]).some(function(m){return m.emp===e.id;}); }).map(function(e){ return {id:e.id,name:e.name,ok:(S.uni||{})[e.id]}; }); },
    pos_uniform_set:function(a){ auth(a); (S.uni=S.uni||{})[a.p_target]=a.p_ok; },
    pos_announcements:function(a){ auth(a); return (S.anns||[]).filter(function(x){ return !(x.read||[]).some(function(r){return r===a.p_emp;}); }); },
    pos_announcement_read:function(a){ auth(a); var x=(S.anns||[]).find(function(y){return y.id===a.p_id;}); if(x) (x.read=x.read||[]).push(a.p_emp); },
    pos_announcement_create:function(a){ auth(a); (S.anns=S.anns||[]).push({id:++id,title:a.p_title,body:a.p_body,by:'Cajera',at:new Date().toISOString(),read:[]}); return id; },
    pos_kitchen:function(){ var by={}; S.items.filter(function(i){return i.status==='enviado'&&!i.ready_at;}).forEach(function(i){ var o=S.orders.find(function(x){return x.id===i.order_id;}); if(!o||o.status==='anulada') return; (by[o.id]=by[o.id]||{id:o.id,label:lbl(o),kind:o.kind,day_number:7,waiter:'Mesera',first_sent:i.sent_at,items:[]}).items.push({id:i.id,name:i.name,variant:i.variant,option:i.option,notes:i.notes,qty:i.qty,sent_at:i.sent_at}); });
      return {now:new Date().toISOString(),orders:Object.keys(by).map(function(k){return by[k];}),recent:S.items.filter(function(i){return i.ready_at;}).map(function(i){return {id:i.id,name:i.name,qty:i.qty,label:'x',minutes:1};}),today:{count:S.items.filter(function(i){return i.ready_at;}).length,avg:1}}; },
    pos_kitchen_ready:function(a){ var n=0; S.items.forEach(function(i){ if(a.p_items.indexOf(i.id)>=0){ i.ready_at=a.p_ready?new Date().toISOString():null; i.served_at=null; n++; } }); return n; },
    pos_served:function(a){ auth(a); var n=0; S.items.forEach(function(i){ if(i.order_id===a.p_order&&i.ready_at&&!i.served_at){ i.served_at=new Date().toISOString(); n++; } }); return n; },
    pos_cash_out:function(a){ auth(a); window.__out=a; },
    pos_drop_empty:function(a){ auth(a); window.__drop=a.p_order; S.orders=S.orders.filter(function(o){return o.id!==a.p_order}); return true; },
    pos_outside:function(){ return [{id:3,name:'Agua (botella)',unit:'unidad',stock:4,min:6,active:true},{id:7,name:'Bolsa para llevar',unit:'unidad',stock:0,min:20,active:false}]; },
    pos_purchase:function(a){ auth(a); window.__buy=a.p_items; return a.p_items.length; },
    pos_tabs_list:function(){ return [{id:11,name:'Ana',full_name:'Ana Prueba',balance:50,limit:100},{id:1,name:'Mesera',full_name:'Mesera Prueba',balance:100,limit:100}]; },
    pos_tab_pay:function(a){ auth(a); window.__tabPay=a; return {paid:a.p_payments[0].amount, balance:30}; },
    pos_device_hello:function(a){ window.__hello=a; return 'Tablet 3'; },
    pos_incoming_list:function(a){ return a.p_source==='binance'?{rows:[{id:7,tx_id:'M_123456789',amount:44,currency:'USDT',payer:'Cliente Prueba',note:'mesa 3',received_at:new Date(Date.now()-180000).toISOString()},{id:8,tx_id:'M_99',amount:12.5,currency:'USDT',payer:'',note:'',received_at:new Date(Date.now()-3600e3).toISOString()}],checked_at:new Date(Date.now()-40000).toISOString(),error:''}:{rows:[],checked_at:null,error:null}; },
    pos_staff:function(){return S.staff.map(function(e){return {id:e.id,name:e.name}})},
    pos_check_pin:function(a){ var e=S.staff.find(function(x){return x.id===a.p_emp}); return e&&e.pin===a.p_pin?{ok:true,name:e.name,can_charge:e.cc}:{ok:false,error:'PIN incorrecto'}; },
    pos_state:function(){ return {rate:S.rate, rate_date:new Date(Date.now()-4*3600e3).toISOString().slice(0,10), service_pct:10, session:S.session, tables:tables,
      orders:S.orders.filter(function(o){return o.status==='abierta'}).map(function(o){return {id:o.id,kind:o.kind,table_id:o.table_id,label:lbl(o),opened_at:o.opened_at,opened_by:'Mesera',total:tot(o).total,paid:o.paid||0,precuenta_at:o.precuenta_at||null,pending:0,items:1,ready:S.items.filter(function(i){return i.order_id===o.id&&i.ready_at&&!i.served_at;}).length}}), printer_backlog:0, printer_oldest:null, alerts:S.alerts, low_stock:[{name:'Agua (botella)',stock:4,min:6,unit:'unidad'}]}; },
    pos_alerts_seen:function(a){ auth(a); S.alerts=[]; },
    pos_cash_preview:function(a){ auth(a); return {preview:true,recipients:'cierre@ejemplo.test',session:{opened_at:new Date().toISOString(),closed_at:new Date().toISOString(),opened_by:'Cajera',closed_by:'Cajera',opening_usd:20,opening_bs:0,expected:{efectivo_usd:36.5,zelle:0},counted:a.p_counted,notes:a.p_notes},rate:52.5,totals:{orders:1,cancelled:0,sales:15,discounts:0,service:1.5,delivery:0,total:16.5},methods:[{method:'efectivo_usd',currency:'REF',amount:16.5,amount_ref:16.5,count:1}],cashiers:[{name:'Cajera',method:'efectivo_usd',count:1,amount:16.5,amount_ref:16.5}],off_caja:S.payments.filter(function(p){return p.device!=='Caja'}).map(function(p){return {order:'Feria 3',by:'Cajera',device:p.device,method:p.method,amount:p.amount,at:new Date().toISOString()}}),by_kind:[],tops:{day:[],week:[],month:[]},staff:[],hours:[],dishes:[],voids:[],discounts:[],cancelled:[],orders:[]}; },
    pos_order:function(a){ var o=S.orders.find(function(x){return x.id===a.p_order}); return {id:o.id,kind:o.kind,table_id:o.table_id,label:lbl(o),status:o.status,service_pct:o.service_pct,discount_reason:o.discount_reason||'',opened_at:o.opened_at,customer:o.label,phone:o.phone||'',address:o.address||'',delivery_fee:o.delivery_fee||0,precuenta_at:o.precuenta_at||null,opened_by:'Mesera',totals:tot(o),
      items:S.items.filter(function(i){return i.order_id===o.id}), split:o.split||null, channel:o.channel||'propio', split_totals:splitTot(o), payments:S.payments.filter(function(p){return p.order_id===o.id})}; },
    pos_set_split:function(a){ auth(a); var o=S.orders.find(function(x){return x.id===a.p_order}); o.split=a.p_split&&a.p_split.n>=2?a.p_split:null; window.__split=o.split; },
    pos_open:function(a){ auth(a); if(a.p_table){ var ex=S.orders.find(function(o){return o.table_id===a.p_table&&o.status==='abierta'}); if(ex) return ex.id; }
      var o={id:++id,kind:a.p_table?'mesa':'llevar',table_id:a.p_table||null,label:a.p_label||'',status:'abierta',service_pct:a.p_table?10:0,opened_at:new Date().toISOString()}; S.orders.push(o); return o.id; },
    pos_add:function(a){ auth(a); a.p_items.forEach(function(it){ var d=menu.dishes.find(function(x){return x.id===it.dish_id}); var p=d.price; if(d.variants&&d.variants.length){ var v=d.variants.find(function(x){return x.label===it.variant}); if(!v) throw {message:'Elige el tamaño de '+d.name}; p=v.price; }
      S.items.push({id:++id,order_id:a.p_order,dish_id:d.id,name:d.name,variant:it.variant||'',option:it.option||'',notes:it.notes||'',qty:it.qty,unit_price:p,status:'pendiente'}); }); return a.p_items.length; },
    pos_send:function(a){ auth(a); var n=0; S.items.forEach(function(i){ if(i.order_id===a.p_order&&i.status==='pendiente'){i.status='enviado';i.sent_at=new Date(Date.now()-60000).toISOString();n++;} }); S.jobs.push('cocina'); return n; },
    pos_void:function(a){ auth(a); var i=S.items.find(function(x){return x.id===a.p_item}); if(i.status==='pendiente'){S.items.splice(S.items.indexOf(i),1);return 'quitado';} if((a.p_reason||'').length<3) throw {message:'Escribe el motivo'}; i.status='anulado'; i.void_reason=a.p_reason; return 'anulado'; },
    pos_discount:function(a){ auth(a); var o=S.orders.find(function(x){return x.id===a.p_order}); o.discount=a.p_amount; o.discount_reason=a.p_reason; },
    pos_precuenta:function(a){ auth(a); S.orders.find(function(x){return x.id===a.p_order}).precuenta_at=new Date().toISOString(); S.jobs.push('caja'); },
    pos_customer_by_phone:function(a){ auth(a); return String(a.p_phone).replace(/\D/g,'').slice(-10)==='4141234567' ? {id:7,name:'Ana Frecuente',address:'Calle 2, casa azul',notes:'',orders:3,spent:45,last_at:new Date(Date.now()-2*86400000).toISOString(),top:['Gyozas','Ramen']} : null; },
    pos_open_delivery:function(a){ auth(a); var o={id:++id,kind:'delivery',table_id:null,label:a.p_name,phone:a.p_phone,address:a.p_address,delivery_fee:a.p_fee,channel:a.p_channel||'propio',status:'abierta',service_pct:0,opened_at:new Date().toISOString()}; S.orders.push(o); return o.id; },
    pos_set_delivery:function(a){ auth(a); var o=S.orders.find(function(x){return x.id===a.p_order}); o.label=a.p_name; o.phone=a.p_phone; o.address=a.p_address; o.delivery_fee=a.p_fee; if(a.p_channel) o.channel=a.p_channel; },
    pos_set_available:function(a){ auth(a); menu.dishes.find(function(d){return d.id===a.p_dish}).available=a.p_available; },
    pos_inventory:function(){ return [{id:1,name:'Fideos',unit:'kg',stock:10,min:3},{id:2,name:'Cerdo',unit:'kg',stock:1,min:2}]; },
    pos_count:function(a){ auth(a); window.__count=a.p_counts; return a.p_counts.length; },
    pos_move:function(a){ auth(a); var o=S.orders.find(function(x){return x.id===a.p_order}); o.table_id=a.p_table; },
    pos_cancel:function(a){ auth(a); var o=S.orders.find(function(x){return x.id===a.p_order}); o.status='anulada'; },
    pos_pay:function(a){ auth(a); if(!S.session) throw {message:'La caja está cerrada'}; var o=S.orders.find(function(x){return x.id===a.p_order}); var t=tot(o).total, paid=0;
      a.p_payments.forEach(function(p){ var r=['efectivo_usd','zelle','binance','paypal','cuenta'].indexOf(p.method)>=0?p.amount:p.amount/S.rate; if(!p.tip) paid+=Math.round(r*100)/100; S.payments.push(Object.assign({order_id:o.id,amount_ref:Math.round(r*100)/100},p)); if(p.device!=='Caja') S.alerts.push({order_id:o.id,label:'Feria 3',by:'Cajera',device:p.device,amount_ref:Math.round(r*100)/100,at:new Date().toISOString()}); });
      var due=t-(o.paid||0); if(paid<due-0.02){ if(!a.p_partial) throw {message:'Falta por cobrar'}; o.paid=(o.paid||0)+paid; return {total:t,paid:paid,rest:due-paid,closed:false}; } o.paid=(o.paid||0)+paid; o.status='cobrada'; t=due; var over=Math.round((paid-t)*100)/100; window.__lastPay={total:t,paid:paid,payments:a.p_payments,change:a.p_change_currency};
      return {total:t,paid:paid,closed:true,change:over>0.02?(a.p_change_currency==='MIX'&&Math.floor(over)>=1&&over-Math.floor(over)>0.009?{currency:'MIX',amount:over,usd:Math.floor(over),bs:Math.round((over-Math.floor(over))*S.rate*100)/100}:{currency:a.p_change_currency==='MIX'?'BS':a.p_change_currency,amount:a.p_change_currency!=='REF'?Math.round(over*S.rate*100)/100:over}):null}; },
    pos_cash_summary:function(){ if(!S.session) return null; var m={}; S.payments.forEach(function(p){ m[p.method]=m[p.method]||{amount:0,currency:'x',amount_ref:0}; m[p.method].amount+=p.amount; }); m.pago_movil={amount:253550.56}; m.punto_debito={amount:419655.43};
      return {payments:[{method:'pago_movil',amount:253550.56,ref:'1234',at:new Date().toISOString(),label:'Tokio 3',by:'Ana'},{method:'punto_debito',amount:419655.43,ref:'',at:new Date().toISOString(),label:'Edo 1',by:'Cajera'}],outs:[],id:1,status:'abierta',opened_at:S.session.opened_at,opened_by:'Cajera',opening_usd:20,opening_bs:0,methods:m,orders:S.orders.filter(function(o){return o.status==='cobrada'}).length,sales:10,service:1,discounts:[],voids:S.items.filter(function(i){return i.status==='anulado'}).map(function(i){return {order:'x',item:i.name,qty:i.qty,amount:i.qty*i.unit_price,reason:i.void_reason,by:'Cajera'}}),open_orders:S.orders.filter(function(o){return o.status==='abierta'}).length}; },
    pos_cash_open:function(a){ auth(a); S.session={id:1,opened_at:new Date().toISOString(),opened_by:'Cajera'}; return 1; },
    pos_cash_close:function(a){ auth(a); window.__closeArgs=a; window.__closed=a.p_counted; S.session=null; return {}; },
    pos_set_rate:function(a){ auth(a); S.rate=a.p_rate; },
    pos_lan_token:function(){ return {token:'llave-de-prueba', ips:['192.168.0.122'], port:8080}; }
  };
  window.__R=R;   // las pruebas pueden añadir funciones (p. ej. las de WhatsApp)
  function Q(t){ this.t=t; } Q.prototype.select=function(){return this}; Q.prototype.order=function(){return this};
  Q.prototype.then=function(res,rej){ if(window.__OFFLINE) return Promise.resolve({data:null,error:{message:'TypeError: Failed to fetch'}}).then(res,rej); var d=this.t==='categories'?menu.categories:menu.dishes; return Promise.resolve({data:JSON.parse(JSON.stringify(d)),error:null}).then(res,rej); };
  window.supabase={createClient:function(){ var cbs=[],session=null; return {
    from:function(t){return new Q(t)},
    functions:{ invoke:function(n,o){ (window.__invokes=window.__invokes||[]).push({fn:n,body:o&&o.body}); return Promise.resolve({data:{sent:0,failed:0},error:null}); } },
    rpc:function(n,a){ return Promise.resolve().then(function(){ if(window.__OFFLINE) return {data:null,error:{message:'TypeError: Failed to fetch'}}; try{ return {data:R[n](a||{}),error:null}; }catch(e){ return {data:null,error:e}; } }); },
    auth:{ onAuthStateChange:function(cb){cbs.push(cb); setTimeout(function(){cb('INITIAL',session)})},
      signInWithPassword:function(){ session={user:{}}; cbs.forEach(function(cb){cb('SIGNED_IN',session)}); return Promise.resolve({error:null}); },
      getSession:function(){ return Promise.resolve({ data:{ session: session ? { access_token:'token-prueba' } : null }, error:null }); },
      signOut:function(){ session=null; cbs.forEach(function(cb){cb('SIGNED_OUT',null)}); } } }; }};
})();
