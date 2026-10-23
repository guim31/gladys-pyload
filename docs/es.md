# pyLoad

Siga y controle [pyLoad](https://github.com/pyload/pyload) desde Gladys: el gestor de descargas
libre para enlaces directos y servicios de alojamiento de archivos, a menudo instalado en un NAS o
un servidor doméstico (Docker, Unraid, Synology…). La integración habla con la API local de
pyLoad: la velocidad, la cola y el espacio libre aparecen en el panel, una escena puede pausar las
descargas durante una videollamada, y Gladys puede avisarle cuando una descarga ha terminado,
cuando un archivo falla o cuando la cola está vacía.

Probada con pyLoad 0.5.0b3.dev96 y dev101 reales, todavía no en un Gladys real: sus comentarios
son bienvenidos en [GitHub](https://github.com/guim31/gladys-pyload/issues).

## Requisitos

- Gladys 5.1.0 o posterior.
- pyLoad **0.5** (el paquete `pyload-ng`, o la imagen Docker `linuxserver/pyload-ng`), accesible
  desde el servidor Gladys (misma red). El antiguo pyLoad 0.4 no es compatible.
- pyLoad **0.5.0b3.dev101 o posterior** (2025): una **clave de API**. Créela en pyLoad:
  **Settings → Users**, el menú de su usuario, **Manage API Keys**. Empieza por `pl_`.
- pyLoad 0.5 más antiguo (antes de dev101): el **nombre de usuario y la contraseña** de la
  interfaz web (`pyload` / `pyload` mientras no los cambie).
- El usuario necesita los permisos de pyLoad **List** (leer la cola), **Status** (pausa, espacio
  libre) y, para las acciones de escena, **Modify** (reiniciar los archivos fallidos) y **Add**
  (añadir enlaces). Un administrador los tiene todos.

## Configuración

Hasta dos servidores, cada uno con:

- **Dirección**: la dirección IP o el nombre, con el puerto: `192.168.1.10:8000`. Sin puerto, se
  añade 8000. Escriba `https://` para HTTPS, y la ruta si pyLoad está detrás de un proxy inverso
  (`https://nas.example.org/pyload`). La dirección copiada del navegador también sirve.
- **Clave de API**, o **Nombre de usuario** y **Contraseña** para las versiones antiguas.
- **Nombre**: el nombre del dispositivo en Gladys (vacío: pyLoad seguido de la dirección).

Opciones:

- **Aceptar certificados autofirmados**: para una dirección `https://` con su propio certificado.
  Márquelo solo para sus propios servidores.
- **Intervalo de actualización**: con qué frecuencia se lee pyLoad, 30 segundos por defecto.
  También es el retraso de los disparadores.
- **Permitir añadir enlaces**: permite que las escenas añadan enlaces para descargar (desactivado
  por defecto: quien pueda editar una escena podría iniciar una descarga).
- **Idioma de los textos de los dispositivos**: los nombres de las funciones al añadir un
  dispositivo, y los textos de estado (francés por defecto).

El botón **Probar la conexión** lee cada servidor e indica lo que encuentra: versión, estado,
cola, archivos fallidos.

## Dispositivos

Un dispositivo por servidor, en la pestaña Descubrimiento. Sus funciones:

| Función                | Lo que muestra                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| Descargas en pausa     | interruptor: encendido pausa pyLoad hasta que lo apague; apagado lo reanuda.                |
| Reconexión automática  | interruptor: la reconexión de pyLoad (nueva dirección IP del router) activada o no.         |
| Velocidad de descarga  | en MB/s.                                                                                    |
| Descargas activas      | los archivos que se descargan ahora.                                                        |
| Archivos en la cola    | los archivos de la cola sin terminar, fallidos incluidos (la «queue» de pyLoad).            |
| Archivos en total      | todos los archivos de pyLoad, cola y colector (el «total» de pyLoad).                       |
| Archivos fallidos      | los archivos que han fallado, o cuyo enlace está fuera de línea.                            |
| Espacio libre en disco | en GB, de la carpeta de descargas.                                                          |
| Estado                 | Descargando, En pausa, En espera (archivos en cola, ninguno activo), Inactivo, Inaccesible. |
| Última descarga        | el nombre del último paquete terminado.                                                     |

Pausar pyLoad no inicia ninguna descarga nueva: los archivos que ya se descargan terminan (es la
pausa del propio pyLoad). Tamaños y velocidades en unidades binarias, como las muestra pyLoad
(1 MB = 1024 × 1024 bytes). Solo se envían a Gladys los cambios, y todos los valores de nuevo al
cabo de 6 horas.

## Widget

El widget **Descargas pyLoad** muestra la velocidad, la cola y el tiempo restante de todos los
servidores (o del elegido en su configuración), y una línea por servidor: su estado (con el fin de
una pausa temporizada), los archivos en curso con su porcentaje, los archivos fallidos, el espacio
libre y la última descarga. Cuatro botones:

- **Pausa**: pausa pyLoad hasta que lo reanude;
- **Pausa 30 min**: lo pausa durante 30 minutos;
- **Reanudar**: lo reanuda;
- **Reintentar fallidos**: vuelve a intentar los archivos fallidos.

La marca muestra el estado actual: en **Pausa** cuando todo está en pausa, en **Reanudar** cuando
todo funciona.

## Disparadores de escena

- **Descarga completada**: todos los archivos de un paquete están descargados. Filtro: el servidor. Variables: nombre del paquete, número de
  archivos, tamaño en MB, nombre del servidor.
- **Archivo fallido**: un archivo ha fallado, o su enlace está fuera de línea (enlace roto, 404).
  Filtro: el servidor. Variables: nombre del archivo, nombre del paquete, el motivo dado por
  pyLoad, nombre del servidor.
- **Cola vacía**: no queda nada por descargar, el último archivo de la cola ha terminado o ha
  fallado. Filtro: el servidor. Variable: nombre del servidor.

Cada paquete y cada archivo dispara una vez (un archivo reiniciado que vuelve a fallar dispara de
nuevo). Lo que ocurrió mientras la integración estaba parada (una actualización, un reinicio)
dispara cuando vuelve a arrancar.

No hay disparador «disco casi lleno»: la función **Espacio libre en disco** es un valor, y el
disparador de dispositivo de Gladys ya lo compara con un umbral («Espacio libre en disco inferior a
20 GB»).

## Acciones de escena

- **Pausar las descargas**: un servidor o todos, durante un número de minutos (0: hasta reanudar).
  La integración reanuda pyLoad al final (pyLoad no tiene pausa temporizada propia). Salidas:
  número de servidores en pausa, duración.
- **Reanudar las descargas**: un servidor o todos.
- **Reiniciar los archivos fallidos**: vuelve a intentar los archivos fallidos, en un servidor o en
  todos.
- **Añadir enlaces para descargar**: enlaces http(s) o ftp, separados por espacios (50 como
  máximo), como un paquete, en el servidor elegido (vacío: el primero). El nombre del paquete es
  opcional (vacío: el nombre del primer archivo). Solo si **Permitir añadir enlaces** está marcado.
  Salida: el ID del paquete.

La integración nunca borra un archivo ni un paquete, y nunca reinicia pyLoad.

## Ejemplos de escenas

- Videollamada: cuando empieza el evento «Reunión» del calendario, **Pausar las descargas** durante
  60 minutos.
- Noche: a la 1, **Reanudar las descargas**; a las 8, **Pausar las descargas** hasta reanudar.
- Notificación: con **Descarga completada**, enviar «{{triggerEvent.data.name}} está descargado» a
  su teléfono.
- Problema: con **Archivo fallido**, enviar el nombre del archivo y el motivo; una hora después,
  **Reiniciar los archivos fallidos**.
- Energía: con **Cola vacía**, apagar el enchufe del NAS unos minutos después.

## Solución de problemas

- «no responde»: compruebe la dirección y el puerto (8000), y que el servidor Gladys llega a
  pyLoad (cortafuegos, red Docker).
- «acceso rechazado»: pyLoad 0.5.0b3.dev101 y posteriores solo aceptan una clave de API; las
  versiones antiguas un nombre de usuario y una contraseña. Corrija y guarde. La integración no
  vuelve a intentarlo sola: cada acceso rechazado escribe un error en el registro de pyLoad.
- «al usuario de pyLoad le falta un permiso»: dé al usuario los permisos indicados en Requisitos.
- «no hay pyLoad 0.5 en esta dirección»: puerto equivocado, o un pyLoad 0.4.
- «certificado rechazado»: marque «Aceptar certificados autofirmados», o use `http://`.
- «demasiadas solicitudes»: pyLoad responde a 100 llamadas de API por minuto y dirección como
  máximo; una actualización cuesta 3 o 4. Elija un intervalo más largo si otras herramientas leen
  también pyLoad.
- Un enlace añadido por una escena que falla enseguida con «Refusing to download from Server-Side
  host»: pyLoad rechaza las direcciones de su propia red (una protección de pyLoad).
- Más detalles: los registros de la integración, con `LOG_LEVEL=debug` para cada lectura.

## Limitaciones

- Cada actualización lee toda la cola de pyLoad (cada archivo): cada 30 segundos por defecto.
- La pausa de pyLoad deja terminar los archivos que ya se descargan.
- El interruptor **Reconexión automática** muestra la opción de pyLoad dentro de su franja horaria:
  fuera de la franja configurada en pyLoad, aparece apagado.
- Una pausa temporizada depende de la integración: si está parada al final de la pausa, pyLoad se
  reanuda en cuanto vuelve a arrancar.
- Sin relación con el equipo de pyLoad.
