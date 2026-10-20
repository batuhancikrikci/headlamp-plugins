# Inference Hub — Headlamp plugin

[English](#english) | [Türkçe](#türkçe)

---

## English

Inference Hub turns [Headlamp](https://headlamp.dev) into a console for running LLMs on Kubernetes. It brings
**KServe**, **llm-d** and the **Gateway API Inference Extension**, **vLLM** and the **NVIDIA GPU
Operator** together under one sidebar entry. You can deploy models from a catalog, check GPU
capacity, watch serving metrics and chat with your endpoints.

Inference Hub works only with Kubernetes objects and the Kubernetes API. It keeps no database and runs no
backend of its own, and it makes no network calls beyond your cluster unless you configure a direct
Prometheus URL.

### Features

| Page                  | What it does                                                                                                                                                                                                                                                                                                                                         |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Command Center**    | Overview of the platform: endpoint health, GPU capacity and use, top models by traffic, recent warnings from AI workloads, catalog and routing summaries, and a readiness check for every stack with install commands.                                                                                                                               |
| **Model Catalog**     | The models your teams may deploy. Each entry is a KServe `LocalModelCache`, so the weights are cached on your GPU nodes ahead of time. Cards show the provider, family, size and quantization, the cache status per node and the endpoints that use the model. You can add models with a form and deploy any of them in one click.                   |
| **Model Endpoints**   | `LLMInferenceService` and `InferenceService` objects in one list. The detail pages show the model, cache status, serving settings, access URLs, routing, containers and conditions. They also have tabs for live serving metrics, pods, events and logs, plus edit, stop/resume and delete actions.                                                  |
| **Deploy wizard**     | Five steps: model (from the catalog or `hf://`, `s3://`, `pvc://`, `oci://`), serving (LLM service with llm-d routing, or InferenceService), resources (GPU memory estimate and a live placement check against the GPU inventory), scaling, and review. The review step shows editable YAML, validates it with a server-side dry run and deploys it. |
| **Playground**        | Chat with any ready endpoint or vLLM pod through the Kubernetes service or pod proxy. Answers stream in as they are generated (SSE, with fallback), and each message shows TTFT, tokens and tokens/s. Also: Markdown and code rendering, reasoning display, "Copy as curl" and side-by-side comparison of two models.                                |
| **Inference Gateway** | `InferencePool`s (GA `inference.networking.k8s.io`), `InferenceObjective`s and `InferenceModelRewrite`s, shown as a Gateway → HTTPRoute → InferencePool → endpoint picker → model servers diagram for each pool.                                                                                                                                     |
| **Serving Profiles**  | `LLMInferenceServiceConfig` presets and your own profiles: what each one configures and which services use it. A form creates new profiles.                                                                                                                                                                                                          |
| **vLLM Engines**      | Every vLLM model server with live metrics: running and waiting requests, KV cache, TTFT, inter-token latency, tokens/s and prefix cache hit rate. It handles the metric names of different vLLM versions.                                                                                                                                            |
| **GPU Fleet**         | GPU inventory per node and per GPU model: MIG, time-slicing and MPS, driver and CUDA versions, DRA devices, GPUs in use per pod and endpoint, DCGM utilization, memory, temperature and power, and GPU Operator health.                                                                                                                              |
| **Model Storage**     | Local model cache node groups (capacity), download status per node, and `ClusterStorageContainer`s.                                                                                                                                                                                                                                                  |
| **Settings**          | Prometheus endpoint (auto-discovered with Thanos preferred when present, a service, or a URL), default namespace, refresh interval and feature switches.                                                                                                                                                                                             |

Every YAML editor, form and wizard has **Documentation** generated from the CRD schema in your
cluster, so it always matches the installed version. You can browse nested fields with
breadcrumbs, search across all levels, and see types, required fields, allowed values, defaults,
limits and CEL validation rules. Fields set in the object you are editing are marked, and each kind
has a short introduction with a link to its upstream documentation.

Inference Hub also adds sections to native Headlamp pages: a **GPU** section on Node pages, and an **AI
workload** section with live engine metrics on Pod pages.

### Screenshots

**Command Center**

![Command Center](https://raw.githubusercontent.com/batuhancikrikci/headlamp-plugins/main/inference-hub/docs/screenshots/command-center.jpg)

**Model Catalog**

![Model Catalog](https://raw.githubusercontent.com/batuhancikrikci/headlamp-plugins/main/inference-hub/docs/screenshots/model-catalog.jpg)

**Deploy wizard**

![Deploy wizard](https://raw.githubusercontent.com/batuhancikrikci/headlamp-plugins/main/inference-hub/docs/screenshots/deploy-wizard.jpg)

**Playground**

![Playground](https://raw.githubusercontent.com/batuhancikrikci/headlamp-plugins/main/inference-hub/docs/screenshots/playground.jpg)

### Requirements

- Headlamp **0.45.0** or newer.
- Every component is optional; pages for missing components explain what is missing and how to install it.
- Optional: Prometheus (or Thanos, Mimir, VictoriaMetrics) scraping the DCGM exporter and vLLM pods. Without Prometheus, vLLM metrics are read through the pod proxy (up to 25 engines).
- The required permissions are listed in the [Permissions](#permissions) section.

### Installation

#### From the Headlamp plugin catalog (Artifact Hub)

The plugin is published on [Artifact Hub](https://artifacthub.io/packages/headlamp/batuhancikrikci-headlamp-plugins/inference-hub). In the Headlamp desktop app, open the plugin
catalog, search for **Inference Hub** and install it. The catalog shows only official plugins by default; turn off the **Only Official** switch in the
catalog (or **Display only Official Plugins** in its settings) to see this plugin.

#### Manual installation

Download `inference-hub-<version>.tar.gz` from [GitHub Releases](https://github.com/batuhancikrikci/headlamp-plugins/releases), compare its SHA-256
checksum with the `.sha256` file and extract it into the Headlamp plugins directory:

| Platform | Plugins directory                                                                                       |
| -------- | ------------------------------------------------------------------------------------------------------- |
| Linux    | `~/.config/Headlamp/plugins/` (or `~/.local/share/Headlamp/plugins/` when it exists)                    |
| macOS    | `~/Library/Application Support/Headlamp/plugins/` (otherwise `~/Library/Preferences/Headlamp/plugins/`) |
| Windows  | `%APPDATA%\Headlamp\Config\plugins\` (or `%LOCALAPPDATA%\Headlamp\Data\plugins\` when it exists)        |

```bash
tar -xzf inference-hub-*.tar.gz -C ~/.config/Headlamp/plugins/
```

The directory must contain `inference-hub/main.js` and `inference-hub/package.json`. Reload Headlamp afterwards
(Ctrl+Shift+R / Cmd+Shift+R).

To confirm that the tarball was built from this repository by its release workflow, verify its
build provenance with the [GitHub CLI](https://cli.github.com):
`gh attestation verify inference-hub-<version>.tar.gz --repo batuhancikrikci/headlamp-plugins`.

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
      - name: inference-hub
        source: https://artifacthub.io/packages/headlamp/batuhancikrikci-headlamp-plugins/inference-hub
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
COPY --from=build /plugin/dist /headlamp/plugins/inference-hub
```

### Permissions

Inference Hub shows only what your Kubernetes user may see. It disables actions you may not perform and
explains why (checked with `SelfSubjectAccessReview`).

| Feature                        | Needs                                                                                                          |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Pages                          | `get/list` on the resources shown; `nodes`, `pods` and `events` for GPU Fleet, vLLM Engines and Command Center |
| Deploy, edit, delete           | `create/update/patch/delete` on the resource                                                                   |
| Playground                     | `create` on `services/proxy` (endpoints) or `pods/proxy` (vLLM pods)                                           |
| Pod metrics without Prometheus | `get` on `pods/proxy`                                                                                          |
| Prometheus through the cluster | `get` on `services/proxy` in the Prometheus namespace                                                          |
| Documentation views            | `get` on `customresourcedefinitions` (`apiextensions.k8s.io`)                                                  |

### Configuration

In Headlamp under **Settings → Plugins → inference-hub**: the Prometheus endpoint (auto-discovered with Thanos preferred, a service, or a URL), the default namespace, the refresh interval and feature switches. Display name, description, license and tags of catalog entries are read from the `inference-hub.batuhancikrikci.github.io/*` annotations.

### Compatibility

Inference Hub finds the API group and version of every resource at runtime, so no version is hard-coded.
It was built against:

| Component                       | Version                                   | APIs used                                                                                                                                                     |
| ------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Headlamp                        | 0.45 (`@kinvolk/headlamp-plugin` 0.14)    |                                                                                                                                                               |
| KServe                          | 0.20 (0.21 RC)                            | `InferenceService`, `LLMInferenceService`, `LLMInferenceServiceConfig`, `LocalModelCache`, `LocalModelNode`, `LocalModelNodeGroup`, `ClusterStorageContainer` |
| Gateway API Inference Extension | 1.6                                       | `InferencePool` (`inference.networking.k8s.io`; the experimental copies KServe also creates are not shown)                                                    |
| llm-d                           | 0.9                                       | `InferenceObjective`, `InferenceModelRewrite` (`llm-d.ai` and `inference.networking.x-k8s.io`)                                                                |
| Gateway API                     | 1.5                                       | `Gateway`, `HTTPRoute`                                                                                                                                        |
| NVIDIA DRA driver               | 0.5                                       | GPUs published as `ResourceSlice`s (driver `gpu.nvidia.com`)                                                                                                  |
| NVIDIA GPU Operator             | 26.x                                      | `ClusterPolicy`, `NVIDIADriver`, GPU Feature Discovery labels, DCGM exporter                                                                                  |
| vLLM                            | 0.30 (older V0 metric names are read too) | Prometheus metrics                                                                                                                                            |

All components are optional. Pages for missing components explain what is missing and how to install it.

### Conventions

- **Catalog entries** are `LocalModelCache` objects. Display details live in annotations:
  - `inference-hub.batuhancikrikci.github.io/display-name`
  - `inference-hub.batuhancikrikci.github.io/description`
  - `inference-hub.batuhancikrikci.github.io/license`
  - `inference-hub.batuhancikrikci.github.io/tags` (comma separated)
- **The model cache is used only when the URI matches exactly.** KServe uses a cached model only if
  the endpoint's model URI is identical to the entry's `sourceModelUri`. The Deploy wizard copies it
  verbatim.
- **Objects created by Inference Hub** carry `app.kubernetes.io/managed-by: inference-hub`. Serving profile
  descriptions use `inference-hub.batuhancikrikci.github.io/description`.
- **Gated Hugging Face models and S3 credentials:** attach a secret with `HF_TOKEN` (or the S3 keys)
  to a service account and pick that account in the wizard. KServe passes it to the model download.

### Troubleshooting

- **Playground says "stream buffered".** A proxy between Headlamp and the model delivered the answer
  in one piece. Chat still works; only live token streaming is lost.
- **Playground cannot connect to an HTTPS endpoint.** KServe enables TLS on the model server when
  its global TLS setting is on. The Playground uses the `https:` proxy scheme automatically when the
  service port is named `https`.
- **No GPU metrics.** Enable the DCGM exporter's ServiceMonitor in the GPU Operator and configure
  Prometheus under Settings.

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
| `npm run package`                   | `inference-hub-<version>.tar.gz` for distribution         |
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
  index.tsx                 Registrations (sidebar, routes, native page sections, settings)
  plugin.ts                 Identity of the plugin, used by src/common
  common/                   Shared building blocks, identical in every plugin of this repository
  icons/                    Product icon, generated icon bundle
  api/                      Discovery, polling store, mutations, RBAC, Prometheus, DCGM, OpenAI client
  resources/                API definitions and pure models (endpoints, pods, GPUs, engines, catalog, routing)
  hooks/                    React hooks over the API layer
  components/               Shared UI (YAML editors, badges, charts, detail panels, kind introductions)
  pages/                    Product pages
  wizards/                  Deploy wizard, serving profile and catalog forms
  integrations/             Sections on native Headlamp pages
  utils/                    Parsing and calculations (model info, quantities, health, metrics, Markdown, GPU fit)
scripts/
  build-icons.mjs           Offline icon bundle (src/icons/bundle.json)
  deploy.mjs                Build and install into the local Headlamp desktop app
```

### License

Licensed under the [Apache License 2.0](https://github.com/batuhancikrikci/headlamp-plugins/blob/main/inference-hub/LICENSE). Third-party components and trademark notices are listed in [NOTICE](https://github.com/batuhancikrikci/headlamp-plugins/blob/main/inference-hub/NOTICE).

This is an independent project; it is not affiliated with or endorsed by the Headlamp project or the projects it works with. Kubernetes, Headlamp, KServe, llm-d, vLLM, NVIDIA, Hugging Face and the names and logos of the model providers are trademarks of their respective owners and are used only to identify the software this plugin works with.

### Contributing

Open an [issue](https://github.com/batuhancikrikci/headlamp-plugins/issues) for bugs and ideas. The contribution guidelines are in [CONTRIBUTING.md](https://github.com/batuhancikrikci/headlamp-plugins/blob/main/CONTRIBUTING.md) and security reports are handled as described in [SECURITY.md](https://github.com/batuhancikrikci/headlamp-plugins/blob/main/SECURITY.md).

---

## Türkçe

Inference Hub, [Headlamp](https://headlamp.dev)'i Kubernetes üzerinde LLM çalıştırmak için bir konsola
dönüştürür. **KServe**, **llm-d** ve **Gateway API Inference Extension**, **vLLM** ve **NVIDIA GPU
Operator**'ü tek bir kenar çubuğu girdisi altında bir araya getirir. Katalogdan model dağıtabilir, GPU
kapasitesini kontrol edebilir, servis metriklerini izleyebilir ve endpoint'lerinizle sohbet
edebilirsiniz.

Inference Hub yalnızca Kubernetes nesneleri ve Kubernetes API'si ile çalışır. Veritabanı tutmaz,
kendine ait bir arka uç çalıştırmaz ve doğrudan bir Prometheus URL'si yapılandırmadığınız sürece
kümeniz dışına ağ isteği yapmaz.

### Özellikler

| Sayfa                 | Ne yapar                                                                                                                                                                                                                                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Command Center**    | Platformun genel görünümü: endpoint sağlığı, GPU kapasitesi ve kullanımı, trafiğe göre en çok kullanılan modeller, AI iş yüklerinden son uyarılar, katalog ve yönlendirme özetleri ve her stack için kurulum komutlarıyla hazır olma denetimi.                                                                                              |
| **Model Catalog**     | Takımların dağıtabileceği modeller. Her kayıt bir KServe `LocalModelCache`'tir, böylece ağırlıklar GPU node'larınızda önceden önbelleğe alınır. Kartlar sağlayıcıyı, aileyi, boyutu ve kuantizasyonu, node başına önbellek durumunu ve modeli kullanan endpoint'leri gösterir. Modeller bir formla eklenebilir ve tek tıkla dağıtılabilir.  |
| **Model Endpoints**   | `LLMInferenceService` ve `InferenceService` nesneleri tek listede. Detay sayfaları modeli, önbellek durumunu, sunum ayarlarını, erişim URL'lerini, yönlendirmeyi, container'ları ve koşulları gösterir; canlı metrik, pod, olay ve log sekmeleriyle düzenleme, durdurma/sürdürme ve silme eylemleri sunar.                                  |
| **Deploy wizard**     | Beş adım: model (katalogdan ya da `hf://`, `s3://`, `pvc://`, `oci://`), sunum (llm-d yönlendirmeli LLM servisi veya InferenceService), kaynaklar (GPU bellek tahmini ve GPU envanterine karşı canlı yerleşim kontrolü), ölçekleme ve inceleme. İnceleme adımı düzenlenebilir YAML gösterir, sunucu tarafı dry run ile doğrular ve dağıtır. |
| **Playground**        | Hazır herhangi bir endpoint veya vLLM pod'u ile Kubernetes service ya da pod proxy üzerinden sohbet. Yanıtlar üretildikçe akar (SSE, yedekli); her mesaj TTFT, token ve token/s gösterir. Ayrıca Markdown ve kod gösterimi, akıl yürütme gösterimi, "Copy as curl" ve iki modelin yan yana karşılaştırılması.                               |
| **Inference Gateway** | `InferencePool`'lar (GA `inference.networking.k8s.io`), `InferenceObjective`'ler ve `InferenceModelRewrite`'lar; her havuz için Gateway → HTTPRoute → InferencePool → endpoint picker → model sunucuları diyagramı.                                                                                                                         |
| **Serving Profiles**  | `LLMInferenceServiceConfig` ön ayarları ve kendi profilleriniz: her birinin neyi yapılandırdığı ve hangi servislerin kullandığı. Yeni profiller bir formla oluşturulur.                                                                                                                                                                     |
| **vLLM Engines**      | Canlı metrikleriyle her vLLM model sunucusu: çalışan ve bekleyen istekler, KV cache, TTFT, token'lar arası gecikme (inter-token latency), token/s ve prefix cache isabet oranı. Farklı vLLM sürümlerinin metrik adlarını tanır.                                                                                                                                   |
| **GPU Fleet**         | Node ve GPU modeli başına GPU envanteri: MIG, time-slicing ve MPS, sürücü ve CUDA sürümleri, DRA cihazları, pod ve endpoint başına kullanılan GPU'lar, DCGM kullanımı, bellek, sıcaklık ve güç ile GPU Operator sağlığı.                                                                                                                    |
| **Model Storage**     | Yerel model önbelleği node grupları (kapasite), node başına indirme durumu ve `ClusterStorageContainer`'lar.                                                                                                                                                                                                                                |
| **Settings**          | Prometheus uç noktası, varsayılan namespace, yenileme aralığı ve özellik anahtarları.                                                                                                                                                                                                                                                       |

Her YAML editörü, form ve sihirbazda kümedeki CRD şemasından üretilen **dokümantasyon** bulunur, böylece
her zaman kurulu sürümle eşleşir: iç içe alanlarda gezinme, tüm seviyelerde arama, tipler, zorunlu
alanlar, izin verilen değerler, varsayılanlar, limitler ve CEL doğrulama kuralları. Düzenlenen
nesnede dolu alanlar işaretlenir ve her türün upstream dokümantasyonuna bağlantılı kısa bir tanıtımı vardır.

Inference Hub ayrıca yerel Headlamp sayfalarına bölümler ekler: Node sayfalarında bir **GPU** bölümü
ve Pod sayfalarında canlı engine metrikleriyle bir **AI iş yükü** bölümü.

### Ekran görüntüleri

**Command Center**

![Command Center](https://raw.githubusercontent.com/batuhancikrikci/headlamp-plugins/main/inference-hub/docs/screenshots/command-center.jpg)

**Model Catalog**

![Model Catalog](https://raw.githubusercontent.com/batuhancikrikci/headlamp-plugins/main/inference-hub/docs/screenshots/model-catalog.jpg)

**Deploy wizard**

![Deploy wizard](https://raw.githubusercontent.com/batuhancikrikci/headlamp-plugins/main/inference-hub/docs/screenshots/deploy-wizard.jpg)

**Playground**

![Playground](https://raw.githubusercontent.com/batuhancikrikci/headlamp-plugins/main/inference-hub/docs/screenshots/playground.jpg)

### Gereksinimler

- Headlamp **0.45.0** veya üstü.
- Bileşenlerin hepsi isteğe bağlıdır; eksik bileşenlerin sayfaları neyin eksik olduğunu ve nasıl kurulacağını açıklar.
- İsteğe bağlı: DCGM exporter ve vLLM pod'larını toplayan Prometheus (veya Thanos, Mimir, VictoriaMetrics). Prometheus yoksa vLLM metrikleri pod proxy üzerinden okunur (en fazla 25 engine).
- Gerekli yetkiler [Yetkiler](#yetkiler) bölümünde.

### Kurulum

#### Headlamp eklenti kataloğundan (Artifact Hub)

Eklenti [Artifact Hub](https://artifacthub.io/packages/headlamp/batuhancikrikci-headlamp-plugins/inference-hub) üzerinde yayınlanır. Headlamp masaüstü uygulamasında eklenti
kataloğunu açın, **Inference Hub** araması yapın ve eklentiyi kurun. Katalog varsayılan olarak yalnızca resmî (official) eklentileri gösterir; bu eklentiyi görmek için
katalogdaki **Only Official** anahtarını (ya da ayarlarındaki **Display only Official Plugins** seçeneğini) kapatın.

#### Elle kurulum

[GitHub Releases](https://github.com/batuhancikrikci/headlamp-plugins/releases) sayfasından `inference-hub-<sürüm>.tar.gz` dosyasını indirin, SHA-256
sağlama toplamını (checksum) `.sha256` dosyasıyla doğrulayın ve Headlamp eklenti dizinine açın:

| Platform | Eklenti dizini                                                                                      |
| -------- | --------------------------------------------------------------------------------------------------- |
| Linux    | `~/.config/Headlamp/plugins/` (varsa `~/.local/share/Headlamp/plugins/`)                            |
| macOS    | `~/Library/Application Support/Headlamp/plugins/` (yoksa `~/Library/Preferences/Headlamp/plugins/`) |
| Windows  | `%APPDATA%\Headlamp\Config\plugins\` (varsa `%LOCALAPPDATA%\Headlamp\Data\plugins\`)                |

```bash
tar -xzf inference-hub-*.tar.gz -C ~/.config/Headlamp/plugins/
```

Dizinde `inference-hub/main.js` ve `inference-hub/package.json` bulunmalıdır. Ardından Headlamp'i yeniden
yükleyin (Ctrl+Shift+R / Cmd+Shift+R).

Paketin bu depodaki sürüm iş akışıyla derlendiğini, derleme kaynağı kanıtını
[GitHub CLI](https://cli.github.com) ile denetleyerek doğrulayabilirsiniz:
`gh attestation verify inference-hub-<sürüm>.tar.gz --repo batuhancikrikci/headlamp-plugins`.

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
      - name: inference-hub
        source: https://artifacthub.io/packages/headlamp/batuhancikrikci-headlamp-plugins/inference-hub
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
COPY --from=build /plugin/dist /headlamp/plugins/inference-hub
```

### Yetkiler

Inference Hub yalnızca Kubernetes kullanıcınızın görebildiklerini gösterir. Yapamayacağınız
eylemleri devre dışı bırakır ve nedenini açıklar (`SelfSubjectAccessReview` ile denetlenir).

| Özellik                           | Gerekenler                                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Sayfalar                          | Gösterilen kaynaklarda `get/list`; GPU Fleet, vLLM Engines ve Command Center için `nodes`, `pods` ve `events` |
| Dağıtma, düzenleme, silme         | Kaynakta `create/update/patch/delete`                                                                         |
| Playground                        | `services/proxy` (endpoint'ler) veya `pods/proxy` (vLLM pod'ları) üzerinde `create`                           |
| Prometheus olmadan pod metrikleri | `pods/proxy` üzerinde `get`                                                                                   |
| Küme üzerinden Prometheus         | Prometheus namespace'inde `services/proxy` üzerinde `get`                                                     |
| Belge görünümleri                 | `customresourcedefinitions` (`apiextensions.k8s.io`) üzerinde `get`                                           |

### Yapılandırma

Headlamp'te **Settings → Plugins → inference-hub** altında: Prometheus uç noktası (Thanos varsa onu tercih eden otomatik keşif, bir service veya bir URL), varsayılan namespace, yenileme aralığı ve özellik anahtarları. Katalog kayıtlarının görünen adı, açıklaması, lisansı ve etiketleri `inference-hub.batuhancikrikci.github.io/*` annotation'larından okunur.

### Uyumluluk

Inference Hub her kaynağın API grubunu ve sürümünü çalışma zamanında bulur, bu yüzden hiçbir sürüm sabit
kodlanmamıştır. Şu sürümlerle geliştirildi:

| Bileşen                         | Sürüm                                  | Kullanılan API'ler                                                                                                                                            |
| ------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Headlamp                        | 0.45 (`@kinvolk/headlamp-plugin` 0.14) |                                                                                                                                                               |
| KServe                          | 0.20 (0.21 RC)                         | `InferenceService`, `LLMInferenceService`, `LLMInferenceServiceConfig`, `LocalModelCache`, `LocalModelNode`, `LocalModelNodeGroup`, `ClusterStorageContainer` |
| Gateway API Inference Extension | 1.6                                    | `InferencePool` (`inference.networking.k8s.io`; KServe'ün oluşturduğu deneysel kopyalar gösterilmez)                                                          |
| llm-d                           | 0.9                                    | `InferenceObjective`, `InferenceModelRewrite` (`llm-d.ai` and `inference.networking.x-k8s.io`)                                                                |
| Gateway API                     | 1.5                                    | `Gateway`, `HTTPRoute`                                                                                                                                        |
| NVIDIA DRA driver               | 0.5                                    | `ResourceSlice` olarak yayınlanan GPU'lar (driver `gpu.nvidia.com`)                                                                                           |
| NVIDIA GPU Operator             | 26.x                                   | `ClusterPolicy`, `NVIDIADriver`, GPU Feature Discovery etiketleri, DCGM exporter                                                                              |
| vLLM                            | 0.30 (eski V0 metrik adları da okunur) | Prometheus metrikleri                                                                                                                                         |

Tüm bileşenler isteğe bağlıdır. Eksik bileşenlerin sayfaları neyin eksik olduğunu ve nasıl kurulacağını açıklar.

### Kurallar

- **Katalog kayıtları** `LocalModelCache` nesneleridir. Görünen bilgiler annotation'lardadır:
  - `inference-hub.batuhancikrikci.github.io/display-name`
  - `inference-hub.batuhancikrikci.github.io/description`
  - `inference-hub.batuhancikrikci.github.io/license`
  - `inference-hub.batuhancikrikci.github.io/tags` (virgülle ayrılmış)
- **Model önbelleği yalnızca URI bire bir eşleştiğinde devreye girer.** KServe önbellekteki modeli ancak
  endpoint'in model URI'si kaydın `sourceModelUri` değeriyle aynıysa kullanır. Deploy wizard bu
  değeri olduğu gibi kopyalar.
- **Inference Hub'ın oluşturduğu nesneler** `app.kubernetes.io/managed-by: inference-hub` etiketini
  taşır. Sunum profili açıklamaları `inference-hub.batuhancikrikci.github.io/description` kullanır.
- **Erişimi kısıtlı Hugging Face modelleri ve S3 kimlik bilgileri:** `HF_TOKEN` (veya S3
  anahtarları) içeren bir secret'ı bir servis hesabına bağlayın ve sihirbazda o hesabı seçin; KServe
  bunu model indirmeye aktarır.

### Sorun giderme

- **Playground arayüzünde "stream buffered" uyarısı görüntülenmesi.** Headlamp ile model arasındaki bir proxy yanıtı tek parça
  hâlinde iletmiştir. Sohbet yine çalışır; yalnızca canlı token akışı kaybolur.
- **Playground bir HTTPS endpoint'ine bağlanamıyor.** KServe genel TLS ayarı açıkken model sunucusunda
  TLS'i etkinleştirir. Service portunun adı `https` ise Playground `https:` proxy şemasını otomatik
  kullanır.
- **GPU metrikleri yok.** GPU Operator'da DCGM exporter'ın ServiceMonitor'ünü etkinleştirin ve
  Prometheus'u Settings altında yapılandırın.

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
| `npm run package`                   | Dağıtım için `inference-hub-<sürüm>.tar.gz`          |
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
  index.tsx                 Kayıtlar (kenar çubuğu, rotalar, yerel sayfa bölümleri, ayarlar)
  plugin.ts                 Eklentinin kimliği (src/common tarafından kullanılır)
  common/                   Ortak yapı taşları, bu depodaki tüm eklentilerde tamamen aynı
  icons/                    Ürün ikonu, üretilen ikon paketi
  api/                      Keşif, polling store, mutasyonlar, RBAC, Prometheus, DCGM, OpenAI istemcisi
  resources/                API tanımları ve saf modeller (endpoint, pod, GPU, engine, katalog, yönlendirme)
  hooks/                    API katmanı üzerinde React hook'ları
  components/               Ortak arayüz (YAML editörleri, rozetler, grafikler, detay panelleri, tür tanıtımları)
  pages/                    Ürün sayfaları
  wizards/                  Deploy wizard, sunum profili ve katalog formları
  integrations/             Yerel Headlamp sayfalarındaki bölümler
  utils/                    Ayrıştırma ve hesaplamalar (model bilgisi, miktarlar, sağlık, metrikler, Markdown, GPU uyumu)
scripts/
  build-icons.mjs           Çevrimdışı ikon paketi (src/icons/bundle.json)
  deploy.mjs                Derler ve yerel Headlamp masaüstüne kurar
```

### Lisans

[Apache License 2.0](https://github.com/batuhancikrikci/headlamp-plugins/blob/main/inference-hub/LICENSE) ile lisanslanmıştır. Üçüncü taraf bileşenler ve marka bildirimleri [NOTICE](https://github.com/batuhancikrikci/headlamp-plugins/blob/main/inference-hub/NOTICE) dosyasındadır.

Bu bağımsız bir projedir; Headlamp projesiyle ya da birlikte çalıştığı projelerle bağlantılı değildir ve onlar tarafından onaylanmamıştır. Kubernetes, Headlamp, KServe, llm-d, vLLM, NVIDIA, Hugging Face ile model sağlayıcılarının adları ve logoları ilgili sahiplerinin ticari markalarıdır; yalnızca eklentinin birlikte çalıştığı yazılımı tanımlamak için kullanılır.

### Katkıda bulunma

Hata bildirimleri ve öneriler için [issue](https://github.com/batuhancikrikci/headlamp-plugins/issues) açın. Katkı kuralları [CONTRIBUTING.md](https://github.com/batuhancikrikci/headlamp-plugins/blob/main/CONTRIBUTING.md), güvenlik bildirimleri [SECURITY.md](https://github.com/batuhancikrikci/headlamp-plugins/blob/main/SECURITY.md) içindedir.
