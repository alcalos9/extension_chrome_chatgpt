# Exportar Chats ChatGPT

Extensión de Chrome (Manifest V3, Chrome ≥ 116) que exporta una conversación de chatgpt.com a un ZIP.
Es el proyecto hermano de `extension_chrome_claude` y comparte su estructura.

```
<titulo>/
  conversacion.json   datos estructurados: rol, fecha, texto, bloques y adjuntos por mensaje
  conversacion.md     versión legible, con quién escribe cada mensaje y enlaces a los archivos
  imagenes/           msg003_usuario_foto.png …   (prefijo = nº de mensaje + autor; incluye imágenes generadas)
  archivos/           documentos subidos y archivos creados por el asistente (sandbox)
  informe.txt         incidencias (descargas fallidas, etc.)
  debug/api_raw.json  respuesta cruda de la API (para diagnosticar cambios de formato; contiene todo el chat)
```

## La familia de extensiones
Tres extensiones independientes que se complementan para **mover tus conversaciones entre ChatGPT y Claude**:

| Extensión | Qué hace |
|---|---|
| [Exportar Chats ChatGPT](https://github.com/alcalos9/extension_chrome_chatgpt) | Descarga una conversación (o proyectos y skills) de chatgpt.com como ZIP |
| [Exportar Chats Claude](https://github.com/alcalos9/extension_chrome_claude) | Descarga una conversación (o proyectos y skills) de claude.ai como ZIP |
| [Importar Chats a Claude](https://github.com/alcalos9/extension_chrome_importar_claude) | Carga esos ZIP en tu cuenta de Claude: chat suelto, proyecto existente o proyecto nuevo |

Flujo típico: **exportas** con una de las dos primeras → obtienes un ZIP → lo **importas** a Claude con la tercera.

## Proyectos y skills (v1.1)
El panel tiene tres pestañas: **Conversación**, **Proyectos** y **Skills**.
- **Proyectos:** lista tus proyectos de ChatGPT (internamente «gizmos» `g-p-…`), eliges cuáles y exporta, por proyecto:
  `instrucciones.md`, `conocimiento/archivos/` (los archivos del proyecto), `proyecto.json`, `LEEME.md` y,
  opcionalmente, todas sus conversaciones (cada una con su carpeta completa: Markdown, JSON, imágenes y archivos).
- **Skills:** lista tus skills (los de OpenAI vienen desmarcados) y exporta cada uno como el ZIP original (listo para
  volver a subirlo desde Skills) y desempaquetado (`SKILL.md` + archivos).
- **Diagnóstico** (en «Registro y diagnóstico»): descarga `diagnostico_chatgpt.json` con el estado HTTP y la *forma*
  (claves y tipos, nunca contenido) de cada endpoint probado. Úsalo si una lista sale vacía o falla.

Los endpoints de proyectos y skills **no son públicos** (los de skills, en particular, son una suposición razonada):
cada operación prueba varias rutas y deja en el informe lo que falló. Siempre se guarda la respuesta cruda en
`debug/` para poder ajustar `recursos.js`. Al exportar proyectos, Chrome pide una vez el permiso para descargar
archivos de otros dominios (URLs firmadas).

## Instalación
La extensión no está en la Chrome Web Store: se instala a mano en modo desarrollador (1 minuto, gratis).

1. **Descarga el código.** En la página del repositorio pulsa **Code → Download ZIP** y descomprímelo
   (o usa `git clone https://github.com/alcalos9/extension_chrome_chatgpt.git`). Guarda la carpeta en un lugar estable: Chrome la lee desde ahí,
   así que si la borras o la mueves la extensión deja de funcionar.
2. Abre `chrome://extensions` en Chrome (o Edge/Brave u otro navegador basado en Chromium, versión ≥ 116).
3. Activa **Modo de desarrollador** (interruptor arriba a la derecha).
4. Pulsa **Cargar descomprimida** y elige la carpeta del proyecto (la que contiene `manifest.json`).
5. Fija la extensión desde el icono de puzle de la barra para tenerla a mano.
6. Abre sesión en chatgpt.com en esa misma ventana de Chrome: la extensión usa tu sesión, no pide contraseñas.

**Actualizar:** descarga de nuevo el repositorio, reemplaza la carpeta y pulsa el botón ⟳ de la extensión en
`chrome://extensions`. **Desinstalar:** botón *Quitar* en la misma página.

> Chrome puede mostrar al abrir el navegador el aviso «Desactiva las extensiones en modo desarrollador».
> Es normal en extensiones instaladas así; puedes cerrarlo.

## Uso
1. Instala la extensión (ver **Instalación** arriba).
2. Abre una conversación en chatgpt.com y pulsa el icono: se abre el panel lateral.
3. **Capturar conversación** → revisa la vista previa → **Exportar ZIP**. Chrome pedirá una vez el permiso para
   descargar archivos de otros dominios (ChatGPT los sirve con URLs firmadas).

## Cómo obtiene los datos
1. **API interna (preferido).** Obtiene el token de `/api/auth/session` y lee `/backend-api/conversation/<id>`:
   un árbol de nodos del que se toma solo la rama visible (`current_node`). Los nodos de herramientas (búsqueda,
   python, DALL·E…) se fusionan en el turno del asistente, igual que en la interfaz. Los archivos se resuelven
   a URLs de descarga con `/backend-api/files/<id>/download` (y alternativas) y los de la sandbox
   (`sandbox:/mnt/data/…`) con el endpoint del intérprete.
2. **Lectura del DOM (respaldo).** Si la API falla, sube hasta cargar todo el historial y lee los mensajes con
   `[data-message-author-role]`. Recupera texto e imágenes visibles, y solo el *nombre* de los documentos.

## Estructura del código
| Archivo | Rol |
|---|---|
| `manifest.json`, `background.js` | MV3; el icono abre el panel lateral |
| `sidepanel.*` | UI y orquestación (captura, descargas, ZIP) |
| `page-lib.js` | Se inyecta en la pestaña: API, DOM, scroll, descargas. **Selectores en `CFG`** |
| `core.js` | Lógica pura (normalización del árbol, Markdown, nombres) |
| `recursos.js` | Lógica pura de proyectos y skills (rutas candidatas, paginación por cursor, reconstrucción de skills) |
| `recursos-ui.js` | Pestañas, listas, exportación de proyectos/skills y diagnóstico |
| `tests/` | `node tests/core.test.js`, `node tests/recursos.test.js`; `tests/e2e-panel.js` (requiere jsdom) |
| `vendor/jszip.min.js` | JSZip 3.10.1 |

## Privacidad y seguridad
- **Todo ocurre en tu navegador.** La extensión no tiene servidor propio, no envía tus conversaciones a ningún
  tercero y no incluye analítica ni telemetría.
- Usa **tu sesión ya abierta** en chatgpt.com; no pide ni guarda contraseñas ni tokens.
- Permisos que solicita (ver `manifest.json`): `activeTab`, `scripting` y `sidePanel` (leer la pestaña activa y mostrar el panel lateral); acceso a `chatgpt.com`, `chat.openai.com` y `*.oaiusercontent.com` (donde ChatGPT guarda los archivos); y, solo si lo aceptas, descargar adjuntos de otros dominios.
- Puedes revisar el código completo: son archivos JavaScript sin compilar ni ofuscar.

## Solución de problemas
- **El icono no abre nada / el panel no aparece:** recarga la extensión (⟳ en `chrome://extensions`) y la pestaña de chatgpt.com.
- **Dice que la sesión está cerrada o no encuentra datos:** abre chatgpt.com, inicia sesión y vuelve a intentarlo.
- **Algo dejó de funcionar de un día para otro:** chatgpt.com cambió su interfaz o su API interna. Revisa el *Registro* del panel y abre un *issue* en el repositorio con ese texto (sin datos personales).
- **Chrome pide un permiso extra:** es para descargar archivos adjuntos de otros dominios; se pide una sola vez.

## Limitaciones conocidas
- La API de ChatGPT no es pública ni estable: endpoints y campos pueden cambiar. Si algo falta, revisa
  `informe.txt` y `debug/api_raw.json` y ajusta `core.js` / `page-lib.js`.
- Las imágenes de resultados de búsqueda web y los canvas no se exportan como archivos.
- Úsala solo con tus propias conversaciones y respetando los términos de OpenAI. La exportación oficial
  (Configuración → Control de datos → Exportar datos) es más fiable para volúmenes grandes.

## Aviso
Proyecto independiente, no afiliado ni respaldado por Anthropic ni por OpenAI. Claude y ChatGPT son marcas de sus
respectivos titulares. Depende de interfaces internas no documentadas que pueden cambiar sin aviso.
Úsalo solo con tus propias conversaciones y respetando los términos de servicio de cada plataforma.
