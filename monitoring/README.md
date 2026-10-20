# Monitoring — Headlamp plugin

[English](#english) | [Türkçe](#turkce)

---

## English

A [Headlamp](https://headlamp.dev) plugin for clusters running **kube-prometheus-stack** or the
**Prometheus Operator**. It adds a **Monitoring** section to the sidebar.

Target versions: **Headlamp ≥ 0.45.0** with the `monitoring.coreos.com` CRDs installed.

### Features

- **Overview**: component health, firing alerts by severity, target health,
  active silences, resource counts, and a list of resources that no
  Prometheus/Alertmanager selects (so they have no effect).
- **Alerting**: active alerts with their Alertmanager status (silenced or
  inhibited, plus receivers), alerting and recording rules linked to their
  `PrometheusRule`, and silences (create, edit, recreate, expire, with a
  preview of the alerts they affect).
- **Metrics**: a PromQL explorer with metric-name completion, query history,
  graph, table and raw views, a range picker, auto refresh, and shareable URLs.
- **Targets**: scrape targets grouped by pool and linked back to the
  ServiceMonitor, PodMonitor, Probe or ScrapeConfig that created them.
- **All 10 CRDs**: Prometheus, Alertmanager, ServiceMonitor, PodMonitor, Probe,
  ScrapeConfig, PrometheusRule, AlertmanagerConfig, PrometheusAgent and
  ThanosRuler, each with a list and a details view.

#### References between resources

The plugin evaluates selectors with the operator's own semantics: a nil
resource selector selects nothing, a nil namespace selector means "own
namespace", and `{}` selects everything. From that it shows:

- which workloads select a resource, and which labels are missing when none do
  (for example kube-prometheus-stack's `release` label);
- everything a Prometheus or Alertmanager selects;
- the Services or Pods a monitor matches, with a check that the endpoint ports
  exist;
- live scrape targets per monitor, and live rule state per `PrometheusRule`;
- a **Monitoring** section on Headlamp's Service and Pod pages, a
  **Monitoring** source in the Map view, and kind icons.

#### Forms and wizards

The **Create** split button opens the wizard (when the kind has one) or the
form, and its menu also offers "Create with form" and "Create from YAML". The
editor dialog has Wizard/Form, YAML and Documentation tabs; form and YAML stay
in sync in both directions. Detail pages have an "Edit with form" action.

| Resource                                                  | Editor                                                                                                                                                                                         |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ServiceMonitor / PodMonitor                               | Wizard: pick an existing Service or Pod, auto-fill selector and ports, live match preview, endpoints (auth via Secret picker), Prometheus selection check with one-click "add missing labels". |
| PrometheusRule                                            | Group and rule editor, **Test query** against the live Prometheus, severity and annotation helpers.                                                                                            |
| AlertmanagerConfig                                        | Wizard: receivers (Slack, Email, Webhook, PagerDuty, Teams, Telegram, Opsgenie) with Secret references, routing tree, inhibit rules, Alertmanager selection check.                             |
| Prometheus / Alertmanager / PrometheusAgent / ThanosRuler | Sectioned form: selectors with explicit None/All/Matching semantics, storage, resources, external labels.                                                                                      |
| Probe / ScrapeConfig                                      | Compact forms; advanced fields go through the YAML tab.                                                                                                                                        |

When you edit a Helm-managed object, the plugin warns that the next
`helm upgrade` will overwrite your changes.

### Screenshots

**Overview**

![Overview](https://raw.githubusercontent.com/batuhancikrikci/headlamp-plugins/main/monitoring/docs/screenshots/overview.jpg)

**Alerting**

![Alerting](https://raw.githubusercontent.com/batuhancikrikci/headlamp-plugins/main/monitoring/docs/screenshots/alerting.jpg)

**ServiceMonitor wizard**

![ServiceMonitor wizard](https://raw.githubusercontent.com/batuhancikrikci/headlamp-plugins/main/monitoring/docs/screenshots/monitor-wizard.jpg)

### Requirements

- Headlamp **0.45.0** or newer, with the `monitoring.coreos.com` CRDs installed.
- `list`/`watch` on the monitoring CRDs; `get` on `services/proxy` in the Prometheus and Alertmanager namespaces for live data. A detailed RBAC example is in the [Permissions](#permissions) section.

### Installation

#### From the Headlamp plugin catalog (Artifact Hub)

The plugin is published on [Artifact Hub](https://artifacthub.io/packages/headlamp/batuhancikrikci-headlamp-plugins/monitoring). In the Headlamp desktop app, open the plugin
catalog, search for **Monitoring** and install it. The catalog shows only official plugins by default; turn off the **Only Official** switch in the
catalog (or **Display only Official Plugins** in its settings) to see this plugin.

#### Manual installation

Download `monitoring-<version>.tar.gz` from [GitHub Releases](https://github.com/batuhancikrikci/headlamp-plugins/releases), compare its SHA-256
checksum with the `.sha256` file and extract it into the Headlamp plugins directory:

| Platform | Plugins directory                                                                                       |
| -------- | ------------------------------------------------------------------------------------------------------- |
| Linux    | `~/.config/Headlamp/plugins/` (or `~/.local/share/Headlamp/plugins/` when it exists)                    |
| macOS    | `~/Library/Application Support/Headlamp/plugins/` (otherwise `~/Library/Preferences/Headlamp/plugins/`) |
| Windows  | `%APPDATA%\Headlamp\Config\plugins\` (or `%LOCALAPPDATA%\Headlamp\Data\plugins\` when it exists)        |

```bash
tar -xzf monitoring-*.tar.gz -C ~/.config/Headlamp/plugins/
```

The directory must contain `monitoring/main.js` and `monitoring/package.json`. Reload Headlamp afterwards
(Ctrl+Shift+R / Cmd+Shift+R).

To confirm that the tarball was built from this repository by its release workflow, verify its
build provenance with the [GitHub CLI](https://cli.github.com):
`gh attestation verify monitoring-<version>.tar.gz --repo batuhancikrikci/headlamp-plugins`.

#### From source

```bash
npm ci
npm run deploy        # icons, type-check, lint, tests, build, install
```

`npm run deploy` installs the plugin into the plugins directory of the Headlamp desktop app, found
the same way `headlamp-plugin start` finds it. Set `HEADLAMP_PLUGINS_DIR` to install somewhere
else, and use `npm run deploy:fast` to skip the checks. The previous version is replaced atomically,
and the script warns about other copies of the plugin that Headlamp might load instead.

#### In-cluster Headlamp

The plugin manager of the Headlamp Helm chart can install the plugin from Artifact Hub:

```yaml
pluginsManager:
  enabled: true
  configContent: |
    plugins:
      - name: monitoring
        source: https://artifacthub.io/packages/headlamp/batuhancikrikci-headlamp-plugins/monitoring
```

Without a `version` field the latest release is installed; add `version: <x.y.z>` under `source`
to pin one.

Alternatively, extract the tarball built by `npm run package` into the directory passed to the
Headlamp server with `-plugins-dir` (`/headlamp/plugins` in the official image), from an init
container or with a custom image:

```dockerfile
FROM node:20-alpine AS build
WORKDIR /plugin
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && cp package.json dist/

FROM ghcr.io/headlamp-k8s/headlamp:v0.45.0
COPY --from=build /plugin/dist /headlamp/plugins/monitoring
```

### Permissions

- `list`/`watch` on `monitoring.coreos.com` resources.
- `get` on `services/proxy` in the Prometheus and Alertmanager namespaces. Live
  data (alerts, rules, targets, metrics, silences) goes through the API
  server's service proxy.
- Optional: `list namespaces` (for label-based namespace selectors) and
  `list secrets` in the relevant namespace (for the Secret picker and
  missing-Secret checks). Without these, the UI degrades gracefully.

#### RBAC for the Overview page (read-only)

The Overview page reads, cluster-wide:

| What                                               | API                                      | Why                                                                      |
| -------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------ |
| All 10 monitoring CRDs                             | `monitoring.coreos.com`: `list`, `watch` | resource cards, health table, needs-attention list                       |
| Namespaces                                         | core: `list`, `watch`                    | evaluating label-based namespace selectors (optional; unknown otherwise) |
| Services in the Prometheus/Alertmanager namespaces | core: `list`                             | finding the Service that fronts each instance                            |
| Prometheus/Alertmanager HTTP APIs                  | core `services/proxy`: `get`             | live status: alerts, targets, silences, config reload                    |

API discovery (`/apis/monitoring.coreos.com`) is allowed for every
authenticated user by the default `system:discovery` role. The built-in `view`
role covers neither the monitoring CRDs nor `services/proxy`, so grant a
dedicated role:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: headlamp-monitoring-viewer
rules:
  - apiGroups: ['monitoring.coreos.com']
    resources:
      - prometheuses
      - prometheusagents
      - alertmanagers
      - thanosrulers
      - servicemonitors
      - podmonitors
      - probes
      - scrapeconfigs
      - prometheusrules
      - alertmanagerconfigs
    verbs: ['get', 'list', 'watch']
  - apiGroups: ['']
    resources: ['namespaces', 'services']
    verbs: ['get', 'list', 'watch']
  - apiGroups: ['']
    resources: ['services/proxy']
    verbs: ['get']
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: headlamp-monitoring-viewer
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: headlamp-monitoring-viewer
subjects:
  - kind: Group
    name: monitoring-viewers # or a User / ServiceAccount
    apiGroup: rbac.authorization.k8s.io
```

`services/proxy` can be narrowed to the monitoring namespace with a Role and
RoleBinding instead of the ClusterRole rule. Creating or expiring silences
additionally needs `create` and `delete` on `services/proxy` for the
Alertmanager service. Editing monitoring resources needs `create`, `update`,
`patch` and `delete` on the CRDs above.

### Configuration

Prometheus and Alertmanager are discovered from their custom resources: the plugin picks the Service that routes to the instance's pods and honors `routePrefix` / `externalUrl`. If a cluster has more than one instance, choose one on the page. For Thanos Query or other custom services, set a manual override under **Settings → Plugins → monitoring**.

### Compatibility

| Component           | Version                                         |
| ------------------- | ----------------------------------------------- |
| Headlamp            | ≥ 0.45.0 (`@kinvolk/headlamp-plugin` 0.14)      |
| Prometheus Operator | `monitoring.coreos.com` (kube-prometheus-stack) |

API versions are discovered at runtime; the table lists the versions used during development and testing.

### Development

Requires Node.js **20.11+** and npm **10+**. In the plugin directory:

```bash
npm ci
npm start             # rebuilds on every change and copies the result into the local Headlamp
```

| Command                             | What it does                                              |
| ----------------------------------- | --------------------------------------------------------- |
| `npm start`                         | Watch mode; every build is copied into the local Headlamp |
| `npm run build`                     | Production bundle in `dist/`                              |
| `npm run check`                     | Type-check, lint and unit tests                           |
| `npm run tsc`                       | Type-check (strict)                                       |
| `npm run lint` / `npm run lint-fix` | ESLint, zero warnings allowed                             |
| `npm run format`                    | Prettier                                                  |
| `npm test`                          | Vitest unit tests                                         |
| `npm run storybook`                 | Component stories                                         |
| `npm run package`                   | `monitoring-<version>.tar.gz` for distribution            |
| `npm run deploy` / `deploy:fast`    | Build and install into the local Headlamp desktop app     |

Icons are bundled, so the plugin works without internet access: `npm run icons` collects every
`mdi:` and `simple-icons:` id used in `src/` into `src/icons/bundle.json` (`start`, `build`,
`package` and `storybook` run it first).

`src/common/` holds the building blocks shared by every plugin of this repository (states, error
boundary, CRD documentation, form fields, editor and wizards). The copies are identical in every
plugin; `src/plugin.ts` describes this plugin to them.

#### Project layout

```text
src/
  index.tsx                 Registrations (sidebar, routes, map, details sections, settings)
  plugin.ts                 Identity of the plugin, used by src/common
  common/                   Shared building blocks, identical in every plugin of this repository
  icons/                    Generated icon bundle
  resources/crds.ts         KubeObject classes (multi-version via apiVersion arrays)
  utils/                    Pure logic + tests: selectors, matchers, relations, discovery, API client
  hooks/                    Polling, endpoint discovery, CRD availability, workloads
  components/common/        Theme-aware chips, selectors, feedback, code blocks
  components/forms/         Form dialog, wizards and field editors
  components/relations/     "Selected by" views
  pages/                    Overview, alerting, metrics, targets, resource lists/details
  integrations/             Service/Pod section, map source, plugin settings
scripts/
  build-icons.mjs           Offline icon bundle (src/icons/bundle.json)
  deploy.mjs                Build and install into the local Headlamp desktop app
```

### License

Licensed under the [Apache License 2.0](https://github.com/batuhancikrikci/headlamp-plugins/blob/main/monitoring/LICENSE). Third-party components and trademark notices are listed in [NOTICE](https://github.com/batuhancikrikci/headlamp-plugins/blob/main/monitoring/NOTICE).

This is an independent project; it is not affiliated with or endorsed by the Headlamp project or the projects it works with. Kubernetes, Headlamp, Prometheus, Alertmanager and Thanos are trademarks of their respective owners and are used only to identify the software this plugin works with.

### Contributing

Open an [issue](https://github.com/batuhancikrikci/headlamp-plugins/issues) for bugs and ideas. The contribution guidelines are in [CONTRIBUTING.md](https://github.com/batuhancikrikci/headlamp-plugins/blob/main/CONTRIBUTING.md) and security reports are handled as described in [SECURITY.md](https://github.com/batuhancikrikci/headlamp-plugins/blob/main/SECURITY.md).

---

## Turkce

**kube-prometheus-stack** veya **Prometheus Operator** çalıştıran kümeler için bir
[Headlamp](https://headlamp.dev) eklentisi. Kenar çubuğuna bir **Monitoring** bölümü ekler.

Hedef sürümler: kurulu `monitoring.coreos.com` CRD'leriyle **Headlamp ≥ 0.45.0**.

### Özellikler

- **Genel bakış**: bileşen sağlığı, önem derecesine göre aktif alarmlar, hedef sağlığı, aktif
  silence'lar, kaynak sayıları ve hiçbir Prometheus veya Alertmanager örneği tarafından seçilmeyen (dolayısıyla atıl
  kalan) kaynakların listesi.
- **Alerting**: Alertmanager durumlarıyla (susturulmuş veya bastırılmış, alıcılarıyla) aktif alarmlar,
  `PrometheusRule`'larına bağlı alarm ve kayıt kuralları ve silence'lar (oluşturma, düzenleme,
  yeniden oluşturma, sonlandırma; etkilenecek alarmların önizlemesiyle).
- **Metrics**: metrik adı tamamlama, sorgu geçmişi, grafik, tablo ve ham görünümler, zaman aralığı
  seçimi, otomatik yenileme ve paylaşılabilir bağlantılarla zenginleştirilmiş PromQL gezgini.
- **Targets**: havuzlara göre gruplanmış ve onları oluşturan ServiceMonitor, PodMonitor, Probe veya
  ScrapeConfig'e bağlanan scrape hedefleri.
- **10 CRD'nin tamamı**: Prometheus, Alertmanager, ServiceMonitor, PodMonitor, Probe, ScrapeConfig,
  PrometheusRule, AlertmanagerConfig, PrometheusAgent ve ThanosRuler; her biri liste ve detay
  görünümüyle.

#### Kaynaklar arası referanslar

Eklenti seçicileri operatörün kendi semantiğiyle değerlendirir: nil kaynak seçicisi hiçbir şey
seçmez, nil namespace seçicisi "kendi namespace'i" demektir ve `{}` her şeyi seçer. Buna göre şunları
gösterir:

- bir kaynağı hangi iş yüklerinin seçtiği ve hiçbiri seçmiyorsa hangi etiketlerin eksik olduğu
  (örneğin kube-prometheus-stack'in `release` etiketi);
- bir Prometheus veya Alertmanager'ın seçtiği her şey;
- bir monitor'ün eşleştiği Service veya Pod'lar ve uç nokta (endpoint) portlarının geçerli ve tanımlı olup olmadığı;
- monitor başına canlı scrape hedefleri ve `PrometheusRule` başına canlı kural durumu;
- Headlamp'in Service ve Pod sayfalarında bir **Monitoring** bölümü, Map görünümünde bir
  **Monitoring** kaynağı ve tür ikonları.

#### Formlar ve sihirbazlar

**Create** düğmesi (tür destekliyorsa) sihirbazı ya da formu açar; menüsü ayrıca "Create with form"
ve "Create from YAML" sunar. Editör penceresinde Wizard/Form, YAML ve Documentation sekmeleri
vardır; form ve YAML iki yönlü senkrondur. Detay sayfalarında "Edit with form" eylemi bulunur.

| Kaynak                                                    | Editör                                                                                                                                                                                                                           |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ServiceMonitor / PodMonitor                               | Sihirbaz: var olan bir Service veya Pod seçin; seçici ve portlar otomatik dolar; canlı eşleşme önizlemesi; endpoint'ler (Secret seçiciyle kimlik doğrulama); tek tıkla "eksik etiketleri ekle" içeren Prometheus seçim kontrolü. |
| PrometheusRule                                            | Grup ve kural editörü, canlı Prometheus'a karşı **Test query**, önem derecesi ve annotation yardımcıları.                                                                                                                        |
| AlertmanagerConfig                                        | Sihirbaz: Secret referanslı alıcılar (Slack, Email, Webhook, PagerDuty, Teams, Telegram, Opsgenie), yönlendirme ağacı, inhibit kuralları, Alertmanager seçim kontrolü.                                                           |
| Prometheus / Alertmanager / PrometheusAgent / ThanosRuler | Bölümlü form: açık None/All/Matching semantiğiyle seçiciler, depolama, kaynaklar, harici etiketler.                                                                                                                              |
| Probe / ScrapeConfig                                      | Kompakt formlar; gelişmiş alanlar YAML sekmesinden düzenlenir.                                                                                                                                                                   |

Helm tarafından yönetilen bir nesneyi düzenlediğinizde eklenti, bir sonraki `helm upgrade`'in
değişikliklerinizin üzerine yazacağı konusunda uyarır.

### Ekran görüntüleri

**Genel bakış**

![Genel bakış](https://raw.githubusercontent.com/batuhancikrikci/headlamp-plugins/main/monitoring/docs/screenshots/overview.jpg)

**Alerting**

![Alerting](https://raw.githubusercontent.com/batuhancikrikci/headlamp-plugins/main/monitoring/docs/screenshots/alerting.jpg)

**ServiceMonitor sihirbazı**

![ServiceMonitor sihirbazı](https://raw.githubusercontent.com/batuhancikrikci/headlamp-plugins/main/monitoring/docs/screenshots/monitor-wizard.jpg)

### Gereksinimler

- Headlamp **0.45.0** veya üstü ve kurulu `monitoring.coreos.com` CRD'leri.
- İzleme CRD'lerinde `list`/`watch`; canlı veriler için Prometheus ve Alertmanager namespace'lerinde `services/proxy` üzerinde `get`. Ayrıntılı RBAC örneği [Yetkiler](#yetkiler) bölümünde.

### Kurulum

#### Headlamp eklenti kataloğundan (Artifact Hub)

Eklenti [Artifact Hub](https://artifacthub.io/packages/headlamp/batuhancikrikci-headlamp-plugins/monitoring) üzerinde yayınlanır. Headlamp masaüstü uygulamasında eklenti
kataloğunu açın, **Monitoring** araması yapın ve eklentiyi kurun. Katalog varsayılan olarak yalnızca resmî (official) eklentileri gösterir; bu eklentiyi görmek için
katalogdaki **Only Official** anahtarını (ya da ayarlarındaki **Display only Official Plugins** seçeneğini) kapatın.

#### Elle kurulum

[GitHub Releases](https://github.com/batuhancikrikci/headlamp-plugins/releases) sayfasından `monitoring-<sürüm>.tar.gz` dosyasını indirin, SHA-256
sağlama toplamını (checksum) `.sha256` dosyasıyla doğrulayın ve Headlamp eklenti dizinine açın:

| Platform | Eklenti dizini                                                                                      |
| -------- | --------------------------------------------------------------------------------------------------- |
| Linux    | `~/.config/Headlamp/plugins/` (varsa `~/.local/share/Headlamp/plugins/`)                            |
| macOS    | `~/Library/Application Support/Headlamp/plugins/` (yoksa `~/Library/Preferences/Headlamp/plugins/`) |
| Windows  | `%APPDATA%\Headlamp\Config\plugins\` (varsa `%LOCALAPPDATA%\Headlamp\Data\plugins\`)                |

```bash
tar -xzf monitoring-*.tar.gz -C ~/.config/Headlamp/plugins/
```

Dizinde `monitoring/main.js` ve `monitoring/package.json` bulunmalıdır. Ardından Headlamp'i yeniden
yükleyin (Ctrl+Shift+R / Cmd+Shift+R).

Paketin bu depodaki sürüm iş akışıyla derlendiğini, derleme kaynağı kanıtını
[GitHub CLI](https://cli.github.com) ile denetleyerek doğrulayabilirsiniz:
`gh attestation verify monitoring-<sürüm>.tar.gz --repo batuhancikrikci/headlamp-plugins`.

#### Kaynaktan kurulum

```bash
npm ci
npm run deploy        # ikonlar, tip denetimi, lint, testler, derleme, kurulum
```

`npm run deploy` eklentiyi Headlamp masaüstü uygulamasının eklenti dizinine, `headlamp-plugin start`
ile aynı kuralla bulduğu dizine kurar. Başka bir dizin için `HEADLAMP_PLUGINS_DIR` ayarlayın;
denetimleri atlamak için `npm run deploy:fast` kullanın. Önceki sürüm atomik olarak değiştirilir ve
betik, Headlamp'in onun yerine yükleyebileceği başka kopyalar hakkında uyarır.

#### Küme içi Headlamp

Headlamp Helm chart'ının eklenti yöneticisiyle eklenti Artifact Hub'dan kurulabilir:

```yaml
pluginsManager:
  enabled: true
  configContent: |
    plugins:
      - name: monitoring
        source: https://artifacthub.io/packages/headlamp/batuhancikrikci-headlamp-plugins/monitoring
```

`version` alanı yazılmazsa en son sürüm kurulur; bir sürümü sabitlemek için `source` altına
`version: <x.y.z>` ekleyin.

Ya da `npm run package` ile üretilen tarball'ı Headlamp sunucusuna `-plugins-dir` ile verilen dizine
(resmî imajda `/headlamp/plugins`) bir init container ile veya özel bir imajla açın:

```dockerfile
FROM node:20-alpine AS build
WORKDIR /plugin
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && cp package.json dist/

FROM ghcr.io/headlamp-k8s/headlamp:v0.45.0
COPY --from=build /plugin/dist /headlamp/plugins/monitoring
```

### Yetkiler

- `monitoring.coreos.com` kaynaklarında `list`/`watch`.
- Prometheus ve Alertmanager namespace'lerinde `services/proxy` üzerinde `get`. Canlı veriler
  (alarmlar, kurallar, hedefler, metrikler, silence'lar) API sunucusunun service proxy'si üzerinden
  gelir.
- İsteğe bağlı: `list namespaces` (etiket tabanlı namespace seçicileri için) ve ilgili namespace'te
  `list secrets` (Secret seçici ve eksik Secret kontrolleri için). Bu izinler olmadan da arayüz hata vermeden esnekçe
  çalışmaya devam eder.

#### Genel bakış sayfası için RBAC (salt okunur)

Genel bakış sayfası küme genelinde şunları okur:

| Ne                                                      | API                                      | Neden                                                                                     |
| ------------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| 10 izleme CRD'sinin tamamı                              | `monitoring.coreos.com`: `list`, `watch` | kaynak kartları, sağlık tablosu, dikkat gerektirenler listesi                             |
| Namespace'ler                                           | core: `list`, `watch`                    | etiket tabanlı namespace seçicilerinin değerlendirilmesi (isteğe bağlı; yetki yoksa "bilinmiyor" olarak işaretlenir) |
| Prometheus/Alertmanager namespace'lerindeki Service'ler | core: `list`                             | her örneğin önündeki Service'in bulunması                                                 |
| Prometheus/Alertmanager HTTP API'leri                   | core `services/proxy`: `get`             | canlı durum: alarmlar, hedefler, silence'lar, yapılandırma yeniden yükleme                |

API keşfi (`/apis/monitoring.coreos.com`) varsayılan `system:discovery` rolüyle kimliği doğrulanmış
her kullanıcıya açıktır. Yerleşik `view` rolü ne izleme CRD'lerini ne de `services/proxy`'yi kapsar,
bu yüzden ayrı bir rol verin:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: headlamp-monitoring-viewer
rules:
  - apiGroups: ['monitoring.coreos.com']
    resources:
      - prometheuses
      - prometheusagents
      - alertmanagers
      - thanosrulers
      - servicemonitors
      - podmonitors
      - probes
      - scrapeconfigs
      - prometheusrules
      - alertmanagerconfigs
    verbs: ['get', 'list', 'watch']
  - apiGroups: ['']
    resources: ['namespaces', 'services']
    verbs: ['get', 'list', 'watch']
  - apiGroups: ['']
    resources: ['services/proxy']
    verbs: ['get']
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: headlamp-monitoring-viewer
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: headlamp-monitoring-viewer
subjects:
  - kind: Group
    name: monitoring-viewers # or a User / ServiceAccount
    apiGroup: rbac.authorization.k8s.io
```

`services/proxy` yetkisi ClusterRole kuralı yerine bir Role ve RoleBinding ile izleme namespace'iyle
sınırlanabilir. Silence oluşturmak veya sonlandırmak ayrıca Alertmanager servisi için
`services/proxy` üzerinde `create` ve `delete` gerektirir. İzleme kaynaklarını düzenlemek yukarıdaki
CRD'lerde `create`, `update`, `patch` ve `delete` gerektirir.

### Yapılandırma

Prometheus ve Alertmanager özel kaynaklarından bulunur: eklenti örneğin pod'larına yönlendiren Service'i seçer ve `routePrefix` / `externalUrl` değerlerini dikkate alır. Kümede birden fazla örnek varsa sayfada birini seçin. Thanos Query veya başka özel servisler için **Settings → Plugins → monitoring** altında elle bir uç nokta tanımlayın.

### Uyumluluk

| Bileşen             | Sürüm                                           |
| ------------------- | ----------------------------------------------- |
| Headlamp            | ≥ 0.45.0 (`@kinvolk/headlamp-plugin` 0.14)      |
| Prometheus Operator | `monitoring.coreos.com` (kube-prometheus-stack) |

API sürümleri çalışma zamanında keşfedilir; tabloda geliştirme ve test sırasında kullanılan sürümler yer alır.

### Geliştirme

Node.js **20.11+** ve npm **10+** gerekir. Eklenti dizininde:

```bash
npm ci
npm start             # her değişiklikte derler ve sonucu yerel Headlamp'e kopyalar
```

| Komut                               | Ne yapar                                             |
| ----------------------------------- | ---------------------------------------------------- |
| `npm start`                         | İzleme modu; her derleme yerel Headlamp'e kopyalanır |
| `npm run build`                     | `dist/` altında üretim paketi                        |
| `npm run check`                     | Tip denetimi, lint ve birim testleri                 |
| `npm run tsc`                       | Tip denetimi (strict)                                |
| `npm run lint` / `npm run lint-fix` | ESLint, sıfır uyarı                                  |
| `npm run format`                    | Prettier                                             |
| `npm test`                          | Vitest birim testleri                                |
| `npm run storybook`                 | Bileşen hikâyeleri                                   |
| `npm run package`                   | Dağıtım için `monitoring-<sürüm>.tar.gz`             |
| `npm run deploy` / `deploy:fast`    | Derleyip yerel Headlamp masaüstüne kurar             |

İkonlar pakete gömülüdür, eklenti internet erişimi olmadan çalışır: `npm run icons`, `src/` içinde
kullanılan her `mdi:` ve `simple-icons:` kimliğini `src/icons/bundle.json` dosyasına toplar
(`start`, `build`, `package` ve `storybook` komutları öncelikli olarak bu adımı çalıştırır).

`src/common/` bu depodaki tüm eklentilerde ortak olan yapı taşlarını içerir (durum ekranları, hata
yakalama, CRD dokümantasyonu, form alanları, editör ve sihirbazlar). Kopyalar her eklentide tamamen
aynıdır; `src/plugin.ts` bu eklentiyi onlara tanıtır.

#### Dosya yapısı

```text
src/
  index.tsx                 Kayıtlar (kenar çubuğu, rotalar, harita, detay bölümleri, ayarlar)
  plugin.ts                 Eklentinin kimliği (src/common tarafından kullanılır)
  common/                   Ortak yapı taşları, bu depodaki tüm eklentilerde tamamen aynı
  icons/                    Üretilen ikon paketi
  resources/crds.ts         KubeObject sınıfları (apiVersion dizileriyle çoklu sürüm)
  utils/                    Saf mantık + testler: seçiciler, eşleştiriciler, ilişkiler, keşif, API istemcisi
  hooks/                    Polling, uç nokta keşfi, CRD kullanılabilirliği, iş yükleri
  components/common/        Temaya uyumlu chip'ler, seçiciler, geri bildirim, kod blokları
  components/forms/         Form penceresi, sihirbazlar ve alan editörleri
  components/relations/     "Seçenler" görünümleri
  pages/                    Genel bakış, alerting, metrikler, hedefler, kaynak listeleri/detayları
  integrations/             Service/Pod bölümü, harita kaynağı, eklenti ayarları
scripts/
  build-icons.mjs           Çevrimdışı ikon paketi (src/icons/bundle.json)
  deploy.mjs                Derler ve yerel Headlamp masaüstüne kurar
```

### Lisans

[Apache License 2.0](https://github.com/batuhancikrikci/headlamp-plugins/blob/main/monitoring/LICENSE) ile lisanslanmıştır. Üçüncü taraf bileşenler ve marka bildirimleri [NOTICE](https://github.com/batuhancikrikci/headlamp-plugins/blob/main/monitoring/NOTICE) dosyasındadır.

Bu bağımsız bir projedir; Headlamp projesiyle ya da birlikte çalıştığı projelerle bağlantılı değildir ve onlar tarafından onaylanmamıştır. Kubernetes, Headlamp, Prometheus, Alertmanager ve Thanos ilgili sahiplerinin ticari markalarıdır; yalnızca eklentinin birlikte çalıştığı yazılımı tanımlamak için kullanılır.

### Katkıda bulunma

Hata bildirimleri ve öneriler için [issue](https://github.com/batuhancikrikci/headlamp-plugins/issues) açın. Katkı kuralları [CONTRIBUTING.md](https://github.com/batuhancikrikci/headlamp-plugins/blob/main/CONTRIBUTING.md), güvenlik bildirimleri [SECURITY.md](https://github.com/batuhancikrikci/headlamp-plugins/blob/main/SECURITY.md) içindedir.
