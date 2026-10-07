# Regla importante para Reaction Force Security

**Nunca borrar la información que el usuario ya digitó** al actualizar la app.

## Datos
- Los puestos y reportes viven en `localStorage` del navegador/PWA.
- Claves estables: `rfs-ops-posts`, `rfs-ops-reports` y `rfs-ops-employees`.
- Empleados: listado único consolidado desde vigilantes de cada servicio; campos vacíos se llenan al editar servicios (sin sobrescribir lo ya lleno).
- Al cambiar versión: migrar/copiar datos hacia adelante.
- No usar `localStorage.removeItem` sobre esas claves.
- No reiniciar con datos de ejemplo si ya hay puestos guardados.
- Siempre preferir merge al importar respaldos.

## Oficial / permanente
1. Publicar en un hosting fijo (Cloudflare Pages / Netlify).
2. Instalar como PWA en la PC (icono en escritorio/barra).
3. Descargar respaldo JSON desde Admin periódicamente (o a Google Drive).
4. Más adelante: base de datos en la nube (Supabase/Firebase) para multi-dispositivo.
