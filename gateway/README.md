# Gateway API — Headlamp plugin

[English](#english) | [Türkçe](#türkçe)

---

## English

A [Headlamp](https://headlamp.dev) plugin for the Kubernetes
[Gateway API](https://gateway-api.sigs.k8s.io/) (`gateway.networking.k8s.io`). It replaces Headlamp's built-in "Gateway (beta)" pages with an
overview, a topology view, relationship-aware detail pages, guided forms and wizards.

It is developed against **Headlamp v0.45.0** and **Envoy Gateway v1.9** (Gateway API v1.6.1), and
works with any conformant Gateway API controller.

### Features

#### Navigation

- A top-level **Gateway API** sidebar entry (same icon as the built-in one, `mdi:lan-connect`).
  Headlamp's built-in "Gateway (beta)" menu is hidden, so there are no duplicate entries.
- One entry per kind below Overview and Topology. Kinds that are not installed in the current
  cluster are hidden.
- The plugin serves the same URLs as the built-in pages (`/gateways`, `/httproutes/…`), so links
  from the resource map, the global search and other plugins open the pages of this plugin.

#### Overview

- Installed Gateway API bundle version and channel, and how many kinds are served.
- One tile per kind with the number of resources and their health distribution.
- Totals of the `Accepted`, `Programmed` and `ResolvedRefs` conditions.
- **Needs attention**: failing conditions (with the controller's reason and message and a
  plain-language hint), cross-namespace references without a ReferenceGrant, backends that do
  not exist, routes without a parent, Gateways whose class does not exist.
- GatewayClasses with their controllers.

#### Topology

A left-to-right graph of **GatewayClass → Gateway → Listener → Route → Backend**:

- Health colouring per node; broken links (route not accepted by a listener, missing Service,
  reference without a grant) are drawn in red.
- Hover or focus a node to highlight the whole path through it; click to open its detail page.
- Namespace filter, text filter and an "only problems" switch.
- ListenerSets contribute their listeners to the Gateway they attach to.

The plugin also adds TLSRoute and ListenerSet (with their relations) to Headlamp's own resource
map, which already covers the other Gateway API kinds.

#### List and detail pages

Namespace-aware, searchable, sortable lists for every kind, and detail pages that explain the
resource instead of dumping its spec:

| Kind                         | Highlights                                                                                                                                                             |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GatewayClass                 | controller, Gateways using the class, supported features                                                                                                               |
| Gateway                      | listeners with TLS, allowed routes and per-listener status; attached routes with an "allowed by listeners" analysis; ListenerSets                                      |
| ListenerSet                  | parent Gateway (and whether it accepts the set), listeners, attached routes                                                                                            |
| HTTPRoute, GRPCRoute         | rules with readable matches and filters; backends with traffic share, Service / port existence and ReferenceGrant state; per-parent conditions and attachment analysis |
| TLSRoute, TCPRoute, UDPRoute | parents, backends, per-parent conditions                                                                                                                               |
| ReferenceGrant               | from / to, and the references that currently rely on the grant                                                                                                         |
| BackendTLSPolicy             | targets, validation settings, status per ancestor                                                                                                                      |

Events are shown on every detail page.

#### Create and edit

- **Every kind has a guided form and a YAML editor.** Both edit the same object: switching tabs
  never loses data, and fields the form has no input for are preserved.
- Validation next to the field (required fields, hostname rules, port ranges, enums and the
  cross-field rules of the Gateway API CRDs), sensible defaults and inline help.
- Documentation without leaving Headlamp: the book button on list and detail pages opens a side
  panel, and the editor has a Documentation tab. Both show a browsable field reference generated
  from the CRD schema of the cluster (types, required fields, allowed values, defaults and
  validation rules), and mark the fields that are set on the current object. Reading the schema
  requires permission to get CustomResourceDefinitions.
- Pickers for the objects in the cluster: GatewayClasses, Gateways and their listeners, Services
  and their ports, TLS Secrets, namespaces.
- Backend references offer, next to Service, the `Backend` kinds of any API group and the
  `InferencePool` kind the cluster serves (found through API discovery), with their objects in the
  backend namespace. Kinds outside the Kubernetes project groups (`*.k8s.io`, `*.x-k8s.io`) show a
  note that only implementations supporting them resolve the reference.
- A live preview in route forms of whether the selected listeners accept the route.
- **Wizards**:
  - Gateway: class → listeners → TLS → allowed routes → summary.
  - HTTPRoute: parents → hostnames → matches → filters → backends → summary.
  - **Expose a Service**: Service → existing or new Gateway → route. Creates the HTTPRoute, the
    Gateway when needed, and the ReferenceGrants required when namespaces differ.
- **Review before apply**: client-side validation, a **server-side dry-run** (with strict field
  validation, so typos in field names are reported) and a diff of the changes. Nothing can be
  applied before the dry-run has passed; API errors are listed per field.
- **RBAC aware**: create is disabled with an explanation when the user may not create the kind,
  and "Edit with form" only appears for users who may update the object. Headlamp's own YAML
  edit and delete actions keep their usual permission checks.

### Screenshots

**Overview**

![Overview](https://raw.githubusercontent.com/batuhancikrikci/headlamp-plugins/main/gateway/docs/screenshots/overview.jpg)

**Topology**

![Topology](https://raw.githubusercontent.com/batuhancikrikci/headlamp-plugins/main/gateway/docs/screenshots/topology.jpg)

**Gateway detail**

![Gateway detail](https://raw.githubusercontent.com/batuhancikrikci/headlamp-plugins/main/gateway/docs/screenshots/gateway-detail.jpg)

**HTTPRoute detail**

![HTTPRoute detail](https://raw.githubusercontent.com/batuhancikrikci/headlamp-plugins/main/gateway/docs/screenshots/httproute-detail.jpg)

### Requirements

- Headlamp **0.45.0** or newer.
- The Gateway API CRDs (developed against **v1.6.1**; older bundles are supported through runtime discovery) and a conformant Gateway API controller (for example Envoy Gateway).
- The bundle version, channel and documentation tab need `get` on `customresourcedefinitions`; without it they are shown as unknown.

### Supported Gateway API versions

|                        |                                                                                                                                                                                                                                        |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Primary target         | Gateway API **v1.6.1**, as shipped with Envoy Gateway v1.9                                                                                                                                                                             |
| Standard channel kinds | GatewayClass, Gateway, HTTPRoute, GRPCRoute, TLSRoute, TCPRoute, UDPRoute, ListenerSet, ReferenceGrant, BackendTLSPolicy                                                                                                               |
| Experimental channel   | Experimental fields of the standard kinds (for example retries and session persistence) can be edited. The experimental kinds of `gateway.networking.x-k8s.io` (XBackendTrafficPolicy, XBackend, XMesh, XListenerSet) are not covered. |
| Older bundles          | Supported through runtime discovery: `v1beta1`, `v1alpha3` and `v1alpha2` versions are used when they are the newest served                                                                                                            |

The plugin discovers at runtime which kinds and versions the cluster serves and always uses the
most stable served version (`v1` before `v1beta1` before `v1alphaN`). When the Gateway API is not
installed at all, the overview explains how to install it.

The bundle version and channel are read from the CRD annotations, which requires permission to
read CustomResourceDefinitions; without it they are shown as unknown and everything else works.

#### Offline use

The plugin makes no request to anything but the Kubernetes API of the cluster:

- there are no links to external documentation; the field reference comes from the CRDs
  installed in the cluster;
- every icon it uses is bundled (`npm run icons` generates `src/icons/bundle.json` from the
  icon names found in the sources; it runs automatically before `npm run build` and `npm start`).

### Installation

#### From the Headlamp plugin catalog (Artifact Hub)

The plugin is published on [Artifact Hub](https://artifacthub.io/packages/headlamp/batuhancikrikci-headlamp-plugins/gateway). In the Headlamp desktop app, open the plugin
catalog, search for **Gateway API** and install it. The catalog shows only official plugins by default; turn off the **Only Official** switch in the
catalog (or **Display only Official Plugins** in its settings) to see this plugin.

#### Manual installation

Download `gateway-<version>.tar.gz` from [GitHub Releases](https://github.com/batuhancikrikci/headlamp-plugins/releases), compare its SHA-256
checksum with the `.sha256` file and extract it into the Headlamp plugins directory:

| Platform | Plugins directory                                                                                       |
| -------- | ------------------------------------------------------------------------------------------------------- |
| Linux    | `~/.config/Headlamp/plugins/` (or `~/.local/share/Headlamp/plugins/` when it exists)                    |
| macOS    | `~/Library/Application Support/Headlamp/plugins/` (otherwise `~/Library/Preferences/Headlamp/plugins/`) |
| Windows  | `%APPDATA%\Headlamp\Config\plugins\` (or `%LOCALAPPDATA%\Headlamp\Data\plugins\` when it exists)        |

```bash
tar -xzf gateway-*.tar.gz -C ~/.config/Headlamp/plugins/
```

The directory must contain `gateway/main.js` and `gateway/package.json`. Reload Headlamp afterwards
(Ctrl+Shift+R / Cmd+Shift+R).

To confirm that the tarball was built from this repository by its release workflow, verify its
build provenance with the [GitHub CLI](https://cli.github.com):
`gh attestation verify gateway-<version>.tar.gz --repo batuhancikrikci/headlamp-plugins`.

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
      - name: gateway
        source: https://artifacthub.io/packages/headlamp/batuhancikrikci-headlamp-plugins/gateway
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
COPY --from=build /plugin/dist /headlamp/plugins/gateway
```

### Configuration

The plugin has no settings of its own; it works with the permissions of the Kubernetes user.

### Compatibility

| Component     | Version                                                                    |
| ------------- | -------------------------------------------------------------------------- |
| Headlamp      | ≥ 0.45.0 (`@kinvolk/headlamp-plugin` 0.14)                                 |
| Gateway API   | v1.6.1 (standard channel); older bundles `v1beta1`, `v1alpha3`, `v1alpha2` |
| Envoy Gateway | v1.9                                                                       |

API versions are discovered at runtime; the table lists the versions used during development and testing.

### Notes and limitations

- The interface is English only.
- Relationship checks run in the browser on the objects the user may list. With restricted
  permissions some checks report "unknown" instead of a verdict (for example ReferenceGrants or
  namespace labels that cannot be read).
- Listeners with an implementation specific protocol are displayed and editable in YAML, but have
  no dedicated form fields. Backend kinds other than Service, `Backend` and `InferencePool` get no
  object suggestions; their group and kind are typed in.
- The forms cover the commonly used fields. Rarely used ones (for example Gateway frontend client
  certificate validation or per-backend filters) are edited in the YAML tab; the form keeps them
  untouched.

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
| `npm run package`                   | `gateway-<version>.tar.gz` for distribution               |
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
  index.tsx                 Sidebar, routes, sidebar filter, kind icons, map source
  plugin.ts                 Identity of the plugin, used by src/common
  common/                   Shared building blocks, identical in every plugin of this repository
  icons/                    Generated icon bundle
  resources/                Gateway API types, kind registry, Headlamp resource classes
  discovery/                Runtime discovery of kinds and versions, CRD gate
  data/                     Live data provider, API writes, RBAC and namespace hooks
  utils/                    Pure logic (unit tested): conditions, references, ReferenceGrants,
                            attachment, validation, YAML, templates, topology, expose-a-service
  components/
    overview/ topology/ kinds/ common/
    editor/                 Editor dialog with dry-run review, forms, wizards, form fields
    docs/                   Documentation side panel
    wizards/                Expose a Service
scripts/
  build-icons.mjs           Offline icon bundle (src/icons/bundle.json)
  deploy.mjs                Build and install into the local Headlamp desktop app
```

### License

Licensed under the [Apache License 2.0](https://github.com/batuhancikrikci/headlamp-plugins/blob/main/gateway/LICENSE). Third-party components and trademark notices are listed in [NOTICE](https://github.com/batuhancikrikci/headlamp-plugins/blob/main/gateway/NOTICE).

This is an independent project; it is not affiliated with or endorsed by the Headlamp project or the projects it works with. Kubernetes, Headlamp and Envoy Gateway are trademarks of their respective owners and are used only to identify the software this plugin works with.

### Contributing

Open an [issue](https://github.com/batuhancikrikci/headlamp-plugins/issues) for bugs and ideas. The contribution guidelines are in [CONTRIBUTING.md](https://github.com/batuhancikrikci/headlamp-plugins/blob/main/CONTRIBUTING.md) and security reports are handled as described in [SECURITY.md](https://github.com/batuhancikrikci/headlamp-plugins/blob/main/SECURITY.md).

---

## Türkçe

Kubernetes [Gateway API](https://gateway-api.sigs.k8s.io/) (`gateway.networking.k8s.io`) için bir
[Headlamp](https://headlamp.dev) eklentisi. Headlamp'in yerleşik "Gateway (beta)" sayfalarının yerine
genel bakış, topoloji görünümü, ilişkileri açıklayan detay sayfaları, rehberli formlar ve sihirbazlar
getirir.

**Headlamp v0.45.0** ve **Envoy Gateway v1.9** (Gateway API v1.6.1) ile geliştirilmiştir ve uyumlu
her Gateway API controller'ıyla çalışır.

### Özellikler

#### Gezinme

- Üst düzeyde bir **Gateway API** kenar çubuğu girdisi (yerleşik olanla aynı ikon,
  `mdi:lan-connect`). Headlamp'in yerleşik "Gateway (beta)" menüsü gizlenir, böylece yinelenen
  girdi olmaz.
- Overview ve Topology'nin altında tür başına bir girdi. Mevcut kümede kurulu olmayan türler gizlenir.
- Eklenti yerleşik sayfalarla aynı URL'leri sunar (`/gateways`, `/httproutes/…`); böylece Resource
  Map'ten, genel aramadan ve diğer eklentilerden gelen bağlantılar bu eklentinin sayfalarını açar.

#### Genel bakış

- Kurulu Gateway API paket sürümü ve kanalı, kaç türün sunulduğu.
- Tür başına kaynak sayısı ve sağlık dağılımını gösteren bir kutu.
- `Accepted`, `Programmed` ve `ResolvedRefs` koşullarının toplamları.
- **Dikkat gerektirenler**: başarısız koşullar (controller'ın nedeni ve mesajıyla, anlaşılır bir dille yazılmış
  ipucuyla), ReferenceGrant'i olmayan namespace'ler arası referanslar, var olmayan backend'ler, bir Gateway'e bağlı olmayan (yetim)
  route'lar, sınıfı var olmayan Gateway'ler.
- Controller'larıyla GatewayClass'lar.

#### Topoloji

Soldan sağa bir **GatewayClass → Gateway → Listener → Route → Backend** grafiği:

- Node başına sağlık renklendirmesi; kırık bağlantılar (dinleyicinin kabul etmediği route, eksik
  Service, izni olmayan referans) kırmızı çizilir.
- Bir node'un üzerine gelin ya da odaklanın, içinden geçen tüm yol vurgulanır; detay sayfasını açmak
  için tıklayın.
- Namespace filtresi, metin filtresi ve "yalnızca sorunlar" anahtarı.
- ListenerSet'ler, bağlandıkları Gateway'e kendi dinleyicilerini katar.

Eklenti ayrıca TLSRoute ve ListenerSet'i (ilişkileriyle) Headlamp'in diğer Gateway API türlerini
zaten kapsayan kendi Resource Map'ine ekler.

#### Liste ve detay sayfaları

Her tür için namespace farkındalıklı, aranabilir ve sıralanabilir listeler; spec'i olduğu gibi
dökmek yerine kaynağı açıklayan detay sayfaları:

| Tür                          | Öne çıkanlar                                                                                                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GatewayClass                 | controller, sınıfı kullanan Gateway'ler, desteklenen özellikler                                                                                                  |
| Gateway                      | TLS'li dinleyiciler, izin verilen route'lar ve dinleyici başına durum; "dinleyicilerin izin verdiği" analiziyle bağlı route'lar; ListenerSet'ler                 |
| ListenerSet                  | üst Gateway (ve set'i kabul edip etmediği), dinleyiciler, bağlı route'lar                                                                                        |
| HTTPRoute, GRPCRoute         | okunabilir eşleşme ve filtrelerle kurallar; trafik payı, Service / port varlığı ve ReferenceGrant durumuyla backend'ler; üst başına koşullar ve bağlanma analizi |
| TLSRoute, TCPRoute, UDPRoute | üstler, backend'ler, üst başına koşullar                                                                                                                         |
| ReferenceGrant               | kimden / kime ve şu anda bu izne dayanan referanslar                                                                                                             |
| BackendTLSPolicy             | hedefler, doğrulama ayarları, üst kaynak (ancestor) başına durum                                                                                                              |

Her detay sayfasında olaylar gösterilir.

#### Oluşturma ve düzenleme

- **Her türün rehberli bir formu ve bir YAML editörü vardır.** İkisi aynı nesneyi düzenler: sekmeler arasında geçiş
  yapmak veri kaybına yol açmaz ve formda karşılığı olmayan alanlar korunur.
- Alanın yanında doğrulama (zorunlu alanlar, hostname kuralları, port aralıkları, enum'lar ve Gateway
  API CRD'lerinin alanlar arası kuralları), makul varsayılanlar ve satır içi yardım.
- Headlamp'ten ayrılmadan şema dokümantasyonu: liste ve detay sayfalarındaki kitap düğmesi bir yan panel açar,
  editörde de bir Documentation sekmesi vardır. İkisi de kümenin CRD şemasından üretilen gezilebilir
  bir alan dokümantasyonu gösterir (tipler, zorunlu alanlar, izin verilen değerler, varsayılanlar ve
  doğrulama kuralları) ve mevcut nesnede dolu alanları işaretler. Şemayı okumak CustomResourceDefinition
  okuma yetkisi gerektirir.
- Kümedeki nesneler için seçiciler: GatewayClass'lar, Gateway'ler ve dinleyicileri, Service'ler ve
  portları, TLS Secret'ları, namespace'ler.
- Backend referansları Service'in yanında, kümenin sunduğu (API keşfiyle bulunan) her API
  grubundaki `Backend` türlerini ve `InferencePool` türünü, backend namespace'indeki nesneleriyle
  birlikte sunar. Kubernetes projesi grupları (`*.k8s.io`, `*.x-k8s.io`) dışındaki türlerde,
  referansı yalnızca bu türü destekleyen implementasyonların çözdüğünü belirten bir not gösterilir.
- Route formlarında, seçilen dinleyicilerin route'u kabul edip etmeyeceğinin canlı önizlemesi.
- **Sihirbazlar**:
  - Gateway: sınıf → dinleyiciler → TLS → izin verilen route'lar → özet.
  - HTTPRoute: üstler → hostname'ler → eşleşmeler → filtreler → backend'ler → özet.
  - **Expose a Service**: Service → var olan ya da yeni Gateway → route. HTTPRoute'u, gerekirse
    Gateway'i ve namespace'ler farklıysa gereken ReferenceGrant'leri oluşturur.
- **Uygulamadan önce inceleme**: istemci tarafı doğrulama, **sunucu tarafı dry-run** (sıkı alan
  doğrulamasıyla, böylece alan adlarındaki yazım hataları bildirilir) ve değişikliklerin farkı.
  Dry-run geçmeden hiçbir şey uygulanamaz; API hataları alan başına listelenir.
- **RBAC farkındalığı**: kullanıcı türü oluşturamıyorsa oluşturma açıklamayla devre dışıdır ve
  "Edit with form" yalnızca nesneyi güncelleyebilen kullanıcılara görünür. Headlamp'in kendi YAML
  düzenleme ve silme eylemleri her zamanki yetki denetimlerini korur.

### Ekran görüntüleri

**Genel bakış**

![Genel bakış](https://raw.githubusercontent.com/batuhancikrikci/headlamp-plugins/main/gateway/docs/screenshots/overview.jpg)

**Topoloji**

![Topoloji](https://raw.githubusercontent.com/batuhancikrikci/headlamp-plugins/main/gateway/docs/screenshots/topology.jpg)

**Gateway detayı**

![Gateway detayı](https://raw.githubusercontent.com/batuhancikrikci/headlamp-plugins/main/gateway/docs/screenshots/gateway-detail.jpg)

**HTTPRoute detayı**

![HTTPRoute detayı](https://raw.githubusercontent.com/batuhancikrikci/headlamp-plugins/main/gateway/docs/screenshots/httproute-detail.jpg)

### Gereksinimler

- Headlamp **0.45.0** veya üstü.
- Gateway API CRD'leri (**v1.6.1** ile geliştirildi; eski paketler çalışma anı keşfiyle desteklenir) ve uyumlu bir Gateway API controller'ı (örneğin Envoy Gateway).
- Paket sürümü ve kanalı ile belge sekmesi için `customresourcedefinitions` üzerinde `get` yetkisi gerekir; yoksa bu bilgiler "bilinmiyor" olarak gösterilir.

### Desteklenen Gateway API sürümleri

|                        |                                                                                                                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Birincil hedef         | Envoy Gateway v1.9 ile gelen Gateway API **v1.6.1**                                                                                                                                                                |
| Standart kanal türleri | GatewayClass, Gateway, HTTPRoute, GRPCRoute, TLSRoute, TCPRoute, UDPRoute, ListenerSet, ReferenceGrant, BackendTLSPolicy                                                                                           |
| Deneysel kanal         | Standart türlerin deneysel alanları (örneğin retry ve oturum kalıcılığı) düzenlenebilir. `gateway.networking.x-k8s.io` grubunun deneysel türleri (XBackendTrafficPolicy, XBackend, XMesh, XListenerSet) kapsanmaz. |
| Eski paketler          | Çalışma anı keşfiyle desteklenir: en yeni sunulan sürümse `v1beta1`, `v1alpha3` ve `v1alpha2` kullanılır                                                                                                           |

Eklenti kümenin hangi türleri ve sürümleri sunduğunu çalışma zamanında keşfeder ve her zaman sunulan en
kararlı sürümü kullanır (`v1`, sonra `v1beta1`, sonra `v1alphaN`). Gateway API hiç kurulu değilse
genel bakış nasıl kurulacağını açıklar.

Paket sürümü ve kanalı CRD annotation'larından okunur; bu, CustomResourceDefinition okuma yetkisi
gerektirir. Yetki yoksa bunlar "bilinmiyor" olarak gösterilir, geri kalan her şey çalışır.

#### Çevrimdışı kullanım

Eklenti kümenin Kubernetes API'si dışında hiçbir yere istek yapmaz:

- dış belgelere bağlantı yoktur; alan dokümantasyonu kümede kurulu CRD'lerden gelir;
- kullandığı her ikon pakete gömülüdür (`npm run icons`, kaynaklarda bulunan ikon adlarından
  `src/icons/bundle.json` dosyasını üretir; `npm run build` ve `npm start` öncesinde otomatik çalışır).

### Kurulum

#### Headlamp eklenti kataloğundan (Artifact Hub)

Eklenti [Artifact Hub](https://artifacthub.io/packages/headlamp/batuhancikrikci-headlamp-plugins/gateway) üzerinde yayınlanır. Headlamp masaüstü uygulamasında eklenti
kataloğunu açın, **Gateway API** araması yapın ve eklentiyi kurun. Katalog varsayılan olarak yalnızca resmî (official) eklentileri gösterir; bu eklentiyi görmek için
katalogdaki **Only Official** anahtarını (ya da ayarlarındaki **Display only Official Plugins** seçeneğini) kapatın.

#### Elle kurulum

[GitHub Releases](https://github.com/batuhancikrikci/headlamp-plugins/releases) sayfasından `gateway-<sürüm>.tar.gz` dosyasını indirin, SHA-256
sağlama toplamını (checksum) `.sha256` dosyasıyla doğrulayın ve Headlamp eklenti dizinine açın:

| Platform | Eklenti dizini                                                                                      |
| -------- | --------------------------------------------------------------------------------------------------- |
| Linux    | `~/.config/Headlamp/plugins/` (varsa `~/.local/share/Headlamp/plugins/`)                            |
| macOS    | `~/Library/Application Support/Headlamp/plugins/` (yoksa `~/Library/Preferences/Headlamp/plugins/`) |
| Windows  | `%APPDATA%\Headlamp\Config\plugins\` (varsa `%LOCALAPPDATA%\Headlamp\Data\plugins\`)                |

```bash
tar -xzf gateway-*.tar.gz -C ~/.config/Headlamp/plugins/
```

Dizinde `gateway/main.js` ve `gateway/package.json` bulunmalıdır. Ardından Headlamp'i yeniden
yükleyin (Ctrl+Shift+R / Cmd+Shift+R).

Paketin bu depodaki sürüm iş akışıyla derlendiğini, derleme kaynağı kanıtını
[GitHub CLI](https://cli.github.com) ile denetleyerek doğrulayabilirsiniz:
`gh attestation verify gateway-<sürüm>.tar.gz --repo batuhancikrikci/headlamp-plugins`.

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
      - name: gateway
        source: https://artifacthub.io/packages/headlamp/batuhancikrikci-headlamp-plugins/gateway
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
COPY --from=build /plugin/dist /headlamp/plugins/gateway
```

### Yapılandırma

Eklentinin ayrı bir yapılandırması yoktur; Kubernetes kullanıcısının yetkileriyle çalışır.

### Uyumluluk

| Bileşen       | Sürüm                                                                      |
| ------------- | -------------------------------------------------------------------------- |
| Headlamp      | ≥ 0.45.0 (`@kinvolk/headlamp-plugin` 0.14)                                 |
| Gateway API   | v1.6.1 (standard channel); older bundles `v1beta1`, `v1alpha3`, `v1alpha2` |
| Envoy Gateway | v1.9                                                                       |

API sürümleri çalışma zamanında keşfedilir; tabloda geliştirme ve test sırasında kullanılan sürümler yer alır.

### Notlar ve sınırlamalar

- Arayüz yalnızca İngilizcedir.
- İlişki denetimleri tarayıcıda, kullanıcının listeleyebildiği nesneler üzerinde çalışır. Kısıtlı
  yetkilerle bazı denetimler bir sonuç yerine "bilinmiyor" olarak raporlanır (örneğin okunamayan
  ReferenceGrant'ler veya namespace etiketleri).
- Uygulamaya özgü protokollü dinleyiciler gösterilir ve YAML'de düzenlenebilir, ama özel form
  alanları yoktur. Service, `Backend` ve `InferencePool` dışındaki backend türleri için nesne
  önerisi gelmez; grup ve tür elle yazılır.
- Formlar yaygın kullanılan alanları kapsar. Nadir kullanılanlar (örneğin Gateway ön yüz istemci
  sertifikası doğrulaması veya backend başına filtreler) YAML sekmesinde düzenlenir; form onlara
  dokunmaz.

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
| `npm run package`                   | Dağıtım için `gateway-<sürüm>.tar.gz`                |
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
  index.tsx                 Kenar çubuğu, rotalar, kenar çubuğu filtresi, tür ikonları, harita kaynağı
  plugin.ts                 Eklentinin kimliği (src/common tarafından kullanılır)
  common/                   Ortak yapı taşları, bu depodaki tüm eklentilerde tamamen aynı
  icons/                    Üretilen ikon paketi
  resources/                Gateway API tipleri, tür kayıt defteri, Headlamp kaynak sınıfları
  discovery/                Türlerin ve sürümlerin çalışma zamanında keşfi, CRD kapısı
  data/                     Canlı veri sağlayıcı, API yazmaları, RBAC ve namespace hook'ları
  utils/                    Saf mantık (birim testli): koşullar, referanslar, ReferenceGrant'ler,
                            bağlanma, doğrulama, YAML, şablonlar, topoloji, expose-a-service
  components/
    overview/ topology/ kinds/ common/
    editor/                 Dry-run incelemeli editör penceresi, formlar, sihirbazlar, form alanları
    docs/                   Belge yan paneli
    wizards/                Expose a Service
scripts/
  build-icons.mjs           Çevrimdışı ikon paketi (src/icons/bundle.json)
  deploy.mjs                Derler ve yerel Headlamp masaüstüne kurar
```

### Lisans

[Apache License 2.0](https://github.com/batuhancikrikci/headlamp-plugins/blob/main/gateway/LICENSE) ile lisanslanmıştır. Üçüncü taraf bileşenler ve marka bildirimleri [NOTICE](https://github.com/batuhancikrikci/headlamp-plugins/blob/main/gateway/NOTICE) dosyasındadır.

Bu bağımsız bir projedir; Headlamp projesiyle ya da birlikte çalıştığı projelerle bağlantılı değildir ve onlar tarafından onaylanmamıştır. Kubernetes, Headlamp ve Envoy Gateway ilgili sahiplerinin ticari markalarıdır; yalnızca eklentinin birlikte çalıştığı yazılımı tanımlamak için kullanılır.

### Katkıda bulunma

Hata bildirimleri ve öneriler için [issue](https://github.com/batuhancikrikci/headlamp-plugins/issues) açın. Katkı kuralları [CONTRIBUTING.md](https://github.com/batuhancikrikci/headlamp-plugins/blob/main/CONTRIBUTING.md), güvenlik bildirimleri [SECURITY.md](https://github.com/batuhancikrikci/headlamp-plugins/blob/main/SECURITY.md) içindedir.
