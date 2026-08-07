# Babyfolio Storage Optimization Helm Chart

이 Chart는 기존 PostgreSQL과 Ceph RGW/S3 bucket에 연결되는 Family Frame frontend/backend 애플리케이션을 배포합니다. namespace, 데이터베이스, bucket, Secret, Cloudflare 및 DNS 리소스는 생성하지 않습니다.

## 사전 조건

- Kubernetes와 Helm 3
- 접근 가능한 기존 PostgreSQL
- 접근 가능한 기존 Ceph RGW/S3 endpoint와 `family-frame` bucket
- frontend/backend container image
- 설치 대상 namespace에 존재하는 Kubernetes Secret
- 기본 Ingress를 사용할 경우 Kong Ingress Controller와 `kong` IngressClass

Chart의 기본 image repository는 의도적으로 `example.invalid` placeholder입니다. 실제 Harbor/GitLab registry 경로와 release tag가 확정되면 반드시 교체해야 합니다. `config.*`, ingress host, Secret 이름과 key도 환경에 맞게 검토하십시오.

namespace는 Chart가 관리하지 않습니다. 설치 시 다음처럼 별도로 지정합니다.

```sh
kubectl create namespace family-frame
```

이미 팀 또는 Argo CD가 namespace를 관리한다면 위 명령은 실행하지 않습니다.

## 기존 Secret

Chart는 Secret 값을 생성하거나 values에 평문으로 받지 않습니다. 다음은 형식 예시이며 placeholder를 실제 값으로 교체해 클러스터에 직접 생성해야 합니다.

```sh
kubectl create secret generic family-frame-secrets \
  --namespace family-frame \
  --from-literal=DATABASE_URL='<DATABASE_URL>' \
  --from-literal=S3_ACCESS_KEY_ID='<S3_ACCESS_KEY_ID>' \
  --from-literal=S3_SECRET_ACCESS_KEY='<S3_SECRET_ACCESS_KEY>'
```

Secret 이름과 각 key 이름은 `existingSecret.name` 및 `existingSecret.keys.*`로 변경할 수 있습니다. 현재 backend 코드가 직접 읽는 민감 설정은 `DATABASE_URL`과 S3 자격증명입니다.

## 검증과 설치

```sh
helm lint .

helm template babyfolio . \
  --namespace family-frame \
  --set ingress.enabled=true \
  > /tmp/babyfolio-rendered.yaml

kubectl apply --dry-run=client \
  -f /tmp/babyfolio-rendered.yaml

helm install babyfolio . \
  --namespace family-frame \
  --dry-run \
  --debug
```

실제 설치 또는 upgrade 예시:

```sh
helm upgrade --install babyfolio . \
  --namespace family-frame \
  --create-namespace \
  --set frontend.image.repository='<FRONTEND_IMAGE_REPOSITORY>' \
  --set frontend.image.tag='<RELEASE_TAG>' \
  --set backend.image.repository='<BACKEND_IMAGE_REPOSITORY>' \
  --set backend.image.tag='<RELEASE_TAG>'
```

운영에서는 많은 값을 `--set`으로 나열하기보다 환경별 values 파일을 별도로 관리하는 방식을 권장합니다. 저장소에 실제 Secret 값은 추가하지 마십시오.

## 설정

ConfigMap에는 다음 비민감 환경변수가 문자열로 렌더링됩니다.

- `APP_ORIGIN`, `API_ORIGIN`
- `SESSION_COOKIE_NAME`, `SESSION_TTL_DAYS`
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`
- `SIGNED_URL_TTL_SECONDS`
- `MAX_ACTIVE_UPLOADS_PER_USER`

frontend에는 `PORT`와 `API_ORIGIN`만 주입합니다. 브라우저 요청은 동일 origin의 `/api/*`를 사용하고 Kong이 backend로 직접 전달하지만, Next.js Server Component는 frontend Pod에서 API를 호출하기 위해 runtime `API_ORIGIN`을 사용합니다. production 기본 public origin은 `https://rakko.site`입니다. backend에는 `PORT`, ConfigMap 전체와 기존 Secret의 세 key를 주입합니다. `MAX_ACTIVE_UPLOADS_PER_USER`는 1~20 문자열이며 기본값은 `"5"`입니다.

`next.config.ts`의 rewrite는 local development에서 `/api/*`를 localhost backend로 전달합니다. 이 값은 image build 시점에 고정될 수 있으므로 production 브라우저 routing에는 사용하지 않습니다. Kong Ingress가 `/api` 요청을 frontend보다 먼저 backend Service로 전달하므로 frontend Pod의 rewrite나 `localhost:4000` fallback에 의존하지 않습니다.

frontend image는 Node `USER node`로 3000 포트에서 실행하고 `/healthz`가 204를 반환합니다. backend image도 `USER node`로 4000 포트에서 실행하며 `/api/health/live`와 PostgreSQL/S3를 확인하는 `/api/health/ready`를 제공합니다. 따라서 기본 probe는 실제 HTTP endpoint를 사용합니다.

두 image 모두 non-root 실행이 보장되어 `runAsNonRoot`, privilege escalation 차단, capability drop과 RuntimeDefault seccomp를 기본 적용합니다. `readOnlyRootFilesystem`는 ffmpeg 임시 파일과 런타임 쓰기 경로를 별도로 검증하지 않았으므로 기본 활성화하지 않습니다. backend resource 기본값은 Sharp/ffmpeg 처리를 고려한 개발용 예시이므로 부하 측정 후 조정해야 합니다.

## Migration Job

Migration은 backend와 동일한 image로 다음 명령을 실행합니다.

```text
node node_modules/prisma/build/index.js migrate deploy
```

backend runtime image에는 production dependency인 Prisma CLI와 `prisma.config.ts`, schema, migrations가 포함됩니다. Job은 `pre-install,pre-upgrade` Helm hook이며 `before-hook-creation,hook-succeeded` 정책을 사용합니다. migration 실패 시 hook 실패로 Helm install/upgrade도 실패하므로 backend 배포 성공처럼 보이지 않습니다.

Hook은 일반 Chart 리소스보다 먼저 실행되므로 새로 생성되는 ServiceAccount나 ConfigMap에는 의존하지 않습니다. 기존 Secret의 `DATABASE_URL`만 참조하고 API token automount는 비활성화합니다.

Argo CD는 Helm hook annotation을 sync hook으로 해석하지만 버전과 운영 정책에 따라 hook 삭제 및 재실행 동작을 확인해야 합니다. 팀의 Argo CD 정책이 Helm hook을 허용하지 않는다면 `migration.enabled=false`로 렌더링을 끄고, 동일 backend image와 DATABASE_URL Secret을 사용해 별도 PreSync Job을 GitOps 저장소에서 관리하십시오. migration 실패 원인을 보존해야 할 때는 다음 배포 전에 Job 로그와 상태를 확인하십시오.

## Ingress 및 외부 인프라

Ingress를 활성화하면 기본 IngressClass는 `kong`이며 단일 host `rakko.site`에서 `/api` Prefix는 backend Service로, `/` Prefix는 frontend Service로 전달합니다. 기본 annotation `konghq.com/strip-path: "false"`가 Kong의 path stripping을 비활성화하므로 `/api` prefix가 제거되지 않고 NestJS의 기존 `/api` global prefix에 그대로 도달합니다. 다만 기존 `templates/nginx-php-kong.yaml` 테스트 Ingress가 이미 `rakko.site`의 `/`를 사용하므로 `ingress.enabled`의 기본값은 `false`입니다. 기존 테스트 Ingress를 제거하거나 전환한 뒤에만 app Ingress를 활성화해야 합니다. `ingress.tls`가 비어 있으면 TLS block은 생성하지 않습니다. TLS Secret, 인증서, Cloudflare Tunnel, 외부 DNS, Ceph RGW와 PostgreSQL은 Chart 외부에서 관리합니다. 별도 `api.rakko.site` public hostname은 필요하지 않으며 `s3.rakko.site`는 Ceph RGW endpoint로 유지합니다.

Kong rate-limiting Plugin과 임의 RPS 제한은 포함하지 않습니다. 정확한 정책과 관리 주체가 확정된 뒤 별도로 적용해야 합니다. 특정 Kong Service 또는 Route 이름에도 의존하지 않습니다.

## 기본값에서 반드시 교체하거나 확인할 항목

- `frontend.image.repository`, `frontend.image.tag`
- `backend.image.repository`, `backend.image.tag`
- private registry라면 `global.imagePullSecrets`
- `config.appOrigin`, `config.apiOrigin`, `config.s3Endpoint`, bucket과 region
- `existingSecret.name` 및 실제 key 이름
- `ingress.className`, `ingress.host`와 환경별 TLS 설정
- replica 수, resource requests/limits, scheduling 설정
- Argo CD에서 migration hook을 처리하는 방식
