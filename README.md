# Reaction Force Security — Operaciones

App operativa de Reaction Force Security (mapa, turnos, reportes, finanzas y administración).

## Enlace
https://tropicalhuracan-tech.github.io/reaction-force-ops/

### Monorriel presupuesto (aparte)
https://tropicalhuracan-tech.github.io/reaction-force-ops/monorriel-presupuesto/ — ver `monorriel-presupuesto/INSTALAR.md`.

## Instalar en PC
Abre el enlace en Chrome/Edge → Instalar aplicación.

## Publicación (GitHub Pages) — reforzar el build

Los fallos `"Page build failed"` vienen del publicador **legacy/Jekyll**. La app es HTML estático: conviene publicar con **GitHub Actions**.

### Activar una sola vez (dueño del repo)

1. Abre: https://github.com/tropicalhuracan-tech/reaction-force-ops/settings/pages  
2. En **Build and deployment → Source** elige **GitHub Actions**.  
3. Crea el archivo `.github/workflows/deploy-pages.yml` pegando el contenido de  
   [`deploy/pages-workflow.yml`](deploy/pages-workflow.yml)  
   (atajo: [crear archivo en main](https://github.com/tropicalhuracan-tech/reaction-force-ops/new/main?filename=.github/workflows/deploy-pages.yml)).  
4. En **Actions**, abre **Deploy Pages** → **Run workflow** y comprueba que quede en verde.

Ese workflow valida archivos clave, empaqueta solo la PWA y despliega sin Jekyll. Los pushes a `main` quedan con un solo deploy a la vez (sin cancelar el que ya está publicando).
