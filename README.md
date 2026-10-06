# Exportar Chats ChatGPT

Extensión de Chrome que **guarda en tu computador** tus conversaciones, proyectos y skills de chatgpt.com, en un archivo ZIP
con todo ordenado: texto, imágenes y archivos adjuntos.

## Las tres extensiones

| Extensión | Para qué sirve |
|---|---|
| **Exportar Chats ChatGPT** (esta) | Guarda tus chats, proyectos y skills de ChatGPT en un ZIP |
| [Exportar Chats Claude](https://github.com/alcalos9/extension_chrome_claude) | Guarda tus chats, proyectos y skills de Claude en un ZIP |
| [Importar Chats a Claude](https://github.com/alcalos9/extension_chrome_importar_claude) | Sube esos ZIP a tu cuenta de Claude |

Orden típico: **exportas** con una de las dos primeras → obtienes un ZIP → lo **importas** a Claude con la tercera.

## Cómo instalarla (1 minuto, gratis)
1. En esta página de GitHub pulsa el botón verde **Code → Download ZIP** y descomprime el archivo.
   Guarda la carpeta en un lugar fijo (si la borras o la mueves, la extensión deja de funcionar).
2. En Chrome escribe `chrome://extensions` en la barra de direcciones.
3. Activa **Modo de desarrollador** (arriba a la derecha).
4. Pulsa **Cargar descomprimida** y elige la carpeta descomprimida.
5. Abre chatgpt.com e inicia sesión. Para usar la extensión, pulsa su icono 🧩: se abre un panel a la derecha.

Para actualizarla, descarga de nuevo el ZIP, reemplaza la carpeta y pulsa ⟳ en `chrome://extensions`.

## Cómo usarla
**Una conversación**
1. Abre la conversación en chatgpt.com y pulsa el icono de la extensión.
2. Pulsa **Capturar conversación** y revisa la vista previa.
3. Pulsa **Exportar ZIP**. Se descarga un ZIP con la conversación.

**Proyectos y skills**
1. En el panel, abre la pestaña **Proyectos** o **Skills**.
2. Marca los que quieras y pulsa **Exportar**.
3. Se descarga un ZIP con instrucciones, archivos y, si lo eliges, las conversaciones de cada proyecto.

## Qué contiene el ZIP
- `conversacion.md`: la conversación para leer, indicando quién escribe cada mensaje.
- `conversacion.json`: los mismos datos, para programas.
- `imagenes/` y `archivos/`: lo que se subió o generó en la conversación.
- `informe.txt`: avisos si algo no se pudo descargar.

Para llevar este ZIP a Claude, usa [Importar Chats a Claude](https://github.com/alcalos9/extension_chrome_importar_claude).

## Tu privacidad
Todo ocurre en tu computador. La extensión no envía tus datos a nadie ni tiene servidor propio: solo usa tu sesión
abierta en chatgpt.com. No pide ni guarda contraseñas.

## Si algo falla
- **No pasa nada al pulsar el icono:** recarga la extensión (⟳ en `chrome://extensions`) y la página de chatgpt.com.
- **Dice que no hay sesión o no encuentra datos:** inicia sesión en chatgpt.com e inténtalo de nuevo.
- **Dejó de funcionar de un día para otro:** probablemente chatgpt.com cambió. Abre un *issue* en este repositorio contando qué pasó.

## Importante
Es un proyecto independiente, sin relación con Anthropic ni OpenAI. Funciona con partes internas de chatgpt.com que pueden
cambiar sin aviso; si algún día deja de funcionar, puede que haya que actualizarla. Úsala solo con tus propias
conversaciones y respetando los términos del servicio.
