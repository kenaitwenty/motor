const BASE = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SECRET_KEY;
const TAMANO_LOTE = 50;
const MAX_POR_CORRIDA = 2000;

if (!BASE || !KEY) {
  console.error('Faltan variables de entorno');
  process.exit(1);
}

const headers = {
  apikey: KEY,
  'Content-Type': 'application/json',
  ...(KEY.startsWith('eyJ') ? { Authorization: `Bearer ${KEY}` } : {}),
};

// Nunca se incluye el cuerpo de la respuesta en los errores (podría tener datos de clientes)
async function api(path, options = {}) {
  const res = await fetch(`${BASE}/rest/v1/${path}`, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${path.split('?')[0]}`);
  const texto = await res.text();
  return texto ? JSON.parse(texto) : null;
}

// SIMULADO: busca datos, arma el mensaje y devuelve el texto para guardar en envios
async function enviar(envio) {
  // Traemos los datos de la campaña (título, detalle, vigencia)
  const camp = await api(`campanas?id=eq.${envio.campana_id}&select=variables`);
  const variables = (camp && camp[0] && camp[0].variables) || {};

  // Traemos el nombre del cliente
  const cli = await api(`clientes?id=eq.${envio.cliente_id}&select=nombre`);
  const nombre = (cli && cli[0] && cli[0].nombre) ? cli[0].nombre.trim() : null;

  // Armamos el texto simulado de WhatsApp
  const saludo = nombre ? `¡Hola ${nombre}!` : '¡Hola!';
  const titulo = variables.titulo || 'Tenemos una novedad';
  const detalle = variables.detalle ? `\n${variables.detalle}` : '';
  const vigencia = variables.vigencia ? `\n\n*Válido:* ${variables.vigencia}` : '';

  const textoMensaje = `${saludo} 📢 *${titulo}*${detalle}${vigencia}`;

  return {
    ok: true,
    waMessageId: `SIM-${envio.id}`,
    texto: textoMensaje,
  };
}

async function main() {
  const generados = await api('rpc/generar_envios', { method: 'POST', body: '{}' });

  let reclamados = 0;
  let enviados = 0;
  let fallidos = 0;

  while (reclamados < MAX_POR_CORRIDA) {
    const lote = await api('rpc/reclamar_envios', {
      method: 'POST',
      body: JSON.stringify({ limite: TAMANO_LOTE }),
    });
    if (!lote || lote.length === 0) break;
    reclamados += lote.length;

    for (const envio of lote) {
      let cambio;
      try {
        const r = await enviar(envio);
        cambio = r.ok
          ? { estado: 'enviado', wa_message_id: r.waMessageId, texto: r.texto }
          : { estado: 'fallido', error: r.error || 'error desconocido' };
      } catch {
        cambio = { estado: 'fallido', error: 'excepcion al enviar' };
      }
      await api(`envios?id=eq.${envio.id}`, {
        method: 'PATCH',
        body: JSON.stringify(cambio),
      });
      if (cambio.estado === 'enviado') enviados++;
      else fallidos++;
    }
  }

  console.log(`generados: ${generados} | reclamados: ${reclamados} | enviados: ${enviados} | fallidos: ${fallidos}`);
}

main().catch((e) => {
  console.error('Error del motor:', e.message);
  process.exit(1);
});
