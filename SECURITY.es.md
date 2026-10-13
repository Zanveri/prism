# Política de seguridad

[English](SECURITY.md) · [Português (BR)](SECURITY.pt-BR.md) · **Español**

## Versiones cubiertas

Prism está en desarrollo. Mientras la versión sea `0.x`, la intención es que las correcciones de seguridad salgan en la versión
siguiente; no hay versiones antiguas mantenidas en paralelo, y las betas (las versiones `X.Y.Z-beta.N`) son reemplazadas por la
estable siguiente. Antes de la primera versión publicada (la 0.1.0), vale la rama `develop`.

## Cómo reportar una vulnerabilidad

**No abras una issue, ni un comentario, ni un pull request con la descripción de la falla**: todo eso es público.

Repórtala en privado, mediante el **reporte privado de vulnerabilidades** de GitHub: en la página del repositorio, abre la pestaña
**Security** y haz clic en **Report a vulnerability**. El formulario pide un resumen, los detalles, una prueba de concepto y el
impacto. El reporte solo lo ven tú y los [mantenedores](CONTRIBUTING.es.md#mantenedores), y GitHub avisa a los mantenedores cuando
llega ([documentación](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/report-privately)). El propio
GitHub agrega a quien reportó como colaborador del aviso de seguridad que nace del reporte, y es ahí donde continúa la conversación.

El botón solo existe con el repositorio **público** y con el reporte privado activado en la configuración. Si no aparece, no
reportes por otro medio público: abre una issue **sin ningún detalle de la falla**, solo pidiendo un contacto para un reporte de
seguridad, y un mantenedor responde.

## Qué incluir

- La versión de Prism (aparece en la pantalla de entrada, junto al nombre; o el commit, si compilaste desde el código), el
  sistema operativo y la base de datos involucrada.
- Qué es la falla y qué permite hacer: por ejemplo, leer el contenido de una bóveda sin la contraseña, usar la API local sin el
  token, ejecutar código a partir de un dato que viene de la base de datos, o hacer que el actualizador instale un paquete que no
  es el de la release.
- Los pasos para reproducirla, lo más cortos que puedas.
- Qué esperabas y qué ocurrió.

Usa datos de prueba. Nunca adjuntes una bóveda real, una contraseña, un token, una cadena de conexión ni datos de clientes. Si el
reporte necesita un archivo de bóveda, crea uno con un usuario de prueba.

## Qué esperar

- La intención es responder en el propio reporte: confirmar la recepción, decir si el problema fue reproducido y, si hay
  corrección, en qué versión sale. No hay plazo definido.
- Pedimos que el reporte no se divulgue antes de que la corrección esté publicada.
- El nombre de quien reportó solo entra en las notas de la versión que trae la corrección si la persona lo quiere.

## Qué está en el alcance

Lo que Prism se propone proteger: la bóveda cifrada de cada usuario, la contraseña de las conexiones, la API local (que solo
escucha en `127.0.0.1` y exige un token de lanzamiento), la ventana de la aplicación, lo que va al log y la actualización (el
paquete descargado se verifica contra dos sumas SHA-256 antes de cualquier uso; mira la
[documentación](https://zanveri.github.io/prism/es/#actualizaciones)).

Fuera del alcance: quien ya tiene acceso a la sesión del usuario en el sistema operativo, con la aplicación abierta y
desbloqueada, y las fallas de las bases de datos a las que Prism se conecta. Un defecto común, sin efecto sobre la seguridad,
va en una issue pública normal.
