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

## Uso
1. `chrome://extensions` → Modo desarrollador → *Cargar descomprimida* → esta carpeta.
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
| `tests/core.test.js` | `node tests/core.test.js` |
| `vendor/jszip.min.js` | JSZip 3.10.1 |

## Limitaciones conocidas
- La API de ChatGPT no es pública ni estable: endpoints y campos pueden cambiar. Si algo falta, revisa
  `informe.txt` y `debug/api_raw.json` y ajusta `core.js` / `page-lib.js`.
- Las imágenes de resultados de búsqueda web y los canvas no se exportan como archivos.
- Úsala solo con tus propias conversaciones y respetando los términos de OpenAI. La exportación oficial
  (Configuración → Control de datos → Exportar datos) es más fiable para volúmenes grandes.
