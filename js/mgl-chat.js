/* ============================================================
   MyGolfLab · mgl-chat.js  v1.1  ·  2026-08-01

   ── v1.1: DETECCIÓN EXACTA DEL CHAT ───────────────────────────────────────
   La v1.0 adivinaba si una llamada era del chat o de un análisis de swing
   mirando el tamaño del cuerpo y buscando imágenes en base64. Ahora que
   sabemos que coach-ai.html manda siempre un campo "mode" con el valor
   'chat' o 'swing', se usa ese campo directamente. Es exacto y no depende
   de heurísticas. La detección por tamaño queda como respaldo.
   Guarda las conversaciones del Coach IA en Supabase.

   No modifica coach-ai.html por dentro. Trabaja "desde afuera":
   escucha las llamadas que la página ya hace a /api/coach y,
   cuando reconoce una del chat (no un análisis de swing),
   guarda tu pregunta y la respuesta del coach.

   Se instala con UNA línea al final de coach-ai.html,
   antes de la etiqueta de cierre del body:

     <script src="/js/mgl-chat.js"><\/script>

   Si algo falla, no rompe nada: el chat sigue funcionando
   exactamente igual, solo que sin guardarse.
   ============================================================ */
(function(){
  'use strict';

  var URL_SUPABASE = 'https://yulpqupmftdjbepqiscs.supabase.co';
  var CLAVE_ANON   = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1bHBxdXBtZnRkamJlcHFpc2NzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxNDA0NjYsImV4cCI6MjA4OTcxNjQ2Nn0.e-8SEni5uxUoigXCkVM2VYm7UrHYxxVl7hPsUrZvYao';
  var TABLA = 'coach_messages';
  var LIMITE_SWING = 150000;   /* un cuerpo más grande que esto lleva frames */

  var VERSION = '1.1';

  var estado = { instalado:false, cliente:null, guardados:0, ultimoError:null, sesionChat:null };

  /* ---------- identificador de conversación, uno por pestaña ---------- */
  function idSesion(){
    if(estado.sesionChat) return estado.sesionChat;
    var k = 'mgl_chat_sesion';
    try{
      var v = sessionStorage.getItem(k);
      if(!v){
        v = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2,7);
        sessionStorage.setItem(k, v);
      }
      estado.sesionChat = v;
    }catch(e){
      estado.sesionChat = 'c' + Date.now().toString(36);
    }
    return estado.sesionChat;
  }

  /* ---------- cliente de Supabase: reusar si ya hay uno ---------- */
  function obtenerCliente(){
    if(estado.cliente) return estado.cliente;
    var candidatos = [window.sb, window.supabaseClient, window._sb, window.MGL_SB, window.client];
    for(var i=0;i<candidatos.length;i++){
      var c = candidatos[i];
      if(c && typeof c.from === 'function' && c.auth){ estado.cliente = c; return c; }
    }
    if(window.supabase && typeof window.supabase.createClient === 'function'){
      estado.cliente = window.supabase.createClient(URL_SUPABASE, CLAVE_ANON);
      return estado.cliente;
    }
    return null;
  }

  /* ---------- ¿esta llamada es del chat o de un análisis? ---------- */
  function esAnalisisDeSwing(crudo){
    if(!crudo) return false;
    if(crudo.length > LIMITE_SWING) return true;
    var m = crudo.slice(0, 4000).toLowerCase();
    return m.indexOf('data:image') > -1 || m.indexOf('"frames"') > -1 ||
           m.indexOf('"imagenes"') > -1 || m.indexOf('"images"') > -1 ||
           m.indexOf('base64') > -1;
  }

  /* ---------- sacar el texto de la pregunta ---------- */
  function textoPregunta(cuerpo){
    if(!cuerpo) return null;
    var llaves = ['mensaje','message','pregunta','texto','prompt','question','input','userMessage'];
    for(var i=0;i<llaves.length;i++){
      if(typeof cuerpo[llaves[i]] === 'string' && cuerpo[llaves[i]].trim()) return cuerpo[llaves[i]].trim();
    }
    var arr = cuerpo.messages || cuerpo.mensajes || cuerpo.historial || cuerpo.history;
    if(Array.isArray(arr)){
      for(var j=arr.length-1;j>=0;j--){
        var m = arr[j];
        if(!m) continue;
        var rol = m.role || m.rol;
        if(rol && rol !== 'user' && rol !== 'usuario') continue;
        var c = m.content !== undefined ? m.content : m.contenido;
        if(typeof c === 'string' && c.trim()) return c.trim();
        if(Array.isArray(c)){
          var t = c.filter(function(x){ return x && x.type === 'text' && x.text; })
                   .map(function(x){ return x.text; }).join('\n').trim();
          if(t) return t;
        }
      }
    }
    return null;
  }

  /* ---------- sacar el texto de la respuesta ---------- */
  function textoRespuesta(datos){
    if(!datos) return null;
    if(typeof datos === 'string') return datos.trim() || null;
    var llaves = ['respuesta','reply','text','mensaje','message','answer','output','contenido'];
    for(var i=0;i<llaves.length;i++){
      var v = datos[llaves[i]];
      if(typeof v === 'string' && v.trim()) return v.trim();
    }
    var c = datos.content || datos.contenido;
    if(typeof c === 'string' && c.trim()) return c.trim();
    if(Array.isArray(c)){
      var t = c.filter(function(x){ return x && (x.type === 'text' || x.text) && x.type !== 'thinking'; })
               .map(function(x){ return x.text || ''; }).join('\n').trim();
      if(t) return t;
    }
    return null;
  }

  /* ---------- guardar ---------- */
  async function guardar(pregunta, respuesta){
    var sb = obtenerCliente();
    if(!sb) return;
    var ses = await sb.auth.getSession();
    var s = ses && ses.data ? ses.data.session : null;
    if(!s) return;                       /* sin sesión no se guarda nada */

    var uid = s.user.id, sid = idSesion(), ahora = new Date();
    var filas = [];
    if(pregunta) filas.push({ user_id:uid, rol:'usuario', contenido:pregunta,
      sesion_id:sid, created_at:ahora.toISOString() });
    if(respuesta) filas.push({ user_id:uid, rol:'coach', contenido:respuesta,
      sesion_id:sid, created_at:new Date(ahora.getTime()+1000).toISOString() });
    if(!filas.length) return;

    var r = await sb.from(TABLA).insert(filas);
    if(r.error){
      estado.ultimoError = r.error.message;
      console.warn('[MGL chat] No se pudo guardar:', r.error.message);
    } else {
      estado.guardados += filas.length;
      console.log('💬 Conversación guardada · ' + estado.guardados + ' mensajes en esta pestaña');
    }
  }

  /* ---------- interceptar las llamadas a /api/coach ---------- */
  function instalar(){
    if(estado.instalado) return;
    if(typeof window.fetch !== 'function'){
      console.warn('[MGL chat] Este navegador no permite el guardado automático.');
      return;
    }
    var original = window.fetch;

    window.fetch = function(entrada, opciones){
      var url = '';
      try{ url = (typeof entrada === 'string') ? entrada : (entrada && entrada.url) || ''; }catch(e){}
      var esCoach = url.indexOf('/api/coach') > -1;
      var crudo = (opciones && typeof opciones.body === 'string') ? opciones.body : null;

      var respuesta = original.apply(this, arguments);
      if(!esCoach || !crudo) return respuesta;

      /* Respaldo: si el cuerpo trae imágenes o pesa demasiado, es un análisis */
      if(crudo.indexOf('"mode":"chat"') === -1 && esAnalisisDeSwing(crudo)) return respuesta;

      var cuerpo = null;
      try{ cuerpo = JSON.parse(crudo); }catch(e){ return respuesta; }

      /* coach-ai.html manda siempre mode: 'chat' o 'swing'.
         Si viene, es la señal definitiva. Si no, caemos al respaldo. */
      if(cuerpo.mode && cuerpo.mode !== 'chat') return respuesta;

      var pregunta = textoPregunta(cuerpo);
      if(!pregunta) return respuesta;

      return respuesta.then(function(res){
        if(!res || !res.ok) return res;
        try{
          res.clone().json().then(function(d){
            guardar(pregunta, textoRespuesta(d)).catch(function(e){
              estado.ultimoError = e.message;
            });
          }).catch(function(){});
        }catch(e){}
        return res;
      });
    };

    estado.instalado = true;
    console.log('%c 💬 MGL CHAT v1.1 — INSTALADO CORRECTAMENTE ',
                'background:#2dd4bf;color:#06251f;font-weight:bold');
    console.log('Las conversaciones con el coach se guardarán en la nube. '+
                'Escribe MGL_CHAT_TEST() para revisar el estado.');
  }

  /* ---------- autotest ---------- */
  window.MGL_CHAT_TEST = async function(){
    var r = [], sb = obtenerCliente();
    function t(n, ok, d){ r.push({ prueba:n, resultado: ok?'OK':'REVISAR', detalle:d }); }

    t('Parche instalado', estado.instalado, 'v' + VERSION);
    t('Cliente de Supabase', !!sb, sb ? 'disponible' : 'no se encontró ni se pudo crear');

    var sesion = null;
    if(sb){
      try{ var s = await sb.auth.getSession(); sesion = s.data.session; }catch(e){}
    }
    t('Sesión iniciada', !!sesion, sesion ? sesion.user.email : 'entra con tu cuenta');

    var tablaOk = false, cuantos = 0;
    if(sb && sesion){
      var q = await sb.from(TABLA).select('id', { count:'exact', head:true }).eq('user_id', sesion.user.id);
      tablaOk = !q.error;
      cuantos = q.count || 0;
      if(q.error) estado.ultimoError = q.error.message;
    }
    t('Tabla coach_messages', tablaOk, tablaOk ? cuantos+' mensajes guardados'
      : 'falta crearla (paso 3 del instructivo)');
    t('Guardados en esta pestaña', true, estado.guardados + ' mensajes');
    t('Sin errores', !estado.ultimoError, estado.ultimoError || 'ninguno');

    console.log('%c MGL CHAT — AUTOTEST ', 'background:#2dd4bf;color:#06251f;font-weight:bold');
    console.table(r);
    var f = r.filter(function(x){ return x.resultado === 'REVISAR'; });
    if(!f.length) console.log('%c Todo correcto. ', 'background:#22c55e;color:#04210e');
    else console.warn('Revisar: ' + f.map(function(x){ return x.prueba; }).join(', '));
    return r;
  };

  window.MGL_CHAT = estado;

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', instalar);
  } else {
    instalar();
  }
})();
