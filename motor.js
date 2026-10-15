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

// SIMULADO: acá irá la llamada real a WhatsApp Cloud API
async function enviar(envio) {
  return { ok: true, waMessageId: `SIM-${envio.id}` };
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
          ? { estado: 'enviado', wa_message_id: r.waMessageId }
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
