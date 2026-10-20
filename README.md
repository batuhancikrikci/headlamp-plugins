# Headlamp plugins

[![CI](https://github.com/batuhancikrikci/headlamp-plugins/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/batuhancikrikci/headlamp-plugins/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Artifact Hub](https://img.shields.io/endpoint?url=https://artifacthub.io/badge/repository/batuhancikrikci-headlamp-plugins)](https://artifacthub.io/packages/search?repo=batuhancikrikci-headlamp-plugins)

[English](#english) | [Türkçe](#türkçe)

---

## English

### Overview

This repository contains independent plugins for [Headlamp](https://headlamp.dev), the web UI for
Kubernetes. Each plugin makes a common Kubernetes platform component (Cilium, Gateway API, Envoy
Gateway, Prometheus Operator, Open Cluster Management, AI/LLM serving, …) manageable from inside
Headlamp: overview dashboards, detail pages that explain relationships, guided forms, wizards and
field documentation generated from the CRD schemas of the cluster.

What the plugins have in common:

- They only talk to the Kubernetes API, with the permissions of the signed-in user; there is no
  backend or service account of their own.
- They discover API versions at runtime; components that are not installed are shown with
  explanatory empty states.
- Icons are bundled, so they work without internet access.
- They use the same shared building blocks (`src/common/`), so they look and behave consistently.

### Plugins

| Plugin               | Description                                                                                           | Directory                                |
| -------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| **Agent Router**     | Envoy AI Gateway / Agent Router: AI routes, service backends, security and quota policies, MCP routes | [agentrouter](agentrouter/README.md)     |
| **Cilium**           | Network policies, endpoints and identities, BGP, LB IPAM, egress gateway and Envoy configuration      | [cilium](cilium/README.md)               |
| **Envoy Gateway**    | Envoy Gateway policies and resources, relationships, wizards                                          | [envoy-gateway](envoy-gateway/README.md) |
| **Gateway API**      | Overview, topology, review with dry-run and wizards for the Gateway API                               | [gateway](gateway/README.md)             |
| **Headlamp Plus**    | Headlamp's original themes, cluster and workloads dashboards, same-tab OIDC sign-in                   | [headlamp-plus](headlamp-plus/README.md) |
| **Inference Hub**    | AI/LLM platform console for KServe, llm-d, vLLM and the NVIDIA GPU Operator                           | [inference-hub](inference-hub/README.md) |
| **Monitoring**       | kube-prometheus-stack / Prometheus Operator: alerts, silences, PromQL, targets                        | [monitoring](monitoring/README.md)       |
| **Multicluster Hub** | Open Cluster Management hubs: clusters, placements, ManifestWorks, add-ons, GitOps                    | [multi-cluster](multi-cluster/README.md) |

### Repository layout

Every plugin is an independent npm package in its own directory; it is built, tested and released
on its own.

```text
<plugin>/
  src/common/          Shared building blocks (identical in every plugin)
  src/plugin.ts        Identity of the plugin (name, title, product details)
  scripts/             build-icons.mjs, deploy.mjs (identical in every plugin)
  artifacthub-pkg.yml  Artifact Hub package metadata
  CHANGELOG.md, LICENSE, NOTICE, README.md
scripts/               Repository tools: check-common.mjs, update-artifacthub.mjs, deploy-all.sh
.github/               CI and release workflows, templates, Dependabot
```

The shared files are kept as a separate copy in each plugin, so every plugin can be used on its
own. `node scripts/check-common.mjs` checks that the copies stay identical; CI runs it on every
pull request.

### Prerequisites

- Headlamp **0.45.0** or newer (desktop or in-cluster).
- Node.js **20.11+** and npm **10+** to build from source.
- The component each plugin manages, installed in the cluster (see the page of the plugin).

### Installation

**From the catalog:** the plugins are published on Artifact Hub. In the Headlamp desktop app, open
the plugin catalog, search for the plugin and install it. The catalog shows only official plugins by
default; turn off **Only official plugins** in the Plugin Catalog settings to see these plugins.

**Manually:** download `<plugin>-<version>.tar.gz` from
[GitHub Releases](https://github.com/batuhancikrikci/headlamp-plugins/releases) and extract it into
the Headlamp plugins directory (`~/.config/Headlamp/plugins/` on Linux,
`~/Library/Application Support/Headlamp/plugins/` on macOS, `%APPDATA%\Headlamp\Config\plugins\`
on Windows). Verify that a tarball was built in this repository with
`gh attestation verify <plugin>-<version>.tar.gz --repo batuhancikrikci/headlamp-plugins`.

**In-cluster:** the plugin manager of the Headlamp Helm chart can install several plugins at once:

```yaml
pluginsManager:
  enabled: true
  configContent: |
    plugins:
      - name: cilium
        source: https://artifacthub.io/packages/headlamp/batuhancikrikci-headlamp-plugins/cilium
      - name: gateway
        source: https://artifacthub.io/packages/headlamp/batuhancikrikci-headlamp-plugins/gateway
```

### Development

```bash
cd cilium            # or any other plugin
npm ci
npm start            # rebuilds on every change and copies the result into the local Headlamp
npm run check        # type-check, lint, unit tests
npm run deploy       # checks + build + install into the local Headlamp desktop app
```

From the repository root, `./scripts/deploy-all.sh` installs every plugin and
`node scripts/check-common.mjs` checks the shared files.

### Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the guidelines,
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for the code of conduct and [SECURITY.md](SECURITY.md)
for reporting security problems.

### License

All plugins are licensed under the [Apache License 2.0](LICENSE). Third-party components and
notices are listed in [NOTICE](NOTICE) and in the `NOTICE` file of each plugin.

### Disclaimer

This is an independent project. It is not affiliated with or endorsed by any company or
organization, or by the Headlamp, Kubernetes, Cilium, Envoy or any other project. Kubernetes,
Headlamp, Cilium, Envoy, Prometheus, Open Cluster Management, Argo CD, KServe, vLLM, NVIDIA and
other names and logos are trademarks of their respective owners and are used only to identify the
software the plugins work with. The plugins are provided "as is", without warranty of any kind.

### Acknowledgements

The CRD documentation viewer was inspired by the documentation tab of the
[Headlamp KubeVirt plugin](https://github.com/naval-group/headlamp-kubevirt). The plugins are built
on the plugin template and the `@kinvolk/headlamp-plugin` tooling of the Headlamp project.

---

## Türkçe

### Genel bakış

Bu depo, Kubernetes için web arayüzü [Headlamp](https://headlamp.dev)'e yönelik bağımsız
eklentiler içerir. Her eklenti, farklı bir Kubernetes platform bileşenini (Cilium,
Gateway API, Envoy Gateway, Prometheus Operator, Open Cluster Management, AI/LLM servisleri…)
Headlamp üzerinden yönetilebilir hâle getirir: genel bakış panoları, ilişkileri açıklayan detay
sayfaları, rehberli formlar, sihirbazlar ve kümedeki CRD şemasından dinamik olarak üretilen alan dokümantasyonu.

Eklentilerin ortak özellikleri:

- Yalnızca Kubernetes API'si ile ve oturum açmış kullanıcının yetkileriyle çalışırlar; kendilerine ait ayrı bir servis hesabı (ServiceAccount) yoktur.
- API sürümlerini çalışma zamanında (runtime) keşfederler; kurulu olmayan bileşenler açıklamalı boş ekranlarla gösterilir.
- İkonlar pakete gömülüdür; internet erişimi olmayan (air-gapped) ortamlarda da sorunsuz çalışırlar.
- Aynı ortak yapı taşlarını (`src/common/`) kullanırlar; bu sayede arayüz görünümü ve davranışları tutarlıdır.

### Eklentiler

| Eklenti              | Açıklama                                                                                                           | Dizin                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| **Agent Router**     | Envoy AI Gateway / Agent Router: AI route'ları, servis backend'leri, güvenlik ve kota politikaları, MCP route'ları | [agentrouter](agentrouter/README.md)     |
| **Cilium**           | Ağ politikaları, uç noktalar ve kimlikler, BGP, LB IPAM, egress gateway ve Envoy yapılandırması                    | [cilium](cilium/README.md)               |
| **Envoy Gateway**    | Envoy Gateway politikaları ve kaynakları, ilişkiler, sihirbazlar                                                   | [envoy-gateway](envoy-gateway/README.md) |
| **Gateway API**      | Gateway API için genel bakış, topoloji, dry-run ile inceleme, sihirbazlar                                          | [gateway](gateway/README.md)             |
| **Headlamp Plus**    | Headlamp'in orijinal temaları, küme ve iş yükü panoları, aynı sekmede OIDC girişi                                  | [headlamp-plus](headlamp-plus/README.md) |
| **Inference Hub**    | KServe, llm-d, vLLM ve NVIDIA GPU Operator için AI/LLM platform konsolu                                            | [inference-hub](inference-hub/README.md) |
| **Monitoring**       | kube-prometheus-stack / Prometheus Operator: alarmlar, silence'lar, PromQL, hedefler                               | [monitoring](monitoring/README.md)       |
| **Multicluster Hub** | Open Cluster Management hub'ı: kümeler, placement'lar, ManifestWork, eklentiler, GitOps                            | [multi-cluster](multi-cluster/README.md) |

### Depo yapısı

Her eklenti kendi dizininde bağımsız bir npm paketidir; tek başına derlenir, test edilir ve
yayınlanır.

```text
<eklenti>/
  src/common/          Ortak yapı taşları (tüm eklentilerde tamamen aynı)
  src/plugin.ts        Eklentinin kimliği (ad, başlık, ürün bilgileri)
  scripts/             build-icons.mjs, deploy.mjs (tüm eklentilerde aynı)
  artifacthub-pkg.yml  Artifact Hub paket bilgileri
  CHANGELOG.md, LICENSE, NOTICE, README.md
scripts/               Depo araçları: check-common.mjs, update-artifacthub.mjs, deploy-all.sh
.github/               CI ve sürüm iş akışları, şablonlar, Dependabot
```

Ortak dosyalar her eklentide ayrı bir kopya olarak bulunur; böylece her eklenti bağımsız olarak
kullanılabilir. `node scripts/check-common.mjs` bu kopyaların eşitliğini denetler; bu denetim CI üzerinde her pull request'te otomatik olarak çalıştırılır.

### Ön koşullar

- Headlamp **0.45.0** veya üstü (masaüstü ya da küme içi).
- Kaynaktan derlemek için Node.js **20.11+** ve npm **10+**.
- Her eklentinin yönettiği bileşenin kümede kurulu olması (ayrıntılar eklentinin sayfasında).

### Kurulum

**Katalogdan:** Eklentiler Artifact Hub'da yayınlanır. Headlamp masaüstü uygulamasında eklenti
kataloğunu açın, eklentiyi arayın ve kurun. Katalog varsayılan olarak yalnızca resmî (official)
eklentileri gösterir; bu eklentileri görmek için Plugin Catalog ayarlarında **Only official plugins**
seçeneğini kapatın.

**Elle:** [GitHub Releases](https://github.com/batuhancikrikci/headlamp-plugins/releases)
sayfasından `<eklenti>-<sürüm>.tar.gz` dosyasını indirip Headlamp eklenti dizinine açın
(Linux'ta `~/.config/Headlamp/plugins/`, macOS'ta `~/Library/Application Support/Headlamp/plugins/`,
Windows'ta `%APPDATA%\Headlamp\Config\plugins\`). Paketin bu depoda derlendiğini
`gh attestation verify <eklenti>-<sürüm>.tar.gz --repo batuhancikrikci/headlamp-plugins` komutuyla doğrulayabilirsiniz.

**Küme içi:** Headlamp Helm chart'ının eklenti yöneticisiyle birden fazla eklenti birlikte
kurulabilir:

```yaml
pluginsManager:
  enabled: true
  configContent: |
    plugins:
      - name: cilium
        source: https://artifacthub.io/packages/headlamp/batuhancikrikci-headlamp-plugins/cilium
      - name: gateway
        source: https://artifacthub.io/packages/headlamp/batuhancikrikci-headlamp-plugins/gateway
```

### Geliştirme

```bash
cd cilium            # veya başka bir eklenti
npm ci
npm start            # her değişiklikte derler ve yerel Headlamp'e kopyalar
npm run check        # tip denetimi, lint, birim testleri
npm run deploy       # denetim + derleme + yerel Headlamp masaüstüne kurulum
```

Depo kök dizininden tüm eklentileri kurmak için `./scripts/deploy-all.sh`, ortak dosyaları denetlemek
için `node scripts/check-common.mjs` kullanılır.

### Katkıda bulunma

Projeye katkıda bulunmanızdan memnuniyet duyarız. Katkı kuralları [CONTRIBUTING.md](CONTRIBUTING.md), davranış kuralları
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) ve güvenlik bildirimleri [SECURITY.md](SECURITY.md)
dosyalarındadır.

### Lisans

Tüm eklentiler [Apache License 2.0](LICENSE) ile lisanslanmıştır. Üçüncü taraf bileşenler ve
bildirimler [NOTICE](NOTICE) dosyasında ve her eklentinin kendi `NOTICE` dosyasındadır.

### Sorumluluk reddi

Bu bağımsız bir projedir; herhangi bir şirket, kurum veya Headlamp, Kubernetes, Cilium, Envoy ya da
diğer projelerle bağlantılı değildir ve onlar tarafından onaylanmamıştır. Kubernetes, Headlamp,
Cilium, Envoy, Prometheus, Open Cluster Management, Argo CD, KServe, vLLM, NVIDIA ve diğer adlar ile
logolar ilgili sahiplerinin ticari markalarıdır; yalnızca eklentilerin birlikte çalıştığı
yazılımları tanımlamak için kullanılır. Eklentiler "olduğu gibi", hiçbir garanti olmaksızın
sağlanır.

### Teşekkür

CRD dokümantasyon görüntüleyicisi, [Headlamp KubeVirt eklentisinin](https://github.com/naval-group/headlamp-kubevirt)
dokümantasyon sekmesinden esinlenmiştir. Eklentiler, Headlamp projesinin eklenti şablonu ve
`@kinvolk/headlamp-plugin` araçları üzerine kuruludur.
