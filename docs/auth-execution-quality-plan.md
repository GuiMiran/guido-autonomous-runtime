# Plan de Ejecución para Auth

## Objetivo
Validar el flujo de login según los insumos SPECTRA.

## Escenarios
- Login exitoso con usuario estándar ("standard_user").

## Pasos
1. Preparar entorno y datos según login.data.json.
2. Ejecutar escenario "Happy path" de login.feature.
3. Verificar éxito del login.

## Criterios de Aceptación
- El usuario puede iniciar sesión exitosamente.
- El resultado coincide con el contexto y datos definidos.

---

# Plan de Calidad para Auth

## Objetivo
Asegurar la cobertura y robustez del flujo de autenticación.

## Estrategia
- Pruebas automáticas con SpecFlow + Selenium.
- Validación continua en GitHub Actions.
- Reporte de resultados con Allure.
- Auto-heal de tests vía GUIDO Scale.

## Métricas
- 100% de cobertura de escenarios SPECTRA.
- Trazabilidad completa en trace-matrix.md.
- Ejecución exitosa en CI/CD.

## Contrato de CI y evidencia ejecutada

- CI restaura y compila la solución explícita con .NET 8 en `Release`; ambas
  suites usan esa misma configuración, sin recompilar ni restaurar en el test.
- La prueba de SauceDemo se ejecuta en Chrome headless. Conserva la misma
  aserción de login y depende de la disponibilidad del sitio público y de
  Chrome/Selenium Manager; un fallo no se oculta ni se convierte en éxito.
- Auth y E2E se ejecutan en pasos separados después de una compilación correcta,
  aunque la otra suite falle. Se conserva el estado de fallo del job.
- Los TRX de esta ejecución se escriben en el directorio temporal del runner,
  no en `TestResults` del checkout: no se reutiliza evidencia antigua versionada.
  Se publican también cuando falla una suite; la ausencia de archivos es error.
- Se usan acciones oficiales fijadas por commit, permisos de lectura y checkout
  sin credenciales persistentes. No se despliega ni modifica el repositorio.
- Allure sigue siendo un objetivo del plan de calidad, no evidencia ya
  entregada por este workflow: TRX no es el formato de resultados Allure y la
  suite actual no está instrumentada para producirlo. Se retira el generador
  que recibía TRX e inputs incorrectos para evitar un informe vacío. Integrar
  Allure real requiere instrumentación y validación del inventario de resultados
  en un cambio separado; no es parte de esta reparación de CI.

Verificación de aceptación: restore y build satisfactorios, ambas suites
ejecutadas y TRX actuales descargables en el artefacto `runtime-test-results-*`.
CI solo se considera validada después de observar esa ejecución en GitHub;
la revisión estática local no demuestra que los tests .NET hayan pasado.
