// Configuración del menú. Rellena con los datos de tu proyecto Supabase
// (Project Settings → API). La "anon key" es pública: la seguridad la dan
// las políticas RLS de supabase/schema.sql.
// Si dejas SUPABASE_URL vacío, el menú usa data/menu.json (modo demo).
window.MENU_CONFIG = {
  SUPABASE_URL: "https://krjryvtnzgwwhanmbdrn.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_uj5tuhHYTNmJNYaLzQjGjQ_fVJzcHq3",
  // Sentry: avisa de errores de la caja, las tablets y Gestión. La DSN es pública (solo permite enviar errores).
  SENTRY_DSN: "https://53b0d19d069528d77fd7488cb56edac7@o4512402789433344.ingest.us.sentry.io/4512402837798912",
  // Nex (asistente con voz): apagada hasta tener el avatar VTuber. Para encenderla: true y publicar la función nex.
  NEX_ENABLED: false,
  RESTAURANT_NAME: "Ichiraku Ramen",
  TAGLINE: "Ramen · Sushi · Postres japoneses",
  // Los precios se muestran como "Ref 2.5". Para usar una moneda normal,
  // deja PRICE_PREFIX en "" y ajusta CURRENCY/LOCALE (p. ej. "USD", "es-VE").
  PRICE_PREFIX: "Ref",
  CURRENCY: "USD",
  LOCALE: "es-VE",
  PHOTO_BUCKET: "dishes",
  // Número de WhatsApp que recibe los pedidos, con código de país (p. ej. "+58 412 1234567").
  // Vacío = el botón "Enviar por WhatsApp" no aparece.
  WHATSAPP_NUMBER: "",
  // Foto grande en la ficha del plato. Actívalo (true) cuando las fotos sean de buena calidad.
  BIG_PHOTOS: false,
  // Cargo por servicio que se suma al total del pedido (en %). 0 = sin cargo.
  SERVICE_PERCENT: 10,
  // En el carrito: nº de mesa, «Mostrar al mesonero» y «Enviar por WhatsApp». false = ocultos.
  ORDER_ACTIONS: false,
};
